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
    freeDeliveryAbove: 49900,
    deliverySlabs: [
      { uptoKm: 3, fee: 2000 },
      { uptoKm: 6, fee: 3500 },
      { uptoKm: Infinity, fee: 5000 },
    ],
  },
  whatsapp: {},
};
