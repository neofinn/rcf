'use strict';

// KOT (kitchen order ticket) and customer bill, laid out for 80 mm or 58 mm
// thermal receipt printers. Several slips print as one job, so the browser
// asks once (or not at all when Chrome runs with --kiosk-printing).

(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (p) => (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const short = (n) => (window.BRAND?.short ? BRAND.short(n) : n);
  const brandName = () => window.BRAND?.name || '';

  // GST rate for the CGST/SGST split; from the server once.
  let gstPercent = null;
  const loadGst = () => (gstPercent != null ? Promise.resolve() : fetch('/api/config').then((r) => r.json())
    .then((c) => { gstPercent = Number(c.gstPercent) || 0; }).catch(() => {}));

  const kind = (o) => `${o.fulfilment === 'delivery' ? 'DELIVERY' : 'PICKUP'} · ${o.channel === 'whatsapp' ? 'WhatsApp' : 'Web'}`;

  function kot(o, copy = '') {
    const qty = o.items.reduce((n, i) => n + i.qty, 0);
    return `<section class="slip kot">
      <div class="c big">KOT${copy ? ` <small>${esc(copy)}</small>` : ''}</div>
      <div class="c">${esc(short(o.outlet?.name || ''))}</div>
      <div class="row"><b>#${esc(o.code)}</b><span>${esc(when(o.created_at))}</span></div>
      <div class="c b">${kind(o)}</div>
      <hr>
      <table class="items">${o.items.map((i) => `<tr><td class="q">${i.qty}</td><td>${esc(i.name)}${i.note ? `<div class="note">» ${esc(i.note)}</div>` : ''}</td></tr>`).join('')}</table>
      <hr>
      ${o.notes ? `<div class="note">Note: ${esc(o.notes)}</div><hr>` : ''}
      <div class="row"><span>${o.items.length} dish${o.items.length === 1 ? '' : 'es'}</span><span>${qty} item${qty === 1 ? '' : 's'}</span></div>
    </section>`;
  }

  function bill(o) {
    const out = o.outlet || {};
    const cgst = Math.floor(o.gst / 2);
    const half = gstPercent ? ` ${gstPercent / 2}%` : '';
    const line = (label, p, cls = '') => `<tr class="${cls}"><td colspan="3">${label}</td><td class="r">${money(p)}</td></tr>`;
    return `<section class="slip bill">
      <div class="c big">${esc(brandName())}</div>
      <div class="c">${esc(short(out.name || ''))}</div>
      ${out.address ? `<div class="c small">${esc(out.address)}</div>` : ''}
      ${out.phone ? `<div class="c small">Ph: ${esc(out.phone)}</div>` : ''}
      ${out.gstin ? `<div class="c small">GSTIN: ${esc(out.gstin)}</div>` : ''}
      ${out.fssai ? `<div class="c small">FSSAI: ${esc(out.fssai)}</div>` : ''}
      <hr>
      <div class="c b">${out.gstin ? 'TAX INVOICE' : 'BILL'}</div>
      <div class="row"><span>Bill no: <b>${esc(o.code)}</b></span></div>
      <div class="row"><span>${esc(when(o.created_at))}</span><span>${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span></div>
      <div>${esc(o.customer_name)} · ${esc(o.phone)}</div>
      ${o.address ? `<div class="small">${esc(o.address)}</div>` : ''}
      <hr>
      <table class="items">
        <tr class="th"><td>Item</td><td class="r">Qty</td><td class="r">Rate</td><td class="r">Amt</td></tr>
        ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r">${i.qty}</td><td class="r">${money(i.price)}</td><td class="r">${money(i.price * i.qty)}</td></tr>`).join('')}
      </table>
      <hr>
      <table class="items">
        ${line('Subtotal', o.subtotal)}
        ${o.packing ? line('Packing', o.packing) : ''}
        ${o.gst ? line(`CGST${half}`, cgst) + line(`SGST${half}`, o.gst - cgst) : ''}
        ${o.delivery_fee ? line('Delivery', o.delivery_fee) : ''}
        ${line('<b>TOTAL</b>', o.total, 'total')}
      </table>
      <hr>
      <div class="row"><span>Payment</span><b>${esc(o.paymentLabel || '')}</b></div>
      <div class="c small" style="margin-top:6px">Thank you! Order again at ${esc(location.host)}</div>
    </section>`;
  }

  function page(slips, paper) {
    const w = paper === 58 ? 48 : 72; // printable width in mm
    return `<!doctype html><html><head><meta charset="utf-8"><title>Print</title><style>
      @page { size: ${paper}mm auto; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #000; background: #fff; font: ${paper === 58 ? 11 : 12}px/1.35 Arial, Helvetica, sans-serif; }
      .slip { width: ${w}mm; margin: 0 auto; padding: 3mm 0 6mm; break-after: page; page-break-after: always; }
      .slip:last-child { break-after: auto; page-break-after: auto; }
      .c { text-align: center; } .r { text-align: right; white-space: nowrap; } .b { font-weight: 700; }
      .big { font-size: 1.45em; font-weight: 800; } .big small { font-size: .6em; font-weight: 600; }
      .small { font-size: .9em; }
      .row { display: flex; justify-content: space-between; gap: 6px; }
      hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
      table.items { width: 100%; border-collapse: collapse; }
      table.items td { padding: 1px 0; vertical-align: top; }
      table.items td + td { padding-left: 6px; }
      .th td { font-weight: 700; border-bottom: 1px solid #000; }
      .total td { font-size: 1.2em; font-weight: 800; border-top: 1px solid #000; padding-top: 3px; }
      .kot table.items td { font-size: 1.25em; font-weight: 700; padding: 2px 0; }
      .kot td.q { width: 2.2em; }
      .note { font-weight: 700; font-style: italic; font-size: .85em; }
      .kot .note { font-size: .8em; }
    </style></head><body>${slips.join('')}</body></html>`;
  }

  /**
   * Print slips for orders. what: 'kot' | 'bill' | 'both'.
   * opts: { paper: 80 | 58, kotCopies: 1 | 2 }
   */
  async function printNow(orders, what = 'both', opts = {}) {
    if (!orders.length) return;
    await loadGst();
    const copies = Math.max(1, Math.min(3, Number(opts.kotCopies) || 1));
    const slips = [];
    for (const o of orders) {
      if (what !== 'bill') for (let n = 1; n <= copies; n++) slips.push(kot(o, copies > 1 ? `copy ${n}` : ''));
      if (what !== 'kot') slips.push(bill(o));
    }
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.srcdoc = page(slips, Number(opts.paper) === 58 ? 58 : 80);
    await new Promise((resolve) => {
      frame.onload = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { console.error(e); }
        // print() returns once the dialog closes (or at once when printing silently).
        setTimeout(() => { frame.remove(); resolve(); }, 1000);
      };
      document.body.appendChild(frame);
    });
  }

  // One print job at a time: a second one waits for the first dialog to close.
  let queue = Promise.resolve();
  const print = (...args) => (queue = queue.then(() => printNow(...args)).catch((e) => console.error(e)));

  window.RCPrint = { print, kot, bill, page };
})();
