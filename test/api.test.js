'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('../src/config');
const { createApp } = require('../src/app');
const { PLACES } = require('./helpers');

const silent = { info() {}, error() {} };

async function start() {
  const sent = [];
  const waClient = { enabled: true, send: async (to, replies) => { sent.push({ to, replies }); } };
  const ctx = createApp({ dbPath: ':memory:', waClient, enableDevTools: true, log: silent });
  // Open 24h so tests don't depend on the wall clock.
  ctx.db.exec("UPDATE outlets SET opens = '00:00', closes = '00:00'");
  const server = ctx.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { ...ctx, sent, call, base, close: () => server.close() };
}

const admin = { Authorization: `Bearer ${config.adminToken}` };

test('web ordering end to end: locate, menu, quote, order, track, status', async (t) => {
  const s = await start();
  t.after(s.close);

  const loc = await s.call('POST', '/api/locate', PLACES.panchkula5);
  assert.equal(loc.status, 200);
  assert.equal(loc.body.outlet.slug, 'sec-11-pkl');
  assert.ok(loc.body.etaMinutes > 0);

  const menu = await s.call('GET', `/api/menu?outletId=${loc.body.outlet.id}`);
  const paneer = menu.body.flatMap((c) => c.items).find((i) => i.name === 'Chilli Paneer Dry');

  const items = [{ id: paneer.id, qty: 2 }];
  const quote = await s.call('POST', '/api/quote', { fulfilment: 'delivery', ...PLACES.panchkula5, items });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.subtotal, paneer.price * 2);

  const bad = await s.call('POST', '/api/orders', { fulfilment: 'delivery', ...PLACES.panchkula5, items, name: 'R', phone: '123', address: 'House 5, Sector 5' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /mobile/);

  const created = await s.call('POST', '/api/orders', { fulfilment: 'delivery', ...PLACES.panchkula5, items, name: 'Rohit Sharma', phone: '9812345678', address: 'House 5, Sector 5' });
  assert.equal(created.status, 201);
  const { code } = created.body;

  const track = await s.call('GET', `/api/orders/${code}`);
  assert.equal(track.body.status, 'placed');
  assert.equal(track.body.customerName, 'Rohit');
  assert.equal(track.body.phone, undefined, 'tracking must not leak phone');
  assert.equal(track.body.total, quote.body.total);

  assert.equal((await s.call('GET', '/api/admin/orders')).status, 401);
  const live = await s.call('GET', `/api/admin/orders?outletId=${loc.body.outlet.id}`, undefined, admin);
  assert.equal(live.body[0].code, code);

  const accepted = await s.call('POST', `/api/admin/orders/${code}/status`, { status: 'accepted' }, admin);
  assert.equal(accepted.body.status, 'accepted');
  const skip = await s.call('POST', `/api/admin/orders/${code}/status`, { status: 'completed' }, admin);
  assert.equal(skip.status, 400);

  // Web orders don't trigger WhatsApp notifications.
  assert.equal(s.sent.length, 0);
});

test('outlet staff can pause orders and mark items out of stock', async (t) => {
  const s = await start();
  t.after(s.close);
  await s.call('PATCH', '/api/admin/outlets/1', { acceptingOrders: false }, admin);
  const loc = await s.call('POST', '/api/locate', PLACES.sector22);
  assert.notEqual(loc.body.outlet.id, 1);

  const item = (await s.call('GET', '/api/menu?outletId=2')).body[0].items[0];
  await s.call('POST', '/api/admin/outlets/2/availability', { itemId: item.id, available: false }, admin);
  const after = (await s.call('GET', '/api/menu?outletId=2')).body[0].items[0];
  assert.equal(after.available, false);
});

test('WhatsApp webhook: verification, signature, dedupe and status notifications', async (t) => {
  const s = await start();
  t.after(s.close);

  const v = await s.call('GET', `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${config.whatsapp.verifyToken}&hub.challenge=42`);
  assert.equal(v.body, 42);
  assert.equal((await s.call('GET', '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status, 403);

  const from = '919811112222';
  const msg = (id, m) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'Neha' } }], messages: [{ id, from, ...m }] } }] }] });
  const post = async (body) => {
    const res = await s.call('POST', '/webhooks/whatsapp', body);
    await new Promise((r) => setImmediate(r));
    return res;
  };

  await post(msg('m1', { type: 'text', text: { body: 'hi' } }));
  await post(msg('m1', { type: 'text', text: { body: 'hi' } })); // redelivery
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0].replies[0].text, /Namaste Neha/);

  await post(msg('m2', { type: 'location', location: { latitude: PLACES.phase7.lat, longitude: PLACES.phase7.lng } }));
  assert.match(s.sent[1].replies[0].text, /Phase 7 Mohali/);

  const combo = s.orders.menuFor(4).find((i) => i.name === 'Noodles + Manchurian Combo');
  await post(msg('m3', { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: `item:${combo.id}` } } }));
  await post(msg('m4', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'qty:1' } } }));
  await post(msg('m5', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'act:checkout' } } }));
  await post(msg('m6', { type: 'text', text: { body: 'Flat 3, Phase 7, near market' } }));
  await post(msg('m7', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'act:place' } } }));
  const placed = s.sent.at(-1).replies[0].text;
  const code = placed.match(/\*(RC[2-9A-Z]{6})\*/)[1];

  await s.call('POST', `/api/admin/orders/${code}/status`, { status: 'accepted' }, admin);
  await new Promise((r) => setImmediate(r));
  assert.equal(s.sent.at(-1).to, from);
  assert.match(s.sent.at(-1).replies[0].text, /accepted your order/);

  // Signature enforcement when an app secret is configured.
  const prev = config.whatsapp.appSecret;
  config.whatsapp.appSecret = 'shh';
  t.after(() => { config.whatsapp.appSecret = prev; });
  const body = JSON.stringify(msg('m8', { type: 'text', text: { body: 'menu' } }));
  const unsigned = await fetch(`${s.base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(unsigned.status, 401);
  const sig = 'sha256=' + crypto.createHmac('sha256', 'shh').update(body).digest('hex');
  const signed = await fetch(`${s.base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body });
  assert.equal(signed.status, 200);
});

test('dev WhatsApp simulator endpoint talks to the bot', async (t) => {
  const s = await start();
  t.after(s.close);
  const r = await s.call('POST', '/api/dev/whatsapp', { from: '919800000000', type: 'text', text: 'hi' });
  assert.equal(r.body[0].type, 'buttons');
});
