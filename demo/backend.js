'use strict';

// The real ordering, routing and WhatsApp code running in the browser on an
// in-memory store, behind the same route handlers the server uses.

const seed = require('../src/seed');
const { createMemoryStore } = require('../src/store/memory');
const { createOrderService, ValidationError } = require('../src/orders');
const { createHandoffService } = require('../src/handoff');
const { createRoutes, recordOutbox, matchPath } = require('../src/routes/handlers');
const { createBot, createSessionStore } = require('../src/whatsapp/bot');
const { notifyOnStatusChange, relayHandoffReplies, notifyOnPayment, notifyOnDelivery } = require('../src/whatsapp/notify');
const { createDispatcher } = require('../src/delivery/dispatcher');
const { createSimulatedShadowfax } = require('../src/delivery/simulator');
const { assignOutlet } = require('../src/geo');

function createDemoBackend() {
  // Demo outlets stay open around the clock so it works at any hour.
  const demoSeed = { ...seed, outlets: seed.outlets.map((o, i) => ({ ...o, opens: '00:00', closes: '00:00', sfxStoreCode: `DEMO-${i + 1}` })) };
  const store = createMemoryStore(demoSeed);
  const orders = createOrderService(store);
  const handoffs = createHandoffService(store);
  const bot = createBot({ orders, handoffs, sessions: createSessionStore(store), baseUrl: 'https://order.rajuchinese.example' });
  const outbox = [];
  const client = recordOutbox({ send: async () => {} }, outbox);
  const quiet = { error: () => {}, info: () => {} };
  notifyOnStatusChange({ orders, client, log: quiet });
  relayHandoffReplies({ handoffs, client, log: quiet });
  notifyOnPayment({ orders, client, log: quiet });
  // Pretend Shadowfax: riders are booked when an outlet accepts a delivery order.
  let dispatcher;
  const shadowfax = createSimulatedShadowfax({ onCallback: (p) => dispatcher.handleCallback(p) });
  dispatcher = createDispatcher({ orders, store, provider: shadowfax, log: quiet });
  notifyOnDelivery({ dispatcher, client, log: quiet });
  const routes = createRoutes({ store, orders, handoffs, bot, outbox, dispatcher });

  /** Serve one API request. Resolves to { status, body }. */
  async function request(method, url, body) {
    const u = new URL(url, 'https://demo.local');
    for (const r of routes) {
      if (r.method !== method) continue;
      const params = matchPath(r.path, u.pathname);
      if (!params) continue;
      try {
        const out = await r.handle({ params, query: Object.fromEntries(u.searchParams), body: body || {} });
        if (out && out.contentType) return { status: 200, body: out.text };
        if (out && out.httpStatus) return { status: out.httpStatus, body: out.body };
        return { status: 200, body: out };
      } catch (e) {
        if (e instanceof ValidationError) return { status: 400, body: { error: e.message, code: e.code } };
        console.error(e);
        return { status: 500, body: { error: 'Something went wrong' } };
      }
    }
    return { status: 404, body: { error: 'Not found' } };
  }

  return { request, orders, handoffs, store, dispatcher, assignOutlet, outlets: () => orders.listOutlets(), localities: () => store.localities() };
}

module.exports = { createDemoBackend };
