'use strict';

// Browser-demo replacement for src/config.js (no env/fs). Pricing must stay in
// line with the server defaults.
module.exports = {
  production: false,
  publicBaseUrl: 'https://order.rajuchinese.example',
  adminToken: 'demo',
  timezone: 'Asia/Kolkata',
  pricing: {
    gstPercent: 5,
    packingPerOrder: 1000,
    minDeliveryOrder: 14900,
    freeDeliveryAbove: 0,
  },
  loyalty: { rupeesPerPoint: 100 },
  // Demo: ask for the review 20 seconds after delivery instead of 30 minutes.
  reviews: { delayMinutes: 1 / 3, webTemplate: '', templateLanguage: 'en' },
  delivery: { rangeKm: 20, partner: 'Shadowfax', baseKm: 3, baseFee: 4000, perKmFee: 1000 },
  whatsapp: { payments: true, goodsType: 'digital-goods' },
};
