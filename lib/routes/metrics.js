'use strict';

const logger = require('../logger');
const ClientMetrics = require('../client-metrics');
const joi = require('joi');
const { clientMetricsSchema, clientRegisterSchema } = require('./metrics-schema');
const { CLIENT_REGISTER, CLIENT_METRICS } = require('../events');
/*
* TODO: 
*  - always catch errors and always return a response to client!
*  - clean up and document uri endpoint
*  - always json response (middleware?)
*  - fix failing tests
*/
module.exports = function (app, config) {
    const {
        clientMetricsStore,
        clientStrategyStore,
        clientInstanceStore,
    } = config.stores;

    const { eventBus } = config;
    
    const metrics = new ClientMetrics(clientMetricsStore);
    
    app.get('/client/seen-toggles', (req, res) => {
        const seenAppToggles = metrics.getAppsWitToggles();
        res.json(seenAppToggles);
    });

    app.get('/metrics/feature-toggles', (req, res) => {
        res.json(metrics.getTogglesMetrics());
    });

    app.post('/client/metrics', (req, res) => {
        const data = req.body;
        const clientIp = req.ip;

        joi.validate(data, clientMetricsSchema, (err, cleaned) => {
            if (err) {
                return res.status(400).json(err);
            }

            eventBus.emit(CLIENT_METRICS);

            clientMetricsStore
                .insert(cleaned)
                .then(() => clientInstanceStore.insert({
                    appName: cleaned.appName,
                    instanceId: cleaned.instanceId,
                    clientIp,
                }))
                .catch(e => logger.error('Error inserting metrics data', e));
            
            res.status(202).end();
        });
    });

    app.post('/client/register', (req, res) => {
        const data = req.body;
        const clientIp = req.ip;

        joi.validate(data, clientRegisterSchema, (err, cleaned) => {
            if (err) {
                return res.status(400).json(err);
            }

            eventBus.emit(CLIENT_REGISTER);

            clientStrategyStore
                .insert(cleaned.appName, cleaned.strategies)
                .then(() => clientInstanceStore.insert({
                    appName: cleaned.appName,
                    instanceId: cleaned.instanceId,
                    clientIp,
                }))
                .then(() => logger.info('New client registered!'))
                .catch((error) => logger.error('Error registering client', error));

            res.status(202).end();
        });
    });

    app.get('/client/strategies', (req, res) => {
        const appName = req.query.appName;
        if(appName) {
            clientStrategyStore.getByAppName(appName)
                .then(data => res.json(data))
                .catch(err => logger.error(err));
        } else {
            clientStrategyStore.getAll()
                .then(data => res.json(data))
                .catch(err => logger.error(err));
        }
    });

    app.get('/client/applications/', (req, res) => {
        clientInstanceStore.getApplications()
            .then(apps => {
                const applications = apps.map(({appName}) => ({
                    appName: appName, 
                    links: {
                        appDetails: `/api/client/applications/${appName}`
                    }
                }))
                res.json({applications})
            })
            .catch(err => logger.error(err));
    });

    app.get('/client/applications/:appName', (req, res) => {
        const appName = req.params.appName;
        const seenToggles = metrics.getSeenTogglesByAppName(appName);
        Promise.all([
                clientInstanceStore.getByAppName(appName), 
                clientStrategyStore.getByAppName(appName)
            ])
            .then(([instances, strategies]) => res.json({appName, instances, strategies, seenToggles}))
            .catch(err => logger.error(err));
    });
};