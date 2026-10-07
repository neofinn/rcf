'use strict';

// WhatsApp ordering conversation.
//
// The bot is transport-agnostic: it takes a normalised incoming message and
// returns a list of abstract replies ({type: 'text' | 'buttons' | 'list' |
// 'location_request'}). src/whatsapp/client.js turns those into WhatsApp Cloud
// API payloads; the dev simulator renders them directly.

const config = require('../config');
const { assignOutlet, isOpen, etaMinutes } = require('../geo');
const { rupees } = require('../format');
const { ValidationError } = require('../orders');

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

// WhatsApp interactive message limits.
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…');
const btn = (id, title) => ({ id, title: clip(title, 20) });
const row = (id, title, description) => ({ id, title: clip(title, 24), ...(description ? { description: clip(description, 72) } : {}) });

const text = (t) => ({ type: 'text', text: t });
const buttons = (t, list) => ({ type: 'buttons', text: t, buttons: list.slice(0, 3) });
const list = (t, button, sections) => ({ type: 'list', text: t, button: clip(button, 20), sections });

function freshSession() {
  return { state: 'start', fulfilment: null, lat: null, lng: null, outletId: null, distanceKm: null, cart: [], pendingItemId: null, address: null };
}

function createBot({ orders, sessions, baseUrl = config.publicBaseUrl }) {
  function load(phone, now) {
    const s = sessions.get(phone);
    if (!s || now - new Date(s.updatedAt).getTime() > SESSION_TTL_MS) return freshSession();
    return s.data;
  }

  const outletOf = (s) => (s.outletId ? orders.getOutlet(s.outletId) : null);

  // ---- Screens -----------------------------------------------------------

  function welcome(name) {
    return [
      buttons(`Namaste${name ? ' ' + name : ''}! 🙏 Welcome to *Raju Chinese* 🥡\n\nHow would you like your order?`, [
        btn('mode:delivery', '🛵 Delivery'),
        btn('mode:pickup', '🏃 Pickup'),
        btn('act:track', '📦 Track order'),
      ]),
    ];
  }

  function askLocation() {
    return [{
      type: 'location_request',
      text: 'Please share your delivery location 📍 so we can send your order from the nearest Raju Chinese outlet.\n\n(Tap *Send location*, or use 📎 → Location.)',
    }];
  }

  function pickupOutlets(now) {
    const rows = orders.listOutlets().map((o) => row(`outlet:${o.id}`, o.name.replace('Raju Chinese - ', ''),
      `${isOpen(o, now) ? 'Open' : 'Closed'} · ${o.opens}-${o.closes} · ${o.address}`));
    return [
      list('Choose the outlet you will pick up from. Or share your location 📍 and we will pick the nearest one.', 'Choose outlet', [{ title: 'Outlets', rows: rows.slice(0, 10) }]),
    ];
  }

  function categoriesList(s, intro) {
    const cats = orders.categories(s.outletId).filter((c) => c.items.some((i) => i.available));
    const rows = cats.slice(0, 10).map((c) => {
      const from = Math.min(...c.items.filter((i) => i.available).map((i) => i.price));
      return row(`cat:${c.name}`, c.name, `${c.items.length} items · from ${rupees(from)}`);
    });
    return [list(`${intro ? intro + '\n\n' : ''}What would you like to eat? 😋`, 'View menu', [{ title: 'Menu', rows }])];
  }

  function itemsList(s, category) {
    const cat = orders.categories(s.outletId).find((c) => c.name === category);
    if (!cat) return categoriesList(s);
    const rows = cat.items.filter((i) => i.available).slice(0, 10)
      .map((i) => row(`item:${i.id}`, i.name, `${i.veg ? '🟢 Veg' : '🔴 Non-veg'} · ${rupees(i.price)}${i.name.length > 24 ? ' · ' + i.name : ''}`));
    return [list(`*${cat.name}*\nPick an item to add to your cart.`, 'Choose item', [{ title: clip(cat.name, 24), rows }])];
  }

  function cartLines(s) {
    const menu = new Map(orders.menuFor(s.outletId).map((i) => [i.id, i]));
    return s.cart.filter((l) => menu.has(l.id)).map((l) => ({ ...l, item: menu.get(l.id) }));
  }

  function cartView(s) {
    const lines = cartLines(s);
    if (!lines.length) {
      return [buttons('Your cart is empty 🛒', [btn('act:more', '📋 Menu')])];
    }
    const body = lines.map((l) => `${l.qty} × ${l.item.name} — ${rupees(l.item.price * l.qty)}`).join('\n');
    const subtotal = lines.reduce((t, l) => t + l.item.price * l.qty, 0);
    return [buttons(`🛒 *Your cart*\n${body}\n\nItem total: *${rupees(subtotal)}*`, [
      btn('act:checkout', '✅ Checkout'),
      btn('act:more', '➕ Add more'),
      btn('act:clear', '🗑️ Clear cart'),
    ])];
  }

  function confirmView(s) {
    const outlet = outletOf(s);
    const qte = orders.quote({ outletId: s.outletId, items: s.cart, fulfilment: s.fulfilment, distanceKm: s.distanceKm || 0 });
    const lines = qte.lines.map((l) => `${l.qty} × ${l.name} — ${rupees(l.price * l.qty)}`).join('\n');
    const charges = [
      `Item total: ${rupees(qte.subtotal)}`,
      `Packing: ${rupees(qte.packing)}`,
      `GST (5%): ${rupees(qte.gst)}`,
      ...(s.fulfilment === 'delivery' ? [`Delivery: ${qte.deliveryFee ? rupees(qte.deliveryFee) : 'FREE'}`] : []),
    ].join('\n');
    const where = s.fulfilment === 'delivery'
      ? `🛵 Delivery to: ${s.address}\nFrom: ${outlet.name}`
      : `🏃 Pickup from: ${outlet.name}\n${outlet.address}`;
    return [buttons(`*Please confirm your order*\n\n${lines}\n\n${charges}\n*To pay: ${rupees(qte.total)}* (cash/UPI on ${s.fulfilment === 'delivery' ? 'delivery' : 'pickup'})\n\n${where}`, [
      btn('act:place', '✅ Place order'),
      btn('act:cart', '✏️ Edit cart'),
      btn('act:cancel', '❌ Cancel'),
    ])];
  }

  function trackView(phone) {
    const o = orders.latestOrderForPhone(phone);
    if (!o) return [text("You don't have any orders yet. Send *hi* to start ordering.")];
    return [text(`📦 Order *${o.code}*: ${o.statusLabel}\nFrom ${o.outlet.name} (${o.outlet.phone})\nTotal ${rupees(o.total)}\n\nTrack: ${baseUrl}/track.html?code=${o.code}`)];
  }

  // ---- Actions -----------------------------------------------------------

  function onLocation(s, loc, now) {
    s.lat = loc.lat;
    s.lng = loc.lng;
    const fulfilment = s.fulfilment === 'pickup' ? 'pickup' : 'delivery';
    const a = assignOutlet(orders.listOutlets(), loc, { fulfilment, now });
    if (a.outlet) {
      s.fulfilment = fulfilment;
      s.outletId = a.outlet.id;
      s.distanceKm = a.distanceKm;
      s.state = 'browsing';
      const intro = fulfilment === 'delivery'
        ? `📍 Great news! *${a.outlet.name}* (${a.distanceKm} km away) will deliver to you in about ${etaMinutes('delivery', a.distanceKm)} min.`
        : `📍 Nearest outlet: *${a.outlet.name}* (${a.distanceKm} km). Your order will be ready in about ${etaMinutes('pickup')} min.`;
      return categoriesList(s, intro);
    }
    s.state = 'await_location';
    const alt = a.pickupSuggestion;
    const msg = a.reason === 'closed'
      ? '😔 Sorry, the outlets that deliver to you are closed right now.'
      : "😔 Sorry, we don't deliver to this location yet.";
    if (!alt) return [text(`${msg} All our outlets are closed at the moment. Please try again during opening hours.`)];
    return [buttons(`${msg}\n\nYou can pick up from *${alt.outlet.name}* (${alt.distanceKm} km away), or send a different location.`, [
      btn(`outlet:${alt.outlet.id}`, 'Pickup instead'),
      btn('mode:delivery', 'Another location'),
    ])];
  }

  function addToCart(s, qty) {
    const item = orders.menuFor(s.outletId).find((i) => i.id === s.pendingItemId);
    s.pendingItemId = null;
    s.state = 'browsing';
    if (!item || !item.available) return [text('Sorry, that item is not available right now.'), ...categoriesList(s)];
    const line = s.cart.find((l) => l.id === item.id);
    if (line) line.qty = Math.min(line.qty + qty, 20);
    else s.cart.push({ id: item.id, qty });
    const count = s.cart.reduce((t, l) => t + l.qty, 0);
    return [buttons(`Added ${qty} × *${item.name}* ✅\nCart: ${count} item${count > 1 ? 's' : ''}`, [
      btn('act:more', '➕ Add more'),
      btn('act:cart', '🛒 View cart'),
      btn('act:checkout', '✅ Checkout'),
    ])];
  }

  function checkout(s) {
    if (!s.outletId) return welcome();
    if (!cartLines(s).length) return cartView(s);
    const qte = orders.quote({ outletId: s.outletId, items: s.cart, fulfilment: s.fulfilment, distanceKm: s.distanceKm || 0 });
    if (s.fulfilment === 'delivery' && qte.subtotal < config.pricing.minDeliveryOrder) {
      return [buttons(`Minimum order for delivery is ${rupees(config.pricing.minDeliveryOrder)}. Your item total is ${rupees(qte.subtotal)}.`, [
        btn('act:more', '➕ Add more'),
      ])];
    }
    if (s.fulfilment === 'delivery') {
      s.state = 'await_address';
      const prompt = 'Please type your complete delivery address 🏠\n(House/flat no., street/sector, landmark)';
      return s.address
        ? [buttons(`${prompt}\n\nOr use your last address:\n_${s.address}_`, [btn('act:same_address', 'Use this address')])]
        : [text(prompt)];
    }
    s.state = 'confirm';
    return confirmView(s);
  }

  function place(s, msg, now) {
    try {
      const order = orders.createOrder({
        channel: 'whatsapp',
        fulfilment: s.fulfilment,
        name: msg.name || 'WhatsApp customer',
        phone: msg.from,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        outletId: s.outletId,
        items: s.cart,
      }, now);
      s.cart = [];
      s.state = 'browsing';
      return [text(`🎉 Order placed! Your order ID is *${order.code}*.\n\n${order.outlet.name} will ${order.fulfilment === 'delivery' ? `deliver in about ${order.etaMinutes} min` : `have it ready in about ${order.etaMinutes} min`}.\nPay ${rupees(order.total)} by cash/UPI on ${order.fulfilment === 'delivery' ? 'delivery' : 'pickup'}.\n\nTrack your order: ${baseUrl}/track.html?code=${order.code}\nOutlet phone: ${order.outlet.phone}\n\nWe'll message you here as your order moves along. Thank you! 🙏`)];
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      s.state = 'browsing';
      return [buttons(`⚠️ ${e.message}`, [btn('act:cart', '🛒 View cart'), btn('mode:delivery', '📍 Change location')])];
    }
  }

  // ---- Router ------------------------------------------------------------

  function route(s, msg, now) {
    const t = (msg.text || '').trim().toLowerCase();

    if (msg.type === 'location') return onLocation(s, msg.location, now);

    if (msg.type === 'text') {
      if (['reset', 'cancel', 'restart', 'start over'].includes(t)) {
        Object.assign(s, freshSession());
        return [text('Okay, starting fresh. 👍'), ...welcome(msg.name)];
      }
      if (['track', 'status', 'order status', 'where is my order'].includes(t)) return trackView(msg.from);
      if (t === 'cart') return s.outletId ? cartView(s) : welcome(msg.name);
      if (['menu', 'order'].includes(t)) return s.outletId ? categoriesList(s) : welcome(msg.name);
      if (['hi', 'hii', 'hello', 'hey', 'namaste', 'sat sri akal'].includes(t)) {
        return s.outletId && s.cart.length ? [text(`Welcome back${msg.name ? ' ' + msg.name : ''}! Your cart is saved.`), ...cartView(s)] : welcome(msg.name);
      }
      if (s.state === 'await_qty' && /^\d{1,2}$/.test(t) && Number(t) >= 1) return addToCart(s, Math.min(Number(t), 20));
      if (s.state === 'await_address' && t.length >= 5) {
        s.address = msg.text.trim().slice(0, 300);
        s.state = 'confirm';
        return confirmView(s);
      }
      if (s.state === 'await_address') return [text('That address looks too short. Please include house/flat no., sector/street and a landmark.')];
      if (s.state === 'await_location') return askLocation();
      if (!s.outletId) return welcome(msg.name);
      return [buttons("Sorry, I didn't get that. 🙂 Use the buttons below, or type *menu*, *cart*, *track* or *reset*.", [
        btn('act:more', '📋 Menu'), btn('act:cart', '🛒 View cart'), btn('act:track', '📦 Track order'),
      ])];
    }

    if (msg.type !== 'reply') return [text('Sorry, I can only understand text, buttons and shared locations. Type *hi* to start.')];

    const [kind, arg] = msg.replyId.split(/:(.*)/s);
    const needsOutlet = ['cat', 'item', 'qty'].includes(kind) || ['more', 'cart', 'checkout', 'place', 'same_address'].includes(arg);
    if (needsOutlet && !s.outletId) return welcome(msg.name);

    switch (kind) {
      case 'mode':
        s.fulfilment = arg === 'pickup' ? 'pickup' : 'delivery';
        if (s.fulfilment === 'pickup') { s.state = 'choose_outlet'; return pickupOutlets(now); }
        s.state = 'await_location';
        return askLocation();
      case 'outlet': {
        const o = orders.getOutlet(Number(arg));
        if (!o) return pickupOutlets(now);
        if (!isOpen(o, now)) return [text(`${o.name} is closed right now (open ${o.opens}–${o.closes}).`), ...pickupOutlets(now)];
        s.fulfilment = 'pickup';
        s.outletId = o.id;
        s.distanceKm = null;
        s.state = 'browsing';
        return categoriesList(s, `🏃 Pickup from *${o.name}*\n${o.address}`);
      }
      case 'cat':
        return itemsList(s, arg);
      case 'item': {
        const item = orders.menuFor(s.outletId).find((i) => i.id === Number(arg));
        if (!item || !item.available) return [text('Sorry, that item is not available right now.'), ...categoriesList(s)];
        s.pendingItemId = item.id;
        s.state = 'await_qty';
        return [buttons(`*${item.name}* — ${rupees(item.price)}\nHow many? (or type a number)`, [btn('qty:1', '1'), btn('qty:2', '2'), btn('qty:3', '3')])];
      }
      case 'qty':
        if (!s.pendingItemId) return categoriesList(s);
        return addToCart(s, Math.max(1, Math.min(Number(arg) || 1, 20)));
      case 'act':
        switch (arg) {
          case 'more': s.state = 'browsing'; return categoriesList(s);
          case 'cart': s.state = 'browsing'; return cartView(s);
          case 'clear': s.cart = []; s.state = 'browsing'; return [text('Cart cleared. 🗑️'), ...categoriesList(s)];
          case 'checkout': return checkout(s);
          case 'same_address':
            if (!s.address) return checkout(s);
            s.state = 'confirm';
            return confirmView(s);
          case 'place':
            if (s.state !== 'confirm') return checkout(s);
            return place(s, msg, now);
          case 'cancel': s.state = 'browsing'; return [text('No problem, your order was not placed. Your cart is still saved.'), ...cartView(s)];
          case 'track': return trackView(msg.from);
          default: return welcome(msg.name);
        }
      default:
        return welcome(msg.name);
    }
  }

  /**
   * Handle one incoming message.
   * msg: { from, name?, type: 'text'|'location'|'reply'|'unsupported', text?, location?: {lat, lng}, replyId? }
   */
  function handle(msg, now = new Date()) {
    const s = load(msg.from, now.getTime());
    let replies;
    try {
      replies = route(s, msg, now);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      replies = [text(`⚠️ ${e.message}`), ...(s.outletId ? cartView(s) : welcome(msg.name))];
    }
    sessions.set(msg.from, s, now);
    return replies;
  }

  return { handle };
}

/** SQLite-backed session store. */
function createSessionStore(db) {
  const get = db.prepare('SELECT data, updated_at FROM wa_sessions WHERE phone = ?');
  const put = db.prepare(`INSERT INTO wa_sessions (phone, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);
  return {
    get(phone) {
      const r = get.get(phone);
      return r && { data: JSON.parse(r.data), updatedAt: r.updated_at };
    },
    set(phone, data, now = new Date()) {
      put.run(phone, JSON.stringify(data), now.toISOString());
    },
  };
}

module.exports = { createBot, createSessionStore };
