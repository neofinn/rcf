'use strict';

// Shadowfax Hyperlocal ("Dedicated Store" model) API client.
//
// Each outlet is registered with Shadowfax once and gets a store_code. For a
// delivery order we check serviceability, then place a Shadowfax order; their
// riders pick up from the outlet and Shadowfax calls our webhook
// (/webhooks/shadowfax) as the order moves: ALLOTTED -> ARRIVED -> DISPATCHED
// -> ARRIVED_CUSTOMER_DOORSTEP -> DELIVERED (or CANCELLED ...), with rider
// name, phone, live location and a tracking link.
//
// Docs: https://developer.shadowfax.in/docs/hyperlocal/overview
// Paths below follow the Dedicated Store quickstart; confirm them (cancel in
// particular) with the Shadowfax team during onboarding. They can be
// overridden through config.shadowfax.paths.

const DEFAULT_PATHS = {
  serviceability: '/api/v2/store_serviceability/',
  createOrder: '/api/v2/stores/orders/',
  status: '/api/v2/orders/{id}/status/',
  cancel: '/api/v2/orders/{id}/cancel/',
};

const digits10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);
const rupees = (paise) => Math.round(paise) / 100;

/** Shadowfax order payload for one of our orders. */
function buildOrderPayload(order, outlet) {
  const paid = order.payment_status === 'paid';
  return {
    store_code: outlet.sfx_store_code,
    pickup_contact_number: digits10(outlet.phone),
    order_details: {
      order_value: rupees(order.total).toFixed(2),
      // Unpaid orders: the rider collects order_value in cash/UPI at the door.
      paid,
      client_order_id: order.code,
    },
    customer_details: {
      name: order.customer_name,
      address_line_1: order.address,
      city: outlet.city,
      contact_number: digits10(order.phone),
      latitude: order.lat,
      longitude: order.lng,
    },
    product_details: order.items.map((i) => ({
      id: i.item_id,
      name: i.note ? `${i.name} (${i.note})` : i.name,
      price: rupees(i.price),
      quantity: i.qty,
    })),
  };
}

class ShadowfaxError extends Error {}

function createShadowfaxClient({ token, baseUrl, paths = {}, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const p = { ...DEFAULT_PATHS, ...paths };

  async function call(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(baseUrl.replace(/\/$/, '') + path, {
        method,
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
      if (!res.ok) throw new ShadowfaxError(`Shadowfax ${res.status}: ${data.message || data.detail || text || 'request failed'}`);
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new ShadowfaxError('Shadowfax did not respond in time');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: 'shadowfax',

    async isServiceable(order, outlet) {
      const r = await call('PUT', p.serviceability, {
        store_code: outlet.sfx_store_code,
        paid: String(order.payment_status === 'paid'),
        order_value: rupees(order.total),
        drop_latitude: order.lat,
        drop_longitude: order.lng,
      });
      return r.is_serviceable !== false && r.serviceable !== false;
    },

    /** Place the delivery. Returns { ref, status, trackUrl, rider }. */
    async book(order, outlet) {
      if (!(await this.isServiceable(order, outlet))) throw new ShadowfaxError('Shadowfax has no rider for this address right now');
      const r = await call('POST', p.createOrder, buildOrderPayload(order, outlet));
      const ref = r.sfx_order_id || r.data?.sfx_order_id;
      // A 2xx without an order id means it was not created; the message says why.
      if (!ref) throw new ShadowfaxError(`Shadowfax did not create the order: ${r.message || 'no order id returned'}`);
      return {
        ref: String(ref),
        status: r.status || r.order_status || 'ACCEPTED',
        trackUrl: r.track_url || null,
        rider: r.rider_name ? { name: r.rider_name, phone: r.rider_contact || null } : null,
      };
    },

    cancel: (ref, reason) => call('PUT', p.cancel.replace('{id}', encodeURIComponent(ref)), { reason }),
    status: (ref) => call('GET', p.status.replace('{id}', encodeURIComponent(ref))),
  };
}

module.exports = { createShadowfaxClient, buildOrderPayload, ShadowfaxError, DEFAULT_PATHS };
