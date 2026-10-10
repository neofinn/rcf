'use strict';

// Head office → Connections: payment gateways, UPI, WhatsApp and delivery
// partners. Keys entered here override the server's .env, are stored
// encrypted, apply at once, and are never shown again (only "set, ends …1a2b").
// Loaded after staff/panel.js and insights.js; registers its view on RCInsights.

(() => {
  const $ = (id) => document.getElementById(id);
  const S = { data: null, msg: {}, busy: '', dirty: new Set() };
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const STATE = { on: ['ok', 'Connected'], test: ['test', 'Test mode'], warn: ['warn', 'Needs attention'], off: ['off', 'Off'] };

  function field(id, f) {
    const name = `f:${f.path}`;
    const src = f.source === 'panel' ? `<span class="src">set here${f.updatedAt ? ` · ${esc(when(f.updatedAt))}` : ''}</span>`
      : f.source === 'server' ? '<span class="src">from server settings (.env)</span>' : '';
    const clear = f.source === 'panel' ? `<button type="button" class="link" data-conn-clear="${id}" data-path="${esc(f.path)}" title="Remove the value saved here and use the server setting">use server setting</button>` : '';
    let input;
    if (f.type === 'select') {
      input = `<select name="${name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (f.type === 'secret') {
      input = `<input name="${name}" type="password" autocomplete="new-password" spellcheck="false" placeholder="${f.hint ? `${esc(f.hint)} · type to replace` : 'not set'}">`;
    } else {
      input = `<input name="${name}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" spellcheck="false">`;
    }
    return `<label class="ofield"><span>${esc(f.label)} ${src} ${clear}</span>${input}${f.help ? `<small class="muted">${esc(f.help)}</small>` : ''}</label>`;
  }

  function card(c) {
    const [cls, word] = STATE[c.status.state] || STATE.off;
    const msg = S.msg[c.id];
    return `<section class="card conn" data-conn="${c.id}">
      <header><h3>${esc(c.title)}</h3><span class="chip conn-${cls}" title="${esc(word)}">${esc(c.status.text || word)}</span></header>
      <p class="small muted" style="margin-top:0">${esc(c.about)}</p>
      ${c.webhook ? `<div class="small webhook">Notifications address (paste into the ${esc(c.title.split(' ')[0])} dashboard):
        <code>${esc(c.webhook)}</code> <button type="button" class="link" data-copy="${esc(c.webhook)}">copy</button></div>` : ''}
      <form data-conn-form="${c.id}" autocomplete="off">
        <div class="conn-fields">${c.fields.map((f) => field(c.id, f)).join('')}</div>
        <div class="row" style="gap:8px;margin-top:8px">
          <button class="btn" style="width:auto" ${S.busy === c.id ? 'disabled' : ''}>Save</button>
          ${c.testable ? `<button type="button" class="btn secondary" style="width:auto" data-conn-test="${c.id}" ${S.busy === c.id ? 'disabled' : ''}>Test connection</button>` : ''}
        </div>
      </form>
      ${msg ? `<p class="small conn-msg ${msg.ok === false ? 'bad' : msg.ok ? 'good' : ''}" role="status">${esc(msg.text)}</p>` : ''}
    </section>`;
  }

  async function renderConnections(ctx) {
    // Don't wipe what someone is typing.
    if (S.dirty.size || document.activeElement?.closest?.('#view .conn form')) return;
    S.data = await ctx.api('/connections');
    const groups = [...new Set(S.data.integrations.map((c) => c.group))];
    $('view').innerHTML = `
      <section class="card">
        <header><h3>Connections</h3><span class="small muted">Keys saved here are encrypted (${esc(S.data.encryption)}), apply immediately and are never shown again.</span></header>
        ${S.data.unreadable.length ? `<p class="small bad">Some saved keys can't be read (was SETTINGS_KEY changed?): ${S.data.unreadable.map(esc).join(', ')}. Enter them again.</p>` : ''}
        <p class="small muted" style="margin:0">Empty fields use the server's settings file. Fill one in to override it; "use server setting" removes the override.</p>
      </section>
      ${groups.map((g) => `<h3 class="section">${esc(g)}</h3><div class="conn-grid">${S.data.integrations.filter((c) => c.group === g).map(card).join('')}</div>`).join('')}
      <section class="card">
        <header><h3>Recent changes</h3></header>
        ${S.data.log.length ? `<ul class="small conn-log">${S.data.log.map((l) => `<li><b>${esc(when(l.at))}</b> · ${esc(l.integration)}: ${esc(l.change)}${l.by ? ` <span class="muted">(${esc(l.by)})</span>` : ''}</li>`).join('')}</ul>` : '<p class="small muted">No changes made here yet.</p>'}
      </section>`;
  }

  const refresh = () => { S.dirty.clear(); document.activeElement?.blur(); return window.RCAdmin.refresh(); };

  document.addEventListener('input', (e) => {
    const f = e.target.closest?.('[data-conn-form]');
    if (f) S.dirty.add(f.dataset.connForm);
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-conn-form]');
    if (!form) return;
    e.preventDefault();
    const id = form.dataset.connForm;
    const c = S.data.integrations.find((x) => x.id === id);
    const values = {};
    for (const f of c.fields) {
      const v = form.elements[`f:${f.path}`].value.trim();
      if (f.type === 'secret') { if (v) values[f.path] = v; continue; } // empty = keep
      if (v !== (f.value || '')) values[f.path] = v;
    }
    if (!Object.keys(values).length) { S.msg[id] = { text: 'Nothing changed.' }; return refresh(); }
    S.busy = id;
    try {
      await window.RCAdmin.api(`/connections/${id}`, { method: 'PUT', body: { values } });
      S.msg[id] = { ok: true, text: c.testable ? 'Saved and in use. Use "Test connection" to check the keys.' : 'Saved and in use.' };
    } catch (err) { S.msg[id] = { ok: false, text: err.message }; }
    S.busy = '';
    refresh();
  });

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-conn-test]');
    if (t) {
      const id = t.dataset.connTest;
      if (S.dirty.has(id)) { S.msg[id] = { ok: false, text: 'Save first, then test.' }; return refresh(); }
      S.busy = id; S.msg[id] = { text: 'Testing…' }; refresh();
      try {
        const r = await window.RCAdmin.api(`/connections/${id}/test`, { method: 'POST' });
        S.msg[id] = { ok: r.ok, text: r.message };
      } catch (err) { S.msg[id] = { ok: false, text: err.message }; }
      S.busy = '';
      return refresh();
    }
    const clr = e.target.closest('[data-conn-clear]');
    if (clr) {
      const id = clr.dataset.connClear;
      if (!confirm('Remove the value saved here and use the server setting instead?')) return;
      try {
        await window.RCAdmin.api(`/connections/${id}`, { method: 'PUT', body: { values: { [clr.dataset.path]: '' } } });
        S.msg[id] = { ok: true, text: 'Now using the server setting.' };
      } catch (err) { S.msg[id] = { ok: false, text: err.message }; }
      return refresh();
    }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'copied'; } catch { prompt('Copy this address:', cp.dataset.copy); }
    }
  });

  Object.assign(window.RCInsights, {
    connections: () => renderConnections(window.RCAdmin),
  });
})();
