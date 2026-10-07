'use strict';

const path = require('node:path');
const express = require('express');
const config = require('./config');
const { openDb } = require('./db');
const { createOrderService, ValidationError } = require('./orders');
const { createApiRouter } = require('./routes/api');
const { createAdminRouter } = require('./routes/admin');
const { createBot, createSessionStore } = require('./whatsapp/bot');
const { createClient } = require('./whatsapp/client');
const { createWebhookRouter, notifyOnStatusChange } = require('./whatsapp/webhook');

function createApp({ dbPath = config.dbPath, waClient, enableDevTools = !config.production, log = console } = {}) {
  const db = openDb(dbPath);
  const orders = createOrderService(db);
  const bot = createBot({ orders, sessions: createSessionStore(db) });
  const client = waClient || createClient({ log });
  notifyOnStatusChange({ orders, client, log });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Webhook needs the raw body for signature checks, so mount it before JSON parsing.
  app.use('/webhooks/whatsapp', createWebhookRouter({ db, bot, client, log }));

  app.use(express.json({ limit: '100kb' }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api/admin', createAdminRouter({ db, orders }));
  app.use('/api', createApiRouter({ db, orders }));

  if (enableDevTools) {
    // Chat with the WhatsApp bot from the browser (public/whatsapp-sim.html).
    app.post('/api/dev/whatsapp', (req, res) => {
      const { from = '919999999999', name = 'Guest', type = 'text', text, location, replyId } = req.body;
      res.json(bot.handle({ from, name, type, text, location, replyId }));
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

  return { app, db, orders, bot };
}

module.exports = { createApp };
