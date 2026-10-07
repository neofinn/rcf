'use strict';

const express = require('express');
const config = require('../config');
const { assignOutlet, isOpen, etaMinutes } = require('../geo');

const publicOutlet = (o, now) => ({
  id: o.id, slug: o.slug, name: o.name, city: o.city, address: o.address, lat: o.lat, lng: o.lng,
  phone: o.phone, deliveryRadiusKm: o.delivery_radius_km, opens: o.opens, closes: o.closes, open: isOpen(o, now),
});

const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));

function createApiRouter({ db, orders }) {
  const router = express.Router();
  const localities = db.prepare('SELECT name, city, lat, lng FROM localities ORDER BY city, id');

  router.get('/config', (req, res) => {
    const p = config.pricing;
    res.json({
      gstPercent: p.gstPercent, packing: p.packingPerOrder, minDeliveryOrder: p.minDeliveryOrder,
      freeDeliveryAbove: p.freeDeliveryAbove,
      deliverySlabs: p.deliverySlabs.map((s) => ({ uptoKm: Number.isFinite(s.uptoKm) ? s.uptoKm : null, fee: s.fee })),
    });
  });

  router.get('/outlets', (req, res) => {
    const now = new Date();
    res.json(orders.listOutlets().map((o) => publicOutlet(o, now)));
  });

  router.get('/localities', (req, res) => res.json(localities.all()));

  // Find the outlet that should serve a location.
  router.post('/locate', (req, res) => {
    const lat = num(req.body.lat);
    const lng = num(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required' });
    const fulfilment = req.body.fulfilment === 'pickup' ? 'pickup' : 'delivery';
    const now = new Date();
    const a = assignOutlet(orders.listOutlets(), { lat, lng }, { fulfilment, now });
    res.json({
      fulfilment,
      outlet: a.outlet && publicOutlet(a.outlet, now),
      distanceKm: a.distanceKm,
      etaMinutes: a.outlet ? etaMinutes(fulfilment, a.distanceKm) : null,
      reason: a.reason,
      pickupSuggestion: a.pickupSuggestion && { outlet: publicOutlet(a.pickupSuggestion.outlet, now), distanceKm: a.pickupSuggestion.distanceKm },
      nearby: a.ranked.slice(0, 3).map((r) => ({ outlet: publicOutlet(r.outlet, now), distanceKm: r.distanceKm, inRange: r.inRange })),
    });
  });

  router.get('/menu', (req, res) => {
    const outletId = Number(req.query.outletId) || null;
    if (outletId && !orders.getOutlet(outletId)) return res.status(404).json({ error: 'Unknown outlet' });
    res.json(orders.categories(outletId));
  });

  router.post('/quote', (req, res) => {
    const b = req.body;
    const fulfilment = b.fulfilment === 'pickup' ? 'pickup' : 'delivery';
    const { outlet, distanceKm } = orders.resolveOutlet({ fulfilment, lat: num(b.lat), lng: num(b.lng), outletId: Number(b.outletId) || null });
    res.json({ outletId: outlet.id, distanceKm, ...orders.quote({ outletId: outlet.id, items: b.items, fulfilment, distanceKm }) });
  });

  router.post('/orders', (req, res) => {
    const order = orders.createOrder({ ...req.body, channel: 'web' });
    res.status(201).json({ code: order.code });
  });

  // Public order tracking. Personal details are trimmed.
  router.get('/orders/:code', (req, res) => {
    const o = orders.getOrder(req.params.code);
    if (!o) return res.status(404).json({ error: 'Order not found' });
    res.json({
      code: o.code, status: o.status, statusLabel: o.statusLabel, fulfilment: o.fulfilment,
      customerName: o.customer_name.split(' ')[0], items: o.items, subtotal: o.subtotal, packing: o.packing,
      gst: o.gst, deliveryFee: o.delivery_fee, total: o.total, paymentMethod: o.payment_method,
      etaMinutes: o.etaMinutes, createdAt: o.created_at, updatedAt: o.updated_at, outlet: o.outlet,
    });
  });

  return router;
}

module.exports = { createApiRouter };
