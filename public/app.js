'use strict';

// Customer ordering app. State lives in memory and is mirrored to
// localStorage so a refresh keeps the cart and location.

const $ = (id) => document.getElementById(id);
const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN', p % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { const v = localStorage.getItem('rc.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rc.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const state = {
  // { fulfilment, lat, lng, label, outlet, distanceKm, etaMinutes }
  location: store.get('location', null),
  cart: store.get('cart', {}), // itemId -> qty
  menu: [],
  vegOnly: store.get('vegOnly', false),
  modeTab: 'delivery',
};

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { code: data.code });
  return data;
}

// ---- Location ---------------------------------------------------------

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) o.classList.add('hidden'); }));

function setModeTab(mode) {
  state.modeTab = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('deliveryPane').classList.toggle('hidden', mode !== 'delivery');
  $('pickupPane').classList.toggle('hidden', mode !== 'pickup');
  if (mode === 'pickup') renderOutletList();
}
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setModeTab(b.dataset.mode)));

function showLocError(msg) {
  $('locError').textContent = msg;
  $('locError').classList.toggle('hidden', !msg);
}

async function locate(lat, lng, label) {
  showLocError('');
  state.lastCoords = { lat, lng };
  const r = await api('/locate', { method: 'POST', body: { lat, lng, fulfilment: 'delivery' } });
  if (r.outlet) {
    setLocation({ fulfilment: 'delivery', lat, lng, label, outlet: r.outlet, distanceKm: r.distanceKm, etaMinutes: r.etaMinutes });
    closeModal('locModal');
    return;
  }
  const why = r.reason === 'closed' ? 'Outlets delivering to this area are closed right now.' : "Sorry, we don't deliver to this area yet.";
  const alt = r.pickupSuggestion;
  showLocError(alt ? `${why} You can pick up from ${alt.outlet.name} (${alt.distanceKm} km).` : `${why} All outlets are closed right now.`);
  if (alt) {
    setModeTab('pickup');
  }
}

$('useGps').addEventListener('click', () => {
  if (!navigator.geolocation) return showLocError('Location is not supported on this device. Please choose your area.');
  const btn = $('useGps');
  btn.disabled = true;
  btn.textContent = 'Finding you…';
  navigator.geolocation.getCurrentPosition(
    (pos) => locate(pos.coords.latitude, pos.coords.longitude, 'Current location')
      .catch((e) => showLocError(e.message))
      .finally(() => { btn.disabled = false; btn.textContent = '📍 Use my current location'; }),
    () => {
      btn.disabled = false;
      btn.textContent = '📍 Use my current location';
      showLocError('Could not get your location. Please allow location access or choose your area.');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
});

$('locality').addEventListener('change', (e) => {
  const opt = e.target.selectedOptions[0];
  if (!opt.value) return;
  locate(Number(opt.dataset.lat), Number(opt.dataset.lng), opt.textContent).catch((err) => showLocError(err.message));
});

let outletsCache = null;
async function renderOutletList() {
  outletsCache = await api('/outlets');
  const at = state.lastCoords || (state.location?.lat != null ? state.location : null);
  const near = at ? (o) => Math.hypot(o.lat - at.lat, o.lng - at.lng) : () => 0;
  const list = [...outletsCache].sort((a, b) => near(a) - near(b));
  $('outletList').innerHTML = list.map((o) => `
    <button type="button" class="outlet-opt" data-outlet="${o.id}" ${o.open ? '' : 'disabled'}>
      <span><b>${esc(o.name.replace('Raju Chinese - ', ''))}</b><br><span class="small muted">${esc(o.address)} · ${o.opens}–${o.closes}</span></span>
      <span class="pill ${o.open ? 'open' : 'closed'}">${o.open ? 'Open' : 'Closed'}</span>
    </button>`).join('');
  $('outletList').querySelectorAll('[data-outlet]').forEach((b) => b.addEventListener('click', () => {
    const o = outletsCache.find((x) => x.id === Number(b.dataset.outlet));
    setLocation({ fulfilment: 'pickup', lat: at?.lat ?? null, lng: at?.lng ?? null, label: 'Pickup', outlet: o, distanceKm: null, etaMinutes: 20 });
    closeModal('locModal');
  }));
}

async function loadLocalities() {
  const locs = await api('/localities');
  const byCity = {};
  for (const l of locs) (byCity[l.city] ||= []).push(l);
  $('locality').innerHTML = '<option value="">Select area…</option>' + Object.entries(byCity).map(([city, ls]) =>
    `<optgroup label="${esc(city)}">${ls.map((l) => `<option value="${esc(l.name)}" data-lat="${l.lat}" data-lng="${l.lng}">${esc(l.name)}, ${esc(city)}</option>`).join('')}</optgroup>`).join('');
}

function setLocation(loc) {
  const changedOutlet = !state.location || state.location.outlet?.id !== loc.outlet.id;
  state.location = loc;
  store.set('location', loc);
  renderHeader();
  if (changedOutlet) loadMenu();
  else renderCartBar();
}

function renderHeader() {
  const l = state.location;
  if (!l) {
    $('locTitle').textContent = 'Set location';
    $('locSub').textContent = 'to see your nearest outlet';
    $('banner').classList.add('hidden');
    return;
  }
  const short = l.outlet.name.replace('Raju Chinese - ', '');
  $('locTitle').textContent = l.fulfilment === 'delivery' ? `Deliver to: ${l.label}` : `Pickup: ${short}`;
  $('locSub').textContent = l.fulfilment === 'delivery' ? `from ${short} · ${l.distanceKm} km` : 'tap to change';
  const b = $('banner');
  b.classList.remove('hidden', 'warn');
  b.innerHTML = l.fulfilment === 'delivery'
    ? `🛵 Delivering from <b>${esc(l.outlet.name)}</b> in about <b>${l.etaMinutes} min</b>.`
    : `🏃 Pick up from <b>${esc(l.outlet.name)}</b>, ${esc(l.outlet.address)}. Ready in about <b>20 min</b>.`;
}

$('locChip').addEventListener('click', () => { setModeTab(state.location?.fulfilment || 'delivery'); openModal('locModal'); });

// ---- Menu -------------------------------------------------------------

async function loadMenu() {
  const outletId = state.location?.outlet?.id;
  state.menu = await api('/menu' + (outletId ? `?outletId=${outletId}` : ''));
  // Drop cart entries that this outlet doesn't serve.
  const available = new Set(state.menu.flatMap((c) => c.items.filter((i) => i.available).map((i) => String(i.id))));
  if (outletId) for (const id of Object.keys(state.cart)) if (!available.has(id)) delete state.cart[id];
  saveCart();
  renderMenu();
}

const findItem = (id) => state.menu.flatMap((c) => c.items).find((i) => i.id === Number(id));

function qtyControl(item) {
  if (!item.available) return '<span class="small muted">Sold out</span>';
  const q = state.cart[item.id] || 0;
  return q
    ? `<span class="stepper"><button type="button" data-dec="${item.id}" aria-label="Remove one">−</button><span>${q}</span><button type="button" data-inc="${item.id}" aria-label="Add one">+</button></span>`
    : `<button type="button" class="add" data-inc="${item.id}">ADD</button>`;
}

function renderMenu() {
  const cats = state.menu
    .map((c) => ({ ...c, items: c.items.filter((i) => !state.vegOnly || i.veg) }))
    .filter((c) => c.items.length);
  const slug = (s) => 'cat-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  $('cats').innerHTML = cats.map((c) => `<a href="#${slug(c.name)}">${esc(c.name)}</a>`).join('');
  $('menu').innerHTML = cats.map((c) => `
    <section class="cat"><h2 id="${slug(c.name)}">${esc(c.name)}</h2>
      ${c.items.map((i) => `
        <div class="item ${i.available ? '' : 'unavailable'}">
          <div class="info">
            <div class="name"><span class="vegmark ${i.veg ? '' : 'non'}" title="${i.veg ? 'Veg' : 'Non-veg'}"></span>${esc(i.name)}</div>
            ${i.description ? `<div class="desc">${esc(i.description)}</div>` : ''}
            <div class="price">${rupees(i.price)}</div>
          </div>
          <div data-ctl="${i.id}">${qtyControl(i)}</div>
        </div>`).join('')}
    </section>`).join('');
  renderCartBar();
}

$('vegOnly').checked = state.vegOnly;
$('vegOnly').addEventListener('change', (e) => { state.vegOnly = e.target.checked; store.set('vegOnly', state.vegOnly); renderMenu(); });

function changeQty(id, delta) {
  if (!state.location) { openModal('locModal'); return; }
  const q = Math.max(0, Math.min(20, (state.cart[id] || 0) + delta));
  if (q) state.cart[id] = q; else delete state.cart[id];
  saveCart();
  document.querySelectorAll(`[data-ctl="${id}"]`).forEach((el) => { el.innerHTML = qtyControl(findItem(id)); });
  renderCartBar();
  if (!$('cartModal').classList.contains('hidden')) renderCart();
}

document.addEventListener('click', (e) => {
  const inc = e.target.closest('[data-inc]');
  const dec = e.target.closest('[data-dec]');
  if (inc) changeQty(inc.dataset.inc, 1);
  if (dec) changeQty(dec.dataset.dec, -1);
});

function saveCart() { store.set('cart', state.cart); }

function cartEntries() {
  return Object.entries(state.cart).map(([id, qty]) => ({ item: findItem(id), qty })).filter((e) => e.item);
}

function renderCartBar() {
  const entries = cartEntries();
  const count = entries.reduce((t, e) => t + e.qty, 0);
  const total = entries.reduce((t, e) => t + e.qty * e.item.price, 0);
  $('cartBar').classList.toggle('hidden', count === 0);
  $('cartCount').textContent = `${count} item${count === 1 ? '' : 's'} · ${rupees(total)}`;
}

// ---- Cart & checkout ----------------------------------------------------

let quoteSeq = 0;
async function renderCart() {
  const entries = cartEntries();
  if (!entries.length) { closeModal('cartModal'); return; }
  const l = state.location;
  $('addressBox').classList.toggle('hidden', l.fulfilment !== 'delivery');
  $('payWhen').textContent = l.fulfilment === 'delivery' ? 'delivery' : 'pickup';
  // Online UPI only where the outlet has a UPI ID set up.
  const upiOk = l.outlet.upi !== false;
  $('payUpiOpt').classList.toggle('hidden', !upiOk);
  if (!upiOk) $('payCod').checked = true;
  $('cartHeading').textContent = l.fulfilment === 'delivery' ? `Delivery from ${l.outlet.name.replace('Raju Chinese - ', '')}` : `Pickup from ${l.outlet.name.replace('Raju Chinese - ', '')}`;
  $('cartLines').innerHTML = entries.map((e) => `
    <div class="line"><span class="vegmark ${e.item.veg ? '' : 'non'}"></span>
      <span class="n">${esc(e.item.name)}<br><span class="small muted">${rupees(e.item.price)}</span></span>
      <span class="stepper"><button type="button" data-dec="${e.item.id}">−</button><span>${e.qty}</span><button type="button" data-inc="${e.item.id}">+</button></span>
    </div>`).join('');

  const seq = ++quoteSeq;
  try {
    const q = await api('/quote', { method: 'POST', body: quoteBody() });
    if (seq !== quoteSeq) return;
    const short = l.fulfilment === 'delivery' && q.subtotal < q.minDeliveryOrder;
    $('bill').innerHTML = `
      <div><span>Item total</span><span>${rupees(q.subtotal)}</span></div>
      <div><span>Packing</span><span>${rupees(q.packing)}</span></div>
      <div><span>GST (5%)</span><span>${rupees(q.gst)}</span></div>
      ${l.fulfilment === 'delivery' ? `<div><span>Delivery fee</span><span>${q.deliveryFee ? rupees(q.deliveryFee) : 'FREE'}</span></div>` : ''}
      <div class="total"><span>To pay</span><span>${rupees(q.total)}</span></div>
      ${l.fulfilment === 'delivery' && q.deliveryFee && q.subtotal < q.freeDeliveryAbove ? `<p class="small muted">Add ${rupees(q.freeDeliveryAbove - q.subtotal)} more for free delivery.</p>` : ''}
      ${short ? `<p class="error">Minimum order for delivery is ${rupees(q.minDeliveryOrder)}.</p>` : ''}`;
    $('placeBtn').disabled = short;
    showCheckoutError('');
  } catch (e) {
    if (seq !== quoteSeq) return;
    $('bill').innerHTML = '';
    showCheckoutError(e.message);
    $('placeBtn').disabled = true;
  }
}

function quoteBody() {
  const l = state.location;
  return {
    fulfilment: l.fulfilment, lat: l.lat, lng: l.lng,
    outletId: l.fulfilment === 'pickup' ? l.outlet.id : undefined,
    items: Object.entries(state.cart).map(([id, qty]) => ({ id: Number(id), qty })),
  };
}

function showCheckoutError(msg) {
  $('checkoutError').textContent = msg;
  $('checkoutError').classList.toggle('hidden', !msg);
}

$('openCart').addEventListener('click', () => {
  const saved = store.get('customer', {});
  for (const k of ['name', 'phone', 'address']) if (saved[k] && !$(k).value) $(k).value = saved[k];
  openModal('cartModal');
  renderCart();
});

$('checkout').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    ...quoteBody(), name: $('name').value, phone: $('phone').value, address: $('address').value, notes: $('notes').value,
    paymentMethod: $('payUpi').checked ? 'upi' : 'cod',
  };
  if (!body.name.trim()) return showCheckoutError('Please enter your name.');
  if (!/^\D*(?:\+?91|0)?\D*[6-9](?:\D*\d){9}\D*$/.test(body.phone)) return showCheckoutError('Please enter a valid 10-digit mobile number.');
  if (body.fulfilment === 'delivery' && body.address.trim().length < 5) return showCheckoutError('Please enter your full delivery address.');
  $('placeBtn').disabled = true;
  $('placeBtn').textContent = 'Placing order…';
  try {
    const { code } = await api('/orders', { method: 'POST', body });
    store.set('customer', { name: body.name, phone: body.phone, address: body.address });
    state.cart = {};
    saveCart();
    const past = store.get('orders', []);
    store.set('orders', [code, ...past].slice(0, 10));
    const url = `/track.html?code=${encodeURIComponent(code)}`;
    if (window.RC_NAVIGATE) window.RC_NAVIGATE(url); else location.href = url;
  } catch (err) {
    showCheckoutError(err.message);
    $('placeBtn').disabled = false;
    $('placeBtn').textContent = 'Place order';
  }
});

// ---- Boot ---------------------------------------------------------------

(async function init() {
  loadLocalities().catch(() => {});
  if (state.location) {
    renderHeader();
    // Re-check assignment: outlet may have closed or been changed since last visit.
    if (state.location.fulfilment === 'delivery') {
      api('/locate', { method: 'POST', body: { lat: state.location.lat, lng: state.location.lng } })
        .then((r) => {
          if (r.outlet) setLocation({ ...state.location, outlet: r.outlet, distanceKm: r.distanceKm, etaMinutes: r.etaMinutes });
          else { $('banner').classList.add('warn'); $('banner').textContent = '⚠️ No outlet can deliver to your saved location right now. Tap the location above to change it or switch to pickup.'; }
        }).catch(() => {});
    }
  } else {
    openModal('locModal');
  }
  await loadMenu();
})();
