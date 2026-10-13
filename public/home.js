'use strict';

// Homepage: brand words, menu categories and outlets come from the server,
// so the page stays right when the head office changes the menu or outlets.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (path) => fetch('/api' + path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
const B = window.BRAND || {};
const shortName = (n) => (B.short ? B.short(n) : n);

// "23:00" -> "11 pm", "11:30" -> "11:30 am"
function clock(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const ap = h >= 12 && h < 24 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${ap}`;
}

const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ---- Brand words ------------------------------------------------------------
if (B.home?.tagline) $('tagline').textContent = B.home.tagline;
if (B.home?.intro) $('intro').textContent = B.home.intro;
if (B.name) $('artMark').textContent = B.name.trim()[0].toUpperCase();
$('year').textContent = new Date().getFullYear();
if (B.whatsappNumber) {
  const wa = $('waCta');
  wa.href = `https://wa.me/${String(B.whatsappNumber).replace(/\D/g, '')}?text=${encodeURIComponent('Hi')}`;
  wa.classList.remove('hidden');
  $('findCta').classList.add('hidden');
}

// Phones: the bottom "Order now" bar appears once the hero's buttons scroll away.
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([e]) => document.querySelector('.sticky').classList.toggle('show', !e.isIntersecting))
    .observe(document.querySelector('.ctas'));
}

// ---- Menu -------------------------------------------------------------------
const ICONS = [
  [/momo|dumpling/i, '🥟'], [/noodle|chowmein|hakka/i, '🍜'], [/rice|biryani/i, '🍚'], [/soup|thukpa/i, '🍲'],
  [/chicken|fish|prawn|mutton/i, '🍗'], [/roll|wrap/i, '🌯'], [/pasta/i, '🍝'], [/platter|combo|meal/i, '🍱'],
  [/chopsuey/i, '🥡'], [/starter|veg/i, '🥢'], [/drink|beverage|shake/i, '🥤'], [/dessert|sweet/i, '🍨'],
];
const iconFor = (name) => (ICONS.find(([re]) => re.test(name)) || [null, '🍽️'])[1];

function renderMenu(categories) {
  const cats = categories.filter((c) => c.items.length);
  if (!cats.length) { $('cats').innerHTML = '<p class="muted">The menu is being updated. Please check back soon.</p>'; return; }
  // A dish sold in two portions is two items; count it once.
  const dishes = new Set();
  $('cats').innerHTML = cats.map((c) => {
    const names = new Set(c.items.map((i) => i.name.replace(/\s*\((Half|Full)\)\s*$/i, '')));
    names.forEach((n) => dishes.add(n));
    const from = Math.min(...c.items.map((i) => i.price));
    return `<a class="cat" href="/order"><span class="ic" aria-hidden="true">${iconFor(c.name)}</span>`
      + `<b>${esc(c.name)}</b><small>${names.size} dish${names.size === 1 ? '' : 'es'}</small>`
      + `<span class="from">from ₹${Math.round(from / 100)}</span></a>`;
  }).join('');
  $('menuSub').textContent = `${dishes.size}+ dishes across ${cats.length} categories, from crispy starters to full platters.`;
}

// ---- Outlets ----------------------------------------------------------------
let outlets = [];
let city = 'All';

function outletCard(o) {
  const name = shortName(o.name);
  const maps = `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`;
  const tel = String(o.phone || '').replace(/[^\d+]/g, '');
  return `<article class="outlet">
    <div class="row"><span class="city">${esc(o.city)}</span>
      <span class="badge ${o.open ? 'open' : 'closed'}">${o.open ? 'Open now' : `Opens ${esc(clock(o.opens))}`}</span></div>
    <h3>${esc(name)}</h3>
    <p class="addr">${esc(o.address)}</p>
    <div class="hours">🕒 ${esc(clock(o.opens))} – ${esc(clock(o.closes))}</div>
    <div class="acts">
      ${tel ? `<a href="tel:${esc(tel)}">Call</a>` : ''}
      <a href="${esc(maps)}" target="_blank" rel="noopener">Directions</a>
      <a class="primary" href="/order">Order</a>
    </div>
  </article>`;
}

function renderOutlets() {
  const shown = city === 'All' ? outlets : outlets.filter((o) => o.city === city);
  $('outletList').innerHTML = shown.map(outletCard).join('');
  for (const b of $('filters').children) b.setAttribute('aria-selected', String(b.dataset.city === city));
}

function setupOutlets(list) {
  outlets = list.slice().sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  if (!outlets.length) { $('outletList').innerHTML = '<p class="muted">Outlets coming soon.</p>'; return; }
  const cities = [...new Set(outlets.map((o) => o.city))];
  const n = outlets.length;
  $('outletsTitle').textContent = `Our ${n} outlet${n === 1 ? '' : 's'}`;
  $('eyebrow').textContent = `${n} outlet${n === 1 ? '' : 's'} across ${listWords(cities)}`;
  $('footAreas').textContent = `Serving ${listWords(cities)}.`;
  if (cities.length > 1) {
    $('filters').innerHTML = ['All', ...cities].map((c) => `<button type="button" role="tab" data-city="${esc(c)}">${esc(c)}</button>`).join('');
    $('filters').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) { city = b.dataset.city; renderOutlets(); }
    });
  }
  renderOutlets();
}

api('/menu').then(renderMenu).catch(() => { $('cats').innerHTML = '<p class="muted">Could not load the menu. <a href="/order">Open the order page</a>.</p>'; });
api('/outlets').then(setupOutlets).catch(() => { $('outletList').innerHTML = '<p class="muted">Could not load outlets. Please refresh.</p>'; });
