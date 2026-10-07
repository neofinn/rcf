'use strict';

// Data access for the server, backed by SQLite (node:sqlite). The browser demo
// implements the same interface in memory (src/store/memory.js), so the order,
// handoff and WhatsApp logic run unchanged in both.

function createSqliteStore(db) {
  const q = {
    outlets: db.prepare('SELECT * FROM outlets WHERE active = 1 ORDER BY id'),
    outlet: db.prepare('SELECT * FROM outlets WHERE id = ?'),
    setAccepting: db.prepare('UPDATE outlets SET accepting_orders = ? WHERE id = ?'),
    items: db.prepare('SELECT * FROM menu_items WHERE active = 1 ORDER BY sort'),
    unavailable: db.prepare('SELECT item_id FROM outlet_unavailable_items WHERE outlet_id = ?'),
    markOut: db.prepare('INSERT OR IGNORE INTO outlet_unavailable_items (outlet_id, item_id) VALUES (?, ?)'),
    markIn: db.prepare('DELETE FROM outlet_unavailable_items WHERE outlet_id = ? AND item_id = ?'),
    localities: db.prepare('SELECT name, city, lat, lng FROM localities ORDER BY city, id'),

    insertOrder: db.prepare(`INSERT INTO orders (code, outlet_id, channel, fulfilment, customer_name, phone,
      address, lat, lng, distance_km, notes, subtotal, packing, gst, delivery_fee, total, payment_method,
      payment_status, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertLine: db.prepare('INSERT INTO order_items (order_id, item_id, name, price, qty, note) VALUES (?, ?, ?, ?, ?, ?)'),
    byCode: db.prepare('SELECT * FROM orders WHERE code = ?'),
    lines: db.prepare('SELECT item_id, name, price, qty, note FROM order_items WHERE order_id = ? ORDER BY rowid'),
    latestForPhone: db.prepare('SELECT * FROM orders WHERE phone = ? ORDER BY id DESC LIMIT 1'),
    setStatus: db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?'),
    setPayment: db.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ? AND payment_status = ?'),
    summary: db.prepare(`SELECT outlet_id, COUNT(*) AS orders, SUM(total) AS revenue FROM orders
      WHERE status != 'cancelled' AND created_at >= ? GROUP BY outlet_id`),

    openHandoff: db.prepare(`INSERT INTO wa_handoffs (phone, name, outlet_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'open', ?, ?)`),
    handoff: db.prepare('SELECT * FROM wa_handoffs WHERE id = ?'),
    openHandoffForPhone: db.prepare("SELECT * FROM wa_handoffs WHERE phone = ? AND status = 'open' ORDER BY id DESC LIMIT 1"),
    addHandoffMsg: db.prepare('INSERT INTO wa_handoff_messages (handoff_id, direction, body, at) VALUES (?, ?, ?, ?)'),
    touchHandoff: db.prepare('UPDATE wa_handoffs SET updated_at = ? WHERE id = ?'),
    handoffMsgs: db.prepare('SELECT direction, body, at FROM wa_handoff_messages WHERE handoff_id = ? ORDER BY id'),
    closeHandoff: db.prepare("UPDATE wa_handoffs SET status = 'closed', updated_at = ? WHERE id = ? AND status = 'open'"),

    getSession: db.prepare('SELECT data, updated_at FROM wa_sessions WHERE phone = ?'),
    putSession: db.prepare(`INSERT INTO wa_sessions (phone, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
  };

  function transaction(fn) {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  return {
    // Outlets & menu
    outlets: () => q.outlets.all(),
    outlet: (id) => q.outlet.get(id) || null,
    setAccepting: (id, accepting) => q.setAccepting.run(accepting ? 1 : 0, id),
    menuItems: () => q.items.all(),
    unavailableItemIds: (outletId) => q.unavailable.all(outletId).map((r) => r.item_id),
    setAvailability: (outletId, itemId, available) => (available ? q.markIn : q.markOut).run(outletId, itemId),
    localities: () => q.localities.all(),

    // Orders
    orderCodeExists: (code) => !!q.byCode.get(code),
    insertOrder: (o, lines) => transaction(() => {
      const id = q.insertOrder.run(o.code, o.outlet_id, o.channel, o.fulfilment, o.customer_name, o.phone, o.address,
        o.lat, o.lng, o.distance_km, o.notes, o.subtotal, o.packing, o.gst, o.delivery_fee, o.total, o.payment_method,
        o.payment_status, o.status, o.created_at, o.updated_at).lastInsertRowid;
      for (const l of lines) q.insertLine.run(id, l.item_id, l.name, l.price, l.qty, l.note);
      return id;
    }),
    orderByCode: (code) => q.byCode.get(code) || null,
    orderLines: (orderId) => q.lines.all(orderId),
    latestOrderForPhone: (phone) => q.latestForPhone.get(phone) || null,
    listOrders({ outletId, statuses, limit }) {
      const where = [];
      const args = [];
      if (outletId) { where.push('outlet_id = ?'); args.push(outletId); }
      if (statuses && statuses.length) {
        where.push(`status IN (${statuses.map(() => '?').join(',')})`);
        args.push(...statuses);
      }
      const sql = `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
      return db.prepare(sql).all(...args, limit);
    },
    setOrderStatus: (id, from, to, ts) => q.setStatus.run(to, ts, id, from).changes > 0,
    setPaymentStatus: (id, from, to, ts) => q.setPayment.run(to, ts, id, from).changes > 0,
    summarySince: (iso) => q.summary.all(iso),

    // WhatsApp handoffs to staff
    openHandoff: ({ phone, name, outletId, ts }) => Number(q.openHandoff.run(phone, name || null, outletId || null, ts, ts).lastInsertRowid),
    handoff: (id) => q.handoff.get(id) || null,
    openHandoffForPhone: (phone) => q.openHandoffForPhone.get(phone) || null,
    addHandoffMessage: (id, direction, body, ts) => { q.addHandoffMsg.run(id, direction, body, ts); q.touchHandoff.run(ts, id); },
    handoffMessages: (id) => q.handoffMsgs.all(id),
    closeHandoff: (id, ts) => q.closeHandoff.run(ts, id).changes > 0,
    listHandoffs({ outletId, status }) {
      const where = ['status = ?'];
      const args = [status];
      if (outletId) { where.push('(outlet_id = ? OR outlet_id IS NULL)'); args.push(outletId); }
      return db.prepare(`SELECT * FROM wa_handoffs WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 100`).all(...args);
    },

    // WhatsApp conversation state
    getSession(phone) {
      const r = q.getSession.get(phone);
      return r ? { data: JSON.parse(r.data), updatedAt: r.updated_at } : null;
    },
    putSession: (phone, data, ts) => q.putSession.run(phone, JSON.stringify(data), ts),
  };
}

module.exports = { createSqliteStore };
