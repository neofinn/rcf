'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const config = require('./config');
const { assignOutlet, isOpen, etaMinutes } = require('./geo');

class ValidationError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

const STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];

// Allowed next statuses, per fulfilment type.
const TRANSITIONS = {
  delivery: {
    placed: ['accepted', 'cancelled'],
    accepted: ['preparing', 'cancelled'],
    preparing: ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['completed'],
  },
  pickup: {
    placed: ['accepted', 'cancelled'],
    accepted: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['completed'],
  },
};

const STATUS_LABELS = {
  placed: 'Order placed',
  accepted: 'Accepted by outlet',
  preparing: 'Being prepared',
  ready: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const MAX_QTY_PER_ITEM = 20;

/** Normalise an Indian mobile number to +91XXXXXXXXXX, or return null. */
function normalisePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
      : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

function deliveryFee(subtotal, distanceKm) {
  const p = config.pricing;
  if (subtotal >= p.freeDeliveryAbove) return 0;
  return p.deliverySlabs.find((s) => distanceKm <= s.uptoKm).fee;
}

/**
 * Price cart lines ({id, qty, note?}) against a menu list. Lines for the same
 * item with different notes ("less spicy" vs none) stay separate.
 */
function priceCart(menuList, items, fulfilment, distanceKm) {
  if (!Array.isArray(items) || items.length === 0) throw new ValidationError('Your cart is empty.');
  const menu = new Map(menuList.map((i) => [i.id, i]));
  const merged = new Map();
  const perItem = new Map();
  for (const line of items) {
    const id = Number(line.id);
    const qty = Number(line.qty);
    const note = String(line.note || '').trim().slice(0, 120);
    if (!Number.isInteger(qty) || qty < 1) throw new ValidationError('Invalid quantity.');
    const key = `${id}|${note.toLowerCase()}`;
    const m = merged.get(key) || { id, qty: 0, note };
    m.qty += qty;
    merged.set(key, m);
    perItem.set(id, (perItem.get(id) || 0) + qty);
  }
  const lines = [];
  for (const { id, qty, note } of merged.values()) {
    const item = menu.get(id);
    if (!item) throw new ValidationError('An item in your cart is no longer on the menu.');
    if (!item.available) throw new ValidationError(`${item.name} is not available at this outlet right now.`, 'unavailable');
    if (perItem.get(id) > MAX_QTY_PER_ITEM) throw new ValidationError(`Maximum ${MAX_QTY_PER_ITEM} of ${item.name} per order.`);
    lines.push({ item_id: id, name: item.name, price: item.price, qty, note: note || null });
  }
  const p = config.pricing;
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const packing = p.packingPerOrder;
  const gst = Math.round(((subtotal + packing) * p.gstPercent) / 100);
  const fee = fulfilment === 'delivery' ? deliveryFee(subtotal, distanceKm) : 0;
  return {
    lines, subtotal, packing, gst, deliveryFee: fee, total: subtotal + packing + gst + fee,
    minDeliveryOrder: p.minDeliveryOrder, freeDeliveryAbove: p.freeDeliveryAbove,
  };
}

function createOrderService(store) {
  const events = new EventEmitter();

  const listOutlets = () => store.outlets();
  const getOutlet = (id) => store.outlet(id);

  /** Menu for an outlet, with per-outlet availability applied. */
  function menuFor(outletId) {
    const out = new Set(outletId ? store.unavailableItemIds(outletId) : []);
    return store.menuItems().map((i) => ({
      id: i.id, category: i.category, name: i.name, description: i.description,
      price: i.price, veg: !!i.veg, available: !out.has(i.id),
    }));
  }

  function categories(outletId) {
    const seen = new Map();
    for (const i of menuFor(outletId)) {
      if (!seen.has(i.category)) seen.set(i.category, []);
      seen.get(i.category).push(i);
    }
    return [...seen].map(([name, items]) => ({ name, items }));
  }

  /**
   * Resolve which outlet serves a request. For delivery the outlet is always
   * derived from the customer's coordinates; a client-supplied outlet id is
   * only honoured for pickup.
   */
  function resolveOutlet({ fulfilment, lat, lng, outletId }, now = new Date()) {
    if (fulfilment === 'pickup') {
      const outlet = outletId ? getOutlet(outletId) : null;
      if (outlet) {
        if (!isOpen(outlet, now)) throw new ValidationError(`${outlet.name} is closed right now.`, 'closed');
        return { outlet, distanceKm: null };
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new ValidationError('Choose an outlet for pickup.');
    } else if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new ValidationError('Delivery location is required.');
    }
    const a = assignOutlet(listOutlets(), { lat, lng }, { fulfilment, now });
    if (!a.outlet) {
      const msg = a.reason === 'closed'
        ? 'Outlets near you are closed right now.'
        : 'Sorry, we do not deliver to this location yet. You can still order for pickup.';
      throw new ValidationError(msg, a.reason);
    }
    return { outlet: a.outlet, distanceKm: a.distanceKm };
  }

  /** Price a cart against the server-side menu. */
  function quote({ outletId, items, fulfilment, distanceKm }) {
    return priceCart(menuFor(outletId), items, fulfilment, distanceKm);
  }

  function newCode() {
    // Unambiguous characters only (no 0/O/1/I).
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (;;) {
      const bytes = crypto.randomBytes(6);
      const code = 'RC' + [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
      if (!store.orderCodeExists(code)) return code;
    }
  }

  /**
   * Create an order. Input:
   * { channel, fulfilment, name, phone, address?, lat?, lng?, outletId?, notes?, items: [{id, qty, note?}] }
   */
  function createOrder(input, now = new Date()) {
    const fulfilment = input.fulfilment === 'pickup' ? 'pickup' : 'delivery';
    const name = String(input.name || '').trim().slice(0, 80);
    const phone = normalisePhone(input.phone);
    const address = String(input.address || '').trim().slice(0, 300);
    const notes = String(input.notes || '').trim().slice(0, 300);
    const lat = input.lat === undefined || input.lat === null ? NaN : Number(input.lat);
    const lng = input.lng === undefined || input.lng === null ? NaN : Number(input.lng);
    if (!name) throw new ValidationError('Please enter your name.');
    if (!phone) throw new ValidationError('Please enter a valid 10-digit mobile number.');
    if (fulfilment === 'delivery' && address.length < 5) throw new ValidationError('Please enter your full delivery address.');

    const { outlet, distanceKm } = resolveOutlet({ fulfilment, lat, lng, outletId: Number(input.outletId) || null }, now);
    const priced = quote({ outletId: outlet.id, items: input.items, fulfilment, distanceKm });
    if (fulfilment === 'delivery' && priced.subtotal < config.pricing.minDeliveryOrder) {
      throw new ValidationError(`Minimum order for delivery is ₹${config.pricing.minDeliveryOrder / 100}.`, 'min_order');
    }

    const code = newCode();
    const ts = now.toISOString();
    store.insertOrder({
      code, outlet_id: outlet.id, channel: input.channel === 'whatsapp' ? 'whatsapp' : 'web', fulfilment,
      customer_name: name, phone, address: fulfilment === 'delivery' ? address : null,
      lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null, distance_km: distanceKm,
      notes: notes || null, subtotal: priced.subtotal, packing: priced.packing, gst: priced.gst,
      delivery_fee: priced.deliveryFee, total: priced.total, payment_method: 'cod', status: 'placed',
      created_at: ts, updated_at: ts,
    }, priced.lines);
    const order = getOrder(code);
    events.emit('created', order);
    return order;
  }

  function present(row) {
    if (!row) return null;
    const outlet = getOutlet(row.outlet_id);
    return {
      ...row,
      items: store.orderLines(row.id),
      statusLabel: STATUS_LABELS[row.status],
      nextStatuses: (TRANSITIONS[row.fulfilment][row.status] || []),
      etaMinutes: etaMinutes(row.fulfilment, row.distance_km || 0),
      outlet: outlet && { id: outlet.id, name: outlet.name, phone: outlet.phone, address: outlet.address, lat: outlet.lat, lng: outlet.lng },
    };
  }

  const getOrder = (code) => present(store.orderByCode(String(code || '').toUpperCase()));

  function latestOrderForPhone(raw) {
    const phone = normalisePhone(raw);
    return phone ? present(store.latestOrderForPhone(phone)) : null;
  }

  function listOrders({ outletId, statuses, limit = 100 } = {}) {
    return store.listOrders({ outletId, statuses, limit: Math.min(Number(limit) || 100, 500) }).map(present);
  }

  function updateStatus(code, next, now = new Date()) {
    const order = getOrder(code);
    if (!order) return null;
    if (!order.nextStatuses.includes(next)) {
      throw new ValidationError(`Cannot move order from "${order.status}" to "${next}".`, 'bad_transition');
    }
    if (!store.setOrderStatus(order.id, order.status, next, now.toISOString())) throw new ValidationError('Order was updated by someone else. Refresh and try again.', 'conflict');
    const updated = getOrder(code);
    events.emit('status', updated);
    return updated;
  }

  return {
    events, listOutlets, getOutlet, menuFor, categories, resolveOutlet, quote, createOrder, getOrder,
    latestOrderForPhone, listOrders, updateStatus,
  };
}

module.exports = {
  createOrderService, priceCart, ValidationError, normalisePhone, STATUSES, STATUS_LABELS, TRANSITIONS, deliveryFee,
};
