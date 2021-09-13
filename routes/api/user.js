'use strict';

module.exports = function (app) {
    const models = app.get('models');
    const db = models.sequelize;

    const loginCheck = app.get('middleware.loginCheck');
    const emailLib = app.get('email');
    const config = app.get('config');
    const cosActivities = app.get('cosActivities');
    const urlLib = app.get('urlLib');
    const jwt = app.get('jwt');
    const uuid = app.get('uuid');
    const moment = app.get('moment');
    const validator = app.get('validator');

    const User = models.User;
    const UserConsent = models.UserConsent;
    const UserConnection = models.UserConnection;

    /**
     * Update User info
     */
    app.put('/api/users/:userId', loginCheck(['partner']), async function (req, res, next) {
        try {
            const fields = ['name', 'company', 'email', 'language', 'imageUrl', 'termsVersion'];
            if (!req.user.partnerId) { // Allow only our own app change the password
                fields.push('password');
            }
            let updateEmail = false;

            let user = await User.findOne({
                where: {
                    id: req.user.id
                }
            });

            if (req.body.email && req.body.email !== user.email) {
                updateEmail = true;
                fields.push('emailIsVerified');
                fields.push('emailVerificationCode');
                req.body.emailIsVerified = false;
                req.body.emailVerificationCode = uuid.v4(); // Generate new emailVerificationCode
            }
            if (req.body.termsVersion && req.body.termsVersion !== user.termsVersion) {
                fields.push('termsAcceptedAt');
                req.body.termsAcceptedAt = moment().format();
            }

            const results = await User.update(
                req.body,
                {
                    where: {
                        id: req.user.id
                    },
                    fields: fields,
                    limit: 1,
                    returning: true
                }
            );

            if (!results[1]) return res.ok();

            user = results[1][0];

            if (updateEmail) {
                await UserConnection.update({
                    connectionData: user
                }, {
                    where: {
                        connectionId: UserConnection.CONNECTION_IDS.citizenos,
                        userId: user.id
                    }
                });
                const tokenData = {
                    redirectSuccess: urlLib.getFe() // TODO: Misleading naming, would like to use "redirectUri" (OpenID convention) instead, but needs RAA.ee to update codebase.
                };

                const token = jwt.sign(tokenData, config.session.privateKey, {algorithm: config.session.algorithm});

                await emailLib.sendAccountVerification(user.email, user.emailVerificationCode, token);
            }

            return res.ok(user.toJSON());
        } catch (err) {
            return next(err);
        }
    });

    /**
     * Get User info
     *
     * Right now only supports getting info for logged in User
     */
    app.get('/api/users/:userId', loginCheck(['partner']), async function (req, res, next) {
        try {
            const user = await User.findOne({
                where: {
                    id: req.user.id
                }
            });

            if (!user) {
                return res.notFound();
            }

            return res.ok(user.toJSON());
        } catch (err) {
            return next(err);
        }
    });

    /**
     * Delete User
     */
    app.delete('/api/users/:userId', loginCheck(), async function (req, res, next) {
        try {
            const user = await User
            .findOne({
                where: {
                    id: req.user.id
                }
            });

        if (!user) {
            return res.notFound();
        }
        await db
            .transaction(async function (t) {
                await User.update(
                    {
                        name: 'Anonymous',
                        email: null,
                        company: null,
                        imageUrl: null,
                        sourceId: null

                    },
                    {
                        where: {
                            id: req.user.id
                        },
                        limit: 1,
                        returning: true,
                        transaction: t
                    }
                );

                await User.destroy({
                    where: {
                        id: req.user.id
                    },
                    transaction: t
                });

                await UserConnection.destroy({
                    where: {
                        userId: req.user.id
                    },
                    force: true,
                    transaction: t
                });

                t.afterCommit(() => {
                    return res.ok();
                });
            });
        } catch (err) {
            return next(err);
        }

    });
    /**
     * Create UserConsent
     */
    app.post('/api/users/:userId/consents', loginCheck(), async function (req, res, next) {
        const userId = req.user.id;
        const partnerId = req.body.partnerId;
        try {
            await db
                .transaction(async function (t) {
                    const created = await UserConsent.upsert({
                        userId: userId,
                        partnerId: partnerId
                    }, {
                        transaction: t
                    });

                    if (created) {
                        const userConsent = UserConsent.build({
                            userId: userId,
                            partnerId: partnerId
                        });

                        await cosActivities
                            .createActivity(userConsent, null, {
                                type: 'User',
                                id: userId,
                                ip: req.ip
                            }, req.method + ' ' + req.path, t);
                    }

                    t.afterCommit(() => {
                        return res.ok();
                    });
                });

        } catch (err) {
            return next(err);
        }
    });

    /**
     * Read User consents
     */
    app.get('/api/users/:userId/consents', loginCheck(), async function (req, res, next) {
        const userId = req.user.id;
        try {
            const results = await db.query(
                `
                SELECT
                    p.id,
                    p.website,
                    p."createdAt",
                    p."updatedAt"
                FROM "UserConsents" uc
                LEFT JOIN "Partners" p ON (p.id = uc."partnerId")
                WHERE uc."userId" = :userId
                    AND uc."deletedAt" IS NULL
                ;`,
                {
                    replacements: {
                        userId: userId
                    },
                    type: db.QueryTypes.SELECT,
                    raw: true,
                    nest: true
                }
            );

            return res.ok({
                count: results.length,
                rows: results
            });
        } catch(err) {
            return next(err);
        }
    });

    /**
     * Delete User consent
     */
    app.delete('/api/users/:userId/consents/:partnerId', loginCheck(), async function (req, res, next) {
        const userId = req.user.id;
        const partnerId = req.params.partnerId;

        try {
            await db.transaction(async function (t) {
                await UserConsent.destroy(
                    {
                        where: {
                            userId: userId,
                            partnerId: partnerId
                        },
                        limit: 1,
                        force: true
                    },
                    {
                        transaction: t
                    }
                );

                const consent = UserConsent.build({
                    userId: userId,
                    partnerId: partnerId
                });

                await cosActivities.deleteActivity(
                    consent,
                    null,
                    {
                        type: 'User',
                        id: req.user.id,
                        ip: req.ip
                    },
                    req.method + ' ' + req.path,
                    t
                );

                t.afterCommit(() => {
                    return res.ok();
                });
            });

        } catch (err) {
            return next(err);
        }
    });


    /**
     * Get UserConnections
     *
     * Get UserConnections, that is list of methods User can use to authenticate.
     */
    app.get('/api/users/:userId/userconnections', async function (req, res, next) {
        try {
            const userId = req.params.userId;
            let where;

            if (validator.isUUID(userId)) {
                const user = await User.findOne({
                    where: {
                        id: userId
                    },
                    attributes: ['id']
                });

                if (!user) {
                    return res.notFound();
                }

                where = {
                    userId: userId
                }
            } else if (validator.isEmail(userId)) {
                const user = await User.findOne({
                    where: {
                        email: userId
                    },
                    attributes: ['id']
                });

                if (!user) {
                    return res.notFound();
                }

                where = {
                    userId: user.id
                }
            } else {
                return res.badRequest('Invalid userId', 1);
            }

            const userConnections = await UserConnection.findAll({
                where: where,
                attributes: ['connectionId'],
                order: [[db.cast(db.col('connectionId'), 'TEXT'), 'ASC']] // Cast as we want alphabetical order, not enum order.
            });

            if (!userConnections || !userConnections.length) {
                return res.ok({
                    count: 0,
                    rows: []
                });
            }

            return res.ok({
                count: userConnections.length,
                rows: userConnections
            });
        } catch (err) {
            return next(err);
        }
    });

};
