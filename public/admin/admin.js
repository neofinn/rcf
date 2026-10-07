'use strict';

const $ = (id) => document.getElementById(id);
const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN', p % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('rca.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rca.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const NEXT_LABEL = {
  accepted: 'Accept', preparing: 'Start preparing', ready: 'Mark ready', out_for_delivery: 'Out for delivery',
  completed: 'Complete', cancelled: 'Cancel',
};

const state = { token: store.get('token', '') || (window.RC_DEMO ? 'demo' : ''), outletId: store.get('outlet', ''), view: 'live', outlets: [], seen: new Set(), firstLoad: true, chatSeen: new Map(), chatsLoaded: false };

async function api(path, opts = {}) {
  const res = await fetch('/api/admin' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLogin('Session expired or wrong token.'); throw new Error('unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showLogin(err) {
  $('dash').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('loginError').textContent = err || '';
  $('loginError').classList.toggle('hidden', !err);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  state.token = $('token').value;
  store.set('token', state.token);
  start();
});
$('logout').addEventListener('click', () => { store.set('token', ''); state.token = ''; showLogin(); });

function beep() {
  if (!$('sound').checked) return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch { /* audio blocked */ }
}

const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
};

function payActions(o) {
  if (o.payment_status === 'claimed') {
    return `<div class="actions" style="margin-bottom:6px"><button type="button" class="paid" data-pay="${o.code}" data-to="paid">✅ Payment received</button><button type="button" class="cancel" data-pay="${o.code}" data-to="pending">Not received</button></div>`;
  }
  if (o.payment_status === 'pending') {
    return `<div class="actions" style="margin-bottom:6px"><button type="button" class="paid" data-pay="${o.code}" data-to="paid">✅ Payment received</button><button type="button" class="cancel" data-pay="${o.code}" data-to="cod">Take cash instead</button></div>`;
  }
  return '';
}

function orderCard(o) {
  const map = o.lat != null ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}" target="_blank" rel="noopener">map</a>` : '';
  return `<div class="order ${o.status}">
    <h4><span>${esc(o.code)}</span><span class="chip">${o.fulfilment === 'delivery' ? '🛵 Delivery' : '🏃 Pickup'} · ${o.channel === 'whatsapp' ? 'WhatsApp' : 'Web'}</span></h4>
    <div class="small muted">${ago(o.created_at)} · ${esc(o.statusLabel)}${state.outletId ? '' : ' · ' + esc(o.outlet.name.replace('Raju Chinese - ', ''))}</div>
    <ul>${o.items.map((i) => `<li>${i.qty} × ${esc(i.name)}${i.note ? ` <b style="color:var(--brand)">(${esc(i.note)})</b>` : ''}</li>`).join('')}</ul>
    ${o.notes ? `<div class="small"><b>Note:</b> ${esc(o.notes)}</div>` : ''}
    <div class="small"><b>${esc(o.customer_name)}</b> · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></div>
    ${o.address ? `<div class="small">${esc(o.address)}${o.distance_km != null ? ` (${o.distance_km} km)` : ''}${map}</div>` : ''}
    <div style="margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${rupees(o.total)}</b> <span class="chip pay-${o.payment_status}">${esc(o.paymentLabel)}</span></div>
    ${payActions(o)}
    <div class="actions">${o.nextStatuses.map((s) => `<button type="button" class="${s === 'cancelled' ? 'cancel' : ''}" data-code="${o.code}" data-status="${s}">${NEXT_LABEL[s]}</button>`).join('')}</div>
  </div>`;
}

async function renderOrders() {
  const q = new URLSearchParams();
  if (state.outletId) q.set('outletId', state.outletId);
  if (state.view === 'history') q.set('status', 'all');
  const orders = await api('/orders?' + q);
  if (state.view === 'live') {
    const fresh = orders.filter((o) => o.status === 'placed' && !state.seen.has(o.code));
    if (fresh.length && !state.firstLoad) beep();
    orders.forEach((o) => state.seen.add(o.code));
    state.firstLoad = false;
  }
  $('view').innerHTML = orders.length ? `<div class="grid">${orders.map(orderCard).join('')}</div>` : '<p class="muted">No orders here yet.</p>';
}

function chatCard(h) {
  const outlet = state.outlets.find((o) => o.id === h.outlet_id);
  return `<div class="chat">
    <h4 style="margin:0;display:flex;justify-content:space-between;gap:8px"><span>💬 ${esc(h.name || 'Customer')} · <a href="tel:+${esc(h.phone)}">+${esc(h.phone)}</a></span>
      <span class="chip">${outlet ? esc(outlet.name.replace('Raju Chinese - ', '')) : 'No outlet yet'}</span></h4>
    <div class="small muted">Opened ${ago(h.created_at)}</div>
    <div class="bubbles">${h.messages.map((m) => `<div class="b ${m.direction}">${esc(m.body)}</div>`).join('')}</div>
    <form data-chat="${h.id}"><input name="text" placeholder="Reply on WhatsApp…" autocomplete="off" required><button class="btn">Send</button></form>
    <button type="button" class="btn secondary" data-close-chat="${h.id}">Close chat & hand back to bot</button>
  </div>`;
}

async function loadChats() {
  const chats = await api('/chats' + (state.outletId ? `?outletId=${state.outletId}` : ''));
  // Alert on new customer messages.
  let fresh = false;
  for (const h of chats) {
    const lastIn = h.messages.filter((m) => m.direction === 'in').length;
    if (state.chatsLoaded && lastIn > (state.chatSeen.get(h.id) ?? -1)) fresh = true;
    state.chatSeen.set(h.id, lastIn);
  }
  if (fresh) beep();
  state.chatsLoaded = true;
  $('chatCount').textContent = chats.length || '';
  return chats;
}

async function renderChats(chats) {
  // Don't wipe a reply someone is typing.
  if (document.activeElement?.closest?.('[data-chat]')) return;
  $('view').innerHTML = chats.length ? `<div class="grid">${chats.map(chatCard).join('')}</div>` : '<p class="muted">No open chats. Customers reach staff by typing "talk to us" on WhatsApp.</p>';
  $('view').querySelectorAll('.bubbles').forEach((b) => { b.scrollTop = b.scrollHeight; });
}

async function renderMenu() {
  if (!state.outletId) { $('view').innerHTML = '<p class="muted">Choose an outlet to manage its stock.</p>'; return; }
  const items = await api(`/outlets/${state.outletId}/menu`);
  $('view').innerHTML = `<table><thead><tr><th>Item</th><th>Category</th><th>Price</th><th>In stock</th></tr></thead><tbody>
    ${items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.category)}</td><td>${rupees(i.price)}</td>
      <td><input type="checkbox" style="width:auto" data-item="${i.id}" ${i.available ? 'checked' : ''}></td></tr>`).join('')}
  </tbody></table>`;
}

async function renderStats() {
  const rows = await api('/summary');
  const name = (id) => (state.outlets.find((o) => o.id === id)?.name || '').replace('Raju Chinese - ', '');
  const shown = state.outletId ? rows.filter((r) => r.outlet_id === Number(state.outletId)) : rows;
  const total = shown.reduce((t, r) => ({ orders: t.orders + r.orders, revenue: t.revenue + r.revenue }), { orders: 0, revenue: 0 });
  $('stats').innerHTML = `<div class="stat">Today: <b>${total.orders}</b> order${total.orders === 1 ? '' : 's'} ·<b>${rupees(total.revenue)}</b></div>`
    + (state.outletId ? '' : shown.map((r) => `<div class="stat">${esc(name(r.outlet_id))}: ${r.orders} · ${rupees(r.revenue)}</div>`).join(''));
}

async function refresh() {
  try {
    const chats = await loadChats();
    const view = state.view === 'menu' ? renderMenu() : state.view === 'chats' ? renderChats(chats) : renderOrders();
    await Promise.all([view, renderStats()]);
  } catch (e) {
    if (e.message !== 'unauthorized') console.error(e);
  }
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-status]');
  if (b) {
    if (b.dataset.status === 'cancelled' && !confirm(`Cancel order ${b.dataset.code}?`)) return;
    b.disabled = true;
    try { await api(`/orders/${b.dataset.code}/status`, { method: 'POST', body: { status: b.dataset.status } }); } catch (err) { alert(err.message); }
    refresh();
  }
  const pay = e.target.closest('[data-pay]');
  if (pay) {
    pay.disabled = true;
    try { await api(`/orders/${pay.dataset.pay}/payment`, { method: 'POST', body: { status: pay.dataset.to } }); } catch (err) { alert(err.message); }
    refresh();
  }
  const c = e.target.closest('[data-close-chat]');
  if (c) {
    try { await api(`/chats/${c.dataset.closeChat}/close`, { method: 'POST' }); } catch (err) { alert(err.message); }
    refresh();
  }
  const v = e.target.closest('[data-view]');
  if (v) {
    state.view = v.dataset.view;
    document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === v));
    refresh();
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-chat]');
  if (!f) return;
  e.preventDefault();
  const input = f.elements.text;
  try {
    await api(`/chats/${f.dataset.chat}/reply`, { method: 'POST', body: { text: input.value } });
    input.value = '';
    input.blur();
  } catch (err) { alert(err.message); }
  refresh();
});

document.addEventListener('change', async (e) => {
  if (e.target.dataset.item) {
    try { await api(`/outlets/${state.outletId}/availability`, { method: 'POST', body: { itemId: Number(e.target.dataset.item), available: e.target.checked } }); } catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
  }
});

$('outlet').addEventListener('change', (e) => {
  state.outletId = e.target.value;
  store.set('outlet', state.outletId);
  syncAccepting();
  refresh();
});

function syncAccepting() {
  const o = state.outlets.find((x) => String(x.id) === String(state.outletId));
  $('accepting').parentElement.classList.toggle('hidden', !o);
  if (o) $('accepting').checked = !!o.accepting_orders;
}

$('accepting').addEventListener('change', async (e) => {
  try {
    const o = await api(`/outlets/${state.outletId}`, { method: 'PATCH', body: { acceptingOrders: e.target.checked } });
    state.outlets = state.outlets.map((x) => (x.id === o.id ? o : x));
  } catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
});

let poll;
async function start() {
  if (!state.token) return showLogin();
  try {
    state.outlets = await api('/outlets');
  } catch { return; }
  $('login').classList.add('hidden');
  $('dash').classList.remove('hidden');
  $('outlet').innerHTML = '<option value="">All outlets</option>' + state.outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  $('outlet').value = state.outletId;
  syncAccepting();
  refresh();
  clearInterval(poll);
  poll = setInterval(() => { if (state.view !== 'menu') refresh(); }, 5000);
}

start();
