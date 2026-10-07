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
2. `assignOutlet` (`src/geo.js`) estimates the road distance to every outlet (straight-line distance × 1.3) and picks the **nearest outlet that is open, accepting orders, and within delivery range**. The range is **20 km by road for every outlet** (`MAX_DELIVERY_KM`), so there is **no blind spot**. `test/coverage.test.js` checks a 500 m grid over the whole tricity and outskirts (New Chandigarh, Mullanpur, Pinjore, Dera Bassi, Kurali, Banur), including with outlets paused.
3. If the nearest outlet is closed or paused, the next nearest one in range takes the order.
4. Only beyond 20 km, or when every outlet is closed, is the customer offered **pickup** instead.
5. For delivery orders the server always works out the outlet itself from the coordinates. It never trusts an outlet ID sent by the client.

Menu stock is per outlet: staff can mark an item out of stock at their outlet only.

## Ordering on WhatsApp

Built on the official **WhatsApp Business Cloud API** (Meta).

**How a chat starts:**
1. *hi* → **Delivery** or **Pickup**.
2. **Pickup** → list of outlets. When the customer shares a location, the bot suggests the nearest ones ("Sector 11 · 1.5 km"), and the list sorts nearest first.
3. **Delivery** → the customer shares their **current location**, types their **full address**, or both.
   - A typed address is placed on the map from known areas (`src/geocode.js`: sectors, phases, towns in the `localities` table). If a sector exists in two cities, the bot asks which. If the area isn't known, the address is saved and a location pin is requested.
   - A pin without an address gets a follow-up asking for house/flat details.
4. We check range and opening hours, pick the outlet, and show the Shadowfax delivery charge.
5. Then the **menu**.

At checkout the saved address is used directly (type *change address* to edit it). If someone types an order before choosing, the cart is kept and delivery/pickup is asked at checkout.

Customers can order in three ways and mix them freely.

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

In the web app, customers browse first and the location is asked once, at checkout.

**3. Send a cart from the WhatsApp catalog.** There is one catalog for all outlets. The cart arrives at the webhook as an `order` message; the bot keeps it, asks for the customer's location if it doesn't have one, routes it to the nearest outlet like any other order, removes anything sold out there, and continues to checkout. Product IDs in the catalog are `RC-<menu item id>`; staff can download the full feed at `/api/admin/catalog.csv` and upload it in Meta Commerce Manager.

**Talk to a person.** Typing things like "talk to someone", "party order", "complaint" or tapping **💬 Talk to us** hands the chat to staff at the customer's outlet. The dashboard's **Chats** tab shows the conversation with the customer's cart and address, staff reply from there, and the bot stays quiet until staff close the chat or the customer types `bot`. When the bot can't find something on the menu it offers this handoff too.

Customers can type `menu`, `cart`, `track` or `reset` at any time. Orders from WhatsApp get status updates on WhatsApp (accepted, preparing, out for delivery / ready, completed, cancelled).

## Payments: UPI QR or pay on delivery (`src/payments.js`)

At checkout (web and WhatsApp) the customer picks **💳 Pay now (UPI)** or **💵 Pay on delivery/pickup**.

- **Each order gets its own UPI request**, unlike a fixed QR printed or saved in the WhatsApp Business app. The request is for the exact bill amount, with the order code as the reference, and goes to the **UPI ID of the outlet that is cooking it**. Every outlet's own merchant UPI ID is stored on the outlet (`outlets.upi_id`); point them all at one ID if payments are collected centrally.
- **On WhatsApp, paid inside the chat** (`WHATSAPP_PAYMENTS=on`): the bot sends WhatsApp's own **"Review and pay"** order message (`order_details`, India UPI). It lists the items, packing, GST, "Delivery by Shadowfax" and the total, with the order code as `reference_id`.
  - The customer pays with **WhatsApp's built-in UPI or any UPI app** on the phone.
  - WhatsApp reports the result to our webhook, and the order is marked **paid automatically**. This only happens when the amount matches and the payment comes from the ordering number; otherwise it goes to staff to check.
  - A failed payment offers **Try again** or **Pay cash instead**.
  - Later status changes update the order card in WhatsApp (`order_status`: processing → shipped → completed).
  - Setup: in Meta Business Suite → WhatsApp Manager → Payments, add each outlet's UPI ID as a *direct payment method* configuration, and put its name in `outlets.wa_payment_config` (seed: `rc-<outlet>`).
- **On WhatsApp, also always**: the **dynamic QR for this order and amount** as an image (`/pay/<code>/qr.png`), for paying from another phone. There's also a link to the order page, whose **Pay with UPI app** button opens GPay/PhonePe/Paytm/BHIM pre-filled. QR payments are confirmed with **I've paid by QR** or a screenshot, then checked by staff, because a plain QR doesn't report back. Without WhatsApp payments configured, the bot sends just the QR and link.
- **On the web** the tracking page shows the same QR and button straight after ordering.
- **Outlet staff** see `UPI payment pending` / `Customer says paid` on the order card and tap **Payment received** once it shows in their UPI app (or **Not received** / **Take cash instead**). WhatsApp customers are told either way.
- QR and web payments are confirmed by staff because plain UPI QR codes don't report back; payments made through WhatsApp's "Review and pay" confirm themselves. For automatic confirmation, add a payment gateway (Razorpay, PayU, Cashfree) or Meta's *Payments on WhatsApp (India)*. Their webhook calls `orders.setPayment(code, 'paid', now, 'gateway')`, and the rest of the flow stays as is.
- Outlets without a UPI ID only offer pay on delivery.

## Delivery riders: Shadowfax (`src/delivery/`)

Delivery orders are handed to **Shadowfax Hyperlocal** riders using their *Dedicated Store* integration, where each outlet is a registered Shadowfax store.

1. When the outlet taps **Accept** on a delivery order (or **Start preparing**, with `SHADOWFAX_BOOK_ON=preparing`), we check Shadowfax serviceability for that store and drop point, then place a Shadowfax order. It carries the customer's coordinates, the items with their notes, and `paid` (a UPI order already marked paid) or the amount the rider should collect.
2. Shadowfax calls `/webhooks/shadowfax` as the delivery moves. *Rider allotted* sends the customer the rider's name, number and live tracking link on WhatsApp. *Dispatched* moves our order to **Out for delivery**, *at doorstep* sends a "rider is at your door" message, and *delivered* completes the order.
3. The dashboard shows the rider, their number and the amount to collect on each order card. If booking fails (no store code, not serviceable, Shadowfax error) or Shadowfax cancels, the card turns red with **Retry Shadowfax rider** and **Own rider**. Cancelling an order cancels its Shadowfax booking.

Setup: get API access from Shadowfax (Dedicated Store model). Put each outlet's store code in `outlets.sfx_store_code`, set `SHADOWFAX_TOKEN` and `SHADOWFAX_BASE_URL` (staging `https://hlbackend.staging.shadowfax.in`, production `https://api.shadowfax.in`), and give Shadowfax your callback URL `https://<your-domain>/webhooks/shadowfax` with the header `X-Callback-Token: <SHADOWFAX_CALLBACK_TOKEN>`. The API paths are in `src/delivery/shadowfax.js` and follow Shadowfax's public docs. Confirm them, especially cancel, during onboarding. `SHADOWFAX_MODE=simulate` runs a pretend Shadowfax for local testing; the demo uses the same simulator.

## Pricing rules (`src/config.js`)

- GST 5% on food + packing
- Packing ₹10 per order
- **Delivery charge = the Shadowfax rate card for the distance**, paid by the customer and shown before they order: ₹40 for the first 3 km, then ₹10 per extra km (rounded up). These are placeholder rates; set `DELIVERY_BASE_FEE_PAISE`, `DELIVERY_BASE_KM` and `DELIVERY_PER_KM_PAISE` to your Shadowfax contract. Customers see it:
  - in the web app's welcome banner (rate card), and after the location as "Delivery by Shadowfax: ₹X"
  - on the bill as "Delivery by Shadowfax (6.2 km) ₹X"
  - on WhatsApp in the cart (rate card until the location is known), in the location reply, and in the order confirmation
  - on the tracking page; staff see "incl. delivery ₹X" on order cards
- Optional free delivery on big orders, where the outlet absorbs the Shadowfax charge: `FREE_DELIVERY_ABOVE_PAISE` (off by default). The bill then shows the waived charge.
- Distance here is our road estimate; Shadowfax bills by its own route distance, so expect small differences
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
  delivery/shadowfax.js  Shadowfax Hyperlocal API client
  delivery/dispatcher.js books riders, applies Shadowfax callbacks
  delivery/simulator.js  pretend Shadowfax for demo and local testing
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
