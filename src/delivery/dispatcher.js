'use strict';

// Books delivery riders and keeps our orders in step with the delivery
// partner (Shadowfax). Provider-agnostic: anything with book(order, outlet)
// and cancel(ref, reason) works, including the simulator used in the demo.
//
// Flow: outlet accepts a delivery order -> book a rider -> partner callbacks
// update rider details; "DISPATCHED" moves our order to out for delivery and
// "DELIVERED" completes it. If booking fails or the partner cancels, staff see
// it on the dashboard and can retry or use their own rider.

const { EventEmitter } = require('node:events');
const { DELIVERY_LABELS } = require('../orders');

const RIDER_ASSIGNED = new Set(['ALLOTTED', 'ALLOTED']);
const FAILED = new Set(['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'RETURNED_TO_SELLER', 'UNDELIVERED', 'FAILED']);

const label = (status) => DELIVERY_LABELS[status === 'ALLOTED' ? 'ALLOTTED' : status] || status;

// Walk our order forward to a target status through allowed steps.
const DELIVERY_PATH = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'completed'];

function createDispatcher({ orders, store, provider, bookOn = 'accepted', log = console }) {
  const events = new EventEmitter();
  const enabled = Boolean(provider);

  function save(order, fields, change) {
    store.upsertDelivery(order.id, { ...fields, updated_at: new Date().toISOString() });
    const fresh = orders.getOrder(order.code);
    events.emit('delivery', fresh, change);
    return fresh;
  }

  function advance(order, target) {
    let o = order;
    const goal = DELIVERY_PATH.indexOf(target);
    while (o && DELIVERY_PATH.indexOf(o.status) < goal && o.status !== 'cancelled') {
      const next = DELIVERY_PATH[DELIVERY_PATH.indexOf(o.status) + 1];
      // Only the final step notifies the customer.
      o = orders.updateStatus(o.code, next, new Date(), { by: 'delivery', quiet: next !== target });
    }
    return o;
  }

  /** Book a rider for a delivery order. Safe to call again after a failure. */
  async function book(code) {
    const order = orders.getOrder(code);
    if (!order || order.fulfilment !== 'delivery' || ['completed', 'cancelled'].includes(order.status)) return order;
    const current = order.delivery;
    if (current && !['FAILED', 'OWN'].includes(current.status) && !FAILED.has(current.status)) return order;
    if (!provider) return save(order, { provider: 'none', status: 'FAILED', error: 'No delivery partner is configured' }, 'failed');
    const outlet = store.outlet(order.outlet_id);
    if (!outlet.sfx_store_code && !provider.simulated) {
      return save(order, { provider: provider.name, status: 'FAILED', error: `${outlet.name} has no Shadowfax store code yet` }, 'failed');
    }
    save(order, { provider: provider.name, ref: null, status: 'BOOKING', error: null, rider_name: null, rider_phone: null, rider_lat: null, rider_lng: null, track_url: null }, 'booking');
    try {
      const r = await provider.book(order, outlet);
      return save(order, {
        provider: provider.name, ref: r.ref, status: r.status || 'ACCEPTED', track_url: r.trackUrl || null, error: null,
        rider_name: r.rider?.name || null, rider_phone: r.rider?.phone || null,
      }, r.rider ? 'rider_assigned' : 'booked');
    } catch (e) {
      log.error('[delivery] booking failed', e.message);
      return save(order, { provider: provider.name, status: 'FAILED', error: e.message }, 'failed');
    }
  }

  /** Staff deliver it themselves. */
  function useOwnRider(code) {
    const order = orders.getOrder(code);
    if (!order) return null;
    const d = order.delivery;
    if (d?.ref && provider && !FAILED.has(d.status) && d.status !== 'DELIVERED') {
      provider.cancel(d.ref, 'Outlet delivering with own rider').catch((e) => log.error('[delivery] cancel failed', e.message));
    }
    return save(order, { provider: 'own', status: 'OWN', error: null }, 'own');
  }

  /**
   * Partner callback (Shadowfax POSTs/PUTs JSON). Returns the updated order,
   * or null if it doesn't match one of ours.
   */
  function handleCallback(payload) {
    const ref = payload.sfx_order_id != null ? String(payload.sfx_order_id) : null;
    const d = (ref && store.deliveryByRef(ref)) || null;
    const order = d ? orders.getOrderById(d.order_id) : orders.getOrder(payload.client_order_id);
    if (!order || !order.delivery || order.delivery.status === 'OWN') return null;

    const status = String(payload.order_status || payload.status || order.delivery.status).toUpperCase();
    const masked = payload.masked_rider_contact;
    const fields = {
      ref: ref || order.delivery.ref,
      status: status === 'ALLOTED' ? 'ALLOTTED' : status,
      rider_name: payload.rider_name || order.delivery.rider_name,
      rider_phone: payload.rider_contact || (masked && (masked.number || masked.contact)) || order.delivery.rider_phone,
      rider_lat: payload.rider_latitude != null ? Number(payload.rider_latitude) : order.delivery.rider_lat,
      rider_lng: payload.rider_longitude != null ? Number(payload.rider_longitude) : order.delivery.rider_lng,
      track_url: payload.track_url || order.delivery.track_url,
      error: FAILED.has(status) ? (payload.comments || payload.cancel_reason || label(status)) : null,
    };
    const statusChanged = fields.status !== order.delivery.status;
    let updated = save(order, fields, statusChanged ? fields.status.toLowerCase() : 'location');
    if (!statusChanged) return updated;

    if (status === 'DISPATCHED') updated = advance(updated, 'out_for_delivery') || updated;
    if (status === 'DELIVERED') updated = advance(updated, 'completed') || updated;
    return updated;
  }

  // Book automatically when the outlet accepts (or starts preparing) a delivery order;
  // release the rider if the order is cancelled.
  orders.events.on('status', (o, meta = {}) => {
    if (o.fulfilment !== 'delivery' || meta.by === 'delivery') return;
    if (enabled && o.status === bookOn && !o.delivery) book(o.code);
    if (o.status === 'cancelled' && o.delivery?.ref && provider && !FAILED.has(o.delivery.status)) {
      provider.cancel(o.delivery.ref, 'Order cancelled by outlet').catch((e) => log.error('[delivery] cancel failed', e.message));
      save(o, { status: 'CANCELLED', error: 'Order cancelled by outlet' }, 'cancelled');
    }
  });

  return { events, enabled, book, useOwnRider, handleCallback, label };
}

module.exports = { createDispatcher };
