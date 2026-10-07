'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBot, createSessionStore } = require('../src/whatsapp/bot');
const { createHandoffService } = require('../src/handoff');
const { toPayload } = require('../src/whatsapp/client');
const { setup, LUNCH, PLACES } = require('./helpers');

function chat() {
  const { db, store, orders } = setup();
  const handoffs = createHandoffService(store);
  const bot = createBot({ orders, handoffs, sessions: createSessionStore(store), baseUrl: 'https://order.example' });
  const from = '919876543210';
  const say = (msg) => bot.handle({ from, name: 'Aman', ...msg }, LUNCH);
  return { db, orders, handoffs, say, text: (t) => say({ type: 'text', text: t }), tap: (id) => say({ type: 'reply', replyId: id }) };
}

const allIds = (replies) => replies.flatMap((r) => [...(r.buttons || []), ...(r.sections || []).flatMap((s) => s.rows)].map((x) => x.id));

test('full delivery order over WhatsApp', () => {
  const c = chat();
  let r = c.text('hi');
  assert.deepEqual(allIds(r), ['mode:delivery', 'mode:pickup', 'act:human']);

  // Delivery goes straight to the menu; no location until checkout.
  r = c.tap('mode:delivery');
  assert.match(r[0].text, /ask for your location once, at checkout/);
  assert.ok(allIds(r).includes('cat:Noodles'));

  r = c.tap('cat:Noodles');
  const itemRow = allIds(r)[0];
  assert.match(itemRow, /^item:\d+$/);

  c.tap(itemRow);
  r = c.tap('qty:2');
  assert.match(r[0].text, /Added 2/);
  assert.ok(r.every((x) => x.type !== 'location_request'));

  r = c.tap('act:checkout');
  assert.equal(r[0].type, 'location_request');
  r = c.say({ type: 'location', location: PLACES.sector22 });
  assert.match(r[0].text, /Sector 17/);
  // Checkout resumes straight away with the address step.
  assert.match(r.at(-1).text, /delivery address/);

  r = c.text('House 12, Sector 22-B, near gurudwara');
  assert.match(r[0].text, /Please confirm/);
  assert.match(r[0].text, /To pay: ₹\d+/);

  r = c.tap('act:place');
  assert.match(r[0].text, /Order placed! Your order ID is \*RC[2-9A-Z]{6}\*/);
  assert.match(r[0].text, /https:\/\/order\.example\/track\.html\?code=RC/);

  const order = c.orders.latestOrderForPhone('919876543210');
  assert.equal(order.channel, 'whatsapp');
  assert.equal(order.outlet.name, 'Raju Chinese - Sector 17');
  assert.equal(order.address, 'House 12, Sector 22-B, near gurudwara');

  // Second checkout offers the saved address.
  c.tap('act:more');
  c.tap(itemRow);
  c.text('3');
  r = c.tap('act:checkout');
  assert.ok(allIds(r).includes('act:same_address'));
  r = c.tap('act:same_address');
  assert.match(r[0].text, /Please confirm/);
});

test('out-of-range location offers pickup from the nearest outlet', () => {
  const c = chat();
  c.tap('mode:delivery');
  const r = c.say({ type: 'location', location: PLACES.ludhiana });
  assert.match(r[0].text, /don't deliver/);
  const pickup = allIds(r).find((id) => id.startsWith('outlet:'));
  assert.ok(pickup);
  const menu = c.tap(pickup);
  assert.match(menu[0].text, /Pickup from/);
});

test('pickup flow skips the address step', () => {
  const c = chat();
  c.tap('mode:pickup');
  c.tap('cat:Beverages');
  c.tap(`item:${c.orders.menuFor(4).find((i) => i.name === 'Masala Lemonade').id}`);
  c.tap('qty:1');
  // Outlet is chosen at checkout.
  const r = c.tap('act:checkout');
  assert.equal(allIds(r).length, 7);
  assert.match(c.tap('outlet:4').at(-1).text, /Pickup from: Raju Chinese - Phase 7 Mohali/);
  assert.match(c.tap('act:place')[0].text, /Order placed/);
});

test('delivery below the minimum order is blocked at checkout', () => {
  const c = chat();
  c.say({ type: 'location', location: PLACES.sector22 });
  c.tap(`item:${c.orders.menuFor(1).find((i) => i.name === 'Coke (300 ml)').id}`);
  c.tap('qty:1');
  assert.match(c.tap('act:checkout')[0].text, /Minimum order/);
});

test('place without confirming does not create an order', () => {
  const c = chat();
  c.say({ type: 'location', location: PLACES.sector22 });
  assert.match(c.tap('act:place')[0].text, /empty/);
  assert.equal(c.orders.latestOrderForPhone('919876543210'), null);
});

test('reset clears the session and track reports the latest order', () => {
  const c = chat();
  assert.match(c.text('track')[0].text, /don't have any orders/);
  c.say({ type: 'location', location: PLACES.sector22 });
  const r = c.text('reset');
  assert.match(r[0].text, /starting fresh/);
  assert.deepEqual(allIds(c.text('menu')), ['mode:delivery', 'mode:pickup', 'act:human']);
});

test('every interactive message respects WhatsApp size limits', () => {
  const c = chat();
  const replies = [...c.text('hi'), ...c.tap('mode:pickup'), ...c.say({ type: 'location', location: PLACES.sector22 })];
  for (const cat of c.orders.categories(1)) replies.push(...c.tap(`cat:${cat.name}`));
  for (const r of replies) {
    if (r.type === 'buttons') {
      assert.ok(r.buttons.length <= 3);
      for (const b of r.buttons) assert.ok(b.title.length <= 20, b.title);
    }
    if (r.type === 'list') {
      const rows = r.sections.flatMap((s) => s.rows);
      assert.ok(rows.length <= 10);
      for (const x of rows) {
        assert.ok(x.title.length <= 24, x.title);
        assert.ok(!x.description || x.description.length <= 72, x.description);
        assert.ok(x.id.length <= 200);
      }
    }
    assert.ok(r.text.length <= 1024, 'interactive body too long');
    toPayload('919876543210', r); // must not throw
  }
});

const idOf = (orders, name) => orders.menuFor(null).find((i) => i.name === name).id;

test('typed order with special instructions, a follow-up question and location', () => {
  const c = chat();
  let r = c.text('2 chilli paneer less spicy, ek veg chowmein no onion. Call before coming');
  assert.match(r[0].text, /1 × Veg Hakka Noodles _\(no onion\)_/);
  assert.match(r[0].text, /Noted for the kitchen: call before coming/);
  // "chilli paneer" is ambiguous: dry or gravy?
  assert.match(r[1].text, /Which \*chilli paneer\*/);
  r = c.tap(`pick:${idOf(c.orders, 'Chilli Paneer Dry')}`);
  assert.match(r[0].text, /Added 2 × Chilli Paneer Dry _\(less spicy\)_/);
  // No location question yet: show the cart, ask for location at checkout.
  assert.match(r[1].text, /Your cart/);
  r = c.tap('act:checkout');
  assert.equal(r[0].type, 'location_request');
  r = c.say({ type: 'location', location: PLACES.phase7 });
  assert.match(r[0].text, /Phase 7 Mohali/);
  assert.match(r.at(-1).text, /delivery address/);
  r = c.text('Flat 3, Phase 7, near market');
  assert.match(r[0].text, /Note for kitchen: call before coming/);
  c.tap('act:place');
  const o = c.orders.latestOrderForPhone('919876543210');
  assert.equal(o.outlet.name, 'Raju Chinese - Phase 7 Mohali');
  assert.equal(o.notes, 'call before coming');
  assert.deepEqual(o.items.map((i) => [i.name, i.qty, i.note]).sort(), [
    ['Chilli Paneer Dry', 2, 'less spicy'],
    ['Veg Hakka Noodles', 1, 'no onion'],
  ]);
});

test('quantity reply can carry instructions', () => {
  const c = chat();
  c.say({ type: 'location', location: PLACES.sector22 });
  c.tap(`item:${idOf(c.orders, 'Honey Chilli Potato')}`);
  const r = c.text('3 extra crispy, sauce separate');
  assert.match(r[0].text, /Added 3 × \*Honey Chilli Potato _\(extra crispy, sauce separate\)_\*/);
});

test('typed items sold out at the assigned outlet are reported, not added', () => {
  const c = chat();
  c.db.prepare('INSERT INTO outlet_unavailable_items VALUES (1, ?)').run(idOf(c.orders, 'Crispy Corn'));
  c.say({ type: 'location', location: PLACES.sector22 });
  const r = c.text('2 crispy corn and 1 veg fried rice');
  assert.match(r[0].text, /Crispy Corn is sold out/);
  assert.match(r[0].text, /1 × Veg Fried Rice/);
});

test('catalog cart is routed to the nearest outlet after location', () => {
  const c = chat();
  const combo = idOf(c.orders, 'Noodles + Manchurian Combo');
  let r = c.say({ type: 'catalog_order', text: 'extra spicy please', items: [{ retailerId: `RC-${combo}`, qty: 2 }] });
  assert.match(r[0].text, /Got your cart: 1 item/);
  assert.match(r[1].text, /2 × Noodles \+ Manchurian Combo/);
  assert.equal(c.tap('act:checkout')[0].type, 'location_request');
  r = c.say({ type: 'location', location: PLACES.panchkula5 });
  assert.match(r[0].text, /Sector 11 Panchkula/);
  assert.match(r.at(-1).text, /delivery address/);
});

test('unknown requests offer a person; handoff relays messages and staff can hand back', () => {
  const c = chat();
  let r = c.text('2 pizza');
  assert.ok(allIds(r).includes('act:human'));

  c.say({ type: 'location', location: PLACES.sector22 });
  c.text('1 veg fried rice');
  r = c.text('I need a party order for 40 people, can I talk to someone');
  assert.match(r[0].text, /Connecting you to our team at \*Raju Chinese - Sector 17\*/);
  const h = c.handoffs.openForPhone('919876543210');
  assert.equal(h.outlet_id, 1);
  assert.match(h.messages[0].body, /Cart:\n1 × Veg Fried Rice/);

  // While a person is on the chat the bot stays quiet and records messages.
  assert.deepEqual(c.text('Also can you do it jain?'), []);
  assert.equal(c.handoffs.get(h.id).messages.at(-1).body, 'Also can you do it jain?');

  r = c.text('bot');
  assert.match(r[0].text, /back with the ordering assistant/);
  assert.equal(c.handoffs.openForPhone('919876543210'), null);
});

test('address step is not hijacked by handoff keywords', () => {
  const c = chat();
  c.say({ type: 'location', location: PLACES.sector22 });
  c.text('2 veg fried rice');
  c.tap('act:checkout');
  const r = c.text('House 4, near staff quarters, Sector 22');
  assert.match(r[0].text, /Please confirm/);
});

test('UPI: pay now sends QR and link for the exact amount to the cooking outlet', () => {
  const c = chat();
  c.say({ type: 'location', location: PLACES.phase7 });
  c.text('2 chilli chicken dry');
  c.tap('act:checkout');
  let r = c.text('Flat 3, Phase 7, near market');
  assert.deepEqual(allIds(r), ['act:place_upi', 'act:place', 'act:cart']);
  r = c.tap('act:place_upi');
  const o = c.orders.latestOrderForPhone('919876543210');
  assert.equal(o.payment_method, 'upi');
  assert.equal(o.payment_status, 'pending');
  assert.equal(o.upi.upiId, 'rc-phase-7-mohali@example');
  assert.equal(o.upi.link, `upi://pay?pa=rc-phase-7-mohali%40example&pn=Raju%20Chinese&am=${(o.total / 100).toFixed(2)}&cu=INR&tn=Raju%20Chinese%20order%20${o.code}&tr=${o.code}`);
  const img = r.find((x) => x.type === 'image');
  assert.equal(img.url, `https://order.example/pay/${o.code}/qr.png`);
  assert.match(img.svg, /^<svg/);
  assert.deepEqual(allIds(r), ["act:paid", 'act:pay_cash']);

  r = c.tap('act:paid');
  assert.match(r[0].text, /will confirm/);
  assert.equal(c.orders.getOrder(o.code).payment_status, 'claimed');
  assert.equal(c.orders.setPayment(o.code, 'paid').paymentLabel, 'Paid by UPI');
  assert.match(c.text('track')[0].text, /Paid by UPI/);
});

test('UPI: screenshot counts as a claim; customer can switch to cash', () => {
  const c = chat();
  c.say({ type: 'location', location: PLACES.sector22 });
  c.text('3 veg fried rice');
  c.tap('act:checkout');
  c.text('House 12, Sector 22-B');
  c.tap('act:place_upi');
  const { code } = c.orders.latestOrderForPhone('919876543210');
  assert.match(c.say({ type: 'image', mediaId: 'm1' })[0].text, /Got your payment screenshot/);
  assert.equal(c.orders.getOrder(code).payment_status, 'claimed');
  c.orders.setPayment(code, 'pending'); // outlet can't find it
  assert.match(c.tap('act:pay_cash')[0].text, /pay ₹\d+(\.\d+)? by cash/);
  assert.equal(c.orders.getOrder(code).payment_status, 'cod');
  assert.match(c.tap('act:paid')[0].text, /don't have a UPI payment waiting/);
});

test('long carts keep button messages within WhatsApp limits', () => {
  const c = chat();
  c.say({ type: 'location', location: PLACES.sector22 });
  for (const i of c.orders.menuFor(1).slice(0, 25)) c.tap(`item:${i.id}`) && c.text('2 less spicy please, sauce separate');
  c.tap('act:checkout');
  const r = c.text('House 12, Sector 22-B, near the big gurudwara');
  for (const x of r) if (x.type === 'buttons') assert.ok(x.text.length <= 1024);
  assert.equal(r.at(-1).type, 'buttons');
});
