'use strict';

/**
 * Log in - call '/api/auth/login' API endpoint
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} email E-mail
 * @param {string} password Password
 * @param {string} expectedHttpCode Expected HTTP code
 *
 * @returns {Promise<Object>} SuperAgent response object
 *
 * @private
 */
const _login = async function (agent, email, password, expectedHttpCode) {
    const path = '/api/auth/login';

    const a = agent
        .post(path)
        .set('Content-Type', 'application/json')
        .send({
            email: email,
            password: password
        })
        .expect(expectedHttpCode)
        .expect('Content-Type', /json/);

    if (expectedHttpCode === 200) {
        a.expect('set-cookie', /.*\.sid=.*; Path=\/api; Expires=.*; HttpOnly/);
    }

    return a;
};

const login = async function (agent, email, password) {
    return _login(agent, email, password, 200);
};

const _loginId = async function (agent, token, clientCert, expectedHttpCode) {
    const path = '/api/auth/id';

    const a = agent
        .post(path)
        .set('Content-Type', 'application/json');

    if (clientCert) {
        a.set('X-SSL-Client-Cert', clientCert);
    }

    if (token) {
        a.send({token: token});
    }

    return a.expect(expectedHttpCode)
        .expect('Content-Type', /json/)
        .then(function (res, err) {
            if (err) return err;
            const data = res.body.data;
            if (data && !data.token && !data.hash) {
                a.expect('set-cookie', /.*\.sid=.*; Path=\/api; Expires=.*; HttpOnly/);
            }
        });
}

/**
 * Initialize Mobiil-ID login - call '/api/auth/mobile/init' API endpoint
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} pid Personal identification number
 * @param {string} phoneNumber Phone number
 * @param {number} expectedHttpCode Expected HTTP response code
 *
 * @return {void}
 *
 * @private
 */

const _loginMobileInit = async function (agent, pid, phoneNumber, expectedHttpCode) {
    const path = '/api/auth/mobile/init';
    return agent
        .post(path)
        .set('Content-Type', 'application/json')
        .send({
            pid: pid,
            phoneNumber: phoneNumber
        })
        .expect(expectedHttpCode)
        .expect('Content-Type', /json/);
};

const loginMobileInit = async function (agent, pid, phoneNumber) {
    return _loginMobileInit(agent, pid, phoneNumber, 200);
};

/**
 * Initialize Smart-ID login - call '/api/auth/smartid/init' API endpoint
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} pid Personal identification number
 * @param {number} expectedHttpCode Expected HTTP response code
 *
 * @return {void}
 *
 * @private
 */

const _loginSmartIdInit = async function (agent, pid, expectedHttpCode) {
    const path = '/api/auth/smartid/init';
    return agent
        .post(path)
        .set('Content-Type', 'application/json')
        .send({pid: pid})
        .expect(expectedHttpCode)
        .expect('Content-Type', /json/);
};

const loginSmartIdInit = async function (agent, pid) {
    return _loginSmartIdInit(agent, pid, 200);
};

/**
 * Check mobile authentication status - call '/api/auth/mobile/status'
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} token JWT token issued when login was initiated
 * @param {number} expectedHttpCode Expected HTTP response code
 *
 * @return {void}
 *
 * @private
 */

const _loginMobilestatus = async function (agent, token, expectedHttpCode) {
    const path = '/api/auth/mobile/status';

    return agent
        .get(path)
        .query({
            token: token
        })
        .expect(expectedHttpCode)
        .expect('Content-Type', /json/)
};

const loginMobilestatus = async function (agent, token) {
    return new Promise(function (resolve, reject) {
        const maxRetries = 20;
        const retryInterval = 1000; // milliseconds;

        let retries = 0;

        const statusInterval = setInterval(async function () {
            try {
                if (retries < maxRetries) {
                    retries++;

                    const loginMobileStatusResponse = await _loginMobilestatus(agent, token, 200);
                    if (loginMobileStatusResponse.body.status.code !== 20001) {
                        clearInterval(statusInterval);
                        return resolve(loginMobileStatusResponse);
                    }

                } else {
                    clearInterval(statusInterval);

                    return reject(new Error(`loginMobileStatus maximum retry limit ${maxRetries} reached!`));
                }
            } catch (err) {
                // Whatever blows, stop polling
                clearInterval(statusInterval);

                return reject(err);
            }

        }, retryInterval);
    });
};
/**
 * Check smart-ID authentication status - call '/api/auth/smartid/status'
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} token JWT token that was issued when flow was initiated
 *
 * @return {void}
 *
 * @private
 */

const _loginSmartIdstatus = async function (agent, token) {
    const path = '/api/auth/smartid/status';

    return agent
        .get(path)
        .query({
            token: token
        })
        .expect('Content-Type', /json/);
};

const loginSmartIdstatus = async function (agent, token, interval) {
    return new Promise(function (resolve, reject) {
        const maxRetries = 20;
        const retryInterval = interval || 1000; // milliseconds;

        let retries = 0;

        const statusInterval = setInterval(async function () {
            try {
                if (retries < maxRetries) {
                    retries++;

                    const loginSmartIdStatusResponse = await _loginSmartIdstatus(agent, token, 200);
                    if (loginSmartIdStatusResponse.body.status.code !== 20001) {
                        clearInterval(statusInterval);
                        return resolve(loginSmartIdStatusResponse);
                    }

                } else {
                    clearInterval(statusInterval);

                    return reject(new Error(`loginSmartIdStatus maximum retry limit ${maxRetries} reached!`));
                }
            } catch (err) {
                // Whatever blows, stop polling
                clearInterval(statusInterval);

                return reject(err);
            }

        }, retryInterval);
    });
};
/**
 * Log out - call '/api/auth/logout' API endpoint
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 *
 * @return {void}
 */

const logout = async function (agent) {
    const path = '/api/auth/logout';

    return agent
        .post(path)
        .set('Content-Type', 'application/json')
        .expect(200)
        .expect('Content-Type', /json/)
};

/**
 * Sign up - call '/api/auth/signup' API endpoint
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} email E-mail
 * @param {string} password Password
 * @param {string} language Users preferred language ISO 2 char language code
 *
 * @return {void}
 */

const _signup = async function (agent, email, password, language, expectedHttpCode) {
    const path = '/api/auth/signup';

    return agent
        .post(path)
        .set('Content-Type', 'application/json')
        .send({
            email: email,
            password: password,
            language: language
        })
        .expect(expectedHttpCode)
        .expect('Content-Type', /json/);
};

const signup = async function (agent, email, password, language) {
    return _signup(agent, email, password, language, 200);
};

/**
 * Set password - call '/api/auth/password' API endpoint
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} currentPassword Current password
 * @param {string} newPassword New password
 * @param {number} expectedHttpCode Expected HTTP response code
 *
 * @return {void}
 *
 * @private
 */

const _passwordSet = async function (agent, currentPassword, newPassword, expectedHttpCode) {
    const path = '/api/auth/password';

    return agent
        .post(path)
        .set('Content-Type', 'application/json')
        .send({
            currentPassword: currentPassword,
            newPassword: newPassword
        })
        .expect(expectedHttpCode)
        .expect('Content-Type', /json/);
};
/**
 * Set password - call '/api/auth/password' API endpoint
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} currentPassword Current password
 * @param {string} newPassword New password
 *
 * @return {void}
 */

const passwordSet = async function (agent, currentPassword, newPassword) {
    return _passwordSet(agent, currentPassword, newPassword, 200);
};

/**
 * Send user password reset email with reset code - call '/api/auth/password/reset' API endpoint
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} email E-mail of the user who's password is to be reset
 * @param {number} expectedHttpCode Expected HTTP response code
 *
 * @return {void}
 *
 * @private
 */

const _passwordResetSend = async function (agent, email, expectedHttpCode) {
    const path = '/api/auth/password/reset/send';

    return agent
        .post(path)
        .set('Content-Type', 'application/json')
        .send({email: email})
        .expect(expectedHttpCode)
        .expect('Content-Type', /json/);
};

const passwordResetSend = function (agent, email) {
    return _passwordResetSend(agent, email, 200);
};

const _passwordResetComplete = async function (agent, email, password, passwordResetCode, expectedHttpCode) {
    const path = '/api/auth/password/reset';

    return agent
        .post(path)
        .set('Content-Type', 'application/json')
        .send({
            email: email,
            password: password,
            passwordResetCode: passwordResetCode
        })
        .expect(expectedHttpCode)
        .expect('Content-Type', /json/);
};

const passwordResetComplete = async function (agent, email, password, passwordResetCode) {
    return _passwordResetComplete(agent, email, password, passwordResetCode, 200);
};


/**
 * Verify e-mail - call '/api/auth/verify/:code'
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {string} emailVerificationCode Verification code e-mailed to the user.
 *
 * @return {void}
 */
const verify = async function (agent, emailVerificationCode) {
    const path = '/api/auth/verify/:code'.replace(':code', emailVerificationCode);

    return agent
        .get(path)
        .expect(302)
        .expect('Location', /\/account\/login\?email=.*/);
};

/**
 * Check auth status - call '/api/auth/status'
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 * @param {number} expectedHttpCode Expected HTTP response code
 *
 * @return {void}
 *
 * @private
 */

const _status = async function (agent, expectedHttpCode) {
    const path = '/api/auth/status';

    return agent
        .get(path)
        .set('Content-Type', 'application/json')
        .expect(expectedHttpCode)
        .expect('Content-Type', /json/);
};

/**
 * Check auth status - call '/api/auth/status'
 *
 * @param {object} agent SuperAgent is in the interface so other tests preparing data could provide their agent. Useful when agent holds a state (for ex session).
 *
 * @return {void}
 */

const status = async function (agent) {
    return _status(agent, 200);
};

const _openIdAuthorize = async function (agent, responseType, clientId, redirectUri, nonce, scope, state, expectedHttpCode) {
    const path = '/api/auth/openid/authorize';

    return agent
        .get(path)
        .query({
            response_type: responseType,
            client_id: clientId,
            redirect_uri: redirectUri,
            nonce: nonce,
            scope: scope,
            state: state
        })
        .expect(expectedHttpCode);
};

const openIdAuthorize = async function (agent, responseType, clientId, redirectUri, scope, state, nonce) {
    return _openIdAuthorize(agent, responseType, clientId, redirectUri, nonce, scope, state, 302);
};

//Export the above function call so that other tests could use it to prepare data.
module.exports.login = login;
module.exports.login = login;
module.exports.logout = logout;
module.exports.logout = logout;
module.exports.signup = signup;
module.exports.signup = signup;
module.exports.verify = verify;
module.exports.status = status;
module.exports._status = _status;
module.exports.status = status;
module.exports._status = _status;

const request = require('supertest');
const app = require('../../app');
const models = app.get('models');
const uuid = require('uuid');
const fs = require('fs');

const assert = require('chai').assert;
const config = app.get('config');
const jwt = app.get('jwt');
const urlLib = app.get('urlLib');
const objectEncrypter = app.get('objectEncrypter');

const shared = require('../utils/shared');
const userLib = require('./lib/user')(app);

const User = models.User;
const UserConnection = models.UserConnection;
const UserConsent = models.UserConsent;
const Partner = models.Partner;
const db = models.sequelize;

suite('Auth', function () {

    suiteSetup(async function () {
        return shared
            .syncDb();
    });

    suite('Login', function () {

        suite('Username & password', function () {

            const agent = request.agent(app);
            const email = 'test_' + new Date().getTime() + '@test.ee';
            const password = 'Test123';

            suiteSetup(async function () {
                await userLib.createUser(agent, email, password, null);
            });

            test('Success', async function () {
                const res = await login(agent, email, password);
                const user = res.body.data;
                assert.equal(user.email, email);
                assert.property(user, 'id');
                assert.notProperty(res.body, 'name'); //TODO: would be nice if null values were not returned in the response
                assert.notProperty(user, 'password');
                assert.notProperty(user, 'emailIsVerified');
                assert.notProperty(user, 'emailVerificationCode');
                assert.notProperty(user, 'createdAt');
                assert.notProperty(user, 'updatedAt');
                assert.notProperty(user, 'deletedAt');
            });

            test('Fail - 40001 - account does not exist', async function () {
                const res = await agent
                    .post('/api/auth/login')
                    .set('Content-Type', 'application/json')
                    .send({
                        email: 'test_nonexistent_' + new Date().getTime() + '@test.ee',
                        password: password
                    })
                    .expect(400)
                    .expect('Content-Type', /json/);
                const status = res.body.status;
                assert.equal(status.code, 40001);
                assert.equal(status.message, 'The account does not exists.');
            });

            test('Fail - 40002 - account has not been verified', async function () {
                const agent = request.agent(app);

                const email = 'test_notverif_' + new Date().getTime() + '@test.ee';
                const password = 'Test123';


                await signup(agent, email, password, null);
                const res = await _login(agent, email, password, 400);
                const status = res.body.status;

                assert.equal(status.code, 40002);
                assert.equal(status.message, 'The account verification has not been completed. Please check your e-mail.');
            });

            test('Fail - 40003 - wrong password', async function () {
                const res = await agent
                    .post('/api/auth/login')
                    .set('Content-Type', 'application/json')
                    .send({
                        email: email,
                        password: 'thisinvalidpassword'
                    })
                    .expect(400)
                    .expect('Content-Type', /json/);

                const status = res.body.status;

                assert.equal(status.code, 40003);
                assert.equal(res.body.errors.password, 'Invalid password');
            });
        });

        suite('ID-card', function () {
            teardown(async function () {
                return UserConnection
                    .destroy({
                        where: {
                            connectionId: UserConnection.CONNECTION_IDS.esteid,
                            connectionUserId: ['PNOEE-37101010021']
                        },
                        force: true
                    });
            });

            test('Success - client certificate in X-SSL-Client-Cert header', async function () {
                this.timeout(5000); //eslint-disable-line no-invalid-this

                const agent = request.agent(app);
                const cert = fs.readFileSync('./test/resources/certificates/good-jaak-kristjan_jõeorg_esteid_sign.pem', {encoding: 'utf8'}).replace(/\n/g, ''); //eslint-disable-line no-sync
                await _loginId(agent, null, cert, 200);
            });

            test('Fail - no token or client certificate in header', async function () {
                await _loginId(request.agent(app), null, null, 400);
            });
        });

        suite('Mobiil-ID', function () {

            suite('Init', function () {

                setup(async function () {
                    await UserConnection
                        .destroy({
                            where: {
                                connectionId: UserConnection.CONNECTION_IDS.esteid,
                                connectionUserId: ['PNOEE-60001019906']
                            },
                            force: true
                        });
                });

                test('Success - 20001 - Estonian mobile number and PID', async function () {
                    this.timeout(15000); //eslint-disable-line no-invalid-this

                    const phoneNumber = '+37200000766';
                    const pid = '60001019906';
                    const response = (await loginMobileInit(request.agent(app), pid, phoneNumber)).body;

                    assert.equal(response.status.code, 20001);
                    assert.match(response.data.challengeID, /[0-9]{4}/);
                    const tokenData = jwt.verify(response.data.token, config.session.publicKey, {algorithms: [config.session.algorithm]});
                    const loginMobileFlowData = objectEncrypter(config.session.secret).decrypt(tokenData.sessionDataEncrypted);
                    assert.property(loginMobileFlowData, 'sessionHash');

                    const responseData = (await loginMobilestatus(request.agent(app), response.data.token)).body.data;

                    assert.property(responseData, 'id');
                    delete responseData.id;
                    assert.deepEqual(responseData, {
                        name: 'Mary Änn O’Connež-Šuslik Testnumber',
                        company: null,
                        language: 'en',
                        email: null,
                        imageUrl: null,
                        termsVersion: null,
                        termsAcceptedAt: null
                    });

                });

                test('Fail - 40021 - Invalid phone number', async function () {
                    const phoneNumber = '+372519';
                    const pid = '51001091072';

                    const response = (await _loginMobileInit(request.agent(app), pid, phoneNumber, 400)).body;

                    assert.equal(response.status.code, 40000);

                    const expectedResponse = {
                        status: {
                            code: 40000,
                            message: 'phoneNumber must contain of + and numbers(8-30)'
                        }
                    };
                    assert.deepEqual(response, expectedResponse);
                });

                test('Fail - 40021 - Invalid PID', async function () {
                    const phoneNumber = '+37260000007';
                    const pid = '1072';

                    const response = (await _loginMobileInit(request.agent(app), pid, phoneNumber, 400)).body;
                    const expectedResponse = {
                        status: {
                            code: 40000,
                            message: 'nationalIdentityNumber must contain of 11 digits'
                        }
                    };

                    assert.deepEqual(response, expectedResponse);
                });

                test('Fail - 40022 - Mobile-ID user certificates are revoked or suspended for Estonian citizen', async function () {
                    const phoneNumber = '+37200000266';
                    const pid = '60001019939';

                    const response = (await loginMobileInit(request.agent(app), pid, phoneNumber)).body.data;
                    const responseData = (await _loginMobilestatus(request.agent(app), response.token, 400)).body;
                    const expectedResponse = {
                        status: {
                            code: 40013,
                            message: 'Mobile-ID functionality of the phone is not yet ready'
                        }
                    };
                    assert.deepEqual(responseData, expectedResponse);
                });

                test('Fail - 40022 - Mobile-ID user certificates are revoked or suspended for Lithuanian citizen', async function () {
                    const phoneNumber = '+37060000266';
                    const pid = '50001018832';

                    const response = (await loginMobileInit(request.agent(app), pid, phoneNumber)).body.data;
                    const responseData = (await _loginMobilestatus(request.agent(app), response.token, 400)).body;
                    const expectedResponse = {
                        status: {
                            code: 40013,
                            message: 'Mobile-ID functionality of the phone is not yet ready'
                        }
                    };
                    assert.deepEqual(responseData, expectedResponse);
                });

                test('Fail - 40023 - User certificate is not activated for Estonian citizen.', async function () {
                    const phoneNumber = '+37200001';
                    const pid = '38002240211';

                    const response = (await loginMobileInit(request.agent(app), pid, phoneNumber)).body.data;
                    const responseData = (await _loginMobilestatus(request.agent(app), response.token, 400)).body;

                    const expectedResponse = {
                        status: {
                            code: 40013,
                            message: 'Mobile-ID functionality of the phone is not yet ready'
                        }
                    };
                    assert.deepEqual(responseData, expectedResponse);
                });

                test('Fail - 40023 - Mobile-ID is not activated for Lithuanian citizen', async function () {
                    const phoneNumber = '+37060000001';
                    const pid = '51001091006';

                    const response = (await loginMobileInit(request.agent(app), pid, phoneNumber)).body.data;
                    const responseData = (await _loginMobilestatus(request.agent(app), response.token, 400)).body;
                    const expectedResponse = {
                        status: {
                            code: 40013,
                            message: 'Mobile-ID functionality of the phone is not yet ready'
                        }
                    };

                    assert.deepEqual(responseData, expectedResponse);
                });

                test.skip('Fail - 40024 - User certificate is suspended', async function () {
                    //TODO: No test phone numbers available for errorcode = 304 - http://id.ee/?id=36373
                });

                test.skip('Fail - 40025 - User certificate is expired', async function () {
                    //TODO: No test phone numbers available for errorcode = 305 - http://id.ee/?id=36373
                });

            });

            suite('Status', function () {
                const phoneNumber = '+37200000766';
                const pid = '60001019906';

                suite('New User', function () {
                    setup(async function () {
                        return UserConnection
                            .destroy({
                                where: {
                                    connectionId: UserConnection.CONNECTION_IDS.esteid,
                                    connectionUserId: ['PNOEE-' + pid]
                                },
                                force: true
                            });
                    });

                    test('Success - 20003 - created', async function () {
                        this.timeout(35000); //eslint-disable-line no-invalid-this

                        const agent = request.agent(app);

                        const response = (await loginMobileInit(agent, pid, phoneNumber)).body.data;
                        const userInfoFromMobiilIdStatusResponse = (await loginMobilestatus(agent, response.token)).body;
                        assert.equal(userInfoFromMobiilIdStatusResponse.status.code, 20003);
                        const userFromStatus = (await status(agent)).body.data;
                        // Makes sure login succeeded AND consistency between /auth/status and /auth/mobile/status endpoints
                        assert.deepEqual(userFromStatus, userInfoFromMobiilIdStatusResponse.data);
                        assert.equal(userInfoFromMobiilIdStatusResponse.data.name, 'Mary Änn O’Connež-Šuslik Testnumber'); // Special check for encoding issues
                    });
                });


                suite('Existing User', function () {
                    const agent2 = request.agent(app);

                    setup(async function () {
                        const user = await userLib.createUser(agent2, null, null, null);
                        return UserConnection
                            .findOrCreate({
                                where: {
                                    connectionId: UserConnection.CONNECTION_IDS.esteid,
                                    connectionUserId: 'PNOEE-'+pid
                                },
                                defaults: {
                                    userId: user.id,
                                    connectionId: UserConnection.CONNECTION_IDS.esteid,
                                    connectionUserId: 'PNOEE-'+pid
                                }
                            });
                    });

                    teardown(async function () {
                        return UserConnection
                            .destroy({
                                where: {
                                    connectionId: UserConnection.CONNECTION_IDS.esteid,
                                    connectionUserId: ['PNOEE-60001019906']
                                },
                                force: true
                            });
                    });

                    test('Success - 20002 - existing User', async function () {
                        this.timeout(35000); //eslint-disable-line no-invalid-this

                        const response = (await loginMobileInit(agent2, pid, phoneNumber)).body.data;
                        const userInfoFromMobiilIdStatusResponse = (await loginMobilestatus(agent2, response.token)).body;
                        assert.equal(userInfoFromMobiilIdStatusResponse.status.code, 20002);
                        const userFromStatus = (await status(agent2)).body.data;

                        assert.deepEqual(userFromStatus, userInfoFromMobiilIdStatusResponse.data);
                    });

                });

            });

        });

        suite('Smart-ID', function () {
            suite('Init', function () {
                let pid = '30303039914';
                teardown(async function () {
                    return UserConnection
                        .destroy({
                            where: {
                                connectionId: UserConnection.CONNECTION_IDS.smartid,
                                connectionUserId: ['PNOEE-' + pid] // Remove the good user so that test would run multiple times. Also other tests use same numbers
                            },
                            force: true
                        });
                });

                test('Success - 20001 - Estonian PID', async function () {
                    this.timeout(5000); //eslint-disable-line no-invalid-this
                    const response = (await loginSmartIdInit(request.agent(app), pid)).body;
                    assert.equal(response.status.code, 20001);
                    assert.match(response.data.challengeID, /[0-9]{4}/);

                    const token = response.data.token;
                    assert.isNotNull(token);

                    const tokenData = jwt.verify(token, config.session.publicKey, {algorithms: [config.session.algorithm]});
                    const loginMobileFlowData = objectEncrypter(config.session.secret).decrypt(tokenData.sessionDataEncrypted);

                    assert.property(loginMobileFlowData, 'sessionId');
                    assert.property(loginMobileFlowData, 'sessionHash');
                    assert.property(loginMobileFlowData, 'challengeID');
                    assert.equal(loginMobileFlowData.challengeID, response.data.challengeID);
                });

                test('Fail - 40400 - Invalid PID', async function () {
                    pid = '1010101';

                    const response = (await _loginSmartIdInit(request.agent(app), pid, 404)).body;
                    const expectedResponse = {
                        status: {
                            code: 40400,
                            message: 'Not Found'
                        }
                    };

                    assert.deepEqual(response, expectedResponse);
                });
            });

            suite('Status', function () {
                let pid = '30303039914';

                suite('New User', function () {
                    teardown(async function () {
                        return UserConnection
                            .destroy({
                                where: {
                                    connectionId: UserConnection.CONNECTION_IDS.smartid,
                                    connectionUserId: ['PNOEE-' + pid] // Remove the good user so that test would run multiple times. Also other tests use same numbers
                                },
                                force: true
                            });
                    });

                    test('Success - 20003 - created', async function () {
                        this.timeout(40000); //eslint-disable-line no-invalid-this

                        const agent = request.agent(app);

                        const initResponse = (await loginSmartIdInit(agent, pid)).body.data;
                        const userInfoFromSmartIdStatusResponse = (await loginSmartIdstatus(agent, initResponse.token)).body;
                        assert.equal(userInfoFromSmartIdStatusResponse.status.code, 20003);
                        const userFromStatus = (await status(agent)).body.data;
                        assert.deepEqual(userFromStatus, userInfoFromSmartIdStatusResponse.data);
                        assert.equal('Qualified Ok1 Testnumber', userInfoFromSmartIdStatusResponse.data.name); // Special check for encoding issues
                    });

                    test('Fail - 40010 - User refused', async function () {
                        this.timeout(40000); //eslint-disable-line no-invalid-this

                        pid = '30403039939';
                        const agent = request.agent(app);

                        const initResponse = (await loginSmartIdInit(agent, pid)).body.data;
                        const smartIdStatusResponse = (await loginSmartIdstatus(agent, initResponse.token, 2000)).body;
                        const expectedResponse = {
                            status: {
                                code: 40010,
                                message: 'User refused'
                            }
                        };
                        assert.deepEqual(expectedResponse, smartIdStatusResponse);
                    });


                    test('Fail - 40011 - Timeout', async function () {
                        this.timeout(120000); //eslint-disable-line no-invalid-this
                        pid = '30403039983'
                        const agent = request.agent(app);

                        const initResponse = (await loginSmartIdInit(agent, pid)).body.data;
                        const smartIdStatusResponse = (await loginSmartIdstatus(agent, initResponse.token, 5000)).body;
                        const expectedResponse = {
                            status: {
                                code: 40011,
                                message: 'The transaction has expired'
                            }
                        };
                        assert.deepEqual(expectedResponse, smartIdStatusResponse);
                    });
                });


                suite('Existing User', function () {
                    const agent2 = request.agent(app);

                    test('Success - 20002 - existing User', async function () {
                        this.timeout(30000); //eslint-disable-line no-invalid-this
                        pid = '30303039914';
                        const user = await userLib.createUser(agent2, null, null, null);

                        await UserConnection
                            .findOrCreate({
                                where: {
                                    connectionId: UserConnection.CONNECTION_IDS.smartid,
                                    connectionUserId: 'PNOEE-'+pid
                                },
                                defaults: {
                                    userId: user.id,
                                    connectionId: UserConnection.CONNECTION_IDS.smartid,
                                    connectionUserId: 'PNOEE-'+pid
                                }
                            });
                        const initResponse = (await loginSmartIdInit(agent2, pid)).body.data;
                        const smartIdStatusResponse = (await loginSmartIdstatus(agent2, initResponse.token, 5000)).body;
                        assert.equal(smartIdStatusResponse.status.code, 20002);
                        const userFromStatus = (await status(agent2)).body.data;
                        assert.deepEqual(userFromStatus, smartIdStatusResponse.data);
                    });

                });

            });
        });
    });

    suite('Logout', function () {

        test('Success', async function () {
            const agent = request.agent(app);
            const email = 'test_' + new Date().getTime() + '@test.ee';
            const password = 'Test123';

            const user = await userLib.createUserAndLogin(agent, email, password, null);
            const userFromStatus = (await status(agent)).body.data;
            let expectedUser = user.toJSON();
            expectedUser.termsVersion = user.termsVersion;
            expectedUser.termsAcceptedAt = user.termsAcceptedAt;

            assert.deepEqual(expectedUser, userFromStatus);
            await logout(agent);
            const statusResponse = (await _status(agent, 401)).body;
            const expectedBody = {
                status: {
                    code: 40100,
                    message: 'Unauthorized'
                }
            };
            assert.deepEqual(statusResponse, expectedBody);
        });

    });

    suite('Signup', function () {
        const agent = request.agent(app);

        test('Success', async function () {
            const email = 'test_' + new Date().getTime() + '@test.ee';
            const password = 'Test123';

            const user = (await signup(agent, email, password, null)).body.data;
            assert.equal(user.email, email);
            assert.property(user, 'id');
            assert.notProperty(user, 'password');
            assert.notProperty(user, 'emailIsVerified');
            assert.notProperty(user, 'emailVerificationCode');
            assert.notProperty(user, 'passwordResetCode');
            assert.notProperty(user, 'createdAt');
            assert.notProperty(user, 'updatedAt');
            assert.notProperty(user, 'deletedAt');
        });

        test('Success - invited user - User with NULL password in DB should be able to sign up', async function () {
            // Users with NULL password are created on User invite
            const agent = request.agent(app);

            const email = 'test_' + new Date().getTime() + '_invited@test.ee';
            const password = 'Test123';
            const language = 'et';

            const user = await User.create({
                email: email,
                password: null,
                name: email,
                source: User.SOURCES.citizenos
            });
            const userSignedup = (await signup(agent, user.email, password, language)).body.data;
            assert.equal(userSignedup.email, email);
            assert.equal(userSignedup.language, user.language);

        });

        test('Fail - 40000 - email cannot be null', async function () {
            const email = null;
            const password = 'Test123';

            const signupResult = (await _signup(agent, email, password, null, 400)).body;
            const expected = {
                status: {
                    code: 40000
                },
                errors: {
                    email: 'Invalid email.'
                }
            };

            assert.deepEqual(signupResult, expected);
        });

        test('Fail - 40000 - invalid email', async function () {
            const email = 'this is an invalid email';
            const password = 'Test123';

            const signupResult = (await _signup(agent, email, password, null, 400)).body;
            const expected = {
                status: {
                    code: 40000
                },
                errors: {
                    email: 'Invalid email.'
                }
            };

            assert.deepEqual(signupResult, expected);
        });

        test('Fail - 40000 - missing password', async function () {
            const email = 'test_' + new Date().getTime() + '@test.ee';
            const password = null;

            const signupResult = (await _signup(agent, email, password, null, 400)).body;
            const expected = {
                status: {
                    code: 40000
                },
                errors: {
                    password: 'Password must be at least 6 character long, containing at least 1 digit, 1 lower and upper case character.'
                }
            };

            assert.deepEqual(signupResult, expected);
        });

        test('Fail - 40000 - invalid password', async function () {
            const email = 'test_' + new Date().getTime() + '@test.ee';
            const password = 'nonumbersoruppercase';

            const signupResult = (await _signup(agent, email, password, null, 400)).body;
            const expected = {
                status: {
                    code: 40000
                },
                errors: {
                    password: 'Password must be at least 6 character long, containing at least 1 digit, 1 lower and upper case character.'
                }
            };
            assert.deepEqual(signupResult, expected);
        });

        test('Fail - 40000 - invalid password and invalid email', async function () {
            const email = 'notvalidatall';
            const password = 'nonumbersoruppercase';

            const signupResult = (await _signup(agent, email, password, null, 400)).body;
            const expected = {
                status: {
                    code: 40000
                },
                errors: {
                    email: "Invalid email.",
                    password: 'Password must be at least 6 character long, containing at least 1 digit, 1 lower and upper case character.'
                }
            };
            assert.deepEqual(signupResult, expected);
        });

        test('Fail - 40001 - email already in use', async function () {
            const email = 'test_emailinuse_' + new Date().getTime() + '@test.ee';
            const password = 'Test123';

            await signup(agent, email, password, null);
            const signupResult = (await _signup(agent, email, password, null, 400)).body;
            const expected = {
                status: {
                    code: 40001
                },
                errors: {
                    email: 'The email address is already in use.'
                }
            };
            assert.deepEqual(signupResult, expected);
        });

    });

    suite('Verify', function () {
        const agent = request.agent(app);

        // Success is already tested as a part of 'Login' suite.
        test.skip('Success - signup sets redirectSuccess and verify should redirect to it', async function () {
        });

        test('Fail - invalid emailVerificationCode', async function () {
            return agent
                .get('/api/auth/verify/thisCodeDoesNotExist')
                .expect(302)
                .expect('Location', urlLib.getFe('/', null, {error: 'emailVerificationFailed'}));
        });

    });

    suite('Password', function () {

        suite('Set', function () {
            const agent = request.agent(app);
            const email = 'test_' + new Date().getTime() + '@test.ee';
            const password = 'testPassword123';
            const newPassword = 'newPassword123';

            suiteSetup(async function () {
                return userLib.createUserAndLogin(agent, email, password, null);
            });

            test('Success', async function () {
                await passwordSet(agent, password, newPassword);
                const loginResult = (await login(request.agent(app), email, newPassword)).body;
                assert.equal(loginResult.status.code, 20000);
                assert.equal(loginResult.data.email, email);
            });

            test('Fail - invalid new password which does not contain special characters needed', async function () {
                const currentPassword = newPassword;
                const invalidNewPassword = 'nospecialchars';
                const resultBody = (await _passwordSet(agent, currentPassword, invalidNewPassword, 400)).body;

                const expected = {
                    status: {
                        code: 40000
                    },
                    errors: {
                        password: 'Password must be at least 6 character long, containing at least 1 digit, 1 lower and upper case character.'
                    }
                };

                assert.deepEqual(resultBody, expected);
            });

            test('Fail - invalid old password', async function () {
                const invalidCurrentPassword = 'thiscannotbevalid';
                const validNewPassword = 'Test123ASD';
                const resultBody = (await _passwordSet(agent, invalidCurrentPassword, validNewPassword, 400)).body;
                assert.equal(resultBody.status.message, 'Invalid email or new password.');
            });

            test('Fail - Unauthorized', async function () {
                const agent = request.agent(app);
                await _passwordSet(agent, 'oldPassSomething', 'newPassSomething', 401);
            });

        });

        suite('Reset', function () {
            const agent = request.agent(app);
            const email = 'test_reset_' + new Date().getTime() + '@test.ee';
            const password = 'testPassword123';
            const language = 'et';

            suiteSetup(async function () {
                return userLib.createUser(agent, email, password, language);
            });

            suite('Send', function () {
                test('Success', async function () {
                    await passwordResetSend(agent, email);

                    const user = await User.findOne({
                        where: db.where(db.fn('lower', db.col('email')), db.fn('lower', email))
                    });
                    const passwordResetCode = user.passwordResetCode;

                    assert.property(user, 'passwordResetCode');
                    assert.isNotNull(passwordResetCode);
                    assert.lengthOf(passwordResetCode, 36);
                });

                test('Fail - 40000 - missing email', async function () {
                    const resetBody = (await _passwordResetSend(agent, null, 400)).body;
                    const expectedBody = {
                        status: {
                            code: 40000
                        },
                        errors: {
                            email: 'Invalid email'
                        }
                    };

                    assert.deepEqual(resetBody, expectedBody);
                });

                test('Fail - 40001 - non existent email', async function () {
                    const resetBody = (await _passwordResetSend(agent, 'test_this_user_we_dont_have@test.com', 400)).body;
                    const expectedBody = {
                        status: {
                            code: 40002
                        },
                        errors: {
                            email: 'Account with this email does not exist.'
                        }
                    };

                    assert.deepEqual(resetBody, expectedBody);
                });
            });


            suite('Complete', function () {
                let passwordResetCode;

                suiteSetup(async function () {
                    await passwordResetSend(agent, email);
                    const user = await User.findOne({
                        where: db.where(db.fn('lower', db.col('email')), db.fn('lower', email))
                    });
                    passwordResetCode = user.passwordResetCode;
                });

                test('Fail - invalid reset code', async function () {
                    const resBody = (await _passwordResetComplete(agent, email, password, uuid.v4(), 400)).body
                    assert.equal(resBody.status.message, 'Invalid email, password or password reset code.');
                });

                test('Fail - missing reset code', async function () {
                    const resBody = (await _passwordResetComplete(agent, email, password, null, 400)).body
                    assert.equal(resBody.status.message, 'Invalid email, password or password reset code.');
                });


                test('Fail - invalid password', async function () {
                    const resBody = (await _passwordResetComplete(agent, email, 'thispassisnotinvalidformat', passwordResetCode, 400)).body
                    const expected = {
                        status: {
                            code: 40000
                        },
                        errors: {
                            password: 'Password must be at least 6 character long, containing at least 1 digit, 1 lower and upper case character.'
                        }
                    };

                    assert.deepEqual(resBody, expected);
                });

                test('Fail - invalid email', async function () {
                    const resBody = (await _passwordResetComplete(agent, 'test_invalidemail@test.com', password, passwordResetCode, 400)).body
                    assert.equal(resBody.status.message, 'Invalid email, password or password reset code.');
                });

                test('Fail - no password reset has been requested by user (passwordResetCode is null)', async function () {
                    const agent = request.agent(app);
                    const email = 'test_' + new Date().getTime() + '@test.ee';
                    const password = 'testPassword123';

                    await signup(agent, email, password, null);
                    const resBody = (await _passwordResetComplete(agent, email, password, null, 400)).body

                    assert.equal(resBody.status.message, 'Invalid email, password or password reset code.');
                });

                test('Success', async function () {
                    await passwordResetComplete(agent, email, password, passwordResetCode);
                    const loginRes = await login(agent, email, password);
                    assert.equal(email, loginRes.body.data.email);
                    const user = await User.findOne({
                        where: db.where(db.fn('lower', db.col('email')), db.fn('lower', email))
                    });
                    assert.notEqual(user.passwordResetCode, passwordResetCode);
                });

            });

        });

    });

    suite('Status', function () {
        const agent = request.agent(app);
        const email = 'test_status_' + new Date().getTime() + '@test.ee';
        const password = 'testPassword123';

        suiteSetup(async function () {
            return userLib.createUser(agent, email, password, null);
        });

        test('Success', async function () {
            await login(agent, email, password);
            const user = (await status(agent)).body.data;
            assert.equal(user.email, email);
        });

        test('Fail - Unauthorized', async function () {
            await _status(request.agent(app), 401);
        });

        test('Fail - Unauthorized - JWT token expired', async function () {
            const agent = request.agent(app);

            const path = '/api/auth/status';
            const token = jwt.sign({
                id: 'notimportantinthistest',
                scope: 'all'
            }, config.session.privateKey, {
                expiresIn: '.1ms',
                algorithm: config.session.algorithm
            });

            const res = await agent
                .get(path)
                .set('Content-Type', 'application/json')
                .set('Authorization', 'Bearer ' + token)
                .expect(401)
                .expect('Content-Type', /json/);

            const expectedResponse = {
                status: {
                    code: 40100,
                    message: 'JWT token has expired'
                }
            };
            assert.deepEqual(res.body, expectedResponse);
        });

    });

    suite('Open ID', function () {
        const TEST_RESPONSE_TYPE = 'id_token token';
        const TEST_PARTNER = {
            id: 'e5fcb764-a635-4858-a496-e43079c7326b',
            website: 'https://citizenospartner.ee',
            redirectUriRegexp: '^https:\\/\\/([^\\.]*\\.)?citizenospartner.ee(:[0-9]{2,5})?\\/.*'
        };
        const TEST_CALLBACK_URI = 'https://dev.citizenospartner.ee/callback';

        const agent = request.agent(app);

        suiteSetup(async function () {
            return shared
                .syncDb();
        });

        suite('Authorize', function () {

            suiteSetup(async function () {
                return Partner
                    .upsert(TEST_PARTNER);
            });

            test('Success - 302 - User is logged in to CitizenOS AND has agreed before -> redirect_uri', async function () {
                const agent = request.agent(app);
                const user = await userLib.createUserAndLogin(agent, null, null, null);
                await UserConsent.create({
                    userId: user.id,
                    partnerId: TEST_PARTNER.id
                });

                const state = '123213asdasas1231';
                const authRes = await openIdAuthorize(agent, TEST_RESPONSE_TYPE, TEST_PARTNER.id, TEST_CALLBACK_URI, 'openid', state, 'dasd12312sdasAA');

                const uriParts = authRes.headers.location.split('#');
                assert.equal(uriParts[0], TEST_CALLBACK_URI);

                const hashParams = uriParts[1];
                const matchExp = new RegExp('^access_token=[^&]*&id_token=[^&]*&state=' + state + '$');
                assert.match(hashParams, matchExp);
            });

            test('Success - 302 - User is logged in to CitizenOS AND has NOT agreed before -> /consent -> redirect_uri', async function () {
                const agent = request.agent(app);
                await userLib.createUserAndLogin(agent, null, null, null);
                const authRes = await openIdAuthorize(agent, TEST_RESPONSE_TYPE, TEST_PARTNER.id, TEST_CALLBACK_URI, 'openid', '123213asdasas1231', 'dasd12312sdasAA');
                const expectedUrl = urlLib.getFe('/:language/partners/:partnerId/consent', {
                    partnerId: TEST_PARTNER.id,
                    language: 'en'
                });

                assert.equal(authRes.headers.location, expectedUrl);
            });

            test.skip('Success - 302 - User is NOT logged in AND has agreed before -> /login -> redirect_uri', async function () {
            });

            test.skip('Success - 302 - User is NOT logged in AND has not agreed before -> /login -> /consent -> redirect_uri', async function () {
            });

            test.skip('Success - 302 - User is NOT registered -> /register -> /verify -> /consent -> redirect_uri', async function () {
            });

            test('Fail - 400 - Invalid or missing "client_id" parameter value', async function () {
                const authRes = await _openIdAuthorize(agent, null, null, null, null, null, null, 400);
                assert.equal(authRes.text, 'Invalid or missing "client_id" parameter value.');
            });

            test('Fail - 400 - Invalid partner configuration. Please contact system administrator.', async function () {
                const authRes = await _openIdAuthorize(agent, null, uuid.v4(), null, null, null, null, 400);
                assert.equal(authRes.text, 'Invalid partner configuration. Please contact system administrator.');
            });

            test('Fail - 400 - Invalid referer. Referer header does not match expected partner URI scheme.', async function () {
                const res = await agent
                    .get('/api/auth/openid/authorize')
                    .set('Referer', 'https://invalidtest.ee/invalid/referer')
                    .query({
                        client_id: TEST_PARTNER.id
                    })
                    .expect(400);

                assert.equal(res.text, 'Invalid referer. Referer header does not match expected partner URI scheme.');
            });

            test('Fail - 400 - Invalid or missing "redirect_uri" parameter value.', async function () {
                const authRes = await _openIdAuthorize(agent, null, TEST_PARTNER.id, 'https://invalidtest.ee/callback', null, null, null, 400);
                assert.equal(authRes.text, 'Invalid or missing "redirect_uri" parameter value.');
            });

            test('Fail - 400 - Invalid "redirect_uri". Cannot contain fragment component "#".', async function () {
                const authRes = await _openIdAuthorize(agent, null, TEST_PARTNER.id, TEST_CALLBACK_URI + '#', null, null, null, 400);
                assert.equal(authRes.text, 'Invalid "redirect_uri". Cannot contain fragment component "#".');
            });

            test('Fail - 302 - Unsupported "response_type" parameter value. Only "token id_token" is supported.', async function () {
                const authRes = await openIdAuthorize(agent, 'code', TEST_PARTNER.id, TEST_CALLBACK_URI, null, null, null);
                assert.equal(authRes.headers.location, TEST_CALLBACK_URI + '#error=unsupported_response_type&error_description=Unsupported%20%22response_type%22%20parameter%20value.%20Only%20%22token%20id_token%22%20is%20supported.');
            });

            test('Fail - 302 - Unsupported "scope" parameter value. Only "openid" is supported.', async function () {
                const authRes = await openIdAuthorize(agent, TEST_RESPONSE_TYPE, TEST_PARTNER.id, TEST_CALLBACK_URI, 'invalid', null, null);
                assert.equal(authRes.headers.location, TEST_CALLBACK_URI + '#error=invalid_scope&error_description=Unsupported%20%22scope%22%20parameter%20value.%20Only%20%22openid%22%20is%20supported.');

            });

            test('Fail - 302 - Invalid or missing "nonce" parameter value. "nonce" must be a random string with at least 14 characters of length.', async function () {
                const authRes = await openIdAuthorize(agent, TEST_RESPONSE_TYPE, TEST_PARTNER.id, TEST_CALLBACK_URI, 'openid', null, null);
                assert.equal(authRes.headers.location, TEST_CALLBACK_URI + '#error=invalid_request&error_description=Invalid%20or%20missing%20%22nonce%22%20parameter%20value.%20%22nonce%22%20must%20be%20a%20random%20string%20with%20at%20least%2014%20characters%20of%20length.&error_uri=http%3A%2F%2Fopenid.net%2Fspecs%2Fopenid-connect-implicit-1_0.html%23RequestParameters');
            });

        });

    });

});
