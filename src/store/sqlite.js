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
    byId: db.prepare('SELECT * FROM orders WHERE id = ?'),
    getDelivery: db.prepare('SELECT * FROM deliveries WHERE order_id = ?'),
    deliveryByRef: db.prepare('SELECT * FROM deliveries WHERE ref = ? ORDER BY updated_at DESC LIMIT 1'),
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

    allItems: db.prepare('SELECT * FROM menu_items ORDER BY sort, id'),
    rate: db.prepare(`INSERT INTO ratings (order_id, item_id, name, stars, outlet_id, phone, at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id, item_id) DO UPDATE SET stars = excluded.stars, at = excluded.at`),
    ratingsFor: db.prepare('SELECT * FROM ratings WHERE order_id = ?'),
    ratingsBetween: db.prepare(`SELECT r.* FROM ratings r JOIN orders o ON o.id = r.order_id WHERE o.created_at >= ? AND o.created_at < ?`),
    comment: db.prepare(`INSERT INTO review_comments (order_id, comment, at) VALUES (?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET comment = excluded.comment, at = excluded.at`),
    commentsBetween: db.prepare(`SELECT c.* FROM review_comments c JOIN orders o ON o.id = c.order_id WHERE o.created_at >= ? AND o.created_at < ?`),
    addJob: db.prepare('INSERT INTO scheduled_jobs (run_at, kind, payload) VALUES (?, ?, ?)'),
    dueJobs: db.prepare('SELECT * FROM scheduled_jobs WHERE done_at IS NULL AND run_at <= ? ORDER BY run_at LIMIT 50'),
    jobDone: db.prepare('UPDATE scheduled_jobs SET done_at = ? WHERE id = ? AND done_at IS NULL'),
    addEvent: db.prepare('INSERT INTO order_events (order_id, status, at) VALUES (?, ?, ?)'),
    eventsBetween: db.prepare(`SELECT e.order_id, e.status, e.at FROM order_events e JOIN orders o ON o.id = e.order_id
      WHERE o.created_at >= ? AND o.created_at < ? ORDER BY e.id`),
    customer: db.prepare('SELECT * FROM customers WHERE phone = ?'),
    customers: db.prepare('SELECT * FROM customers'),
    addPoints: db.prepare('INSERT OR IGNORE INTO loyalty_ledger (phone, order_id, points, kind, note, at) VALUES (?, ?, ?, ?, ?, ?)'),
    ledger: db.prepare('SELECT * FROM loyalty_ledger WHERE phone = ? ORDER BY id DESC'),
    balances: db.prepare('SELECT phone, SUM(points) AS balance FROM loyalty_ledger GROUP BY phone'),
    earnedFor: db.prepare("SELECT points FROM loyalty_ledger WHERE order_id = ? AND kind = 'earn'"),
    ordersForPhone: db.prepare('SELECT * FROM orders WHERE phone = ? ORDER BY id DESC'),
    ordersBetween: db.prepare('SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at'),
    linesBetween: db.prepare(`SELECT oi.order_id, oi.item_id, oi.name, oi.price, oi.qty, oi.note FROM order_items oi
      JOIN orders o ON o.id = oi.order_id WHERE o.created_at >= ? AND o.created_at < ?`),
    insertItem: db.prepare('INSERT INTO menu_items (category, name, description, price, veg, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    addPriceHistory: db.prepare('INSERT INTO price_history (batch, item_id, old_price, new_price, note, at) VALUES (?, ?, ?, ?, ?, ?)'),
    lastBatch: db.prepare('SELECT * FROM price_history WHERE batch = (SELECT batch FROM price_history ORDER BY id DESC LIMIT 1)'),
    deleteBatch: db.prepare('DELETE FROM price_history WHERE batch = ?'),
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
    orderById: (id) => q.byId.get(id) || null,

    // Delivery partner bookings
    getDelivery: (orderId) => q.getDelivery.get(orderId) || null,
    deliveryByRef: (ref) => q.deliveryByRef.get(ref) || null,
    upsertDelivery(orderId, fields) {
      const cur = q.getDelivery.get(orderId);
      const row = { provider: 'none', ref: null, status: 'FAILED', rider_name: null, rider_phone: null, rider_lat: null, rider_lng: null, track_url: null, error: null, ...cur, ...fields, order_id: orderId };
      db.prepare(`INSERT INTO deliveries (order_id, provider, ref, status, rider_name, rider_phone, rider_lat, rider_lng, track_url, error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET provider = excluded.provider, ref = excluded.ref, status = excluded.status,
          rider_name = excluded.rider_name, rider_phone = excluded.rider_phone, rider_lat = excluded.rider_lat,
          rider_lng = excluded.rider_lng, track_url = excluded.track_url, error = excluded.error, updated_at = excluded.updated_at`)
        .run(orderId, ...['provider', 'ref', 'status', 'rider_name', 'rider_phone', 'rider_lat', 'rider_lng', 'track_url', 'error', 'updated_at'].map((k) => row[k] ?? null));
    },

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

    // Menu management (includes inactive items)
    allMenuItems: () => q.allItems.all(),
    updateMenuItem(id, fields) {
      const allowed = ['category', 'name', 'description', 'price', 'veg', 'active', 'sort'];
      const keys = Object.keys(fields).filter((k) => allowed.includes(k));
      if (keys.length) db.prepare(`UPDATE menu_items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    },
    insertMenuItem: (i) => Number(q.insertItem.run(i.category, i.name, i.description || '', i.price, i.veg ? 1 : 0, i.sort ?? 9999, i.active === 0 ? 0 : 1).lastInsertRowid),
    setPrices: (changes, batch, note, ts) => transaction(() => {
      for (const c of changes) {
        db.prepare('UPDATE menu_items SET price = ? WHERE id = ?').run(c.newPrice, c.id);
        if (batch) q.addPriceHistory.run(batch, c.id, c.oldPrice, c.newPrice, note || null, ts);
      }
    }),
    lastPriceBatch: () => q.lastBatch.all(),
    dropPriceBatch: (batch) => q.deleteBatch.run(batch),

    // CRM & loyalty
    customer: (phone) => q.customer.get(phone) || null,
    customers: () => q.customers.all(),
    upsertCustomer(c) {
      const cur = q.customer.get(c.phone);
      const row = { tags: '', notes: '', marketing_opt_in: 0, ...cur, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) };
      const cols = ['phone', 'name', 'first_seen_at', 'last_seen_at', 'first_channel', 'last_address', 'last_lat', 'last_lng', 'last_outlet_id', 'marketing_opt_in', 'tags', 'notes'];
      db.prepare(`INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
        ON CONFLICT(phone) DO UPDATE SET ${cols.slice(1).map((k) => `${k} = excluded.${k}`).join(', ')}`)
        .run(...cols.map((k) => row[k] ?? null));
    },
    addPoints: (e) => q.addPoints.run(e.phone, e.orderId ?? null, e.points, e.kind, e.note ?? null, e.at).changes > 0,
    pointsLedger: (phone) => q.ledger.all(phone),
    pointsBalances: () => new Map(q.balances.all().map((r) => [r.phone, r.balance])),
    pointsEarnedFor: (orderId) => q.earnedFor.get(orderId)?.points ?? null,
    ordersForPhone: (phone) => q.ordersForPhone.all(phone),

    // Reviews
    addRating: (r) => q.rate.run(r.orderId, r.itemId, r.name, r.stars, r.outletId, r.phone, r.at),
    ratingsForOrder: (orderId) => q.ratingsFor.all(orderId),
    ratingsBetween: (fromIso, toIso) => q.ratingsBetween.all(fromIso, toIso),
    addReviewComment: (orderId, comment, at) => q.comment.run(orderId, comment, at),
    commentsBetween: (fromIso, toIso) => q.commentsBetween.all(fromIso, toIso),

    // Scheduled jobs
    addJob: (runAt, kind, payload) => Number(q.addJob.run(runAt, kind, JSON.stringify(payload)).lastInsertRowid),
    dueJobs: (nowIso) => q.dueJobs.all(nowIso).map((j) => ({ ...j, payload: JSON.parse(j.payload) })),
    markJobDone: (id, at) => q.jobDone.run(at, id).changes > 0,

    // Analytics
    addOrderEvent: (orderId, status, at) => q.addEvent.run(orderId, status, at),
    orderEventsBetween: (fromIso, toIso) => q.eventsBetween.all(fromIso, toIso),
    ordersBetween: (fromIso, toIso) => q.ordersBetween.all(fromIso, toIso),
    linesBetween: (fromIso, toIso) => q.linesBetween.all(fromIso, toIso),

    // WhatsApp conversation state
    getSession(phone) {
      const r = q.getSession.get(phone);
      return r ? { data: JSON.parse(r.data), updatedAt: r.updated_at } : null;
    },
    putSession: (phone, data, ts) => q.putSession.run(phone, JSON.stringify(data), ts),
  };
}

module.exports = { createSqliteStore };
