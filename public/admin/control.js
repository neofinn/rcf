'use strict';

// Head office controls: Stock (every dish at every outlet: on/off and how many
// are left) and Outlets (accepting orders, outlet panel PINs, signed-in tablets).
// Loaded after staff/panel.js and insights.js; registers its views on RCInsights.

(() => {
  const $ = (id) => document.getElementById(id);
  const short = (name) => String(name || '').replace('Raju Chinese - ', '');
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
  const LOW = 5;
  const S = { q: '', category: '', show: 'all', msg: '' };

  // ---- Stock ----------------------------------------------------------------

  function cell(item, outletId, c) {
    const label = `${item.name} at ${short(window.RCAdmin.state.outlets.find((o) => o.id === outletId)?.name)}`;
    const cls = !c.on ? 'off' : c.remaining === 0 ? 'out' : c.remaining != null && c.remaining <= LOW ? 'low' : '';
    return `<td class="stock-cell ${cls}">
      <label><input type="checkbox" data-stock-on="${outletId}" data-item="${item.id}" ${c.on ? 'checked' : ''} aria-label="${esc(label)} available" style="width:auto"> ${c.on ? 'On' : 'Off'}</label>
      <input type="number" min="0" step="1" inputmode="numeric" data-stock-count="${outletId}" data-item="${item.id}" value="${c.remaining ?? ''}" placeholder="no limit" aria-label="${esc(label)}: how many left">
    </td>`;
  }

  async function renderStock(ctx) {
    if (document.activeElement?.closest?.('#view .stock-table input, #view .stock-filters input')) return;
    const board = await ctx.api('/stock');
    const outlets = ctx.state.outletId ? board.outlets.filter((o) => String(o.id) === String(ctx.state.outletId)) : board.outlets;
    const cats = [...new Set(board.items.map((i) => i.category))];
    const cells = (i) => outlets.map((o) => i.outlets[o.id]);
    const counts = { off: 0, out: 0, low: 0 };
    for (const i of board.items) {
      for (const c of cells(i)) {
        if (!c.on) counts.off += 1;
        else if (c.remaining === 0) counts.out += 1;
        else if (c.remaining != null && c.remaining <= LOW) counts.low += 1;
      }
    }
    const q = S.q.trim().toLowerCase();
    const items = board.items.filter((i) => (!S.category || i.category === S.category) && (!q || i.name.toLowerCase().includes(q))
      && (S.show === 'all' || cells(i).some((c) => (S.show === 'off' ? !c.on || c.remaining === 0 : c.remaining != null))));
    $('view').innerHTML = `
      <div class="tiles">
        <div class="tile"><span class="t-label">Switched off</span><span class="t-value">${counts.off}</span><span class="t-foot muted">dish × outlet</span></div>
        <div class="tile"><span class="t-label">Sold out (count at 0)</span><span class="t-value">${counts.out}</span><span class="t-foot muted">dish × outlet</span></div>
        <div class="tile"><span class="t-label">Running low (${LOW} or fewer)</span><span class="t-value">${counts.low}</span><span class="t-foot muted">dish × outlet</span></div>
      </div>
      <section class="card">
        <header><h3>Stock ${ctx.state.outletId ? `at ${esc(short(outlets[0]?.name))}` : 'at every outlet'}</h3>
          <span class="muted small">Only head office can change stock. Tick to sell a dish at an outlet; enter how many are left to sell only that many (orders count it down, cancellations add back, 0 = sold out). Empty = no limit.</span></header>
        <div class="filters stock-filters">
          <input type="search" id="sQ" placeholder="Search dish" value="${esc(S.q)}" aria-label="Search dish">
          <select id="sCat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option ${c === S.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <div class="seg" role="group" aria-label="Show">${[['all', 'All dishes'], ['off', 'Off or sold out'], ['count', 'With a count']].map(([k, l]) => `<button type="button" data-stock-show="${k}" class="${S.show === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
        ${S.msg ? `<p class="small" role="status">${esc(S.msg)}</p>` : ''}
        <div class="table-wrap"><table class="data stock-table">
          <thead><tr><th>Dish</th>${outlets.map((o) => `<th>${esc(short(o.name))}${o.accepting ? '' : ' <span class="chip">paused</span>'}</th>`).join('')}${outlets.length > 1 ? '<th>All outlets</th>' : ''}</tr></thead>
          <tbody>${items.map((i) => `<tr>
            <td><b>${esc(i.name)}</b><br><span class="small muted">${esc(i.category)}</span></td>
            ${outlets.map((o) => cell(i, o.id, i.outlets[o.id])).join('')}
            ${outlets.length > 1 ? `<td class="stock-all"><button type="button" class="chip" data-stock-all="on" data-item="${i.id}">All on</button> <button type="button" class="chip" data-stock-all="off" data-item="${i.id}">All off</button> <button type="button" class="chip" data-stock-all="nolimit" data-item="${i.id}">No limits</button></td>` : ''}
          </tr>`).join('') || `<tr><td colspan="${outlets.length + 2}" class="muted">No dishes match.</td></tr>`}</tbody>
        </table></div>
      </section>`;
  }

  async function saveStock(body, done) {
    try {
      await window.RCAdmin.api('/stock', { method: 'POST', body });
      S.msg = done;
    } catch (err) { S.msg = err.message; }
    window.RCAdmin.refresh();
  }

  // ---- Outlets ----------------------------------------------------------------

  async function renderOutlets(ctx) {
    if (document.activeElement?.closest?.('#view .outlet-table input')) return;
    const [outlets, logins] = await Promise.all([ctx.api('/outlets'), ctx.api('/logins')]);
    ctx.state.outlets = outlets;
    const login = new Map(logins.map((l) => [l.outletId, l]));
    $('view').innerHTML = `
      <section class="card">
        <header><h3>Outlets and outlet panel logins</h3>
          <span class="muted small">Each outlet's tablet opens <b>/outlet/</b> and logs in with the PIN you set here. It then sees only that outlet's orders, chats and (read-only) stock. Changing a PIN signs that outlet's tablets out.</span></header>
        ${S.msg ? `<p class="small" role="status">${esc(S.msg)}</p>` : ''}
        <div class="table-wrap"><table class="data outlet-table">
          <thead><tr><th>Outlet</th><th>Taking orders</th><th>Panel login</th><th>Tablets signed in</th><th>Set new PIN</th></tr></thead>
          <tbody>${outlets.map((o) => {
            const l = login.get(o.id) || {};
            return `<tr>
              <td><b>${esc(short(o.name))}</b><br><span class="small muted">${esc(o.address)} · ${esc(o.phone)} · ${o.opens === o.closes ? 'open 24 hours' : `${esc(o.opens)}–${esc(o.closes)}`}</span></td>
              <td><label><input type="checkbox" data-accept="${o.id}" ${o.accepting_orders ? 'checked' : ''} style="width:auto" aria-label="${esc(short(o.name))} taking orders"> ${o.accepting_orders ? 'Yes' : 'Paused'}</label></td>
              <td>${l.hasPin ? `PIN set ${esc(when(l.pinSetAt))}` : '<span class="chip">No PIN yet</span>'}</td>
              <td>${l.devices || 0}${l.lastLoginAt ? `<br><span class="small muted">last ${esc(when(l.lastLoginAt))}</span>` : ''}${l.devices ? `<br><button type="button" class="link" data-signout="${o.id}">Sign out all</button>` : ''}</td>
              <td><form class="row" data-pin="${o.id}"><input name="pin" type="password" inputmode="numeric" pattern="\\d{4,8}" placeholder="4–8 digits" required aria-label="New PIN for ${esc(short(o.name))}" style="max-width:120px"><button class="btn" style="width:auto">Save</button></form></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>`;
  }

  // ---- Events -------------------------------------------------------------------

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.stockOn) {
      saveStock({ outletId: Number(t.dataset.stockOn), itemId: Number(t.dataset.item), available: t.checked }, 'Saved.');
    } else if (t.dataset.stockCount) {
      saveStock({ outletId: Number(t.dataset.stockCount), itemId: Number(t.dataset.item), remaining: t.value === '' ? null : Number(t.value) }, 'Saved.');
    } else if (t.id === 'sCat') {
      S.category = t.value; window.RCAdmin.refresh();
    } else if (t.dataset.accept) {
      window.RCAdmin.api(`/outlets/${t.dataset.accept}`, { method: 'PATCH', body: { acceptingOrders: t.checked } })
        .then(() => { S.msg = ''; window.RCAdmin.refresh(); }, (err) => alert(err.message));
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id !== 'sQ') return;
    S.q = e.target.value;
    clearTimeout(S.timer);
    S.timer = setTimeout(() => { e.target.blur(); window.RCAdmin.refresh().then(() => { const q = $('sQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }); }, 300);
  });

  document.addEventListener('keydown', (e) => {
    // Enter in a count saves it (via change) and moves on.
    if (e.key === 'Enter' && e.target.dataset?.stockCount) e.target.blur();
  });

  document.addEventListener('click', (e) => {
    const show = e.target.closest('[data-stock-show]');
    if (show) { S.show = show.dataset.stockShow; window.RCAdmin.refresh(); return; }
    const all = e.target.closest('[data-stock-all]');
    if (all) {
      const body = { outletId: 'all', itemId: Number(all.dataset.item) };
      if (all.dataset.stockAll === 'nolimit') body.remaining = null; else body.available = all.dataset.stockAll === 'on';
      saveStock(body, 'Saved for every outlet.');
      return;
    }
    const so = e.target.closest('[data-signout]');
    if (so && confirm('Sign out every tablet of this outlet? They will need the PIN again.')) {
      window.RCAdmin.api(`/outlets/${so.dataset.signout}/sign-out`, { method: 'POST' })
        .then(() => { S.msg = 'Tablets signed out.'; window.RCAdmin.refresh(); }, (err) => alert(err.message));
    }
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-pin]');
    if (!f) return;
    e.preventDefault();
    try {
      await window.RCAdmin.api(`/outlets/${f.dataset.pin}/pin`, { method: 'POST', body: { pin: f.elements.pin.value } });
      S.msg = 'PIN saved. Give it to the outlet manager; their tablets need to log in again.';
    } catch (err) { S.msg = err.message; }
    f.elements.pin.value = '';
    window.RCAdmin.refresh();
  });

  const reset = (fn) => (ctx) => { if (window.RCAdmin.state.lastView !== window.RCAdmin.state.view) S.msg = ''; window.RCAdmin.state.lastView = window.RCAdmin.state.view; return fn(ctx); };
  Object.assign(window.RCInsights, {
    stock: () => reset(renderStock)(window.RCAdmin),
    outlets: () => reset(renderOutlets)(window.RCAdmin),
  });
})();
