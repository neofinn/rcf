'use strict';

// Converts the bot's abstract replies into WhatsApp Cloud API payloads and
// sends them. Without credentials it only logs, so local dev works offline.

const config = require('../config');

function toPayload(to, r) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (r.type) {
    case 'text':
      return { ...base, type: 'text', text: { body: r.text, preview_url: true } };
    case 'buttons':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'button', body: { text: r.text },
          action: { buttons: r.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
        },
      };
    case 'list':
      return {
        ...base, type: 'interactive',
        interactive: { type: 'list', body: { text: r.text }, action: { button: r.button, sections: r.sections } },
      };
    case 'location_request':
      return {
        ...base, type: 'interactive',
        interactive: { type: 'location_request_message', body: { text: r.text }, action: { name: 'send_location' } },
      };
    default:
      throw new Error(`Unknown reply type ${r.type}`);
  }
}

function createClient({ token = config.whatsapp.token, phoneNumberId = config.whatsapp.phoneNumberId, fetchImpl = globalThis.fetch, log = console } = {}) {
  const enabled = Boolean(token && phoneNumberId);
  const url = `https://graph.facebook.com/${config.whatsapp.graphVersion}/${phoneNumberId}/messages`;

  async function send(to, replies) {
    for (const r of replies) {
      const payload = toPayload(to, r);
      if (!enabled) {
        log.info(`[whatsapp:dry-run] -> ${to}: ${r.text}`);
        continue;
      }
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        log.error(`[whatsapp] send failed ${res.status}: ${await res.text()}`);
        break; // keep message order: don't send later parts if an earlier one failed
      }
    }
  }

  return { enabled, send };
}

module.exports = { createClient, toPayload };
