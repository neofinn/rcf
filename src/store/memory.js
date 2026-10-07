'use strict';

// In-memory implementation of the store interface (see sqlite.js). Used by the
// browser demo; data lives only as long as the page.

function createMemoryStore(seed) {
  const outlets = seed.outlets.map((o, i) => ({
    id: i + 1, slug: o.slug, name: o.name, city: o.city, address: o.address, lat: o.lat, lng: o.lng, phone: o.phone,
    delivery_radius_km: o.radiusKm, opens: o.opens, closes: o.closes, accepting_orders: 1, active: 1,
    upi_id: o.upiId || null, upi_name: 'Raju Chinese', sfx_store_code: o.sfxStoreCode || null,
    wa_payment_config: o.waPaymentConfig || null,
  }));
  const items = seed.menu.map((m, i) => ({
    id: i + 1, category: m.category, name: m.name, description: m.description || '', price: m.price * 100,
    veg: m.veg ? 1 : 0, sort: i, active: 1,
  }));
  const unavailable = new Set();
  const stock = new Map(); // "outlet|item" -> { remaining, updated_at }
  const pins = new Map();
  const staffSessions = new Map();
  const orders = [];
  const lines = new Map();
  const handoffs = [];
  const handoffMsgs = new Map();
  const sessions = new Map();
  const deliveries = new Map();
  const customers = new Map();
  const ledger = [];
  const priceHistory = [];
  const events = [];
  const ratings = new Map();
  const comments = new Map();
  const jobs = [];
  const inRange = (fromIso, toIso) => new Set(orders.filter((o) => o.created_at >= fromIso && o.created_at < toIso).map((o) => o.id));
  const copy = (x) => (x ? { ...x } : null);
  const byNewest = (a, b) => b.id - a.id;

  return {
    outlets: () => outlets.filter((o) => o.active).map(copy),
    outlet: (id) => copy(outlets.find((o) => o.id === Number(id))),
    setAccepting(id, accepting) { const o = outlets.find((x) => x.id === Number(id)); if (o) o.accepting_orders = accepting ? 1 : 0; },
    allOutlets: () => outlets.map(copy),
    insertOutlet(o) { const id = Math.max(0, ...outlets.map((x) => x.id)) + 1; outlets.push({ ...o, id }); return id; },
    updateOutlet(id, fields) { const o = outlets.find((x) => x.id === Number(id)); if (o) Object.assign(o, fields); },
    menuItems: () => items.filter((i) => i.active).map(copy),
    unavailableItemIds: (outletId) => items.filter((i) => unavailable.has(`${outletId}|${i.id}`)).map((i) => i.id),
    setAvailability(outletId, itemId, available) { unavailable[available ? 'delete' : 'add'](`${outletId}|${itemId}`); },
    stockFor: (outletId) => [...stock].filter(([k]) => k.startsWith(`${outletId}|`)).map(([k, v]) => ({ item_id: Number(k.split('|')[1]), ...v })),
    allStock: () => [...stock].map(([k, v]) => ({ outlet_id: Number(k.split('|')[0]), item_id: Number(k.split('|')[1]), ...v })),
    allUnavailable: () => [...unavailable].map((k) => ({ outlet_id: Number(k.split('|')[0]), item_id: Number(k.split('|')[1]) })),
    setStock(outletId, itemId, remaining, ts) {
      if (remaining == null) stock.delete(`${outletId}|${itemId}`);
      else stock.set(`${outletId}|${itemId}`, { remaining, updated_at: ts });
    },
    adjustStock(outletId, itemId, delta, ts) {
      const s = stock.get(`${outletId}|${itemId}`);
      if (s) Object.assign(s, { remaining: Math.max(0, s.remaining + delta), updated_at: ts });
    },
    outletPinHash: (outletId) => copy(pins.get(Number(outletId))),
    outletLogins: () => [...pins].map(([outlet_id, p]) => ({ outlet_id, updated_at: p.updated_at })),
    setOutletPin(outletId, hash, ts) { pins.set(Number(outletId), { pin_hash: hash, updated_at: ts }); },
    addStaffSession(tokenHash, outletId, createdAt, expiresAt) {
      staffSessions.set(tokenHash, { token_hash: tokenHash, outlet_id: outletId, created_at: createdAt, expires_at: expiresAt });
    },
    staffSession: (tokenHash, now) => { const x = staffSessions.get(tokenHash); return x && x.expires_at > now ? copy(x) : null; },
    dropStaffSession(tokenHash) { staffSessions.delete(tokenHash); },
    dropStaffSessions(outletId) { for (const [k, v] of staffSessions) if (v.outlet_id === Number(outletId)) staffSessions.delete(k); },
    staffSessionCounts(now) {
      const by = new Map();
      for (const v of staffSessions.values()) {
        if (v.expires_at <= now) continue;
        const c = by.get(v.outlet_id) || { outlet_id: v.outlet_id, n: 0, last: '' };
        c.n += 1; if (v.created_at > c.last) c.last = v.created_at;
        by.set(v.outlet_id, c);
      }
      return [...by.values()];
    },
    localities: () => seed.localities.map(copy),

    orderCodeExists: (code) => orders.some((o) => o.code === code),
    insertOrder(o, ls) {
      const id = orders.length + 1;
      orders.push({ ...o, id });
      lines.set(id, ls.map(copy));
      return id;
    },
    orderByCode: (code) => copy(orders.find((o) => o.code === code)),
    orderLines: (id) => (lines.get(id) || []).map(copy),
    latestOrderForPhone: (phone) => copy([...orders].sort(byNewest).find((o) => o.phone === phone)),
    listOrders: ({ outletId, statuses, limit }) => [...orders].sort(byNewest)
      .filter((o) => (!outletId || o.outlet_id === Number(outletId)) && (!statuses || statuses.includes(o.status)))
      .slice(0, limit).map(copy),
    setOrderStatus(id, from, to, ts) {
      const o = orders.find((x) => x.id === id && x.status === from);
      if (!o) return false;
      Object.assign(o, { status: to, updated_at: ts });
      return true;
    },
    setPaymentStatus(id, from, to, ts) {
      const o = orders.find((x) => x.id === id && x.payment_status === from);
      if (!o) return false;
      Object.assign(o, { payment_status: to, updated_at: ts });
      return true;
    },
    orderById: (id) => copy(orders.find((o) => o.id === id)),
    getDelivery: (orderId) => copy(deliveries.get(orderId)),
    deliveryByRef: (ref) => copy([...deliveries.values()].find((d) => d.ref === ref)),
    upsertDelivery(orderId, fields) {
      deliveries.set(orderId, { provider: 'none', ref: null, status: 'FAILED', ...deliveries.get(orderId), ...fields, order_id: orderId });
    },
    summarySince(iso) {
      const m = new Map();
      for (const o of orders) {
        if (o.status === 'cancelled' || o.created_at < iso) continue;
        const r = m.get(o.outlet_id) || { outlet_id: o.outlet_id, orders: 0, revenue: 0 };
        r.orders += 1;
        r.revenue += o.total;
        m.set(o.outlet_id, r);
      }
      return [...m.values()];
    },

    openHandoff({ phone, name, outletId, ts }) {
      const id = handoffs.length + 1;
      handoffs.push({ id, phone, name: name || null, outlet_id: outletId || null, status: 'open', created_at: ts, updated_at: ts });
      handoffMsgs.set(id, []);
      return id;
    },
    handoff: (id) => copy(handoffs.find((h) => h.id === Number(id))),
    openHandoffForPhone: (phone) => copy([...handoffs].sort(byNewest).find((h) => h.phone === phone && h.status === 'open')),
    addHandoffMessage(id, direction, body, at) {
      handoffMsgs.get(id).push({ direction, body, at });
      handoffs.find((h) => h.id === id).updated_at = at;
    },
    handoffMessages: (id) => (handoffMsgs.get(id) || []).map(copy),
    closeHandoff(id, ts) {
      const h = handoffs.find((x) => x.id === Number(id) && x.status === 'open');
      if (!h) return false;
      Object.assign(h, { status: 'closed', updated_at: ts });
      return true;
    },
    listHandoffs: ({ outletId, status }) => handoffs
      .filter((h) => h.status === status && (!outletId || !h.outlet_id || h.outlet_id === Number(outletId)))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).map(copy),

    allMenuItems: () => items.map(copy),
    updateMenuItem(id, fields) {
      const it = items.find((i) => i.id === Number(id));
      if (!it) return;
      for (const k of ['category', 'name', 'description', 'price', 'veg', 'active', 'sort']) if (fields[k] !== undefined) it[k] = fields[k];
    },
    insertMenuItem(i) {
      const id = Math.max(0, ...items.map((x) => x.id)) + 1;
      items.push({ id, category: i.category, name: i.name, description: i.description || '', price: i.price, veg: i.veg ? 1 : 0, sort: i.sort ?? 9999, active: i.active === 0 ? 0 : 1 });
      return id;
    },
    setPrices(changes, batch, note, ts) {
      for (const c of changes) {
        items.find((i) => i.id === c.id).price = c.newPrice;
        if (batch) priceHistory.push({ batch, item_id: c.id, old_price: c.oldPrice, new_price: c.newPrice, note: note || null, at: ts });
      }
    },
    lastPriceBatch() {
      const last = priceHistory.at(-1);
      return last ? priceHistory.filter((h) => h.batch === last.batch).map(copy) : [];
    },
    dropPriceBatch(batch) { for (let i = priceHistory.length - 1; i >= 0; i--) if (priceHistory[i].batch === batch) priceHistory.splice(i, 1); },

    customer: (phone) => copy(customers.get(phone)),
    customers: () => [...customers.values()].map(copy),
    upsertCustomer(c) {
      const cur = customers.get(c.phone) || { tags: '', notes: '', marketing_opt_in: 0 };
      customers.set(c.phone, { ...cur, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) });
    },
    addPoints(e) {
      if (e.kind === 'earn' && ledger.some((l) => l.kind === 'earn' && l.order_id === e.orderId)) return false;
      ledger.push({ id: ledger.length + 1, phone: e.phone, order_id: e.orderId ?? null, points: e.points, kind: e.kind, note: e.note ?? null, at: e.at });
      return true;
    },
    pointsLedger: (phone) => ledger.filter((l) => l.phone === phone).reverse().map(copy),
    pointsBalances() {
      const m = new Map();
      for (const l of ledger) m.set(l.phone, (m.get(l.phone) || 0) + l.points);
      return m;
    },
    pointsEarnedFor: (orderId) => ledger.find((l) => l.kind === 'earn' && l.order_id === orderId)?.points ?? null,
    addRating(r) { ratings.set(`${r.orderId}|${r.itemId}`, { order_id: r.orderId, item_id: r.itemId, name: r.name, stars: r.stars, outlet_id: r.outletId, phone: r.phone, at: r.at }); },
    ratingsForOrder: (orderId) => [...ratings.values()].filter((r) => r.order_id === orderId).map(copy),
    ratingsBetween(fromIso, toIso) { const ids = inRange(fromIso, toIso); return [...ratings.values()].filter((r) => ids.has(r.order_id)).map(copy); },
    addReviewComment(orderId, comment, at) { comments.set(orderId, { order_id: orderId, comment, at }); },
    commentsBetween(fromIso, toIso) { const ids = inRange(fromIso, toIso); return [...comments.values()].filter((c) => ids.has(c.order_id)).map(copy); },
    addJob(runAt, kind, payload) { jobs.push({ id: jobs.length + 1, run_at: runAt, kind, payload: JSON.parse(JSON.stringify(payload)), done_at: null }); return jobs.length; },
    dueJobs: (nowIso) => jobs.filter((j) => !j.done_at && j.run_at <= nowIso).map(copy),
    markJobDone(id, at) { const j = jobs.find((x) => x.id === id && !x.done_at); if (!j) return false; j.done_at = at; return true; },
    addOrderEvent(orderId, status, at) { events.push({ order_id: orderId, status, at }); },
    orderEventsBetween(fromIso, toIso) {
      const ids = new Set(orders.filter((o) => o.created_at >= fromIso && o.created_at < toIso).map((o) => o.id));
      return events.filter((e) => ids.has(e.order_id)).map(copy);
    },
    ordersForPhone: (phone) => [...orders].sort(byNewest).filter((o) => o.phone === phone).map(copy),
    ordersBetween: (fromIso, toIso) => orders.filter((o) => o.created_at >= fromIso && o.created_at < toIso)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map(copy),
    linesBetween: (fromIso, toIso) => orders.filter((o) => o.created_at >= fromIso && o.created_at < toIso)
      .flatMap((o) => (lines.get(o.id) || []).map((l) => ({ ...l, order_id: o.id }))),

    getSession: (phone) => (sessions.has(phone) ? JSON.parse(sessions.get(phone)) : null),
    putSession(phone, data, ts) { sessions.set(phone, JSON.stringify({ data, updatedAt: ts })); },
  };
}

module.exports = { createMemoryStore };
