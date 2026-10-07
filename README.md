# Raju Chinese – Online Ordering

Online ordering for Raju Chinese's outlets across the Chandigarh tricity: a web app, ordering on WhatsApp, and automatic routing of every order to the nearest outlet.

| Part | URL | Who uses it |
|---|---|---|
| Customer web app | `/` | Customers on phone/desktop |
| Order tracking | `/track.html?code=RC…` | Customers (link shown after ordering and sent on WhatsApp) |
| WhatsApp bot | `/webhooks/whatsapp` | Customers chatting with the business number |
| Outlet dashboard | `/admin/` | Outlet staff / managers |
| WhatsApp simulator | `/whatsapp-sim.html` | Developers/demos (disabled when `NODE_ENV=production`) |

**Shareable demo:** `npm run build:demo` writes `dist/demo.html`, a single file with the web app, WhatsApp chat, outlet dashboard and a live routing map. It runs the real code from `src/` in the browser on an in-memory store, so no server is needed.

## How orders reach the right outlet

1. The customer shares a location: browser GPS, picking their area from a list (25 tricity localities), or a WhatsApp location pin.
2. `assignOutlet` (`src/geo.js`) estimates the road distance to every outlet (straight-line distance × 1.3) and picks the **nearest outlet that is open, accepting orders, and has the customer inside its delivery radius** (5–6 km by default, set per outlet).
3. If the nearest outlet is closed or paused, the next nearest one in range takes the order.
4. If no outlet can deliver, the customer is offered **pickup** from the nearest open outlet.
5. For delivery orders the server always works out the outlet itself from the coordinates. It never trusts an outlet ID sent by the client.

Menu stock is per outlet: staff can mark an item out of stock at their outlet only.

## Ordering on WhatsApp

Built on the official **WhatsApp Business Cloud API** (Meta). Customers can order in three ways and mix them freely.

**1. Type it like a message to a person** (`src/whatsapp/nlu.js`)

```
"2 chilli paneer less spicy, ek veg chowmein no onion. Call before coming"
→ Got it 👍  • 1 × Veg Hakka Noodles (no onion)
  📝 Noted for the kitchen: call before coming
  Which chilli paneer would you like? (×2) (less spicy)  [Dry] [Gravy] [Combo]
```

- Understands English and Hinglish quantities (`2`, `2x`, `do`, `ek`, `teen`), common spellings (chowmein, manchuriyan, shezwan, chilly, momo…) and small typos.
- Special instructions stay attached to the item they belong to (`less spicy`, `no onion`, `jain`, `sauce alag`, `extra crispy`…) and print on the outlet's order card. Requests for the whole order (`call before coming`, `everything less spicy`, `cutlery`) become an order note.
- When a dish has variants ("chilli paneer", "momos"), the bot asks which one instead of guessing.
- Items sold out at the customer's outlet are reported, not added.

**2. Tap through the menu:** menu list → item → quantity (or type "2 less spicy") → cart → checkout.

**3. Send a cart from the WhatsApp catalog.** There is one catalog for all outlets. The cart arrives at the webhook as an `order` message; the bot keeps it, asks for the customer's location if it doesn't have one, routes it to the nearest outlet like any other order, removes anything sold out there, and continues to checkout. Product IDs in the catalog are `RC-<menu item id>`; staff can download the full feed at `/api/admin/catalog.csv` and upload it in Meta Commerce Manager.

**Talk to a person.** Typing things like "talk to someone", "party order", "complaint" or tapping **💬 Talk to us** hands the chat to staff at the customer's outlet. The dashboard's **Chats** tab shows the conversation with the customer's cart and address, staff reply from there, and the bot stays quiet until staff close the chat or the customer types `bot`. When the bot can't find something on the menu it offers this handoff too.

Customers can type `menu`, `cart`, `track` or `reset` at any time. Orders from WhatsApp get status updates on WhatsApp (accepted, preparing, out for delivery / ready, completed, cancelled).

## Payments: UPI QR or pay on delivery (`src/payments.js`)

At checkout (web and WhatsApp) the customer picks **💳 Pay now (UPI)** or **💵 Pay on delivery/pickup**.

- **Each order gets its own UPI request**, unlike a fixed QR printed or saved in the WhatsApp Business app. The request is for the exact bill amount, with the order code as the reference, and goes to the **UPI ID of the outlet that is cooking it**. Every outlet's own merchant UPI ID is stored on the outlet (`outlets.upi_id`); point them all at one ID if payments are collected centrally.
- **On WhatsApp** the customer gets the QR as an image (`/pay/<code>/qr.png`) plus a link to the order page, whose **Pay with UPI app** button opens GPay/PhonePe/Paytm/BHIM with payee, amount and note filled in. Then they tap **I've paid** or send the payment screenshot.
- **On the web** the tracking page shows the same QR and button straight after ordering.
- **Outlet staff** see `UPI payment pending` / `Customer says paid` on the order card and tap **Payment received** once it shows in their UPI app (or **Not received** / **Take cash instead**). WhatsApp customers are told either way.
- Confirmation is manual because plain UPI QR codes don't report payments back to us. For automatic confirmation, add a payment gateway (Razorpay, PayU, Cashfree) or Meta's *Payments on WhatsApp (India)*. Their webhook calls `orders.setPayment(code, 'paid', now, 'gateway')`, and the rest of the flow stays as is.
- Outlets without a UPI ID only offer pay on delivery.

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

1. **Real outlet data.** `src/seed.js` contains *placeholder* addresses, coordinates, phone numbers, UPI IDs (`…@example`, deliberately invalid), prices and hours. Replace them before the first start (the seed runs only on an empty database), or edit the `outlets` / `menu_items` tables afterwards. Take each outlet's latitude/longitude from Google Maps (right-click the location).
2. **Hosting.** Any small VPS or PaaS with a persistent disk for `data/`, behind HTTPS (required by both WhatsApp webhooks and browser geolocation). Set `NODE_ENV=production`, `PUBLIC_BASE_URL` and a long random `ADMIN_TOKEN`.
3. **WhatsApp Business.**
   - Create a Meta Business account and a WhatsApp Business app at developers.facebook.com, and add and verify the business phone number.
   - Copy the permanent access token and phone number ID into `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`, and the app secret into `WHATSAPP_APP_SECRET`.
   - Set the webhook URL to `https://<your-domain>/webhooks/whatsapp` with your `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field.
   - Optional catalog: create a catalog in Meta Commerce Manager, upload `/api/admin/catalog.csv` (add real photos at the `image_link` URLs), and connect it to the WhatsApp number. Customers can then browse and send carts; routing still uses their location.
   - Put an "Order on WhatsApp" link (`https://wa.me/91XXXXXXXXXX?text=hi`) and a QR code on menus, packaging and the website.
4. **Outlet tablets.** Open `/admin/` at each outlet, log in, select the outlet and leave it open; it refreshes every 5 s and beeps on new orders and new chat messages. "Accepting orders" pauses an outlet when it is overloaded.

## Suggested next steps

- Automatic UPI confirmation through a payment gateway webhook (today staff confirm UPI payments by hand)
- Separate logins per outlet (today one admin token sees every outlet)
- An LLM (e.g. Claude) behind the WhatsApp parser for messages the rule-based parser can't follow, with the current parser as the fast path
- WhatsApp template messages so web customers also get WhatsApp status updates (Meta only allows free-form messages within 24 h of the customer's last message)
- OTP verification of phone numbers for web orders
- Rider assignment / third-party delivery integration
- Delivery zones drawn as polygons instead of a radius, if outlets' areas need sharper boundaries

## Code map

```
src/
  server.js              start the HTTP server
  app.js                 wires everything together (Express)
  config.js              env settings and pricing rules
  db.js, seed.js         SQLite schema and starter data
  store/sqlite.js        data access on SQLite
  store/memory.js        same interface in memory (browser demo)
  geo.js                 distance, opening hours, outlet assignment
  orders.js              menu, pricing, order creation and status changes
  handoff.js             WhatsApp chats handed to outlet staff
  payments.js            UPI payment links and QR codes
  routes/handlers.js     the HTTP API as plain functions (server + demo)
  whatsapp/bot.js        WhatsApp conversation
  whatsapp/nlu.js        free-text order understanding
  whatsapp/client.js     Cloud API sender
  whatsapp/webhook.js    webhook endpoint (signature check, dedupe)
  whatsapp/notify.js     status updates and staff replies to customers
public/                  web app, tracking page, dashboard, simulator
demo/, scripts/          single-file browser demo and its build
test/                    node:test suites
```
