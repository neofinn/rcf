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
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

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
    // 0 = customers always pay the delivery charge. Set e.g. 49900 to make
    // delivery free (outlet pays Shadowfax) on bigger orders.
    freeDeliveryAbove: int(env.FREE_DELIVERY_ABOVE_PAISE, 0),
  },

  delivery: {
    // Every outlet delivers up to this road distance; the nearest open outlet
    // cooks. 20 km leaves no blind spot across Chandigarh, Mohali, Panchkula,
    // Zirakpur, Kharar and the outskirts (New Chandigarh, Pinjore, Dera Bassi,
    // Kurali, Banur). See test/coverage.test.js.
    rangeKm: num(env.MAX_DELIVERY_KM, 20),
    partner: 'Shadowfax',
    // Delivery charge shown to and paid by the customer: the Shadowfax rate
    // card. Base fare covers the first baseKm, then perKmFee per extra km
    // (rounded up). PLACEHOLDER values: use the rates in your Shadowfax contract.
    baseKm: num(env.DELIVERY_BASE_KM, 3),
    baseFee: int(env.DELIVERY_BASE_FEE_PAISE, 4000),
    perKmFee: int(env.DELIVERY_PER_KM_PAISE, 1000),
  },

  // Delivery partner. SHADOWFAX_MODE=simulate runs a pretend Shadowfax (dev/demo).
  shadowfax: {
    mode: env.SHADOWFAX_MODE || (env.SHADOWFAX_TOKEN ? 'live' : 'off'),
    token: env.SHADOWFAX_TOKEN || '',
    baseUrl: env.SHADOWFAX_BASE_URL || 'https://hlbackend.staging.shadowfax.in',
    // Shared secret Shadowfax sends back in a custom header on callbacks.
    callbackToken: env.SHADOWFAX_CALLBACK_TOKEN || '',
    // Book the rider when the outlet accepts ('accepted') or starts cooking ('preparing').
    bookOn: env.SHADOWFAX_BOOK_ON === 'preparing' ? 'preparing' : 'accepted',
  },

  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || 'raju-verify',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    graphVersion: env.WHATSAPP_GRAPH_VERSION || 'v21.0',
    // In-chat UPI payments ("Review and pay" order_details messages, India).
    // Needs each outlet's UPI ID added as a payment configuration in Meta
    // Business Suite (WhatsApp Manager > Payments > Direct payment methods);
    // its name goes in outlets.wa_payment_config.
    payments: env.WHATSAPP_PAYMENTS === 'on',
    // 'digital-goods' needs no shipping address block; 'physical-goods' does.
    goodsType: env.WHATSAPP_PAYMENTS_GOODS_TYPE || 'digital-goods',
  },
};
