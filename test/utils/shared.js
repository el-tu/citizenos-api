'use strict';

/**
 * Shared functionality of all Mocha tests
 *
 * @see {@link https://github.com/mochajs/mocha/wiki/Shared-Behaviours}
 */

const app = require('../../app');
const logger = app.get('logger');
const Promise = app.get('Promise');
const db = app.get('models').sequelize;

const syncDb = function () {
    if (process.env.FORCE_DB_SYNC == true && app.get('env') !== 'production') { // eslint-disable-line no-process-env, eqeqeq
        return db
            .sync({
                logging: function (msg) {
                    logger.info(msg);
                }
            })
            .then(function () {
                return Promise.resolve();
            });
    } else {
        return Promise.resolve();
    }
};

module.exports.syncDb = syncDb;
