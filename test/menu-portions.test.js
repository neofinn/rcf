'use strict';

// The real menu: dishes in Half and Full, more than 10 dishes per category.

const test = require('node:test');
const assert = require('node:assert/strict');
const realSeed = require('../src/seed');
const { createBot, createSessionStore } = require('../src/whatsapp/bot');
const { createHandoffService } = require('../src/handoff');
const { parseOrderText } = require('../src/whatsapp/nlu');
const { groupDishes, portionOf } = require('../src/portions');
const helpers = require('./helpers');

const menu = realSeed.menu.map((m, i) => ({ ...m, id: i + 1, available: true }));
const names = (r) => r.lines.map((l) => menu[l.id - 1].name);

test('real menu: every category fits WhatsApp once grouped, names fit list rows', () => {
  const cats = [...new Set(realSeed.menu.map((m) => m.category))];
  assert.ok(cats.length <= 10, 'categories fit one WhatsApp list');
  for (const d of groupDishes(menu)) assert.ok(d.items.length <= 2 && d.items.every((i) => i.price > 0), d.dish);
  assert.equal(portionOf('Veg Steam Momo (Half)').portion, 'Half');
});

test('typed orders: "half"/"full"/"bada" pick the portion, otherwise we ask', () => {
  assert.deepEqual(names(parseOrderText('1 full veg steam momo', menu)), ['Veg Steam Momo (Full)']);
  assert.deepEqual(names(parseOrderText('half plate chilli potato', menu)), ['Chilli Potato (Half)']);
  assert.deepEqual(names(parseOrderText('2 bada honey chilli potato', menu)), ['Honey Chilli Potato (Full)']);
  assert.deepEqual(names(parseOrderText('veg manchow soup', menu)), ['Veg Manchow Soup'], 'single-portion dishes need no question');
  const r = parseOrderText('2 veg steam momo', menu);
  assert.deepEqual(r.choices[0].options.map((o) => o.name), ['Veg Steam Momo (Half)', 'Veg Steam Momo (Full)']);
});

test('WhatsApp: dishes page 9 at a time, then Half or Full, then how many', () => {
  const { db, orders, store } = helpers.setup({ seed: realSeed });
  db.exec("UPDATE outlets SET opens = '00:00', closes = '00:00'");
  const bot = createBot({ orders, handoffs: createHandoffService(store), sessions: createSessionStore(store) });
  const tap = (id) => bot.handle({ from: '919800000001', name: 'Asha', type: 'reply', replyId: id }, helpers.LUNCH);
  const say = (t) => bot.handle({ from: '919800000001', name: 'Asha', type: 'text', text: t }, helpers.LUNCH);
  const rows = (r) => r[0].sections.flatMap((s) => s.rows);
  tap('mode:pickup');
  assert.equal(rows(tap('outlet:2')).length, 10);
  const p1 = rows(tap('cat:Momos'));
  assert.equal(p1.length, 10);
  assert.equal(p1[9].id, 'cat:Momos|2');
  assert.match(p1[0].description, /Half ₹139 · Full ₹199/);
  const p3 = rows(tap('cat:Momos|3'));
  assert.equal(p3.length, 9, 'last page has no More row');
  const portions = tap(p1[0].id)[0];
  assert.deepEqual(portions.buttons.map((b) => b.title), ['Half · ₹139', 'Full · ₹199']);
  assert.match(tap(portions.buttons[1].id)[0].text, /Veg Steam Momo \(Full\)/);
  tap('qty:2');
  // Typed, ambiguous across dishes: first the dish, then the portion.
  const ask = say('chilli chicken');
  const chilliBoneless = rows(ask).find((r) => /Boneless/.test(r.description || r.title));
  const half = tap(chilliBoneless.id)[0].buttons[0];
  assert.match(half.title, /^Half · ₹3\d\d$/);
  const done = tap(half.id);
  assert.match(done[0].text, /Added 1 × Chilli Chicken Boneless (Dry|Gravy) \(Half\)/);
});

test('WhatsApp with menu pictures: images then "type your order"; order slip; remove a line', () => {
  const { createMenuImages } = require('../src/whatsapp/menu-image');
  const { db, orders, store } = helpers.setup({ seed: realSeed });
  db.exec("UPDATE outlets SET opens = '00:00', closes = '00:00'");
  const menuImages = createMenuImages({ menuItems: () => store.menuItems(), baseUrl: 'https://order.example' });
  const bot = createBot({ orders, handoffs: createHandoffService(store), sessions: createSessionStore(store), menuImages });
  const tap = (id) => bot.handle({ from: '919800000002', name: 'Asha', type: 'reply', replyId: id }, helpers.LUNCH);
  const say = (t) => bot.handle({ from: '919800000002', name: 'Asha', type: 'text', text: t }, helpers.LUNCH);
  tap('mode:pickup');
  const r = tap('outlet:2');
  const images = r.filter((m) => m.type === 'image');
  assert.equal(images.length, 4, 'the whole menu on 4 pictures');
  assert.match(images[0].url, /^https:\/\/order\.example\/menu\/page-1\.png\?v=[0-9a-f]{12}$/);
  assert.match(images[0].text, /Menu 1\/4: Momos/);
  assert.match(r.at(-1).text, /Just type your order/);
  assert.deepEqual(r.at(-1).buttons.map((b) => b.id), ['act:browse', 'act:human']);
  assert.equal(tap('act:browse')[0].type, 'list', 'lists are still there');

  const slip = say('2 half veg steam momo, 1 full chilli potato less spicy, 1 veg manchow soup');
  const cart = slip.at(-1).text;
  assert.match(cart, /\*1\.\* Veg Steam Momo · Half × 2 — \*₹278\*/);
  assert.match(cart, /\*2\.\* Chilli Potato · Full × 1 — \*₹249\*\n {6}_less spicy_/);
  assert.match(cart, /\*3\.\* Veg Manchow Soup × 1 — \*₹129\*/);
  const removed = say('remove 2');
  assert.match(removed[0].text, /Removed 1 × Chilli Potato \(Full\)/);
  assert.doesNotMatch(removed.at(-1).text, /Chilli Potato/);
  assert.match(say('remove 9')[0].text, /no line 9/);

  // Prices change -> new picture version.
  const before = menuImages.messages()[0].url;
  store.setPrices([{ id: 1, oldPrice: 13900, newPrice: 14900 }], 'b1', 'test', new Date().toISOString());
  assert.notEqual(menuImages.messages()[0].url, before);
  const png = menuImages.png(1);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
});
