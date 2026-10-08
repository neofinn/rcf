'use strict';

const config = require('./config');
const { createApp } = require('./app');

if (config.production && config.adminToken === 'change-me') {
  console.error('Refusing to start: set ADMIN_TOKEN in production.');
  process.exit(1);
}

const { app, reviews, sync, dispatcher } = createApp();
// Moves bookings that get no rider in time to the next delivery partner.
dispatcher.startSweeper(60 * 1000);
// Sends review requests (30 min after delivery) and other scheduled jobs.
reviews.startTicker(60 * 1000);
// Copies new and changed rows to Supabase every few seconds, when configured.
if (sync) sync.startTicker(5000);
app.listen(config.port, () => {
  console.log(`${require('./brand').brand().name} ordering running on http://localhost:${config.port}`);
  console.log(`  Customer app:       ${config.publicBaseUrl}/`);
  console.log(`  Outlet dashboard:   ${config.publicBaseUrl}/admin/`);
  if (sync) console.log(`  Supabase copy:      ${config.supabase.url}`);
  if (!config.production) console.log(`  WhatsApp simulator: ${config.publicBaseUrl}/whatsapp-sim.html`);
});
