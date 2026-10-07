'use strict';

// UPI payments. Every order gets its own UPI request for the exact amount,
// paid to the UPI ID of the outlet that cooks it, with the order code as the
// reference so staff can match it in their UPI app / bank statement.
//
// The QR code and the upi:// link open any UPI app (GPay, PhonePe, Paytm,
// BHIM) with payee, amount and note filled in. Confirmation is manual (staff
// tap "Paid" once it shows in their UPI app) until a payment gateway is added,
// whose webhook would call orders.confirmPayment() instead.

const QRCode = require('qrcode');

const PAYMENT_LABELS = {
  cod: 'Cash/UPI on delivery',
  pending: 'UPI payment pending',
  claimed: 'Customer says paid, check UPI app',
  paid: 'Paid by UPI',
};

/** upi:// payment link (NPCI deep-link format). */
function upiLink({ upiId, payee, amountPaise, code }) {
  const params = [
    ['pa', upiId],
    ['pn', payee],
    ['am', (amountPaise / 100).toFixed(2)],
    ['cu', 'INR'],
    ['tn', `Raju Chinese order ${code}`],
    ['tr', code],
  ];
  return 'upi://pay?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** QR code as an SVG string (works in Node and in the browser demo). */
function qrSvg(text, { size = 240, margin = 3 } = {}) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const total = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="UPI payment QR code"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** QR code as PNG (server only), for WhatsApp image messages. */
function qrPng(text) {
  return QRCode.toBuffer(text, { errorCorrectionLevel: 'M', width: 600, margin: 3 });
}

module.exports = { upiLink, qrSvg, qrPng, PAYMENT_LABELS };
