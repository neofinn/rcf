'use strict';

const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');

const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(config.adminToken);
  if (token.length === expected.length && crypto.timingSafeEqual(token, expected)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function createAdminRouter({ db, orders }) {
  const router = express.Router();
  router.use(requireAdmin);

  const setAccepting = db.prepare('UPDATE outlets SET accepting_orders = ? WHERE id = ?');
  const markOut = db.prepare('INSERT OR IGNORE INTO outlet_unavailable_items (outlet_id, item_id) VALUES (?, ?)');
  const markIn = db.prepare('DELETE FROM outlet_unavailable_items WHERE outlet_id = ? AND item_id = ?');
  const summary = db.prepare(`SELECT outlet_id, COUNT(*) AS orders, SUM(total) AS revenue FROM orders
    WHERE status != 'cancelled' AND created_at >= ? GROUP BY outlet_id`);

  router.get('/orders', (req, res) => {
    const outletId = Number(req.query.outletId) || null;
    const statuses = req.query.status === 'all' ? null : ACTIVE;
    res.json(orders.listOrders({ outletId, statuses, limit: req.query.limit }));
  });

  router.post('/orders/:code/status', (req, res) => {
    const o = orders.updateStatus(req.params.code, String(req.body.status || ''));
    if (!o) return res.status(404).json({ error: 'Order not found' });
    res.json(o);
  });

  router.get('/outlets', (req, res) => res.json(orders.listOutlets()));

  router.patch('/outlets/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!orders.getOutlet(id)) return res.status(404).json({ error: 'Unknown outlet' });
    if (typeof req.body.acceptingOrders === 'boolean') setAccepting.run(req.body.acceptingOrders ? 1 : 0, id);
    res.json(orders.getOutlet(id));
  });

  router.get('/outlets/:id/menu', (req, res) => res.json(orders.menuFor(Number(req.params.id))));

  router.post('/outlets/:id/availability', (req, res) => {
    const id = Number(req.params.id);
    const itemId = Number(req.body.itemId);
    if (!orders.getOutlet(id)) return res.status(404).json({ error: 'Unknown outlet' });
    (req.body.available ? markIn : markOut).run(id, itemId);
    res.json({ ok: true });
  });

  // Today's orders and revenue per outlet (IST day).
  router.get('/summary', (req, res) => {
    // IST is a fixed UTC+5:30 with no daylight saving.
    const IST_OFFSET_MS = 330 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const since = new Date(Math.floor((Date.now() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS).toISOString();
    res.json(summary.all(since));
  });

  return router;
}

module.exports = { createAdminRouter };
