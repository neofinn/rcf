'use strict';

const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const { rupees } = require('../format');

/** Turn a Cloud API webhook body into normalised messages for the bot. */
function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = new Map((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        const base = { id: m.id, from: m.from, name: names.get(m.from) || null };
        if (m.type === 'text') out.push({ ...base, type: 'text', text: m.text?.body || '' });
        else if (m.type === 'location') out.push({ ...base, type: 'location', location: { lat: m.location.latitude, lng: m.location.longitude } });
        else if (m.type === 'interactive') {
          const id = m.interactive?.button_reply?.id || m.interactive?.list_reply?.id;
          out.push(id ? { ...base, type: 'reply', replyId: id } : { ...base, type: 'unsupported' });
        } else if (m.type === 'button') out.push({ ...base, type: 'text', text: m.button?.payload || m.button?.text || '' });
        else out.push({ ...base, type: 'unsupported' });
      }
    }
  }
  return out;
}

function validSignature(rawBody, header, secret) {
  if (!secret) return true; // not configured (local dev)
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
  const got = Buffer.from(header);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

function createWebhookRouter({ db, bot, client, log = console }) {
  const router = express.Router();
  const markSeen = db.prepare('INSERT OR IGNORE INTO wa_processed (message_id, at) VALUES (?, ?)');

  // Meta's one-time verification handshake.
  router.get('/', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.whatsapp.verifyToken) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
  });

  router.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!validSignature(raw, req.get('x-hub-signature-256'), config.whatsapp.appSecret)) return res.sendStatus(401);
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return res.sendStatus(400); }
    res.sendStatus(200); // acknowledge fast; Meta retries slow webhooks

    for (const msg of parseWebhook(body)) {
      // Meta may deliver the same message more than once.
      if (markSeen.run(msg.id, new Date().toISOString()).changes === 0) continue;
      try {
        await client.send(msg.from, bot.handle(msg));
      } catch (e) {
        log.error('[whatsapp] failed to handle message', e);
      }
    }
  });

  return router;
}

/** Message WhatsApp customers when their order status changes. */
function notifyOnStatusChange({ orders, client, log = console }) {
  const messages = {
    accepted: (o) => `✅ ${o.outlet.name} has accepted your order *${o.code}*.`,
    preparing: (o) => `👨‍🍳 Your order *${o.code}* is being prepared.`,
    out_for_delivery: (o) => `🛵 Your order *${o.code}* is out for delivery! Please keep ${rupees(o.total)} ready (cash/UPI).`,
    ready: (o) => `🥡 Your order *${o.code}* is ready for pickup at ${o.outlet.name}, ${o.outlet.address}.`,
    completed: (o) => `🙏 Thank you for ordering from Raju Chinese! Hope you enjoyed order *${o.code}*. Send *hi* to order again.`,
    cancelled: (o) => `❌ Sorry, your order *${o.code}* was cancelled by the outlet. Please call ${o.outlet.phone} for help.`,
  };
  orders.events.on('status', (o) => {
    // Free-form messages are only allowed inside WhatsApp's 24h customer
    // service window, which WhatsApp orders are. Web orders would need an
    // approved template message.
    if (o.channel !== 'whatsapp' || !messages[o.status]) return;
    const to = o.phone.replace(/^\+/, '');
    client.send(to, [{ type: 'text', text: messages[o.status](o) }]).catch((e) => log.error('[whatsapp] notify failed', e));
  });
}

module.exports = { createWebhookRouter, parseWebhook, validSignature, notifyOnStatusChange };
