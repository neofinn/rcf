'use strict';

// Minimal .env loader so the app runs without extra dependencies.
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const env = process.env;
const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

module.exports = {
  port: int(env.PORT, 3000),
  production: env.NODE_ENV === 'production',
  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'rcf.db'),
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/$/, ''),
  adminToken: env.ADMIN_TOKEN || 'change-me',
  timezone: 'Asia/Kolkata',

  // Pricing rules (all money in paise).
  pricing: {
    gstPercent: 5, // GST on restaurant food in India
    packingPerOrder: int(env.PACKING_CHARGE_PAISE, 1000),
    minDeliveryOrder: int(env.MIN_DELIVERY_ORDER_PAISE, 14900),
    freeDeliveryAbove: int(env.FREE_DELIVERY_ABOVE_PAISE, 49900),
    // Delivery fee slabs by distance from the assigned outlet.
    deliverySlabs: [
      { uptoKm: 3, fee: 2000 },
      { uptoKm: 6, fee: 3500 },
      { uptoKm: Infinity, fee: 5000 },
    ],
  },

  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || 'raju-verify',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    graphVersion: env.WHATSAPP_GRAPH_VERSION || 'v21.0',
  },
};
