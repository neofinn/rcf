'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// public/staff/print.js runs in the staff panels; load it with a bare window.
function loadPrint() {
  const ctx = vm.createContext({
    BRAND: { name: 'Test Kitchen', short: (n) => n.replace('Test Kitchen - ', '') },
    location: { host: 'order.example.com' }, console,
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'staff', 'print.js'), 'utf8'), ctx);
  return ctx.RCPrint;
}

const order = {
  code: 'TK123', fulfilment: 'delivery', channel: 'whatsapp', created_at: '2026-10-07T08:30:00Z',
  customer_name: 'Aman <b>', phone: '+919876543210', address: 'House 12, Sector 22', notes: 'Ring the bell',
  outlet: { name: 'Test Kitchen - Sector 17', address: 'SCO 1, Sector 17', phone: '+911234567890', gstin: '04ABCDE1234F1Z5', fssai: null },
  items: [{ name: 'Veg Momo (Half)', qty: 2, price: 13900, note: 'less spicy' }, { name: 'Hakka Noodles', qty: 1, price: 22900 }],
  subtotal: 50700, packing: 1000, gst: 2585, delivery_fee: 3000, total: 57285, paymentLabel: 'Cash on delivery',
};

test('KOT lists dishes, notes and order type, without prices', () => {
  const kot = loadPrint().kot(order);
  assert.match(kot, /TK123/);
  assert.match(kot, /DELIVERY · WhatsApp/);
  assert.match(kot, />2<\/td><td>Veg Momo \(Half\)<div class="note">» less spicy/);
  assert.match(kot, /Ring the bell/);
  assert.match(kot, /3 items/);
  assert.doesNotMatch(kot, /139|₹/);
});

test('bill shows outlet details, GST split and the order total', () => {
  const bill = loadPrint().bill(order);
  assert.match(bill, /Test Kitchen/);
  assert.match(bill, /GSTIN: 04ABCDE1234F1Z5/);
  assert.match(bill, /TAX INVOICE/);
  assert.doesNotMatch(bill, /FSSAI/, 'no FSSAI line when the outlet has none');
  assert.match(bill, /278\.00/);
  // ₹25.85 GST: CGST 12.92 + SGST 12.93.
  assert.match(bill, /CGST[^<]*<\/td><td class="r">12\.92/);
  assert.match(bill, /SGST[^<]*<\/td><td class="r">12\.93/);
  assert.match(bill, /572\.85/);
  assert.match(bill, /Aman &lt;b&gt;/, 'customer text is escaped');
  // Without a GSTIN it is a plain bill.
  assert.match(loadPrint().bill({ ...order, outlet: { ...order.outlet, gstin: null } }), /<div class="c b">BILL<\/div>/);
});
