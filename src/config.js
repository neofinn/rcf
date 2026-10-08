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

  // Loyalty: 1 point for every ₹100 of a completed order.
  loyalty: {
    rupeesPerPoint: num(env.LOYALTY_RUPEES_PER_POINT, 100),
  },

  // Reviews: ask for star ratings on WhatsApp this long after delivery/pickup.
  reviews: {
    delayMinutes: num(env.REVIEW_DELAY_MINUTES, 30),
    // Web orders: the customer hasn't messaged us, so WhatsApp needs an
    // approved template to start the chat. Name of that template (optional).
    webTemplate: env.WHATSAPP_REVIEW_TEMPLATE || '',
    templateLanguage: env.WHATSAPP_REVIEW_TEMPLATE_LANG || 'en',
  },

  delivery: {
    // Every outlet delivers up to this road distance; the nearest open outlet
    // cooks. 20 km leaves no blind spot across Chandigarh, Mohali, Panchkula,
    // Zirakpur, Kharar and the outskirts (New Chandigarh, Pinjore, Dera Bassi,
    // Banur). Kurali (~25 km) is outside it. See test/coverage.test.js.
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
    // Applies to every partner. SHADOWFAX_MODE=simulate runs pretend Shadowfax,
    // Porter and Borzo (demo/local) instead of the real ones.
    bookOn: env.SHADOWFAX_BOOK_ON === 'preparing' ? 'preparing' : 'accepted',
  },

  // More delivery partners; each is used when its key is set. The selector
  // (src/delivery/selector.js) quotes all of them for every order.
  porter: {
    apiKey: env.PORTER_API_KEY || '',
    baseUrl: env.PORTER_BASE_URL || 'https://pfe-apigw-uat.porter.in',
    // Secret we add to the webhook URL we give Porter (?token=…), or send as X-Callback-Token.
    callbackToken: env.PORTER_CALLBACK_TOKEN || '',
  },
  borzo: {
    token: env.BORZO_TOKEN || '',
    baseUrl: env.BORZO_BASE_URL || 'https://robotapitest-in.borzodelivery.com/api/business/1.8',
    // "Callback Secret Key" from the Borzo dashboard; signs every callback.
    callbackSecret: env.BORZO_CALLBACK_SECRET || '',
  },
  // How partners are compared: a minute of waiting for a rider is worth this
  // much (paise); a booking with no rider after this many minutes moves on.
  dispatch: {
    minuteValue: int(env.DELIVERY_MINUTE_VALUE_PAISE, 300),
    reassignMinutes: num(env.DELIVERY_REASSIGN_MINUTES, 8),
  },

  // Optional copy of the data in Supabase (Postgres) for Power BI, campaigns
  // and other tools. The app keeps running on SQLite; see src/sync/supabase.js.
  supabase: {
    url: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
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
