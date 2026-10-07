'use strict';

// Builds a single self-contained HTML demo (dist/demo.html): the customer web
// app, WhatsApp chat, outlet dashboard and a live routing map, all running the
// real code from src/ in the browser on an in-memory store.
//
//   npm run build:demo [-- out/file.html]

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'demo.html'));

// Swap Node-only modules for browser versions.
const browserShims = {
  name: 'browser-shims',
  setup(build) {
    build.onResolve({ filter: /^node:(events|crypto)$/ }, () => ({ path: path.join(root, 'demo', 'shims.js') }));
    build.onResolve({ filter: /^\.\.?\/config$/ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      return resolved === path.join(root, 'src', 'config') ? { path: path.join(root, 'demo', 'config.js') } : undefined;
    });
  },
};

// Runs inside each embedded page: routes fetch() to the in-browser backend
// held by the parent page, and turns GPS/navigation into messages to it.
const CHILD_SHIM = `<script>
(() => {
  window.RC_DEMO = true;
  const pending = new Map();
  let seq = 0;
  const ask = (msg) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    parent.postMessage({ ...msg, rc: true, id }, '*');
  });
  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || !e.data.rc) return;
    if (e.data.reply) {
      const p = pending.get(e.data.id);
      if (p) { pending.delete(e.data.id); p(e.data); }
    }
    if (e.data.fill) {
      const input = document.getElementById('t');
      if (input) { input.value = e.data.fill; input.form.requestSubmit(); }
    }
  });
  window.fetch = async (url, opts = {}) => {
    const r = await ask({ kind: 'fetch', method: (opts.method || 'GET').toUpperCase(), url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  // "Use my location" uses the demo position chosen on the parent page.
  const geo = {
    getCurrentPosition(ok) {
      ask({ kind: 'gps' }).then((r) => setTimeout(() => ok({ coords: { latitude: r.lat, longitude: r.lng, accuracy: 20 } }), 400));
    },
  };
  try { Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true }); } catch { /* keep default */ }
  window.RC_NAVIGATE = (url) => parent.postMessage({ rc: true, kind: 'nav', url }, '*');
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="/"]');
    if (a) { e.preventDefault(); window.RC_NAVIGATE(a.getAttribute('href')); }
  }, true);
})();
</script>`;

function inlinePage(file) {
  const css = read('public/styles.css');
  let html = read(file)
    .replace('<link rel="stylesheet" href="/styles.css">', () => `<style>${css}</style>`)
    .replace(/<script src="(\/[^"]+)"><\/script>/g, (_, src) => `<script>${read('public' + src).replace(/<\/script/gi, '<\\/script')}</script>`);
  html = html.replace('<head>', () => `<head>\n${CHILD_SHIM}`);
  return html;
}

async function main() {
  const bundle = await esbuild.build({
    entryPoints: [path.join(root, 'demo', 'backend.js')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'RCBackend',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    plugins: [browserShims],
  });
  const backend = bundle.outputFiles[0].text;

  const pages = {
    web: inlinePage('public/index.html'),
    track: inlinePage('public/track.html'),
    admin: inlinePage('public/admin/index.html'),
    whatsapp: inlinePage('public/whatsapp-sim.html'),
  };
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

  const html = read('demo/shell.html')
    .replace('/*__BACKEND__*/', () => backend.replace(/<\/script/gi, '<\\/script'))
    .replace('/*__PAGES__*/', () => `const PAGES = ${json(pages)};`);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`Wrote ${path.relative(process.cwd(), out)} (${Math.round(html.length / 1024)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
