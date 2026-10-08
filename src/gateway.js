'use strict';

// Online payments through a gateway (Razorpay). Every "Pay now" order gets a
// link on our own address, /pay/<code>; opening it creates (or reuses) a
// Razorpay payment link for the exact amount and forwards the customer there:
// UPI apps, UPI QR, cards, netbanking. The same address is in the WhatsApp
// message, on the tracking page and inside the order's QR code, so paying from
// another phone works too.
//
// Razorpay's signed webhook confirms the payment: the order is marked paid and
// goes to the kitchen (orders.setPayment). No staff checking. If the outlet
// cancels a paid order, the payment is refunded automatically. A second payment
// for an order that is already paid is refunded too.

const { EventEmitter } = require('node:events');

const MIN = 60000;
// Orders that can still be paid: waiting (or legacy placed-but-unpaid), not
// expired, cancelled or finished.
const PAYABLE_STATUSES = new Set(['awaiting_payment', 'placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']);

function createGateway({ client, store, orders, publicBaseUrl, windowMinutes = 15, log = console }) {
  const events = new EventEmitter();
  const payable = (o) => o && o.payment_method === 'upi' && ['pending', 'claimed'].includes(o.payment_status) && PAYABLE_STATUSES.has(o.status);

  /**
   * The payment page URL for an order: a live link is reused, otherwise a new one
   * is made. Returns { url } or { done: 'paid' | 'closed' } when there is nothing to pay.
   */
  async function linkFor(code, now = new Date()) {
    const o = orders.getOrder(code);
    if (!o) return null;
    if (o.payment_status === 'paid' || o.payment_status === 'refunded') return { done: 'paid' };
    if (!payable(o)) return { done: 'closed' };
    const links = store.paymentLinks(o.id);
    const live = links.find((l) => l.status === 'created' && l.amount === o.total && l.expires_at > new Date(now.getTime() + 2 * MIN).toISOString());
    if (live) return { url: live.url };
    // Razorpay links must live at least 15 minutes; keep them a little past our payment window.
    const expireBy = new Date(now.getTime() + Math.max(16, windowMinutes + 5) * MIN);
    const created = await client.createLink({
      code: o.code,
      reference: links.length ? `${o.code}-${links.length + 1}` : o.code,
      amount: o.total,
      description: `Order ${o.code} · ${o.outlet.name}`,
      customer: { name: o.customer_name, phone: o.phone },
      expireBy,
      callbackUrl: `${publicBaseUrl}/track.html?code=${o.code}`,
    });
    store.insertPaymentLink({
      id: created.id, order_id: o.id, provider: client.name, url: created.url, amount: o.total,
      expires_at: expireBy.toISOString(), status: 'created', created_at: now.toISOString(),
    });
    return { url: created.url };
  }

  // Refund one payment. linkId: the link row to mark refunded (when it holds this payment).
  async function refund(order, paymentId, linkId, reason, now = new Date()) {
    try {
      const r = await client.refund(paymentId, { reason });
      if (linkId) store.updatePaymentLink(linkId, { status: 'refunded', refund_id: r.id }, now.toISOString());
      return r;
    } catch (e) {
      log.error(`[payments] refund of ${paymentId} for ${order.code} failed: ${e.message}`);
      events.emit('refund_failed', order, e);
      return null;
    }
  }

  /**
   * A verified webhook. eventId: X-Razorpay-Event-Id (duplicates are ignored).
   * Returns what happened: 'paid' | 'duplicate' | 'mismatch' | 'refunded_extra' | 'ignored' | 'unknown'.
   */
  async function handleWebhook(parsed, eventId, now = new Date()) {
    if (eventId && store.gatewayEventSeen(eventId, now.toISOString())) return 'duplicate';
    if (parsed.kind !== 'paid') return 'ignored';
    const o = parsed.code ? orders.getOrder(parsed.code) : null;
    const link = parsed.linkId ? store.paymentLinkById(parsed.linkId) : null;
    if (!o || !link || link.order_id !== o.id) {
      log.error(`[payments] payment ${parsed.paymentId} for unknown order/link ${parsed.code}/${parsed.linkId}`);
      return 'unknown';
    }
    // Already paid (another link, or WhatsApp Pay): give this one back. The link
    // keeps the record of the payment that counts, if it holds one.
    if (o.payment_status === 'paid' || o.payment_status === 'refunded') {
      const ownRow = !link.payment_id;
      if (ownRow) store.updatePaymentLink(link.id, { status: 'paid', payment_id: parsed.paymentId }, now.toISOString());
      await refund(o, parsed.paymentId, ownRow ? link.id : null, `Duplicate payment for order ${o.code}`, now);
      return 'refunded_extra';
    }
    store.updatePaymentLink(link.id, { status: 'paid', payment_id: parsed.paymentId }, now.toISOString());
    // The outlet cancelled before the money arrived.
    if (o.status === 'cancelled') {
      orders.setPayment(o.code, 'paid', now, 'gateway');
      await refundOrder(o.code, 'Order cancelled before payment arrived', now);
      return 'refunded_extra';
    }
    if (parsed.amount !== o.total) {
      // Never mark paid for the wrong amount; staff look at it.
      if (o.payment_status === 'pending') orders.setPayment(o.code, 'claimed', now, 'gateway');
      log.error(`[payments] ${o.code}: paid ${parsed.amount}, bill ${o.total}`);
      return 'mismatch';
    }
    orders.setPayment(o.code, 'paid', now, 'gateway');
    return 'paid';
  }

  /** Refund every captured gateway payment of an order (outlet cancelled it). */
  async function refundOrder(code, reason, now = new Date()) {
    const o = orders.getOrder(code);
    if (!o || o.payment_status !== 'paid') return false;
    const paid = store.paymentLinks(o.id).filter((l) => l.status === 'paid' && l.payment_id);
    if (!paid.length) return false;
    let ok = true;
    for (const l of paid) ok = Boolean(await refund(o, l.payment_id, l.id, reason, now)) && ok;
    if (ok) orders.setPayment(o.code, 'refunded', now, 'gateway');
    return ok;
  }

  // An outlet cancelling a paid order refunds the customer.
  orders.events.on('status', (o) => {
    if (o.status !== 'cancelled' || o.payment_status !== 'paid') return;
    refundOrder(o.code, `Order ${o.code} cancelled by ${o.outlet.name}`).catch((e) => log.error('[payments] refund failed', e.message));
  });

  return { events, name: client.name, linkFor, handleWebhook, refundOrder };
}

module.exports = { createGateway };
