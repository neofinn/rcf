# Raju Chinese – Online Ordering

Online ordering for Raju Chinese's outlets across the Chandigarh tricity: a web app, ordering on WhatsApp, and automatic routing of every order to the nearest outlet.

| Part | URL | Who uses it |
|---|---|---|
| Customer web app | `/` | Customers on phone/desktop |
| Order tracking | `/track.html?code=RC…` | Customers (link shown after ordering and sent on WhatsApp) |
| WhatsApp bot | `/webhooks/whatsapp` | Customers chatting with the business number |
| Outlet dashboard | `/admin/` | Outlet staff / managers |
| WhatsApp simulator | `/whatsapp-sim.html` | Developers/demos (disabled when `NODE_ENV=production`) |

## How orders reach the right outlet

1. The customer shares a location: browser GPS, picking their area from a list (25 tricity localities), or a WhatsApp location pin.
2. `assignOutlet` (`src/geo.js`) estimates the road distance to every outlet (straight-line distance × 1.3) and picks the **nearest outlet that is open, accepting orders, and has the customer inside its delivery radius** (5–6 km by default, set per outlet).
3. If the nearest outlet is closed or paused, the next nearest one in range takes the order.
4. If no outlet can deliver, the customer is offered **pickup** from the nearest open outlet.
5. For delivery orders the server always works out the outlet itself from the coordinates. It never trusts an outlet ID sent by the client.

Menu stock is per outlet: staff can mark an item out of stock at their outlet only.

## Ordering on WhatsApp

Built on the official **WhatsApp Business Cloud API** (Meta). The conversation:

```
hi → [Delivery | Pickup | Track order]
Delivery → "Send location" request → nearest outlet + ETA → menu (list)
→ category → item → quantity [1|2|3 or type a number]
→ [Add more | View cart | Checkout] → address (saved for next time)
→ confirmation with full bill → [Place order] → order ID + tracking link
```

Customers can type `menu`, `cart`, `track` or `reset` at any time. Orders from WhatsApp get status updates on WhatsApp (accepted, preparing, out for delivery / ready, completed, cancelled).

## Pricing rules (`src/config.js`)

- GST 5% on food + packing
- Packing ₹10 per order
- Delivery fee by distance: ₹20 up to 3 km, ₹35 up to 6 km, ₹50 beyond; **free above ₹499**
- Minimum delivery order ₹149
- Payment: cash/UPI on delivery or at pickup

## Order statuses

Delivery: `placed → accepted → preparing → out_for_delivery → completed`
Pickup: `placed → accepted → preparing → ready → completed`
Cancelling is allowed until the food is out for delivery or ready.

## Running it

Requires Node.js 22.5+ (uses the built-in `node:sqlite`, so there is no separate database server).

```bash
npm install
cp .env.example .env   # edit values
npm start              # http://localhost:3000
npm test
```

Without WhatsApp credentials the bot runs in dry-run mode and logs what it would send. Use `/whatsapp-sim.html` to try the full conversation in a browser.

## Going live checklist

1. **Real outlet data.** `src/seed.js` contains *placeholder* addresses, coordinates, phone numbers, prices and hours. Replace them before the first start (the seed runs only on an empty database), or edit the `outlets` / `menu_items` tables afterwards. Take each outlet's latitude/longitude from Google Maps (right-click the location).
2. **Hosting.** Any small VPS or PaaS with a persistent disk for `data/`, behind HTTPS (required by both WhatsApp webhooks and browser geolocation). Set `NODE_ENV=production`, `PUBLIC_BASE_URL` and a long random `ADMIN_TOKEN`.
3. **WhatsApp Business.**
   - Create a Meta Business account and a WhatsApp Business app at developers.facebook.com, and add and verify the business phone number.
   - Copy the permanent access token and phone number ID into `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`, and the app secret into `WHATSAPP_APP_SECRET`.
   - Set the webhook URL to `https://<your-domain>/webhooks/whatsapp` with your `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field.
   - Put an "Order on WhatsApp" link (`https://wa.me/91XXXXXXXXXX?text=hi`) and a QR code on menus, packaging and the website.
4. **Outlet tablets.** Open `/admin/` at each outlet, log in, select the outlet and leave it open; it refreshes every 10 s and beeps on new orders. "Accepting orders" pauses an outlet when it is overloaded.

## Suggested next steps

- Online payments (Razorpay/PhonePe UPI) in addition to cash/UPI on delivery
- Separate logins per outlet (today one admin token sees every outlet)
- WhatsApp template messages so web customers also get WhatsApp status updates (Meta only allows free-form messages within 24 h of the customer's last message)
- OTP verification of phone numbers for web orders
- Rider assignment / third-party delivery integration
- Delivery zones drawn as polygons instead of a radius, if outlets' areas need sharper boundaries

## Code map

```
src/
  server.js            start the HTTP server
  app.js               wires everything together
  config.js            env settings and pricing rules
  db.js, seed.js       SQLite schema and starter data
  geo.js               distance, opening hours, outlet assignment
  orders.js            menu, pricing, order creation and status changes
  routes/api.js        public API used by the web app
  routes/admin.js      staff API (Bearer ADMIN_TOKEN)
  whatsapp/bot.js      WhatsApp conversation
  whatsapp/client.js   Cloud API sender
  whatsapp/webhook.js  webhook endpoint and status notifications
public/                web app, tracking page, dashboard, simulator
test/                  node:test suites
```
