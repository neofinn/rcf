'use strict';

// "No blind spot": every address across the tricity and its outskirts must
// have an outlet within delivery range, even when its nearest outlet is closed.

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { assignOutlet } = require('../src/geo');
const realSeed = require('../src/seed');
const helpers = require('./helpers');

const { LUNCH } = helpers;
// Coverage is checked against the real outlet list.
const setup = () => helpers.setup({ seed: realSeed });

const PLACES = {
  'New Chandigarh': [30.787, 76.695], Mullanpur: [30.798, 76.716], Pinjore: [30.797, 76.917],
  Banur: [30.556, 76.716], 'Dera Bassi': [30.588, 76.843], 'Aerocity Mohali': [30.663, 76.733], 'TDI City': [30.648, 76.690],
  'Chandigarh Airport': [30.673, 76.788], 'Sunny Enclave Kharar': [30.735, 76.660], Landran: [30.702, 76.663],
  Sohana: [30.683, 76.700], 'Panchkula Sec 26': [30.687, 76.880], Chandimandir: [30.722, 76.885], 'Mansa Devi': [30.731, 76.861],
  Bhabat: [30.640, 76.825], 'Peer Muchalla': [30.672, 76.845], PGI: [30.765, 76.776], 'IT Park': [30.727, 76.845],
};

test('every outskirt town is in range', () => {
  const { orders } = setup();
  for (const [name, [lat, lng]] of Object.entries(PLACES)) {
    const a = assignOutlet(orders.listOutlets(), { lat, lng }, { now: LUNCH });
    assert.ok(a.outlet, `${name} has no delivery outlet`);
  }
});

test('no blind spot on a 500 m grid over the tricity', () => {
  const { orders } = setup();
  const outlets = orders.listOutlets();
  const blind = [];
  for (let lat = 30.61; lat <= 30.80; lat += 0.0045) {
    for (let lng = 76.62; lng <= 76.92; lng += 0.0052) {
      if (!assignOutlet(outlets, { lat, lng }, { now: LUNCH }).outlet) blind.push([lat.toFixed(3), lng.toFixed(3)]);
    }
  }
  assert.deepEqual(blind, [], `blind spots: ${blind.slice(0, 5).join(' ')}`);
});

test('nearest outlet still cooks; a paused outlet is covered by its neighbours', () => {
  const { db, orders } = setup();
  const sec22 = { lat: 30.733, lng: 76.772 };
  assert.equal(assignOutlet(orders.listOutlets(), sec22, { now: LUNCH }).outlet.slug, 'sec-34-chd');
  db.exec("UPDATE outlets SET accepting_orders = 0 WHERE slug IN ('sec-34-chd', 'sec-15-chd', 'sec-46-chd')");
  const a = assignOutlet(orders.listOutlets(), sec22, { now: LUNCH });
  assert.ok(a.outlet, 'Sector 22 still served with three Chandigarh outlets paused');
  assert.ok(a.distanceKm <= config.delivery.rangeKm);
});
