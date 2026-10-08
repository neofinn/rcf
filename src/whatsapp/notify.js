'use strict';

// Business-initiated WhatsApp messages: order status updates and staff replies
// from the dashboard.

const { rupees } = require('../format');
const config = require('../config');
const { brand } = require('../brand');
const { WA_ORDER_STATUS } = require('../payments');

const STATUS_MESSAGES = {
  accepted: (o) => `✅ ${o.outlet.name} has accepted your order *${o.code}*.`,
  preparing: (o) => `👨‍🍳 Your order *${o.code}* is being prepared.`,
  out_for_delivery: (o) => `🛵 Your order *${o.code}* is out for delivery!${o.delivery?.rider_name ? ` ${o.delivery.rider_name} is bringing it.` : ''}${o.payment_status === 'paid' ? '' : ` Please keep ${rupees(o.total)} ready (cash/UPI).`}${o.delivery?.track_url ? `\nLive tracking: ${o.delivery.track_url}` : ''}`,
  ready: (o) => `🥡 Your order *${o.code}* is ready for pickup at ${o.outlet.name}, ${o.outlet.address}.`,
  completed: (o) => `🙏 Thank you for ordering from ${brand().name}! Hope you enjoyed order *${o.code}*. Send *hi* to order again.`,
  cancelled: (o) => `❌ Sorry, your order *${o.code}* was cancelled by the outlet. Please call ${o.outlet.phone} for help.`,
};

/** Message WhatsApp customers when their order status changes. */
function notifyOnStatusChange({ orders, client, crm = null, log = console }) {
  orders.events.on('status', (o, meta = {}) => {
    if (meta.quiet) return;
    // Free-form messages are only allowed inside WhatsApp's 24h customer
    // service window, which WhatsApp orders are. Web orders would need an
    // approved template message.
    if (o.channel !== 'whatsapp' || !STATUS_MESSAGES[o.status]) return;
    const to = o.phone.replace(/^\+/, '');
    let body = STATUS_MESSAGES[o.status](o);
    if (o.status === 'completed' && crm) {
      const earned = crm.pointsFor(o.total);
      if (earned) body += `\n\n⭐ You earned *${earned} loyalty point${earned > 1 ? 's' : ''}*. Balance: *${crm.balance(o.phone)}* points. Type *points* to see them.`;
    }
    // Orders sent with "Review and pay" also get their order card in WhatsApp updated.
    const outlet = orders.getOutlet(o.outlet_id);
    const card = config.whatsapp.payments && o.payment_method === 'upi' && outlet?.wa_payment_config && WA_ORDER_STATUS[o.status];
    const reply = card ? { type: 'order_status', referenceId: o.code, status: card, text: body } : { type: 'text', text: body };
    client.send(to, [reply]).catch((e) => log.error('[whatsapp] notify failed', e));
  });
}

/** Deliver staff replies from the dashboard to the customer on WhatsApp. */
function relayHandoffReplies({ handoffs, client, log = console }) {
  const send = (h, body) => client.send(h.phone, [{ type: 'text', text: body }]).catch((e) => log.error('[whatsapp] relay failed', e));
  handoffs.events.on('message', (h, direction) => {
    if (direction === 'out') send(h, h.messages.at(-1).body);
  });
  handoffs.events.on('closed', (h) => {
    // Closed by the customer typing "bot" already got a reply from the bot.
    if (h.messages.at(-1)?.direction !== 'in') send(h, '✅ Our team has closed this chat. Type *hi* anytime to order, or *talk to us* to reach us again. 🙏');
  });
}

/** Tell WhatsApp customers when the outlet confirms (or can't find) their UPI payment. */
function notifyOnPayment({ orders, client, log = console }) {
  orders.events.on('payment', (o, previous, by) => {
    // The bot already answers changes made in the chat (customer or WhatsApp Pay).
    if (o.channel !== 'whatsapp' || by === 'customer' || by === 'whatsapp') return;
    let text = null;
    if (o.payment_status === 'paid') text = `✅ Payment of ${rupees(o.total)} received for order *${o.code}*. Thank you!`;
    else if (o.payment_status === 'pending' && previous === 'claimed') {
      text = `⚠️ ${o.outlet.name} can't see your payment for order *${o.code}* yet. Please check your UPI app, or pay ${rupees(o.total)} by cash/UPI when your order arrives.`;
    } else if (o.payment_status === 'cod' && previous !== 'cod') text = `👍 No problem, pay ${rupees(o.total)} by cash/UPI ${o.fulfilment === 'delivery' ? 'when your order arrives' : 'at pickup'}.`;
    if (text) client.send(o.phone.replace(/^\+/, ''), [{ type: 'text', text }]).catch((e) => log.error('[whatsapp] notify failed', e));
  });
}

/** Rider updates from the delivery partner (Shadowfax). */
function notifyOnDelivery({ dispatcher, client, log = console }) {
  dispatcher.events.on('delivery', (o, change) => {
    if (o.channel !== 'whatsapp' || !o.delivery) return;
    const d = o.delivery;
    let text = null;
    if (change === 'rider_assigned' || change === 'allotted') {
      text = `🛵 *${d.rider_name || 'A rider'}* will deliver your order *${o.code}*.${d.rider_phone ? `\nRider's number: ${d.rider_phone}` : ''}${d.track_url ? `\nLive tracking: ${d.track_url}` : ''}`;
    } else if (change === 'arrived_customer_doorstep') {
      text = `🚪 Your rider is at your door with order *${o.code}*.${o.payment_status === 'paid' ? '' : ` Amount to pay: ${rupees(o.total)}.`}`;
    }
    if (text) client.send(o.phone.replace(/^\+/, ''), [{ type: 'text', text }]).catch((e) => log.error('[whatsapp] notify failed', e));
  });
}

module.exports = { notifyOnStatusChange, relayHandoffReplies, notifyOnPayment, notifyOnDelivery };
