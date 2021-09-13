'use strict';

/**
 * Group API-s (/api/../groups/..)
 */

module.exports = function (app) {
    const logger = app.get('logger');
    const models = app.get('models');
    const db = models.sequelize;
    const Op = db.Sequelize.Op;
    const _ = app.get('lodash');
    const cosActivities = app.get('cosActivities');
    const validator = app.get('validator');
    const emailLib = app.get('email');
    const util = app.get('util');
    const moment = app.get('moment');
    const Promise = app.get('Promise');

    const loginCheck = app.get('middleware.loginCheck');
    const asyncMiddleware = app.get('middleware.asyncMiddleware');

    const Group = models.Group;
    const GroupInviteUser = models.GroupInviteUser;
    const GroupMemberUser = models.GroupMemberUser;
    const User = models.User;

    const _hasPermission = async function (groupId, userId, level, allowPublic, allowSelf) {
        try {
            const result = await db.query(`
                SELECT
                    g.visibility = \'public\' AS "isPublic",
                    gm.level::"enum_GroupMemberUsers_level" >= :level AS "allowed",
                    gm."userId" AS uid,
                    gm."level" AS level,
                    g.id
                FROM "Groups" g
                LEFT JOIN "GroupMemberUsers" gm
                    ON(gm."groupId" = g.id)
                WHERE g.id = :groupId
                    AND gm."userId" = :userId
                    AND gm."deletedAt" IS NULL
                    AND g."deletedAt" IS NULL
                GROUP BY id, uid, level;`, {
            replacements: {
                groupId: groupId,
                userId: userId,
                level: level
            },
            type: db.QueryTypes.SELECT,
            raw: true
        });
        if (result && result[0]) {
            const isPublic = result[0].isPublic;
            const isAllowed = result[0].allowed;

            if (isAllowed || (allowPublic && isPublic) || allowSelf) {
                return true;
            }
        }

            return Promise.reject();
        } catch(err) {
            return Promise.reject(err);
        }
    };
    const hasPermission = function (level, allowPublic, allowSelf) {
        return function (req, res, next) {
            const groupId = req.params.groupId;
            const userId = req.user.id;
            let allowDeleteSelf = allowSelf;

            if (allowSelf) {
                if (userId !== req.params.memberId) {
                    allowDeleteSelf = false;
                }
            }

            return _hasPermission(groupId, userId, level, allowPublic, allowDeleteSelf)
                .then(function () {
                    return new Promise(function (resolve) {
                        return resolve(next(null, req, res));
                    });
                }, function (err) {
                    if (err) {
                        return next(err);
                    }

                    return res.forbidden('Insufficient permissions');
                })
                .catch(next);
        };
    };

    /**
     * Create a new Group
     */
    app.post('/api/users/:userId/groups', loginCheck(['partner']), function (req, res, next) {
        const group = Group
            .build({
                name: req.body.name,
                creatorId: req.user.id,
                parentId: req.body.parentId, //TODO: check that user actually has Permissions on the Parent and the Parent exists?
                visibility: req.body.visibility || Group.VISIBILITY.private
            });

        db
            .transaction(function (t) {
                return group
                    .save({transaction: t})
                    .then(function () {
                        return cosActivities
                            .createActivity(
                                group,
                                null,
                                {
                                    type: 'User',
                                    id: req.user.id,
                                    ip: req.ip
                                },
                                req.method + ' ' + req.path, t
                            );
                    })
                    .then(function () {
                        return group.addMember( // Magic method by Sequelize - https://github.com/sequelize/sequelize/wiki/API-Reference-Associations#hasmanytarget-options
                            req.user.id
                            ,
                            {
                                through: {
                                    level: GroupMemberUser.LEVELS.admin
                                },
                                transaction: t
                            }
                        );
                    });
            })
            .then(function () {
                return res.created(group.toJSON());
            })
            .catch(next);
    });


    /**
     * Read a Group
     */
    app.get('/api/users/:userId/groups/:groupId', loginCheck(['partner']), hasPermission(GroupMemberUser.LEVELS.read, null, null), function (req, res, next) {
        db
            .query(
                'SELECT \
                     g.id, \
                     g."parentId" AS "parent.id", \
                     g.name, \
                     g.visibility, \
                     c.id as "creator.id", \
                     c.email as "creator.email", \
                     c.name as "creator.name", \
                     c."createdAt" as "creator.createdAt", \
                     mc.count as "members.count" \
                FROM "Groups" g \
                    LEFT JOIN "Users" c ON (c.id = g."creatorId") \
                    LEFT JOIN ( \
                        SELECT "groupId", count("userId") AS "count" \
                        FROM "GroupMemberUsers" \
                        WHERE "deletedAt" IS NULL \
                        GROUP BY "groupId" \
                    ) AS mc ON (mc."groupId" = g.id) \
                WHERE g.id = :groupId;',
                {
                    replacements: {
                        groupId: req.params.groupId
                    },
                    type: db.QueryTypes.SELECT,
                    raw: true,
                    nest: true
                }
            )
            .then(function (result) {
                if (result && result.length && result[0]) {
                    const group = result[0];

                    return res.ok(group);
                }
            })
            .catch(next);
    });

    /**
     * Update Group info
     */
    app.put('/api/users/:userId/groups/:groupId', loginCheck(['partner']), hasPermission(GroupMemberUser.LEVELS.admin, null, null), function (req, res, next) {
        const groupId = req.params.groupId;
        const groupName = req.body.name;

        Group
            .findOne({
                where: {
                    id: groupId
                }
            })
            .then(function (group) {
                group.name = groupName;

                return group
                    .validate()
                    .then(function (group) {
                        return db
                            .transaction(function (t) {
                                return cosActivities
                                    .updateActivity(
                                        group,
                                        null,
                                        {
                                            type: 'User',
                                            id: req.user.id,
                                            ip: req.ip
                                        },
                                        null,
                                        req.method + ' ' + req.path,
                                        t
                                    )
                                    .then(function () {
                                        return db
                                            .query(
                                                'WITH \
                                                    updated AS ( \
                                                        UPDATE \
                                                            "Groups" SET \
                                                            "name"= :groupName, \
                                                            "updatedAt"=:timestamp \
                                                                WHERE "id" = :groupId \
                                                            RETURNING * \
                                                    ) \
                                                    SELECT  \
                                                        g.id, \
                                                        g."parentId" AS "parent.id", \
                                                        g.name, \
                                                        g.visibility, \
                                                        c.id as "creator.id", \
                                                        c.email as "creator.email", \
                                                        c.name as "creator.name", \
                                                        c."createdAt" as "creator.createdAt", \
                                                        mc.count as "members.count" \
                                                    FROM updated g \
                                                    LEFT JOIN \
                                                        "Users" c ON (c.id = g."creatorId") \
                                                            LEFT JOIN ( \
                                                                SELECT "groupId", count("userId") AS "count" \
                                                                FROM "GroupMemberUsers" \
                                                                WHERE "deletedAt" IS NULL \
                                                                GROUP BY "groupId" \
                                                            ) AS mc ON (mc."groupId" = g.id);'
                                                , {
                                                    replacements: {
                                                        timestamp: moment().format('YYYY-MM-DD HH:mm:ss.SSS ZZ'),
                                                        groupId: req.params.groupId,
                                                        groupName: req.body.name
                                                    },
                                                    type: db.QueryTypes.SELECT,
                                                    raw: true,
                                                    nest: true,
                                                    transaction: t
                                                }
                                            );
                                    });
                            });
                    })
                    .then(function (result) {
                        if (result && result.length && result[0]) {
                            return res.ok(result[0]);
                        }

                        return next();
                    });
            })
            .catch(next);
    });

    /**
     * Delete Group
     */
    app.delete('/api/users/:userId/groups/:groupId', loginCheck(['partner']), hasPermission(GroupMemberUser.LEVELS.admin, null, null), async function (req, res, next) {
        try {
            const group = await Group.findByPk(req.params.groupId);
            if (!group) {
                return res.notFound('No such Group found.');
            }

            await db.transaction(async function (t) {
                await GroupMemberUser.destroy({where: {groupId: group.id}}, {transaction: t});
                await group.destroy({transaction: t});
                await cosActivities.deleteActivity(
                    group,
                    null,
                    {
                        type: 'User',
                        id: req.user.id,
                        ip: req.ip
                    },
                    req.method + ' ' + req.path, t
                );
                t.afterCommit(() => {
                    return res.ok();
                });
            });
        }
        catch(err) {
            return next (err);
        }
    });


    /**
     * Get all Groups User belongs to
     */
    app.get('/api/users/:userId/groups', loginCheck(['partner']), function (req, res, next) {
        let include = req.query.include;
        // Sequelize and associations are giving too eager results + not being the most effective. https://github.com/sequelize/sequelize/issues/2458
        // Falling back to raw SQL
        // TODO: support LIMIT & OFFSET
        // TODO: This cannot possibly be the most effective query in the world..
        let joinText = '';
        let returnFields = '';
        if (include && !Array.isArray(include)) {
            include = [include];
        }

        if (include) {
            let union = false;
            joinText = 'LEFT JOIN (';
            if (include.indexOf('member.topic') > -1) {
                joinText += '\
                                SELECT \
                                    tmg."topicId" as "memberId", \
                                    t.title as "memberName", \
                                    \'topic\' as "type", \
                                    tmg."groupId" as "groupId", \
                                    tmg.level::text as "memberLevel" \
                                FROM "TopicMemberGroups" tmg \
                                LEFT JOIN "Topics" t \
                                ON t.id = tmg."topicId" \
                                WHERE tmg."deletedAt" IS NULL ';
                union = true;
                returnFields += ' tmgpl.level as "member.levelTopic", ';
            }
            if (include.indexOf('member.user') > -1) {
                if (union) {
                    joinText += ' UNION ';
                }
                joinText += '\
                                SELECT \
                                    gmu."userId" as "memberId", \
                                    u.name as "memberName", \
                                    \'user\' as type, \
                                    gmu."groupId" as "groupId", \
                                    gmu.level::text as "memberLevel" \
                                FROM "GroupMemberUsers" gmu \
                                LEFT JOIN "Users" u \
                                ON u.id = gmu."userId" \
                                WHERE gmu."deletedAt" IS NULL';
            }
            joinText += ') as members ON members."groupId" = g.id ';
            joinText += ' \
                        LEFT JOIN ( \
                        SELECT DISTINCT ON (tmgp."topicId") * FROM ( \
                            SELECT \
                                tmg."topicId", \
                                gm."userId", \
                                tmg.level::text, \
                                2 as "priority" \
                            FROM "TopicMemberGroups" tmg \
                                LEFT JOIN "GroupMemberUsers" gm \
                            ON tmg."groupId" = gm."groupId" \
                            WHERE tmg."deletedAt" IS NULL \
                             \
                            UNION \
                              \
                            SELECT \
                                tmu."topicId", \
                                tmu."userId", \
                                tmu.level::text, \
                                1 as "priority" \
                            FROM "TopicMemberUsers" tmu \
                            WHERE tmu."deletedAt" IS NULL \
                            ) as tmgp ORDER BY tmgp."topicId", tmgp."priority", tmgp.level::"enum_TopicMemberUsers_level" DESC ) as tmgpl ON tmgpl."topicId" = members."memberId"';
            returnFields += '\
                                members."memberId" as "member.memberId", \
                                members."memberName" as "member.memberName", \
                                members."type" as "member.memberType", \
                                members."memberLevel" as "member.level", ';
        }

        db
            .query(
                ' \
                SELECT \
                    g.id, \
                    g."parentId" AS "parent.id", \
                    g.name, \
                    g.visibility, \
                    c.id as "creator.id", \
                    c.email as "creator.email", \
                    c.name as "creator.name", \
                    gm.level as "permission.level", \
                    mc.count as "members.users.count", \
                    COALESCE(gtc.count, 0) as "members.topics.count", \
                    gt."topicId" as "members.topics.latest.id", \
                    ' + returnFields + ' \
                    gt.title as "members.topics.latest.title" \
                FROM "Groups" g \
                    JOIN "GroupMemberUsers" gm ON (gm."groupId" = g.id) \
                    JOIN "Users" c ON (c.id = g."creatorId") \
                    JOIN ( \
                        SELECT "groupId", count("userId") AS "count" \
                        FROM "GroupMemberUsers" \
                        WHERE "deletedAt" IS NULL \
                        GROUP BY "groupId" \
                    ) AS mc ON (mc."groupId" = g.id) \
                    LEFT JOIN ( \
                        SELECT \
                            tmg."groupId", \
                            count(tmg."topicId") AS "count" \
                        FROM "TopicMemberGroups" tmg \
                        WHERE tmg."deletedAt" IS NULL \
                        GROUP BY tmg."groupId" \
                    ) AS gtc ON (gtc."groupId" = g.id) \
                    LEFT JOIN ( \
                        SELECT \
                            tmg."groupId", \
                            tmg."topicId", \
                            t.title \
                        FROM "TopicMemberGroups" tmg \
                            LEFT JOIN "Topics" t ON (t.id = tmg."topicId") \
                        WHERE tmg."deletedAt" IS NULL \
                        ORDER BY t."updatedAt" ASC \
                    ) AS gt ON (gt."groupId" = g.id) \
                    ' + joinText + ' \
                WHERE g."deletedAt" IS NULL \
                    AND gm."deletedAt" is NULL \
                    AND gm."userId" = :userId \
                ORDER BY g."updatedAt" DESC, g.id; \
                ',
                {
                    replacements: {
                        userId: req.user.id
                    },
                    type: db.QueryTypes.SELECT,
                    raw: true,
                    nest: true
                }
            )
            .then(function (rows) {
                const results = {
                    count: 0,
                    rows: []
                };
                const memberGroupIds = [];

                rows.forEach(function (groupRow) {
                    const group = _.cloneDeep(groupRow);
                    const member = _.clone(group.member);


                    if (memberGroupIds.indexOf(group.id) < 0) {
                        delete group.member;
                        group.members.users.rows = [];
                        group.members.topics.rows = [];
                        results.rows.push(group);
                        memberGroupIds.push(group.id);
                    }

                    if (include && member && member.memberId) {
                        results.rows.find(function (g, index) {
                            if (g.id === group.id) {
                                const newMember = {
                                    id: member.memberId
                                };

                                if (member.memberType === 'topic') {
                                    newMember.title = member.memberName;
                                    newMember.level = member.levelTopic;

                                    const topicInGroup = results.rows[index].members.topics.rows.find(function (t) {
                                        return t.id === newMember.id;
                                    });

                                    if (!topicInGroup) {
                                        results.rows[index].members.topics.rows.push(newMember);
                                    }

                                    return true;
                                } else if (member.memberType === 'user') {
                                    newMember.name = member.memberName;
                                    newMember.level = member.level;
                                    results.rows[index].members.users.rows.push(newMember);

                                    return true;
                                } else {
                                    return true;
                                }
                            }

                            return false;
                        });
                    }
                });

                return results;
            })
            .then(function (results) {
                results.rows.forEach(function (row) {
                    if (!row.members.topics.latest.id) {
                        delete row.members.topics.latest;
                    }
                    if (!include || include.indexOf('member.user') < 0) {
                        delete row.members.users.rows;
                    }
                    if (!include || include.indexOf('member.topic') < 0) {
                        delete row.members.topics.rows;
                    }
                });
                results.count = results.rows.length;

                return res.ok(results);
            })
            .catch(next);
    });

    /**
     * Get Group member Users
     */
    app.get(['/api/users/:userId/groups/:groupId/members/users'], loginCheck(['partner']), hasPermission(GroupMemberUser.LEVELS.read, null, null), async function (req, res, next) {
        //FIXME: Deprecation warning - https://github.com/citizenos/citizenos-fe/issues/348

        const groupId = req.params.groupId;
        const limitDefault = 10;
        const offset = parseInt(req.query.offset, 10) ? parseInt(req.query.offset, 10) : 0;
        let limit = parseInt(req.query.limit, 10) ? parseInt(req.query.limit, 10) : limitDefault;
        const search = req.query.search;

        let where = '';
        if (search) {
            where = ` AND u.name ILIKE :search `
        }

        try {
            const members = await db
                .query(
                    `SELECT
                        u.id,
                        u.name,
                        u.company,
                        u."imageUrl",
                        gm.level,
                        count(*) OVER()::integer AS "countTotal"
                    FROM "GroupMemberUsers" gm
                        JOIN "Users" u ON (u.id = gm."userId")
                    WHERE gm."groupId" = :groupId
                    AND gm."deletedAt" IS NULL
                    ${where}
                    LIMIT :limit
                    OFFSET :offset
                    ;`,
                    {
                        replacements: {
                            groupId,
                            limit,
                            offset,
                            search: `%${search}%`
                        },
                        type: db.QueryTypes.SELECT,
                        raw: true
                    }
                );
            let countTotal = 0;
            if (members && members.length) {
                countTotal = members[0].countTotal;
                members.forEach(function (member) {
                    delete member.countTotal;
                });
            }

            return res.ok({
                countTotal,
                count: members.length,
                rows: members
            });
        } catch (err) {
            return next(err);
        }
    });

    /**
     * Update membership information
     */
    app.put(['/api/users/:userId/groups/:groupId/members/users/:memberId'], loginCheck(['partner']), hasPermission(GroupMemberUser.LEVELS.admin, null, null), function (req, res, next) {
        const newLevel = req.body.level;
        const memberId = req.params.memberId;
        const groupId = req.params.groupId;

        GroupMemberUser
            .findAll({
                where: {
                    groupId: groupId,
                    level: GroupMemberUser.LEVELS.admin
                },
                attributes: ['userId'],
                raw: true
            })
            .then(function (result) {
                if (result.length === 1 && _.find(result, {userId: memberId})) {
                    return res.badRequest('Cannot revoke admin permissions from the last admin member.');
                }

                return GroupMemberUser
                    .findOne({
                        where: {
                            groupId: groupId,
                            userId: memberId
                        }
                    })
                    .then(function (groupMemberUser) {
                        groupMemberUser.level = newLevel;

                        return db
                            .transaction(function (t) {
                                return cosActivities
                                    .updateActivity(
                                        groupMemberUser,
                                        null,
                                        {
                                            type: 'User',
                                            id: req.user.id,
                                            ip: req.ip
                                        },
                                        null,
                                        req.method + ' ' + req.path, t
                                    )
                                    .then(function () {
                                        return groupMemberUser
                                            .save({
                                                transaction: t
                                            });
                                    });
                            });
                    });
            })
            .then(function () {
                return res.ok();
            })
            .catch(next);
    });

    /**
     * Delete membership information
     */
    app.delete(['/api/users/:userId/groups/:groupId/members/users/:memberId'], loginCheck(['partner']), hasPermission(GroupMemberUser.LEVELS.admin, null, true), function (req, res, next) {
        const groupId = req.params.groupId;
        const memberId = req.params.memberId;

        GroupMemberUser
            .findAll({
                where: {
                    groupId: groupId,
                    level: GroupMemberUser.LEVELS.admin
                },
                attributes: ['userId'],
                raw: true
            })
            .then(function (result) {
                // At least 1 admin member has to remain at all times..
                if (result.length === 1 && _.find(result, {userId: memberId})) {
                    return res.badRequest('Cannot delete the last admin member.');
                }

                // TODO: Used to use GroupMember.destroy, but that broke when moving 2.x->3.x - https://github.com/sequelize/sequelize/issues/4465
                // NOTE: Postgres does not support LIMIT for DELETE, thus the hidden "ctid" column and subselect is used
                return db
                    .transaction(function (t) {
                        const group = Group.build({id: groupId});
                        const user = User.build({id: memberId});
                        group.dataValues.id = groupId;
                        user.dataValues.id = memberId;

                        return cosActivities
                            .deleteActivity(
                                user,
                                group,
                                {
                                    type: 'User',
                                    id: req.user.id,
                                    ip: req.ip
                                },
                                req.method + ' ' + req.path,
                                t
                            )
                            .then(function () {
                                return db
                                    .query(
                                        '\
                                        DELETE FROM \
                                            "GroupMemberUsers" \
                                        WHERE ctid IN (\
                                            SELECT \
                                                ctid \
                                            FROM "GroupMemberUsers" \
                                            WHERE "groupId" = :groupId \
                                            AND "userId" = :userId \
                                            LIMIT 1 \
                                        ) \
                                        ',
                                        {
                                            replacements: {
                                                groupId: groupId,
                                                userId: memberId
                                            },
                                            type: db.QueryTypes.DELETE,
                                            transaction: t,
                                            raw: true
                                        }
                                    );
                            });
                    });
            })
            .then(function () {
                return res.ok();
            })
            .catch(next);
    });

    /**
     * Invite new Members to the Group
     *
     * Does NOT add a Member automatically, but will send an invite, which has to accept in order to become a Member of the Group
     *
     * @see https://github.com/citizenos/citizenos-fe/issues/348
     */
    app.post('/api/users/:userId/groups/:groupId/invites/users', loginCheck(), hasPermission(GroupMemberUser.LEVELS.admin, null, null), asyncMiddleware(async function (req, res) {
        //NOTE: userId can be actual UUID or e-mail - it is comfort for the API user, but confusing in the BE code.
        const groupId = req.params.groupId;
        const userId = req.user.id;
        let members = req.body;

        if (!Array.isArray(members)) {
            members = [members];
        }
        const inviteMessage = members[0].inviteMessage; // IF future holds personalized invite messages, every invite has its own message. Also, easiest solution without rewriting a lot of code.
        const validEmailMembers = [];
        let validUserIdMembers = [];

        // userId can be actual UUID or e-mail, sort to relevant buckets
        _(members).forEach(function (m) {
            if (m.userId) {
                m.userId = m.userId.trim();

                // Is it an e-mail?
                if (validator.isEmail(m.userId)) {
                    validEmailMembers.push(m); // The whole member object with level
                } else if (validator.isUUID(m.userId, 4)) {
                    validUserIdMembers.push(m);
                } else {
                    logger.warn('Invalid member ID, is not UUID or email thus ignoring', req.method, req.path, m, req.body);
                }
            } else {
                logger.warn('Missing member id, ignoring', req.method, req.path, m, req.body);
            }
        });

        const validEmails = _.map(validEmailMembers, 'userId');
        if (validEmails.length) {
            // Find out which e-mails already exist
            const usersExistingEmail = await User
                .findAll({
                    where: {
                        email: {
                            [Op.iLike]: {
                                [Op.any]: validEmails
                            }
                        }
                    },
                    attributes: ['id', 'email']
                });


            _(usersExistingEmail).forEach(function (u) {
                const member = _.find(validEmailMembers, {userId: u.email});
                if (member) {
                    member.userId = u.id;
                    validUserIdMembers.push(member);
                    _.remove(validEmailMembers, member); // Remove the e-mail, so that by the end of the day only e-mails that did not exist remain.
                }
            });
        }

        let createdInvites = await db.transaction(async function (t) {
            let createdUsers;

            // The leftovers are e-mails for which User did not exist
            if (validEmailMembers.length) {
                const usersToCreate = [];
                _(validEmailMembers).forEach(function (m) {
                    usersToCreate.push({
                        email: m.userId,
                        language: m.language,
                        password: null,
                        name: util.emailToDisplayName(m.userId),
                        source: User.SOURCES.citizenos
                    });
                });

                createdUsers = await User.bulkCreate(usersToCreate, {transaction: t});

                const createdUsersActivitiesCreatePromises = createdUsers.map(async function (user) {
                    return cosActivities.createActivity(
                        user,
                        null,
                        {
                            type: 'System',
                            ip: req.ip
                        },
                        req.method + ' ' + req.path,
                        t
                    );
                });

                await Promise.all(createdUsersActivitiesCreatePromises);
            }

            // Go through the newly created users and add them to the validUserIdMembers list so that they get invited
            if (createdUsers && createdUsers.length) {
                _(createdUsers).forEach(function (u) {
                    const member = {
                        userId: u.id
                    };

                    // Sequelize defaultValue has no effect if "undefined" or "null" is set for attribute...
                    const level = _.find(validEmailMembers, {userId: u.email}).level;
                    if (level) {
                        member.level = level;
                    }

                    validUserIdMembers.push(member);
                });
            }

            // Need the Group just for the activity
            const group = await Group.findOne({
                where: {
                    id: groupId
                }
            });

            validUserIdMembers = validUserIdMembers.filter(function (member) {
                return member.userId !== req.user.id; // Make sure user does not invite self
            });
            const currentMembers = await GroupMemberUser.findAll({
                where: {
                    groupId: groupId
                }
            });

            const createInvitePromises = validUserIdMembers.map(async function (member) {
                const existingMember = currentMembers.find(function (cmember) {
                    return cmember.userId === member.userId;
                });
                if (existingMember) {
                    const levelsArray = Object.keys(GroupMemberUser.LEVELS);
                    if (existingMember.level !== member.level) {
                        if (levelsArray.indexOf(member.level) > levelsArray.indexOf(existingMember.level)) {
                            await existingMember.update({
                                level: member.level
                            });

                            cosActivities
                                .updateActivity(existingMember, null, {
                                    type: 'User',
                                    id: req.user.id,
                                    ip: req.ip
                                }, null, req.method + ' ' + req.path, t);

                            return;
                        }

                        return;
                    } else {
                        return;
                    }
                } else {
                    const groupInvite = await GroupInviteUser.create(
                        {
                            groupId: groupId,
                            creatorId: userId,
                            userId: member.userId,
                            level: member.level
                        },
                        {
                            transaction: t
                        }
                    );

                    const userInvited = User.build({id: groupInvite.userId});
                    userInvited.dataValues.level = groupInvite.level; // FIXME: HACK? Invite event, putting level here, not sure it belongs here, but.... https://github.com/citizenos/citizenos-fe/issues/112 https://github.com/w3c/activitystreams/issues/506
                    userInvited.dataValues.inviteId = groupInvite.id;

                    await cosActivities.inviteActivity(
                        group,
                        userInvited,
                        {
                            type: 'User',
                            id: req.user.id,
                            ip: req.ip
                        },
                        req.method + ' ' + req.path,
                        t
                    );

                    return groupInvite;
                }
            });

            return Promise.all(createInvitePromises);
        });

        createdInvites = createdInvites.filter(function (invite) {
            return !!invite;
        });

        for (let invite of createdInvites) { // IF future holds personalized invite messages, every invite has its own message and this code can be removed.
            invite.inviteMessage = inviteMessage;
        }

        await emailLib.sendGroupMemberUserInviteCreate(createdInvites);

        if (createdInvites.length) {
            return res.created({
                count: createdInvites.length,
                rows: createdInvites
            });
        } else {
            return res.badRequest('No invites were created. Possibly because no valid userId-s (uuidv4s or emails) were provided.', 1);
        }
    }));

    /**
     * Get all pending User invites for a Group
     *
     * @see https://github.com/citizenos/citizenos-fe/issues/348
     */
    app.get('/api/users/:userId/groups/:groupId/invites/users', loginCheck(), hasPermission(GroupMemberUser.LEVELS.read, null, null), asyncMiddleware(async function (req, res, next) {
        const limitDefault = 10;
        const offset = parseInt(req.query.offset, 10) ? parseInt(req.query.offset, 10) : 0;
        let limit = parseInt(req.query.limit, 10) ? parseInt(req.query.limit, 10) : limitDefault;
        const search = req.query.search;

        let where = '';
        if (search) {
            where = ` AND u.name ILIKE :search `
        }

        try {
            const invites = await db
                .query(
                    `SELECT
                    giu.id,
                    giu."creatorId",
                    giu.level,
                    giu."groupId",
                    giu."userId",
                    giu."createdAt",
                    giu."updatedAt",
                    u.id as "user.id",
                    u.name as "user.name",
                    u."imageUrl" as "user.imageUrl",
                    count(*) OVER()::integer AS "countTotal"
                FROM "GroupInviteUsers" giu
                JOIN "Users" u ON u.id = giu."userId"
                WHERE giu."groupId" = :groupId AND giu."deletedAt" IS NULL AND giu."createdAt" > NOW() - INTERVAL '${GroupInviteUser.VALID_DAYS}d'
                ${where}
                ORDER BY u.name ASC
                LIMIT :limit
                OFFSET :offset
                ;`,
                    {
                        replacements: {
                            groupId: req.params.groupId,
                            limit,
                            offset,
                            search: `%${search}%`
                        },
                        type: db.QueryTypes.SELECT,
                        raw: true,
                        nest: true
                    }
                );

            if (!invites) {
                return res.notFound();
            }
            let countTotal = 0;
            if (invites.length) {
                countTotal = invites[0].countTotal;
            }

            invites.forEach(function (invite) {
                delete invite.countTotal;
            });

            return res.ok({
                countTotal,
                count: invites.length,
                rows: invites
            });
        } catch (err) {
            return next(err);
        }
    }));

    /**
     * Get specific invite for a Group
     *
     * @see https://github.com/citizenos/citizenos-fe/issues/348
     */
    app.get(['/api/groups/:groupId/invites/users/:inviteId', '/api/users/:userId/groups/:groupId/invites/users/:inviteId'], asyncMiddleware(async function (req, res) {
        const groupId = req.params.groupId;
        const inviteId = req.params.inviteId;

        const invite = await GroupInviteUser
            .findOne(
                {
                    where: {
                        id: inviteId,
                        groupId: groupId
                    },
                    paranoid: false, // return deleted!
                    include: [
                        {
                            model: Group,
                            attributes: ['id', 'name', 'creatorId'],
                            as: 'group',
                            required: true
                        },
                        {
                            model: User,
                            attributes: ['id', 'name', 'company', 'imageUrl'],
                            as: 'creator',
                            required: true
                        },
                        {
                            model: User,
                            attributes: ['id', 'email'],
                            as: 'user',
                            required: true
                        }
                    ],
                    attributes: {
                        include: [
                            [
                                db.literal(`EXTRACT(DAY FROM (NOW() - "GroupInviteUser"."createdAt"))`),
                                'createdDaysAgo'
                            ]
                        ]
                    }
                }
            );

        if (!invite) {
            return res.notFound();
        }

        if (invite.deletedAt) {

            let hasAccess;
            try {
                hasAccess = await _hasPermission(groupId, invite.userId, GroupMemberUser.LEVELS.read, null, null);
            } catch (e) {
                hasAccess = false;
            }

            if (hasAccess) {
                return res.ok(invite, 1); // Invite has already been accepted OR deleted and the person has access
            }

            return res.gone('The invite has been deleted', 1);
        }

        if (invite.dataValues.createdDaysAgo > GroupInviteUser.VALID_DAYS) {
            return res.gone(`The invite has expired. Invites are valid for ${GroupInviteUser.VALID_DAYS} days`, 2);
        }

        // At this point we can already confirm users e-mail
        await User.update({emailIsVerified: true}, {
            where: {id: invite.userId},
            fields: ['emailIsVerified'],
            limit: 1
        });

        return res.ok(invite);
    }));

    /**
     * Delete Group invite
     *
     * @see https://github.com/citizenos/citizenos-fe/issues/348
     */
    app.delete(['/api/groups/:groupId/invites/users/:inviteId', '/api/users/:userId/groups/:groupId/invites/users/:inviteId'], loginCheck(), hasPermission(GroupMemberUser.LEVELS.admin), asyncMiddleware(async function (req, res) {
        const groupId = req.params.groupId;
        const inviteId = req.params.inviteId;

        const deletedCount = await GroupInviteUser
            .destroy(
                {
                    where: {
                        id: inviteId,
                        groupId: groupId
                    }
                }
            );

        if (!deletedCount) {
            return res.notFound('Invite not found', 1);
        }

        return res.ok();
    }));

    /**
     * Accept a group invite
     */
    app.post(['/api/users/:userId/groups/:groupId/invites/users/:inviteId/accept', '/api/groups/:groupId/invites/users/:inviteId/accept'], loginCheck(), asyncMiddleware(async function (req, res) {
        const userId = req.user.id;
        const groupId = req.params.groupId;
        const inviteId = req.params.inviteId;

        const invite = await GroupInviteUser
            .findOne(
                {
                    where: {
                        id: inviteId,
                        groupId: groupId
                    },
                    attributes: {
                        include: [
                            [
                                db.literal(`EXTRACT(DAY FROM (NOW() - "GroupInviteUser"."createdAt"))`),
                                'createdDaysAgo'
                            ]
                        ]
                    }
                }
            );

        // Find out if the User is already a member of the Group
        const memberUserExisting = await GroupMemberUser
            .findOne({
                where: {
                    groupId: groupId,
                    userId: userId
                }
            });

        if (invite) {
            if (invite.userId !== userId) {
                return res.forbidden();
            }

            if (memberUserExisting) {
                // User already a member, see if we need to update the level
                const levelsArray = Object.keys(GroupMemberUser.LEVELS);
                if (levelsArray.indexOf(memberUserExisting.level) < levelsArray.indexOf(invite.level)) {
                    const memberUserUpdated = await memberUserExisting.update({
                        level: invite.level
                    });
                    return res.ok(memberUserUpdated);
                } else {
                    // No level update, respond with existing member info
                    return res.ok(memberUserExisting);
                }
            } else {
                // Has the invite expired?
                if (invite.dataValues.createdDaysAgo > GroupInviteUser.VALID_DAYS) {
                    return res.gone(`The invite has expired. Invites are valid for ${GroupInviteUser.VALID_DAYS} days`, 2);
                }

                // Group needed just for the activity
                const group = await Group.findOne({
                    where: {
                        id: invite.groupId
                    }
                });

                const memberUserCreated = await db.transaction(async function (t) {
                    const member = await GroupMemberUser.create(
                        {
                            groupId: invite.groupId,
                            userId: invite.userId,
                            level: GroupMemberUser.LEVELS[invite.level]
                        },
                        {
                            transaction: t
                        }
                    );

                    await invite.destroy({transaction: t});

                    const user = User.build({id: member.userId});
                    user.dataValues.id = member.userId;

                    await cosActivities.acceptActivity(
                        invite,
                        {
                            type: 'User',
                            id: req.user.id,
                            ip: req.ip
                        },
                        {
                            type: 'User',
                            id: invite.creatorId
                        },
                        group,
                        req.method + ' ' + req.path,
                        t
                    );

                    return member;
                });

                return res.created(memberUserCreated);
            }
        } else {
            // Already a member, return that membership information
            if (memberUserExisting) {
                return res.ok(memberUserExisting);
            } else { // No invite, not a member - the User is not invited
                return res.notFound();
            }
        }
    }));

    /**
     * Get Group Topics
     */
    app.get('/api/users/:userId/groups/:groupId/topics', loginCheck(['partner']), hasPermission(GroupMemberUser.LEVELS.read, null, null), async function (req, res, next) {
        const userId = req.user.id;
        const visibility = req.query.visibility;
        const creatorId = req.query.creatorId;
        let statuses = req.query.statuses;
        const pinned = req.query.pinned;
        const hasVoted = req.query.hasVoted; // Filter out Topics where User has participated in the voting process.
        const showModerated = req.query.showModerated || false;
        if (statuses && !Array.isArray(statuses)) {
            statuses = [statuses];
        }

        let where = ` gt."groupId" = :groupId
            AND gt."deletedAt" IS NULL
            AND t."deletedAt" IS NULL
            AND t.title IS NOT NULL `;

        if (visibility) {
            where += ` AND t.visibility=:visibility `;
        }

        if (statuses && statuses.length) {
            where += ` AND t.status IN (:statuses) `;
        }

        if (pinned) {
            where += ` AND tp."topicId" = t.id AND tp."userId" = :userId`;
        }

        if (['true', '1'].includes(hasVoted)) {
            where += ` AND EXISTS (SELECT TRUE FROM "VoteLists" vl WHERE vl."voteId" = tv."voteId" AND vl."userId" = :userId LIMIT 1)`;
        } else if (['false', '0'].includes(hasVoted)) {
            where += ` AND tv."voteId" IS NOT NULL AND t.status = 'voting'::"enum_Topics_status" AND NOT EXISTS (SELECT TRUE FROM "VoteLists" vl WHERE vl."voteId" = tv."voteId" AND vl."userId" = :userId LIMIT 1)`;
        } else {
            logger.warn(`Ignored parameter "voted" as invalid value "${hasVoted}" was provided`);
        }

        if (!showModerated || showModerated == "false") {
            where += ` AND (tr."moderatedAt" IS NULL OR tr."resolvedAt" IS NOT NULL) `;
        } else {
            where += ` AND (tr."moderatedAt" IS NOT NULL AND tr."resolvedAt" IS NULL) `;
        }

        if (creatorId) {
            if (creatorId === userId) {
                where += ` AND u.id =:creatorId `;
            } else {
                return res.badRequest('No rights!');
            }
        }

        try {
            const topics = await db
                .query(
                    `SELECT
                        t.id,
                        t.title,
                        t.visibility,
                        t.status,
                        t.categories,
                        t."endsAt",
                        CASE
                            WHEN tp."topicId" = t.id THEN true
                            ELSE false
                        END as "pinned",
                        t.hashtag,
                        t."updatedAt",
                        t."createdAt",
                        COALESCE(ta."lastActivity", t."updatedAt") as "lastActivity",
                        COALESCE(tmup.level, tmgp.level, 'none') as "permission.level",
                        muc.count as "members.users.count",
                        COALESCE(mgc.count, 0) as "members.groups.count"
                    FROM "TopicMemberGroups" gt
                        JOIN "Topics" t ON (t.id = gt."topicId")
                        LEFT JOIN "TopicReports" tr ON  tr."topicId" = t.id
                        LEFT JOIN (
                            SELECT
                                tmu."topicId",
                                tmu."userId",
                                tmu.level::text AS level
                            FROM "TopicMemberUsers" tmu
                            WHERE tmu."deletedAt" IS NULL
                        ) AS tmup ON (tmup."topicId" = t.id AND tmup."userId" = :userId)
                        LEFT JOIN (
                            SELECT
                                tmg."topicId",
                                gm."userId",
                                MAX(tmg.level)::text AS level
                            FROM "TopicMemberGroups" tmg
                                LEFT JOIN "GroupMemberUsers" gm ON (tmg."groupId" = gm."groupId")
                            WHERE tmg."deletedAt" IS NULL
                            AND gm."deletedAt" IS NULL
                            GROUP BY "topicId", "userId"
                        ) AS tmgp ON (tmgp."topicId" = t.id AND tmgp."userId" = :userId)
                        LEFT JOIN (
                            SELECT tmu."topicId", COUNT(tmu."memberId") AS "count" FROM (
                                SELECT
                                    tmuu."topicId",
                                    tmuu."userId" AS "memberId"
                                FROM "TopicMemberUsers" tmuu
                                WHERE tmuu."deletedAt" IS NULL
                                UNION
                                SELECT
                                    tmg."topicId",
                                    gm."userId" AS "memberId"
                                FROM "TopicMemberGroups" tmg
                                    JOIN "GroupMemberUsers" gm ON (tmg."groupId" = gm."groupId")
                                WHERE tmg."deletedAt" IS NULL
                                AND gm."deletedAt" IS NULL
                            ) AS tmu GROUP BY "topicId"
                        ) AS muc ON (muc."topicId" = t.id)
                        LEFT JOIN (
                            SELECT "topicId", count("groupId")::integer AS "count"
                            FROM "TopicMemberGroups"
                            WHERE "deletedAt" IS NULL
                            GROUP BY "topicId"
                        ) AS mgc ON (mgc."topicId" = t.id)
                        LEFT JOIN "TopicPins" tp ON tp."topicId" = t.id AND tp."userId" = :userId
                        LEFT JOIN (
                            SELECT
                                tv."topicId",
                                tv."voteId",
                                v."authType",
                                v."createdAt",
                                v."delegationIsAllowed",
                                v."description",
                                v."endsAt",
                                v."maxChoices",
                                v."minChoices",
                                v."type",
                                v."autoClose"
                            FROM "TopicVotes" tv INNER JOIN
                                (
                                    SELECT
                                        MAX("createdAt") as "createdAt",
                                        "topicId"
                                    FROM "TopicVotes"
                                    GROUP BY "topicId"
                                ) AS _tv ON (_tv."topicId" = tv."topicId" AND _tv."createdAt" = tv."createdAt")
                            LEFT JOIN "Votes" v
                                    ON v.id = tv."voteId"
                        ) AS tv ON (tv."topicId" = t.id)
                        LEFT JOIN (
                            SELECT t.id, MAX(a."updatedAt") as "lastActivity"
                            FROM "Topics" t JOIN "Activities" a ON ARRAY[t.id::text] <@ a."topicIds" GROUP BY t.id
                        ) ta ON (ta.id = t.id)
                    WHERE ${where}
                    ORDER BY "pinned" DESC, t."updatedAt" DESC
                        ;`
                    ,
                {
                    replacements: {
                        groupId: req.params.groupId,
                        userId: req.user.id,
                        statuses,
                        visibility
                    },
                    type: db.QueryTypes.SELECT,
                    raw: true,
                    nest: true
                }
            );

            return res.ok({
                count: topics.length,
                rows: topics
            });
        } catch (err) {
            return next(err);
        }
    });

    /**
     * Get Group member Topics
     */
    app.get('/api/users/:userId/groups/:groupId/members/topics', loginCheck(['partner']), hasPermission(GroupMemberUser.LEVELS.read, null, null), async function (req, res, next) {
        const limitDefault = 10;
        const offset = parseInt(req.query.offset, 10) ? parseInt(req.query.offset, 10) : 0;
        const search = req.query.search;
        let limit = parseInt(req.query.limit, 10) ? parseInt(req.query.limit, 10) : limitDefault;
        let where = '';
        if (search) {
            where = ` AND t.title ILIKE :search `
        }
        const userId = req.user.id;
        const visibility = req.query.visibility;
        const creatorId = req.query.creatorId;
        let statuses = req.query.statuses;
        const pinned = req.query.pinned;
        const hasVoted = req.query.hasVoted; // Filter out Topics where User has participated in the voting process.
        const showModerated = req.query.showModerated || false;
        const order = req.query.order;
        const sortOrder = req.query.sortOrder || 'ASC';

        let sortSql = ` ORDER BY `;

        if (order) {
            switch (order) {
                case 'status':
                    sortSql += ` t.status ${sortOrder} `;
                    break;
                case 'pinned':
                    sortSql += ` pinned ${sortOrder} `;
                    break;
                case 'lastActivity':
                    sortSql += ` "lastActivity" ${sortOrder}`;
            }
        } else {
            sortSql += `"pinned" DESC, t."updatedAt" DESC`;
        }

        if (statuses && !Array.isArray(statuses)) {
            statuses = [statuses];
        }

        if (visibility) {
            where += ` AND t.visibility=:visibility `;
        }

        if (statuses && statuses.length) {
            where += ` AND t.status IN (:statuses) `;
        }

        if (pinned) {
            where += ` AND tp."topicId" = t.id AND tp."userId" = :userId`;
        }

        if (['true', '1'].includes(hasVoted)) {
            where += ` AND EXISTS (SELECT TRUE FROM "VoteLists" vl WHERE vl."voteId" = tv."voteId" AND vl."userId" = :userId LIMIT 1)`;
        } else if (['false', '0'].includes(hasVoted)) {
            where += ` AND tv."voteId" IS NOT NULL AND t.status = 'voting'::"enum_Topics_status" AND NOT EXISTS (SELECT TRUE FROM "VoteLists" vl WHERE vl."voteId" = tv."voteId" AND vl."userId" = :userId LIMIT 1)`;
        } else {
            logger.warn(`Ignored parameter "voted" as invalid value "${hasVoted}" was provided`);
        }

        if (!showModerated || showModerated == "false") {
            where += ` AND (tr."moderatedAt" IS NULL OR tr."resolvedAt" IS NOT NULL) `;
        } else {
            where += ` AND (tr."moderatedAt" IS NOT NULL AND tr."resolvedAt" IS NULL) `;
        }

        if (creatorId) {
            if (creatorId === userId) {
                where += ` AND u.id =:creatorId `;
            }
        }

        try {
            const topics = await db
                .query(
                    `SELECT
                        t.id,
                        t.title,
                        t.visibility,
                        t.status,
                        t.categories,
                        t."endsAt",
                        CASE
                            WHEN tp."topicId" = t.id THEN true
                            ELSE false
                        END as "pinned",
                        t.hashtag,
                        t."updatedAt",
                        t."createdAt",
                        COALESCE(ta."lastActivity", t."updatedAt") as "lastActivity",
                        u.id as "creator.id",
                        u.name as "creator.name",
                        u.company as "creator.company",
                        u."imageUrl" as "creator.imageUrl",
                        COALESCE(tmup.level, tmgp.level, 'none') as "permission.level",
                        COALESCE(tmgp.level, 'none') as "permission.levelGroup",
                        muc.count as "members.users.count",
                        COALESCE(mgc.count, 0) as "members.groups.count",
                        count(*) OVER()::integer AS "countTotal"
                    FROM "TopicMemberGroups" gt
                        JOIN "Topics" t ON (t.id = gt."topicId")
                        LEFT JOIN "TopicReports" tr ON  tr."topicId" = t.id
                        LEFT JOIN "Users" u ON (u.id = t."creatorId")
                        LEFT JOIN (
                            SELECT
                                tmu."topicId",
                                tmu."userId",
                                tmu.level::text AS level
                            FROM "TopicMemberUsers" tmu
                            WHERE tmu."deletedAt" IS NULL
                        ) AS tmup ON (tmup."topicId" = t.id AND tmup."userId" = :userId)
                        LEFT JOIN (
                            SELECT
                                tmg."topicId",
                                gm."userId",
                                MAX(tmg.level)::text AS level
                            FROM "TopicMemberGroups" tmg
                                LEFT JOIN "GroupMemberUsers" gm ON (tmg."groupId" = gm."groupId")
                            WHERE tmg."deletedAt" IS NULL
                            AND gm."deletedAt" IS NULL
                            GROUP BY "topicId", "userId"
                        ) AS tmgp ON (tmgp."topicId" = t.id AND tmgp."userId" = :userId)
                        LEFT JOIN (
                            SELECT tmu."topicId", COUNT(tmu."memberId") AS "count" FROM (
                                SELECT
                                    tmuu."topicId",
                                    tmuu."userId" AS "memberId"
                                FROM "TopicMemberUsers" tmuu
                                WHERE tmuu."deletedAt" IS NULL
                                UNION
                                SELECT
                                    tmg."topicId",
                                    gm."userId" AS "memberId"
                                FROM "TopicMemberGroups" tmg
                                    JOIN "GroupMemberUsers" gm ON (tmg."groupId" = gm."groupId")
                                WHERE tmg."deletedAt" IS NULL
                                AND gm."deletedAt" IS NULL
                            ) AS tmu GROUP BY "topicId"
                        ) AS muc ON (muc."topicId" = t.id)
                        LEFT JOIN (
                            SELECT "topicId", count("groupId")::integer AS "count"
                            FROM "TopicMemberGroups"
                            WHERE "deletedAt" IS NULL
                            GROUP BY "topicId"
                        ) AS mgc ON (mgc."topicId" = t.id)
                        LEFT JOIN "TopicPins" tp ON tp."topicId" = t.id AND tp."userId" = :userId
                        LEFT JOIN (
                            SELECT
                                tv."topicId",
                                tv."voteId",
                                v."authType",
                                v."createdAt",
                                v."delegationIsAllowed",
                                v."description",
                                v."endsAt",
                                v."maxChoices",
                                v."minChoices",
                                v."type",
                                v."autoClose"
                            FROM "TopicVotes" tv INNER JOIN
                                (
                                    SELECT
                                        MAX("createdAt") as "createdAt",
                                        "topicId"
                                    FROM "TopicVotes"
                                    GROUP BY "topicId"
                                ) AS _tv ON (_tv."topicId" = tv."topicId" AND _tv."createdAt" = tv."createdAt")
                            LEFT JOIN "Votes" v
                                    ON v.id = tv."voteId"
                        ) AS tv ON (tv."topicId" = t.id)
                        LEFT JOIN (
                            SELECT t.id, MAX(a."updatedAt") as "lastActivity"
                            FROM "Topics" t JOIN "Activities" a ON ARRAY[t.id::text] <@ a."topicIds" GROUP BY t.id
                        ) ta ON (ta.id = t.id)
                    WHERE gt."groupId" = :groupId
                        AND gt."deletedAt" IS NULL
                        AND t."deletedAt" IS NULL
                        AND COALESCE(tmup.level, tmgp.level, 'none')::"enum_TopicMemberUsers_level" > 'none'
                        ${where}
                    ${sortSql}
                    LIMIT :limit
                    OFFSET :offset
                    ;`,
                    {
                        replacements: {
                            groupId: req.params.groupId,
                            userId: userId,
                            creatorId: userId,
                            limit,
                            offset,
                            search: `%${search}%`,
                            statuses,
                            visibility
                        },
                        type: db.QueryTypes.SELECT,
                        raw: true,
                        nest: true
                    }
                );

            let countTotal = 0;
            if (topics && topics.length) {
                countTotal = topics[0].countTotal;
                topics.forEach(function (member) {
                    delete member.countTotal;
                });
            }

            return res.ok({
                countTotal,
                count: topics.length,
                rows: topics
            });
        } catch (err) {
            return next(err);
        }
    });

    /**
     * Group list
     */
    app.get('/api/groups', function (req, res, next) {
        const limitMax = 100;
        const limitDefault = 26;

        const offset = req.query.offset || 0;
        let limit = req.query.limit || limitDefault;
        if (limit > limitMax) limit = limitDefault;

        const where = {
            visibility: Group.VISIBILITY.public,
            name: {
                [Op.not]: null
            }
        };

        const name = req.query.name;
        if (name) {
            where.name = {
                [Op.iLike]: name
            };
        }

        const sourcePartnerId = req.query.sourcePartnerId;
        if (sourcePartnerId) {
            where.sourcePartnerId = sourcePartnerId;
        }
        // TODO: .findAndCount does 2 queries, either write a raw query using PG window functions (http://www.postgresql.org/docs/9.3/static/tutorial-window.html) or wait for Sequelize to fix it - https://github.com/sequelize/sequelize/issues/2465
        Group
            .findAndCountAll({
                where: where,
                include: [
                    {
                        model: User,
                        as: 'creator',
                        attributes: ['id', 'name', 'company'] // TODO: Should fix User model not to return "email" by default. I guess requires Sequelize scopes - https://github.com/sequelize/sequelize/issues/1462
                    }
                ],
                limit: limit,
                offset: offset,
                order: [['updatedAt', 'DESC']]
            })
            .then(function (result) {
                return res.ok({
                    countTotal: result.count,
                    count: result.rows.length,
                    rows: result.rows
                });
            })
            .catch(next);
    });

    return {
        hasPermission: hasPermission
    };
};
