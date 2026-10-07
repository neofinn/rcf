'use strict';

// Sample order history for the demo only (never used by the server), so the
// CRM and analytics screens have something realistic to show: ~90 days of
// orders with lunch/dinner peaks, busier weekends, regulars and lapsed
// customers. Deterministic (fixed seed) so the demo looks the same each load.

const { priceCart } = require('../src/orders');
const { roadKm } = require('../src/geo');

const FIRST = ['Aman', 'Simran', 'Rohit', 'Neha', 'Gurpreet', 'Harsh', 'Priya', 'Karan', 'Ishita', 'Manpreet', 'Arjun', 'Tanvi',
  'Jaspreet', 'Rahul', 'Ananya', 'Vikram', 'Pooja', 'Sahil', 'Kavya', 'Navjot', 'Deepak', 'Ritika', 'Mohit', 'Sneha', 'Ankit',
  'Mehak', 'Varun', 'Nidhi', 'Rajat', 'Shreya', 'Kunal', 'Jasleen', 'Abhishek', 'Divya', 'Yuvraj', 'Komal'];
const LAST = ['Singh', 'Sharma', 'Kaur', 'Gill', 'Verma', 'Bansal', 'Sandhu', 'Gupta', 'Arora', 'Dhillon', 'Mehta', 'Sidhu', 'Kapoor', 'Bedi', 'Malhotra'];

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedSampleHistory(store, { days = 90, now = new Date() } = {}) {
  const rand = rng(20261007);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const weighted = (pairs) => {
    const total = pairs.reduce((t, [, w]) => t + w, 0);
    let r = rand() * total;
    for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; }
    return pairs[0][0];
  };

  const outlets = store.outlets();
  const localities = store.localities();
  const menu = store.menuItems().map((i) => ({ ...i, available: true }));
  // Popular dishes sell more.
  const itemWeight = (i) => (/Momos|Hakka|Chilli Paneer Dry|Manchurian Gravy|Fried Rice|Honey Chilli/.test(i.name) ? 6 : /Combo/.test(i.name) ? 4 : /Coke|Lemonade|Soup/.test(i.name) ? 3 : 1.5);
  const itemPairs = menu.map((i) => [i, itemWeight(i)]);
  const outletPairs = outlets.map((o, k) => [o, [1.6, 1.2, 0.9, 1.4, 0.7, 1, 1.1][k] || 1]);

  // A customer pool: each has a home locality and an ordering habit.
  const customers = Array.from({ length: 320 }, (_, n) => {
    const home = pick(localities.filter((l) => l.lat > 30.6 && l.lat < 30.8));
    return {
      phone: `+9190000${String(10000 + n).slice(-5)}`,
      name: `${pick(FIRST)} ${pick(LAST)}`,
      home,
      freq: weighted([[0.2, 5], [1, 4], [3, 2], [7, 1]]), // relative order frequency
      activeUntil: rand() < 0.18 ? Math.floor(rand() * days * 0.6) : days, // some lapse
      optIn: rand() < 0.45,
      channel: rand() < 0.58 ? 'whatsapp' : 'web',
    };
  });
  const custPairs = customers.map((c) => [c, c.freq]);

  const hourPairs = [[11, 2], [12, 6], [13, 8], [14, 5], [15, 2], [16, 2], [17, 3], [18, 5], [19, 9], [20, 12], [21, 11], [22, 6], [23, 2]];
  const IST = 330 * 60000;
  let seq = 0;
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  for (let d = days; d >= 1; d--) {
    const dayStart = new Date(Math.floor((now.getTime() + IST) / 864e5) * 864e5 - IST - d * 864e5);
    const weekday = new Date(dayStart.getTime() + IST).getUTCDay();
    const growth = 1 + (days - d) / days * 0.35; // business growing over the period
    const count = Math.round((weekday === 0 || weekday === 6 ? 46 : weekday === 5 ? 40 : 30) * growth * (0.85 + rand() * 0.3));
    for (let n = 0; n < count; n++) {
      let c = weighted(custPairs);
      if (days - d > c.activeUntil) c = weighted(custPairs);
      if (days - d > c.activeUntil) continue;
      const at = new Date(dayStart.getTime() + weighted(hourPairs) * 3600e3 + Math.floor(rand() * 3600e3));
      const fulfilment = rand() < 0.66 ? 'delivery' : 'pickup';
      const near = outlets.map((o) => ({ o, km: roadKm(c.home, o) })).sort((a, b) => a.km - b.km)[0];
      const outlet = fulfilment === 'delivery' || rand() < 0.7 ? near.o : weighted(outletPairs);
      const distanceKm = fulfilment === 'delivery' ? Math.max(0.6, Math.round((near.km + rand() * 1.5) * 10) / 10) : null;
      const lines = [];
      const nItems = weighted([[1, 3], [2, 5], [3, 3], [4, 1]]);
      for (let k = 0; k < nItems; k++) {
        const it = weighted(itemPairs);
        if (!lines.some((l) => l.id === it.id)) lines.push({ id: it.id, qty: weighted([[1, 6], [2, 3], [3, 1]]), note: rand() < 0.12 ? pick(['less spicy', 'no onion', 'extra spicy', 'jain']) : '' });
      }
      const priced = priceCart(menu, lines, fulfilment, distanceKm || 0);
      if (fulfilment === 'delivery' && priced.subtotal < 14900) continue;
      const cancelled = rand() < 0.04;
      const upi = rand() < 0.5;
      const code = 'RC' + Array.from({ length: 6 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
      seq += 1;
      const iso = at.toISOString();
      const id = store.insertOrder({
        code, outlet_id: outlet.id, channel: c.channel === 'whatsapp' && rand() < 0.85 ? 'whatsapp' : 'web', fulfilment,
        customer_name: c.name, phone: c.phone, address: fulfilment === 'delivery' ? `House ${1 + Math.floor(rand() * 900)}, ${c.home.name}, ${c.home.city}` : null,
        lat: c.home.lat, lng: c.home.lng, distance_km: distanceKm, notes: null,
        subtotal: priced.subtotal, packing: priced.packing, gst: priced.gst, delivery_fee: priced.deliveryFee, total: priced.total,
        payment_method: upi ? 'upi' : 'cod', payment_status: upi ? (cancelled ? 'pending' : 'paid') : 'cod',
        status: cancelled ? 'cancelled' : 'completed', created_at: iso, updated_at: iso,
      }, priced.lines);
      const cur = store.customer(c.phone);
      store.upsertCustomer({
        phone: c.phone, name: c.name, first_seen_at: cur?.first_seen_at || iso, last_seen_at: iso, first_channel: cur?.first_channel || c.channel,
        last_address: fulfilment === 'delivery' ? `House ${1 + (seq % 900)}, ${c.home.name}, ${c.home.city}` : cur?.last_address || null,
        last_lat: c.home.lat, last_lng: c.home.lng, last_outlet_id: outlet.id, marketing_opt_in: c.optIn ? 1 : 0,
      });
      if (!cancelled) {
        const pts = Math.floor(priced.total / 10000);
        if (pts) store.addPoints({ phone: c.phone, orderId: id, points: pts, kind: 'earn', note: `Order ${code}`, at: iso });
      }
    }
  }
  // A few redemptions.
  for (const c of customers.slice(0, 40)) {
    const bal = store.pointsBalances().get(c.phone) || 0;
    if (bal >= 20 && rand() < 0.5) store.addPoints({ phone: c.phone, points: -20, kind: 'redeem', note: 'Free Masala Lemonade', at: new Date(now.getTime() - 3 * 864e5).toISOString() });
  }
  return seq;
}

module.exports = { seedSampleHistory };
