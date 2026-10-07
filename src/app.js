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
const { notifyOnStatusChange, relayHandoffReplies, notifyOnPayment, notifyOnDelivery } = require('./whatsapp/notify');
const { createDispatcher } = require('./delivery/dispatcher');
const { createShadowfaxClient } = require('./delivery/shadowfax');
const { createSimulatedShadowfax } = require('./delivery/simulator');
const { qrPng } = require('./payments');

function isAdmin(req) {
  const token = Buffer.from((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(config.adminToken);
  return token.length === expected.length && crypto.timingSafeEqual(token, expected);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function deliveryProvider({ shadowfax, onCallback }) {
  if (shadowfax.mode === 'live') return createShadowfaxClient({ token: shadowfax.token, baseUrl: shadowfax.baseUrl });
  if (shadowfax.mode === 'simulate') return createSimulatedShadowfax({ onCallback });
  return null;
}

function createApp({
  dbPath = config.dbPath, waClient, enableDevTools = !config.production, log = console, deliveryPartner,
} = {}) {
  const db = openDb(dbPath);
  const store = createSqliteStore(db);
  const orders = createOrderService(store);
  const handoffs = createHandoffService(store);
  const bot = createBot({ orders, handoffs, sessions: createSessionStore(store), places: () => store.localities() });

  // Dev: keep messages the business sends on its own so the simulator can show them.
  const outbox = [];
  const baseClient = waClient || createClient({ log });
  const client = enableDevTools ? recordOutbox(baseClient, outbox) : baseClient;
  notifyOnStatusChange({ orders, client, log });
  relayHandoffReplies({ handoffs, client, log });
  notifyOnPayment({ orders, client, log });

  let dispatcher;
  const provider = deliveryPartner !== undefined ? deliveryPartner
    : deliveryProvider({ shadowfax: config.shadowfax, onCallback: (p) => dispatcher.handleCallback(p) });
  dispatcher = createDispatcher({ orders, store, provider, bookOn: config.shadowfax.bookOn, log });
  notifyOnDelivery({ dispatcher, client, log });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Webhook needs the raw body for signature checks, so mount it before JSON parsing.
  app.use('/webhooks/whatsapp', createWebhookRouter({ db, bot, client, log }));

  app.use(express.json({ limit: '100kb' }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // UPI QR image for an order (sent as a WhatsApp image; WhatsApp can't show SVG).
  app.get('/pay/:code/qr.png', async (req, res, next) => {
    try {
      const o = orders.getOrder(req.params.code);
      if (!o || !o.upi) return res.sendStatus(404);
      res.type('png').set('Cache-Control', 'private, max-age=3600').send(await qrPng(o.upi.link));
    } catch (e) { next(e); }
  });

  // Shadowfax sends a shared secret in a custom header we agree with them at
  // onboarding. Without one configured, callbacks are only accepted outside production.
  const partnerAuthorized = (req) => (config.shadowfax.callbackToken
    ? safeEqual(req.get('x-callback-token'), config.shadowfax.callbackToken)
    : !config.production);

  for (const route of createRoutes({ store, orders, handoffs, bot, outbox, dispatcher })) {
    if (route.dev && !enableDevTools) continue;
    // Shadowfax may call back with POST or PUT.
    const methods = route.partner ? ['post', 'put'] : [route.method.toLowerCase()];
    for (const method of methods) app[method](route.path, async (req, res, next) => {
      if (route.admin && !isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (route.partner && !partnerAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
      let out;
      try {
        out = await route.handle({ params: req.params, query: req.query, body: req.body || {} });
      } catch (e) { return next(e); }
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

  return { app, db, store, orders, handoffs, bot, dispatcher };
}

module.exports = { createApp };
