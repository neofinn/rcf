'use strict';

const config = require('./config');
const { createApp } = require('./app');

if (config.production && config.adminToken === 'change-me') {
  console.error('Refusing to start: set ADMIN_TOKEN in production.');
  process.exit(1);
}

const { app, reviews } = createApp();
// Sends review requests (30 min after delivery) and other scheduled jobs.
reviews.startTicker(60 * 1000);
app.listen(config.port, () => {
  console.log(`Raju Chinese ordering running on http://localhost:${config.port}`);
  console.log(`  Customer app:       ${config.publicBaseUrl}/`);
  console.log(`  Outlet dashboard:   ${config.publicBaseUrl}/admin/`);
  if (!config.production) console.log(`  WhatsApp simulator: ${config.publicBaseUrl}/whatsapp-sim.html`);
});
