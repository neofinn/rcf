'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBot, createSessionStore } = require('../src/whatsapp/bot');
const { toPayload } = require('../src/whatsapp/client');
const { setup, LUNCH, PLACES } = require('./helpers');

function chat() {
  const { db, orders } = setup();
  const bot = createBot({ orders, sessions: createSessionStore(db), baseUrl: 'https://order.example' });
  const from = '919876543210';
  const say = (msg) => bot.handle({ from, name: 'Aman', ...msg }, LUNCH);
  return { db, orders, say, text: (t) => say({ type: 'text', text: t }), tap: (id) => say({ type: 'reply', replyId: id }) };
}

const allIds = (replies) => replies.flatMap((r) => [...(r.buttons || []), ...(r.sections || []).flatMap((s) => s.rows)].map((x) => x.id));

test('full delivery order over WhatsApp', () => {
  const c = chat();
  let r = c.text('hi');
  assert.deepEqual(allIds(r), ['mode:delivery', 'mode:pickup', 'act:track']);

  r = c.tap('mode:delivery');
  assert.equal(r[0].type, 'location_request');

  r = c.say({ type: 'location', location: PLACES.sector22 });
  assert.match(r[0].text, /Sector 17/);
  assert.ok(allIds(r).includes('cat:Noodles'));

  r = c.tap('cat:Noodles');
  const itemRow = allIds(r)[0];
  assert.match(itemRow, /^item:\d+$/);

  c.tap(itemRow);
  r = c.tap('qty:2');
  assert.match(r[0].text, /Added 2/);

  r = c.tap('act:checkout');
  assert.match(r[0].text, /delivery address/);

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
  const r = c.tap('mode:pickup');
  assert.equal(allIds(r).length, 7);
  c.tap('outlet:4');
  c.tap('cat:Beverages');
  c.tap(`item:${c.orders.menuFor(4).find((i) => i.name === 'Masala Lemonade').id}`);
  c.tap('qty:1');
  assert.match(c.tap('act:checkout')[0].text, /Pickup from: Raju Chinese - Phase 7 Mohali/);
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
  assert.deepEqual(allIds(c.text('menu')), ['mode:delivery', 'mode:pickup', 'act:track']);
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
