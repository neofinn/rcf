'use strict';

// Pretend Shadowfax for demos and local development: accepts bookings and
// replays the same callbacks Shadowfax would send, with a rider moving from
// the outlet to the customer. Timings are compressed (about a minute end to end).

const RIDERS = [
  ['Gurpreet Singh', '9876500011'], ['Amit Kumar', '9876500022'], ['Rohit Sharma', '9876500033'],
  ['Manpreet Kaur', '9876500044'], ['Sandeep Rana', '9876500055'],
];

function createSimulatedShadowfax({ onCallback, speed = 1, schedule = setTimeout }) {
  let n = 0;
  const cancelled = new Set();
  const at = (ms, fn) => schedule(fn, ms / speed);

  return {
    name: 'shadowfax',
    simulated: true,

    async book(order, outlet) {
      const ref = `SIM${100000 + ++n}`;
      const [riderName, riderPhone] = RIDERS[n % RIDERS.length];
      const send = (status, extra = {}) => {
        if (cancelled.has(ref)) return;
        onCallback({ sfx_order_id: ref, client_order_id: order.code, order_status: status, ...extra });
      };
      const rider = { rider_name: riderName, rider_contact: riderPhone, track_url: `https://example.com/track/${ref}` };
      // Rider starts a little away from the outlet, comes in, then rides to the customer.
      const start = { lat: outlet.lat + 0.01, lng: outlet.lng - 0.012 };
      const lerp = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      const moveTo = (from, to, startMs, durMs, steps) => {
        for (let i = 1; i <= steps; i++) {
          const p = lerp(from, to, i / steps);
          at(startMs + (durMs * i) / steps, () => send(currentStatus(), { rider_latitude: p.lat, rider_longitude: p.lng }));
        }
      };
      let status = 'ACCEPTED';
      const currentStatus = () => status;
      const step = (ms, s, extra) => at(ms, () => { status = s; send(s, { ...rider, ...extra }); });
      const drop = { lat: order.lat, lng: order.lng };

      step(3000, 'ALLOTTED', { rider_latitude: start.lat, rider_longitude: start.lng });
      moveTo(start, outlet, 3000, 7000, 4);
      step(10500, 'ARRIVED', { rider_latitude: outlet.lat, rider_longitude: outlet.lng });
      step(18000, 'DISPATCHED');
      moveTo(outlet, drop, 18000, 24000, 10);
      step(42500, 'ARRIVED_CUSTOMER_DOORSTEP', { rider_latitude: drop.lat, rider_longitude: drop.lng });
      step(48000, 'DELIVERED');
      return { ref, status: 'ACCEPTED', trackUrl: rider.track_url, rider: null };
    },

    async cancel(ref) { cancelled.add(ref); return { message: 'Cancelled' }; },
    async status() { return {}; },
  };
}

module.exports = { createSimulatedShadowfax };
