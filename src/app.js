'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const config = require('./config');
const { openDb } = require('./db');
const { createSqliteStore } = require('./store/sqlite');
const { createOrderService, ValidationError } = require('./orders');
const { createHandoffService } = require('./handoff');
const { createRoutes, recordOutbox } = require('./routes/handlers');
const { createBot, createSessionStore } = require('./whatsapp/bot');
const { createClient } = require('./whatsapp/client');
const { createWebhookRouter } = require('./whatsapp/webhook');
const { notifyOnStatusChange, relayHandoffReplies } = require('./whatsapp/notify');

function isAdmin(req) {
  const token = Buffer.from((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(config.adminToken);
  return token.length === expected.length && crypto.timingSafeEqual(token, expected);
}

function createApp({ dbPath = config.dbPath, waClient, enableDevTools = !config.production, log = console } = {}) {
  const db = openDb(dbPath);
  const store = createSqliteStore(db);
  const orders = createOrderService(store);
  const handoffs = createHandoffService(store);
  const bot = createBot({ orders, handoffs, sessions: createSessionStore(store) });

  // Dev: keep messages the business sends on its own so the simulator can show them.
  const outbox = [];
  const baseClient = waClient || createClient({ log });
  const client = enableDevTools ? recordOutbox(baseClient, outbox) : baseClient;
  notifyOnStatusChange({ orders, client, log });
  relayHandoffReplies({ handoffs, client, log });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Webhook needs the raw body for signature checks, so mount it before JSON parsing.
  app.use('/webhooks/whatsapp', createWebhookRouter({ db, bot, client, log }));

  app.use(express.json({ limit: '100kb' }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  for (const route of createRoutes({ store, orders, handoffs, bot, outbox })) {
    if (route.dev && !enableDevTools) continue;
    app[route.method.toLowerCase()](route.path, (req, res) => {
      if (route.admin && !isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
      const out = route.handle({ params: req.params, query: req.query, body: req.body || {} });
      if (out && out.contentType) return res.type(out.contentType).attachment(out.filename).send(out.text);
      if (out && out.httpStatus) return res.status(out.httpStatus).json(out.body);
      res.json(out);
    });
  }

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message, code: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    log.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return { app, db, store, orders, handoffs, bot };
}

module.exports = { createApp };
