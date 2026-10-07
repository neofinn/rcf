'use strict';

// HTTP API as plain handler functions. The Express app mounts these on the
// server (src/app.js) and the browser demo calls the same functions, so both
// run identical logic.
//
// Each route: { method, path, admin?, dev?, handle({ params, query, body }) }.
// A handler returns a JSON-able value, or { httpStatus, body }, or
// { contentType, filename, text } for a file. ValidationError means 400.

const config = require('../config');
const { assignOutlet, isOpen, etaMinutes } = require('../geo');
const { qrSvg } = require('../payments');

const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const IST_OFFSET_MS = 330 * 60 * 1000; // IST is UTC+5:30, no daylight saving
const DAY_MS = 24 * 60 * 60 * 1000;

const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));
const notFound = (error) => ({ httpStatus: 404, body: { error } });
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const publicOutlet = (o, now) => ({
  id: o.id, slug: o.slug, name: o.name, city: o.city, address: o.address, lat: o.lat, lng: o.lng,
  phone: o.phone, deliveryRadiusKm: o.delivery_radius_km, opens: o.opens, closes: o.closes, open: isOpen(o, now),
  upi: !!o.upi_id,
});

const publicPayment = (o) => ({
  method: o.payment_method, status: o.payment_status, label: o.paymentLabel,
  ...(o.upi && o.payment_status !== 'cod' ? { upiId: o.upi.upiId, payee: o.upi.payee, link: o.upi.link, qrSvg: qrSvg(o.upi.link) } : {}),
});

const publicDelivery = (d) => d && {
  partner: d.provider, status: d.status, label: d.label, riderName: d.rider_name, riderPhone: d.rider_phone,
  riderLat: d.rider_lat, riderLng: d.rider_lng, trackUrl: d.track_url,
};

function createRoutes({ store, orders, handoffs, bot, outbox, dispatcher }) {
  return [
    // ---- Customer API ------------------------------------------------------
    {
      method: 'GET', path: '/api/config',
      handle: () => {
        const p = config.pricing;
        return {
          gstPercent: p.gstPercent, packing: p.packingPerOrder, minDeliveryOrder: p.minDeliveryOrder,
          freeDeliveryAbove: p.freeDeliveryAbove,
          deliverySlabs: p.deliverySlabs.map((s) => ({ uptoKm: Number.isFinite(s.uptoKm) ? s.uptoKm : null, fee: s.fee })),
        };
      },
    },
    { method: 'GET', path: '/api/outlets', handle: () => orders.listOutlets().map((o) => publicOutlet(o, new Date())) },
    { method: 'GET', path: '/api/localities', handle: () => store.localities() },
    {
      // Find the outlet that should serve a location.
      method: 'POST', path: '/api/locate',
      handle: ({ body }) => {
        const lat = num(body.lat);
        const lng = num(body.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { httpStatus: 400, body: { error: 'lat and lng are required' } };
        const fulfilment = body.fulfilment === 'pickup' ? 'pickup' : 'delivery';
        const now = new Date();
        const a = assignOutlet(orders.listOutlets(), { lat, lng }, { fulfilment, now });
        return {
          fulfilment,
          outlet: a.outlet && publicOutlet(a.outlet, now),
          distanceKm: a.distanceKm,
          etaMinutes: a.outlet ? etaMinutes(fulfilment, a.distanceKm) : null,
          reason: a.reason,
          pickupSuggestion: a.pickupSuggestion && { outlet: publicOutlet(a.pickupSuggestion.outlet, now), distanceKm: a.pickupSuggestion.distanceKm },
          nearby: a.ranked.slice(0, 3).map((r) => ({ outlet: publicOutlet(r.outlet, now), distanceKm: r.distanceKm, inRange: r.inRange })),
        };
      },
    },
    {
      method: 'GET', path: '/api/menu',
      handle: ({ query }) => {
        const outletId = Number(query.outletId) || null;
        if (outletId && !orders.getOutlet(outletId)) return notFound('Unknown outlet');
        return orders.categories(outletId);
      },
    },
    {
      method: 'POST', path: '/api/quote',
      handle: ({ body }) => {
        const fulfilment = body.fulfilment === 'pickup' ? 'pickup' : 'delivery';
        const { outlet, distanceKm } = orders.resolveOutlet({ fulfilment, lat: num(body.lat), lng: num(body.lng), outletId: Number(body.outletId) || null });
        return { outletId: outlet.id, distanceKm, ...orders.quote({ outletId: outlet.id, items: body.items, fulfilment, distanceKm }) };
      },
    },
    {
      method: 'POST', path: '/api/orders',
      handle: ({ body }) => ({ httpStatus: 201, body: { code: orders.createOrder({ ...body, channel: 'web' }).code } }),
    },
    {
      // Public order tracking. Personal details are trimmed.
      method: 'GET', path: '/api/orders/:code',
      handle: ({ params }) => {
        const o = orders.getOrder(params.code);
        if (!o) return notFound('Order not found');
        return {
          code: o.code, status: o.status, statusLabel: o.statusLabel, fulfilment: o.fulfilment,
          customerName: o.customer_name.split(' ')[0], items: o.items, subtotal: o.subtotal, packing: o.packing,
          gst: o.gst, deliveryFee: o.delivery_fee, total: o.total, paymentMethod: o.payment_method,
          etaMinutes: o.etaMinutes, createdAt: o.created_at, updatedAt: o.updated_at, outlet: o.outlet,
          payment: publicPayment(o),
          delivery: publicDelivery(o.delivery),
        };
      },
    },
    {
      // Customer taps "I've paid" on the tracking page.
      method: 'POST', path: '/api/orders/:code/paid',
      handle: ({ params }) => {
        const o = orders.claimPayment(params.code);
        return o ? { payment: publicPayment(o) } : notFound('Order not found');
      },
    },

    // ---- Outlet staff (admin) ---------------------------------------------
    {
      method: 'GET', path: '/api/admin/orders', admin: true,
      handle: ({ query }) => orders.listOrders({
        outletId: Number(query.outletId) || null, statuses: query.status === 'all' ? null : ACTIVE, limit: query.limit,
      }),
    },
    {
      method: 'POST', path: '/api/admin/orders/:code/status', admin: true,
      handle: ({ params, body }) => orders.updateStatus(params.code, String(body.status || '')) || notFound('Order not found'),
    },
    {
      // Staff confirm a UPI payment arrived, say it hasn't, or switch the order to cash.
      method: 'POST', path: '/api/admin/orders/:code/payment', admin: true,
      handle: ({ params, body }) => orders.setPayment(params.code, String(body.status || '')) || notFound('Order not found'),
    },
    {
      // Delivery partner: (re)book a Shadowfax rider, or deliver with the outlet's own rider.
      method: 'POST', path: '/api/admin/orders/:code/delivery', admin: true,
      handle: async ({ params, body }) => {
        if (!orders.getOrder(params.code)) return notFound('Order not found');
        if (body.action === 'own') return dispatcher.useOwnRider(params.code);
        if (body.action === 'book') return dispatcher.book(params.code);
        return { httpStatus: 400, body: { error: 'action must be "book" or "own"' } };
      },
    },
    {
      // Partner callbacks (Shadowfax). Mounted by the server with its own auth check.
      method: 'POST', path: '/webhooks/shadowfax', partner: true,
      handle: ({ body }) => {
        dispatcher.handleCallback(body);
        return { ok: true };
      },
    },
    { method: 'GET', path: '/api/admin/outlets', admin: true, handle: () => orders.listOutlets() },
    {
      method: 'PATCH', path: '/api/admin/outlets/:id', admin: true,
      handle: ({ params, body }) => {
        const id = Number(params.id);
        if (!orders.getOutlet(id)) return notFound('Unknown outlet');
        if (typeof body.acceptingOrders === 'boolean') store.setAccepting(id, body.acceptingOrders);
        return orders.getOutlet(id);
      },
    },
    { method: 'GET', path: '/api/admin/outlets/:id/menu', admin: true, handle: ({ params }) => orders.menuFor(Number(params.id)) },
    {
      method: 'POST', path: '/api/admin/outlets/:id/availability', admin: true,
      handle: ({ params, body }) => {
        const id = Number(params.id);
        if (!orders.getOutlet(id)) return notFound('Unknown outlet');
        store.setAvailability(id, Number(body.itemId), !!body.available);
        return { ok: true };
      },
    },
    {
      // Today's orders and revenue per outlet (IST day).
      method: 'GET', path: '/api/admin/summary', admin: true,
      handle: () => store.summarySince(new Date(Math.floor((Date.now() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS).toISOString()),
    },
    {
      // Customer chats handed over from the WhatsApp bot.
      method: 'GET', path: '/api/admin/chats', admin: true,
      handle: ({ query }) => handoffs.list({ outletId: Number(query.outletId) || null, status: query.status === 'closed' ? 'closed' : 'open' }),
    },
    {
      method: 'POST', path: '/api/admin/chats/:id/reply', admin: true,
      handle: ({ params, body }) => {
        const h = handoffs.get(Number(params.id));
        const text = String(body.text || '').trim();
        if (!h) return notFound('Chat not found');
        if (h.status !== 'open') return { httpStatus: 400, body: { error: 'This chat is closed' } };
        if (!text) return { httpStatus: 400, body: { error: 'Message is empty' } };
        return handoffs.addMessage(h.id, 'out', text);
      },
    },
    {
      method: 'POST', path: '/api/admin/chats/:id/close', admin: true,
      handle: ({ params }) => {
        if (!handoffs.get(Number(params.id))) return notFound('Chat not found');
        handoffs.close(Number(params.id));
        return { ok: true };
      },
    },
    {
      // Menu as a product feed for WhatsApp / Meta Commerce Manager. One catalog
      // serves every outlet; product ids (RC-<id>) map back to menu items, and the
      // bot routes catalog carts to the nearest outlet by the customer's location.
      method: 'GET', path: '/api/admin/catalog.csv', admin: true,
      handle: () => {
        const base = config.publicBaseUrl;
        const header = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'product_type'];
        const rows = orders.menuFor(null).map((i) => [
          `RC-${i.id}`, i.name, i.description || `${i.veg ? 'Veg' : 'Non-veg'} · ${i.category}`, 'in stock', 'new',
          `${(i.price / 100).toFixed(2)} INR`, `${base}/#item-${i.id}`, `${base}/menu-photos/${i.id}.jpg`, 'Raju Chinese', i.category,
        ]);
        return {
          contentType: 'text/csv', filename: 'raju-chinese-catalog.csv',
          text: [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n',
        };
      },
    },

    // ---- Development: WhatsApp simulator ------------------------------------
    {
      method: 'POST', path: '/api/dev/whatsapp', dev: true,
      handle: ({ body }) => {
        const { from = '919999999999', name = 'Guest', type = 'text', text, location, replyId, items } = body;
        return bot.handle({ from, name, type, text, location, replyId, items });
      },
    },
    {
      // Messages the business sent on its own (status updates, staff replies).
      method: 'GET', path: '/api/dev/whatsapp/outbox', dev: true,
      handle: ({ query }) => {
        const after = Number(query.after) || 0;
        return { last: outbox.at(-1)?.seq || 0, messages: outbox.filter((m) => m.seq > after && m.to === String(query.from)).map((m) => m.reply) };
      },
    },
  ];
}

/** Wrap a WhatsApp client so business-initiated messages are also kept for the simulator. */
function recordOutbox(client, outbox) {
  return {
    ...client,
    async send(to, replies) {
      for (const r of replies) outbox.push({ seq: (outbox.at(-1)?.seq || 0) + 1, to, reply: r });
      if (outbox.length > 1000) outbox.splice(0, outbox.length - 1000);
      return client.send(to, replies);
    },
  };
}

/** Match "/api/orders/:code" style paths. Returns params or null. */
function matchPath(pattern, path) {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

module.exports = { createRoutes, recordOutbox, matchPath, ACTIVE };
