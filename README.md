# Raju Chinese – Online Ordering

Online ordering for Raju Chinese's outlets across the Chandigarh tricity: a web app, ordering on WhatsApp, and automatic routing of every order to the nearest outlet.

| Part | URL | Who uses it |
|---|---|---|
| Customer web app | `/` | Customers on phone/desktop |
| Order tracking | `/track.html?code=RC…` | Customers (link shown after ordering and sent on WhatsApp) |
| WhatsApp bot | `/webhooks/whatsapp` | Customers chatting with the business number |
| Outlet panel | `/outlet/` | Staff at one outlet (logs in with that outlet's PIN) |
| Head office panel | `/admin/` | Owner / head office (admin token) |
| WhatsApp simulator | `/whatsapp-sim.html` | Developers/demos (disabled when `NODE_ENV=production`) |

**Shareable demo:** `npm run build:demo` writes `dist/demo.html`, a single file with the web app, WhatsApp chat, outlet dashboard and a live routing map. It runs the real code from `src/` in the browser on an in-memory store, so no server is needed.

## How orders reach the right outlet

**Outlets** (`clients/raju-chinese/data.js`): Sector 15-D, Sector 34 and Sector 46-C Chandigarh, Phase 3B2 Mohali, VIP Road Zirakpur, Khuda Lahora (near PGI) and Peer Muchalla. These are the outlets found on Zomato, Swiggy, Justdial, magicpin and Google listings; addresses and phone numbers come from those listings, and the coordinates are approximate (Peer Muchalla's is estimated). Check each against the real outlet before going live.

1. The customer shares a location: browser GPS, a typed address, picking their area from a list of tricity localities, or a WhatsApp location pin.
2. `assignOutlet` (`src/geo.js`) estimates the road distance to every outlet (straight-line distance × 1.3) and picks the **nearest outlet that is open, accepting orders, and within delivery range**. The range is **20 km by road for every outlet** (`MAX_DELIVERY_KM`), so there is **no blind spot**. `test/coverage.test.js` checks a 500 m grid over the whole tricity and outskirts (New Chandigarh, Mullanpur, Pinjore, Dera Bassi, Banur), including with outlets paused. Kurali (~25 km from Phase 3B2) is outside the range; raise `MAX_DELIVERY_KM` to 26 to include it.
3. If the nearest outlet is closed or paused, the next nearest one in range takes the order.
4. Only beyond 20 km, or when every outlet is closed, is the customer offered **pickup** instead.
5. For delivery orders the server always works out the outlet itself from the coordinates. It never trusts an outlet ID sent by the client.

Stock is per outlet and controlled by head office: a dish can be switched off at one outlet, or given a count of how many are left (see below).

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

**Menu as pictures, order by typing.** 138 dishes don't fit WhatsApp lists (10 rows each), so once the outlet is set the bot sends the menu as **4 pictures** (`src/whatsapp/menu-image.js`). They are drawn from the live menu, so new prices and dishes show at once (served as PNG at `/menu/page-<n>.png`). Then it says "just type your order". The bot arranges what was typed into a numbered **order slip**: dish, Half/Full, quantity, price, the customer's notes, and the total with delivery. The customer can type more, or `remove 2` to drop a line, before confirming. "Browse menu" still opens the tap-through lists.

Customers can order in three ways and mix them freely.

**1. Type it like a message to a person** (`src/whatsapp/nlu.js`)

```
"2 kurkure veg momo less spicy, ek full veg chowmein no onion. Call before coming"
→ Got it 👍  • 1 × Veg Noodles (Full) (no onion)
  📝 Noted for the kitchen: call before coming
  Kurkure Veg Momo (×2) (less spicy) — Half or Full?  [Half · ₹159] [Full · ₹249]
```

- Understands English and Hinglish quantities (`2`, `2x`, `do`, `ek`, `teen`), common spellings (chowmein, manchuriyan, shezwan, chilly, momo…) and small typos.
- Special instructions stay attached to the item they belong to (`less spicy`, `no onion`, `jain`, `sauce alag`, `extra crispy`…) and print on the outlet's order card. Requests for the whole order (`call before coming`, `everything less spicy`, `cutlery`) become an order note.
- When a dish has variants ("chilli chicken", "momos"), the bot asks which one instead of guessing, then Half or Full unless the customer said it ("half", "full", "chhota", "bada").
- **Menu:** the real dine-in menu (138 dishes, most in Half and Full) in 10 categories. Each portion is its own item (price, stock, sales); the web app shows both on one card, WhatsApp lists dishes 9 per page and then asks Half or Full.
- Items sold out at the customer's outlet are reported, not added.

**2. Tap through the menu:** menu list → item → quantity (or type "2 less spicy") → cart → checkout.

The **web app follows the same steps**: on opening it asks Delivery or Pickup. Delivery takes the current location (GPS), a typed full address, or both, and picks the outlet; Pickup lists outlets nearest first. Then the menu. The phone field is labelled **WhatsApp number** (order updates and the review request go there), and once it's filled in, the customer's **saved loyalty points** are shown.

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

## Delivery riders: several partners, picked per order (`src/delivery/`)

Supported partners: **Shadowfax** (`shadowfax.js`), **Porter** (`porter.js`; two-wheelers, prepaid only) and **Borzo** (`borzo.js`; motorbikes, cash on delivery). Each is switched on by setting its key; one partner is enough to run, more partners mean fewer orders waiting for a rider.

- **Smart selection** (`selector.js`). When an outlet accepts a delivery order, every partner is asked for a quote at the same time (4 s timeout each). Partners that can't serve the address, aren't set up for the outlet, or can't collect cash on an unpaid order drop out. The rest are ranked by price + expected wait for a rider × ₹3/min (`DELIVERY_MINUTE_VALUE_PAISE`) + a penalty for their recent failure rate. Expected wait is the partner's own estimate, or its average time to assign a rider over the last 7 days from our own records. So a partner ₹5 cheaper but 10 minutes slower loses in the rush.
- **Fallbacks** (`dispatcher.js`). If a booking is refused, the next partner is booked straight away. If no rider is assigned within 8 minutes (`DELIVERY_REASSIGN_MINUTES`), or the partner cancels before pickup, the booking moves to the next partner automatically. Only when every partner has failed does it land with outlet staff, who can retry or use their own rider.
- **What staff see:** the partner, its price and the comparison on each order card ("Porter ₹54 ✓ · Borzo ₹62 · Shadowfax: no cash on delivery").
- **Customers** see one delivery charge (our rate card, `DELIVERY_*` settings) whichever partner delivers. The partner and rider show on tracking.
- **Webhooks:** `/webhooks/shadowfax`, `/webhooks/porter` and `/webhooks/borzo`. Borzo's are checked with its HMAC signature, the others with a shared secret.
- **Simulation:** `SHADOWFAX_MODE=simulate` runs pretend Shadowfax, Porter and Borzo with different prices and rider availability (used by the demo).
- **To confirm at onboarding:** Porter's exact paths and field names (`porter.js` follows its published shapes; test in Porter's UAT), Shadowfax's quote/serviceability endpoint, and Borzo's signature encoding on a live test callback.

## Two staff panels

**Outlet panel (`/outlet/`)**, for the counter tablet at each outlet:
- The tablet logs in with **that outlet's PIN**. Head office sets PINs; staff can't pick another outlet's data.
- It shows **only that outlet's** live orders (accept, cooking, ready, rider, payment), its WhatsApp chats, history and today's total, with a beep on new orders.
- **Stock is read-only** here: what head office switched off, and the counts left. Counts go down by themselves as orders come in.
- Staff can still pause new orders when the kitchen is overloaded (the next nearest outlet takes them).
- Sessions last 30 days. Five wrong PINs lock that outlet's login for 5 minutes. A new PIN (or **Sign out all**) logs the outlet's tablets out.
- Every outlet API is checked on the server (`/api/outlet/*`): an order or chat of another outlet answers "not found".

**Head office panel (`/admin/`)**, for the owner, logs in with `ADMIN_TOKEN` and sees every outlet:
- Live orders, chats and history for all outlets (or filter to one).
- **Stock** (`src/stock.js`): every dish × every outlet. Tick to sell it there; type a count to sell only that many (orders take from it, a cancellation puts it back, at 0 the dish shows as sold out on web and WhatsApp, and customers can't order more than what's left). Empty count = no limit. Per dish: *All on*, *All off*, *No limits* across outlets. Tiles show what's off, sold out and running low.
- **Outlets:** **add a new outlet** or edit one (name, address, phone, location from a pasted Google Maps link or coordinates, opening hours, UPI ID, Shadowfax store code, WhatsApp payment configuration; `src/outlet-admin.js`). A new outlet takes orders straight away: routing sends nearby customers to it, the whole menu is in stock, and its tablet logs in once it has a PIN. Also pause or resume an outlet, set each outlet's panel PIN, see how many tablets are signed in, sign them out.
- Customers, Menu and Analytics below.

## Back office (head office panel `/admin/`)

### Customers: CRM and loyalty (`src/crm.js`)
- **Saved automatically from every order** (web and WhatsApp), keyed by phone: name, address, location, first channel, favourite outlet. Orders, total spent, average order, last order and favourite dishes are worked out from the orders themselves, so they never drift.
- **Segments for campaigns:** New (1 order), Regular (3+), VIP (top 10% by spend), Lapsed (no order in 30 days). Combine them with search, outlet and "opted in to offers" filters, then **Export for campaign** (CSV).
- **Offers opt-in:** a checkbox at web checkout, and a one-time "Want our offers?" question on WhatsApp after the first order. *stop offers* opts out. Staff can change it per customer. Only message customers who opted in (WhatsApp marketing rules).
- **Loyalty: 1 point for every ₹100** of a completed order's total (`LOYALTY_RUPEES_PER_POINT`), credited once per order and never for cancelled ones.
  - On WhatsApp: "You'll earn X points" when ordering, "You earned X, balance Y" on completion, and *points* shows the balance.
  - The tracking page also shows the points for the order.
  - Staff can **redeem** (e.g. -20 for a free drink) or adjust points with a reason. Every change is in the points history, and the balance can't go below zero.
  - Redeeming points as a discount at online checkout is not built yet.
- **Customer page:** profile, order history, favourite dishes, points history, tags and notes.

### Menu (`src/menu-admin.js`)
- Edit name, category, veg, price and on-menu inline, or add a dish. With an outlet selected, the same table shows that outlet's **In stock** column.
- **One-click price change:** choose all dishes, one category or ticked dishes, then change by % or ₹ (quick buttons +5%, +10%, −5%, +₹10, −₹10). Round to ₹1/₹5/₹10, **preview** old → new, then apply. **Undo** reverts the last change, and every change is kept in `price_history`. New prices apply to web, WhatsApp and the catalog feed straight away.

### Analytics (`src/analytics.js`)
- Filters: date range (today, 7/30/90 days, this month, custom), outlet, channel and order type. Everything below follows them.
- **KPIs with change vs the previous period:** gross sales, orders, average order, customers (new vs returning), item sales, cancellations, delivery charges and GST.
- **Charts:** daily sales trend, outlet-wise sales, category mix, top 10 dishes, and a weekday × hour heatmap of when orders arrive. Also channel, payment and order-type splits.
- **Tables:** item-wise sales (qty, revenue, share, % of orders it appears in), dishes that didn't sell, top customers, and a money breakdown (items, packing, GST, delivery).
- **Exports:** outlet and item tables as CSV, for Excel or Power BI.
- **Rush hours:** orders by hour of day with the peak marked, the busiest day-and-hour slots, and each outlet's peak hour. Use it for staff rosters and rider booking.
- **Kitchen and delivery speed** (from the time of every status change, `order_events`): minutes to accept, to cook, rider time and total, by hour and by outlet, so slow-downs in the rush show up.
- **Ordered together:** dish pairs that appear in the same order, with how often, revenue and their rating. Good for combo offers.
- **Reviews:** average stars, distribution, response rate, by outlet, **star rating per dish** (with low-rating counts) and the latest comments.
- **Exports:** outlets, items, combos and ratings as CSV.
- Sales exclude cancelled orders. Dates are IST days.

### Reviews on WhatsApp (`src/reviews.js`)
**30 minutes after delivery** (or pickup), the customer gets a WhatsApp message asking for a 1–5 star rating of the order, then of each dish (up to 6), then an optional comment. A low rating offers to connect them with the outlet. Delay: `REVIEW_DELAY_MINUTES`. The job is stored in the database, so it survives restarts.
- WhatsApp orders: sent as a normal message (the chat is open).
- Web orders: WhatsApp only allows a business to start a chat with an approved **template**. Create one (e.g. *review_request*: "Hi {{1}}, how was your Raju Chinese order {{2}}?" with a quick-reply button "Rate order") and set `WHATSAPP_REVIEW_TEMPLATE`. Without it, web orders aren't asked.

The demo ships ~90 days of generated sample history (`demo/sample-history.js`) so these screens have data. The real server starts empty and fills from real orders.

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

## Supabase (optional copy of the data)

The app runs on its own SQLite file, so orders never depend on an outside service. If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, every new or changed row (orders, items, status times, customers, points, ratings, deliveries, menu, outlets, price changes) is also copied to Supabase Postgres within seconds (`src/sync/supabase.js`). If Supabase is unreachable, changes wait in an outbox and are sent when it's back. Use it for **Power BI**, Metabase, campaigns or anything else that talks to Postgres. `supabase/schema.sql` has the tables plus ready views in rupees and IST (`v_orders`, `v_order_lines`, `v_item_ratings`, `v_customers`). `GET /api/admin/sync` shows the sync status. Setup steps are in [DEPLOY.md](DEPLOY.md).

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

Step-by-step hosting (Hostinger), Supabase and WhatsApp number setup: **[DEPLOY.md](DEPLOY.md)**.

1. **Real outlet data.** `clients/raju-chinese/data.js` has the 7 outlets from public listings, but the coordinates are approximate, and the menu prices, opening hours and UPI IDs (`…@example`, deliberately invalid) are *placeholders*. Fix them before the first start (the seed runs only on an empty database), or edit the `outlets` / `menu_items` tables afterwards. Take each outlet's latitude/longitude from Google Maps (right-click the outlet's pin).
2. **Hosting.** Any small VPS with a persistent disk for `data/`, behind HTTPS (required by both WhatsApp webhooks and browser geolocation). Set `NODE_ENV=production`, `PUBLIC_BASE_URL` and a long random `ADMIN_TOKEN`.
3. **WhatsApp Business.**
   - Create a Meta Business account and a WhatsApp Business app at developers.facebook.com, and add and verify the business phone number.
   - Copy the permanent access token and phone number ID into `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`, and the app secret into `WHATSAPP_APP_SECRET`.
   - Set the webhook URL to `https://<your-domain>/webhooks/whatsapp` with your `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field.
   - Optional catalog: create a catalog in Meta Commerce Manager, upload `/api/admin/catalog.csv` (add real photos at the `image_link` URLs), and connect it to the WhatsApp number. Customers can then browse and send carts; routing still uses their location.
   - Put an "Order on WhatsApp" link (`https://wa.me/91XXXXXXXXXX?text=hi`) and a QR code on menus, packaging and the website.
4. **Outlet tablets.** In the head office panel, **Outlets** tab, set a PIN for each outlet. On each outlet's tablet open `/outlet/`, choose the outlet and enter its PIN, and leave it open; it refreshes every 5 s and beeps on new orders and new chat messages. "Accepting orders" pauses that outlet when it is overloaded. Keep `/admin/` and the admin token for head office only.

## Suggested next steps

- Automatic UPI confirmation through a payment gateway webhook (today staff confirm UPI payments by hand)
- Named staff accounts (today one PIN per outlet), and a manager role between outlet and head office
- An LLM (e.g. Claude) behind the WhatsApp parser for messages the rule-based parser can't follow, with the current parser as the fast path
- WhatsApp template messages so web customers also get WhatsApp status updates (Meta only allows free-form messages within 24 h of the customer's last message; review requests already use a template)
- OTP verification of phone numbers for web orders
- Delivery zones drawn as polygons instead of a radius, if outlets' areas need sharper boundaries

## Code map

```
src/
  server.js              start the HTTP server
  app.js                 wires everything together (Express)
  config.js              env settings and pricing rules
  db.js                  SQLite schema
  brand.js               which client this runs for (clients/<id>/: brand, outlets, menu)
  store/sqlite.js        data access on SQLite
  store/memory.js        same interface in memory (browser demo)
  geo.js                 distance, opening hours, outlet assignment
  orders.js              menu, pricing, order creation and status changes
  handoff.js             WhatsApp chats handed to outlet staff
  payments.js            UPI payment links and QR codes
  crm.js                 customers, segments, loyalty points
  menu-admin.js          dish editing, bulk price changes, undo
  stock.js               per-outlet stock: on/off and counts (head office)
  outlet-admin.js        add a new outlet, edit outlet details
  staff-auth.js          outlet PIN logins and head office token
  analytics.js           sales, rush, speed, combos and review analytics
  reviews.js             WhatsApp star ratings after delivery
  sync/supabase.js       copies data to Supabase (outbox + retries)
  delivery/shadowfax.js  Shadowfax Hyperlocal API client
  delivery/dispatcher.js books riders, applies Shadowfax callbacks
  delivery/simulator.js  pretend Shadowfax for demo and local testing
  routes/handlers.js     the HTTP API as plain functions (server + demo)
  whatsapp/bot.js        WhatsApp conversation
  whatsapp/nlu.js        free-text order understanding
  whatsapp/client.js     Cloud API sender
  whatsapp/webhook.js    webhook endpoint (signature check, dedupe)
  whatsapp/notify.js     status updates and staff replies to customers
public/                  web app, tracking page, simulator
  outlet/, admin/        outlet panel, head office panel
  staff/                 code and styles shared by both panels
supabase/schema.sql      Postgres tables and reporting views
demo/, scripts/          browser demo build, Supabase backfill
test/                    node:test suites
```
