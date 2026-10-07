'use strict';

// Business-initiated WhatsApp messages: order status updates and staff replies
// from the dashboard.

const { rupees } = require('../format');

const STATUS_MESSAGES = {
  accepted: (o) => `✅ ${o.outlet.name} has accepted your order *${o.code}*.`,
  preparing: (o) => `👨‍🍳 Your order *${o.code}* is being prepared.`,
  out_for_delivery: (o) => `🛵 Your order *${o.code}* is out for delivery! Please keep ${rupees(o.total)} ready (cash/UPI).`,
  ready: (o) => `🥡 Your order *${o.code}* is ready for pickup at ${o.outlet.name}, ${o.outlet.address}.`,
  completed: (o) => `🙏 Thank you for ordering from Raju Chinese! Hope you enjoyed order *${o.code}*. Send *hi* to order again.`,
  cancelled: (o) => `❌ Sorry, your order *${o.code}* was cancelled by the outlet. Please call ${o.outlet.phone} for help.`,
};

/** Message WhatsApp customers when their order status changes. */
function notifyOnStatusChange({ orders, client, log = console }) {
  orders.events.on('status', (o) => {
    // Free-form messages are only allowed inside WhatsApp's 24h customer
    // service window, which WhatsApp orders are. Web orders would need an
    // approved template message.
    if (o.channel !== 'whatsapp' || !STATUS_MESSAGES[o.status]) return;
    const to = o.phone.replace(/^\+/, '');
    client.send(to, [{ type: 'text', text: STATUS_MESSAGES[o.status](o) }]).catch((e) => log.error('[whatsapp] notify failed', e));
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

module.exports = { notifyOnStatusChange, relayHandoffReplies };
