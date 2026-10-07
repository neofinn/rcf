'use strict';

// In-memory implementation of the store interface (see sqlite.js). Used by the
// browser demo; data lives only as long as the page.

function createMemoryStore(seed) {
  const outlets = seed.outlets.map((o, i) => ({
    id: i + 1, slug: o.slug, name: o.name, city: o.city, address: o.address, lat: o.lat, lng: o.lng, phone: o.phone,
    delivery_radius_km: o.radiusKm, opens: o.opens, closes: o.closes, accepting_orders: 1, active: 1,
  }));
  const items = seed.menu.map((m, i) => ({
    id: i + 1, category: m.category, name: m.name, description: m.description || '', price: m.price * 100,
    veg: m.veg ? 1 : 0, sort: i, active: 1,
  }));
  const unavailable = new Set();
  const orders = [];
  const lines = new Map();
  const handoffs = [];
  const handoffMsgs = new Map();
  const sessions = new Map();
  const copy = (x) => (x ? { ...x } : null);
  const byNewest = (a, b) => b.id - a.id;

  return {
    outlets: () => outlets.filter((o) => o.active).map(copy),
    outlet: (id) => copy(outlets.find((o) => o.id === Number(id))),
    setAccepting(id, accepting) { const o = outlets.find((x) => x.id === Number(id)); if (o) o.accepting_orders = accepting ? 1 : 0; },
    menuItems: () => items.filter((i) => i.active).map(copy),
    unavailableItemIds: (outletId) => items.filter((i) => unavailable.has(`${outletId}|${i.id}`)).map((i) => i.id),
    setAvailability(outletId, itemId, available) { unavailable[available ? 'delete' : 'add'](`${outletId}|${itemId}`); },
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

    getSession: (phone) => (sessions.has(phone) ? JSON.parse(sessions.get(phone)) : null),
    putSession(phone, data, ts) { sessions.set(phone, JSON.stringify({ data, updatedAt: ts })); },
  };
}

module.exports = { createMemoryStore };
