# Going live: hosting, Supabase and WhatsApp

This takes the app from the demo to real orders. Rough order of work:

1. Start the WhatsApp/Meta paperwork first: business verification can take days.
2. Set up the server: one script, about 15 minutes once DNS points at it.
3. Add Supabase (about 15 minutes).
4. Connect WhatsApp, payments and Shadowfax.

Prices below are indicative (October 2026). Check the providers' pages before buying.

---

## 1. Hosting on Hostinger

### Which plan

| Option | Fits? | Why |
|---|---|---|
| **VPS KVM 2** (2 vCPU, 8 GB) | **Recommended** | Full control: Node 22, a persistent disk for the SQLite database, background jobs (review requests, rider reassignment, Supabase sync) always running. Measured capacity below: even KVM 1 copes, but KVM 2 gives reports their own core, room for backups and menu-picture rendering, and growth to many more outlets. |
| Business / Cloud web hosting with "Node.js apps" | Possible, not advised | Hostinger's managed Node.js hosting deploys from GitHub and is easy, but this app needs Node **22.5+** (built-in SQLite) and a data folder that survives redeploys, and the timers must keep running. Use it only if the panel offers Node 22+ and you keep `DB_PATH` outside the deployed folder. |
| Shared hosting (Single/Premium) | No | No long-running Node.js process. |

### How much server this traffic needs (measured)

Today's aggregator volume, ₹50–70 lakh a month, is about 12,500–17,500 orders a month. That is 420–580 a day, and roughly 60–90 in the busiest hour if all of it moved to direct ordering. That is 1–2 orders a minute.

`scripts/loadtest.js` simulates that mix all at once: web customers browsing, quoting, ordering and tracking; WhatsApp conversations of 8 messages each; 7 outlet tablets polling every 5 s; and staff updating orders. I ran it with the server pinned to **one CPU core**, against a database holding **a year of orders (219,000)**:

| | Result |
|---|---|
| Orders handled | **≈1,700–2,000 a minute**, with p95 response 70–95 ms, while managers kept reloading analytics and the customer list |
| Headroom | About **1,000×** the busiest hour |
| Memory | About 200 MB |
| Database | About 140 MB per year of orders (the nightly backup is one file) |
| Analytics over a year of data | About 2.5 s, in a separate worker thread, so it never pauses order taking |

The first run exposed real slowdowns at a year of data, all now fixed:
- missing indexes;
- the report loading every order ever;
- the customer list being rebuilt for one WhatsApp lookup.

Before the fixes, order taking stalled for 2–5 s at a time.

**When to change the setup:** only if Raju Chinese grows into many cities, or one server is no longer enough. At that point move the main database to Postgres (Supabase already holds a live copy) and run two app servers. Re-run the load test before and after any big change:

```bash
DB_PATH=/tmp/loadtest.db PORT=3456 SHADOWFAX_MODE=simulate node src/server.js &
node scripts/loadtest.js http://localhost:3456 --seconds 60 --customers 20
```

**WhatsApp limits.** The Cloud API sends up to 80 messages a second per number, far above ~10 messages per order. The limit that matters is Meta's **messaging tier**: how many different customers a day you may message *first*, with templates such as review requests to web customers and offers. It starts low and rises with business verification and good quality ratings. Replies to customers who messaged you are not limited by it.

### Set up the VPS (Ubuntu 24.04): one script

**Before you start:**
1. Buy the VPS with **Ubuntu 24.04** and note its IP address.
2. Choose the ordering address, e.g. `order.<your-domain>`. At the domain registrar, add an `A` record from that name to the VPS IP. (`rajuchinesefood.com` did not resolve when checked, so register or renew a domain first.)
3. Wait until `ping order.<your-domain>` shows the VPS IP, usually a few minutes.

**Run the setup** (SSH in as root, then):

```bash
curl -fsSL https://raw.githubusercontent.com/neofinn/rcf/release/v0.20/deploy/setup.sh -o setup.sh
sudo bash setup.sh order.<your-domain> you@example.com release/v0.20
```

`deploy/setup.sh` does everything below, and is safe to run again; it never overwrites `.env` or the database:
- installs nginx, certbot, sqlite3, the firewall, Node.js 22 and pm2;
- creates the app user `rcf`;
- writes `/home/rcf/shared/.env` with fresh secrets (head office token, WhatsApp verify token, partner callback tokens);
- installs the release with `deploy.sh` (below), which runs the test suite first;
- configures nginx (gzip, an API rate limit, a "back in a moment" page during restarts) and a free HTTPS certificate with automatic renewal;
- sets up start on boot, log rotation, nightly backups and the firewall.

At the end it prints the panel addresses, the **head office token** and the **WhatsApp webhook URL and verify token**, then runs the setup check.

**Layout on the server** (`/home/rcf`):

```
repo/                 git clone, only used to fetch releases
releases/<name>/      one folder per installed release (last 5 kept)
current -> releases/… the live release (pm2 runs this)
shared/.env           settings and keys (chmod 600)
shared/data/rcf.db    the database: all orders, customers, menu
shared/backups/       nightly backups (30 days) + one before every update
shared/logs/          app, backup and test logs
```

**Settings.** Fill in the WhatsApp, delivery partner and Supabase keys as you finish those sections below:

```bash
sudo -u rcf nano /home/rcf/shared/.env
sudo -u rcf pm2 reload rcf
```

**Setup check.** `sudo -u rcf bash -c 'cd ~/current && npm run check'` lists what is still missing or a placeholder: UPI IDs ending `@example`, outlets without a panel PIN or Shadowfax store code, test-server URLs for delivery partners, the placeholder delivery rate card. In production, the server **refuses to start** on unsafe settings:
- a short head office token, or a non-https address;
- WhatsApp connected without its app secret;
- delivery partners in simulate mode, or a partner without its callback secret.

**Panels.** Open `https://order.<your-domain>/admin/` with the head office token. In **Outlets**, set a PIN for each outlet and fix each outlet's UPI ID and phone number. On each outlet's tablet, open `https://order.<your-domain>/outlet/`, pick the outlet, enter its PIN, and add it to the home screen.

**Uptime alert (free).** At uptimerobot.com, add an HTTPS monitor for `https://order.<your-domain>/healthz` (every 5 minutes) with alerts to your phone. It reports `{"ok":true}` only when the app and the database answer.

**Backups.** Every night at 03:15, `deploy/backup.sh` copies the database (consistent while running), checks it, and keeps 30 days in `shared/backups/`. Every update also takes a backup first. For copies off the server: Supabase (section 2) holds a live copy, and Hostinger's weekly VPS snapshots cover the whole machine. To restore a backup:

```bash
sudo -u rcf pm2 stop rcf
sudo -u rcf bash -c 'gunzip -c ~/shared/backups/rcf-2026-11-02-0315.db.gz > ~/shared/data/rcf.db && rm -f ~/shared/data/rcf.db-wal ~/shared/data/rcf.db-shm'
sudo -u rcf pm2 start rcf
```

Orders placed after that backup are lost, so only do this if the data is damaged.

**Updating, and rolling back.** Every release is a branch `release/v0.N` on GitHub. To update:

```bash
sudo -u rcf bash /home/rcf/current/deploy/deploy.sh release/v0.21
```

The script:
1. installs the release into a new folder;
2. **runs the full test suite** (stops here if anything fails; nothing changes);
3. backs up the database;
4. switches over (customers see "back in a moment" for 1–2 seconds);
5. waits for the health check.

If the new version doesn't come up healthy within 40 seconds, **it switches back to the previous one by itself**. Update outside the lunch and dinner rush.

```bash
sudo -u rcf bash /home/rcf/current/deploy/deploy.sh --list       # installed releases, * = live
sudo -u rcf bash /home/rcf/current/deploy/deploy.sh --rollback   # back to the one before
```

Database changes are only ever additions (new tables and columns), so an older release runs on a newer database and a rollback never needs a restore.

**Everyday commands:**

| What | Command |
|---|---|
| Is it running? | `sudo -u rcf pm2 status` |
| Live log | `sudo -u rcf pm2 logs rcf` |
| Restart after editing `.env` | `sudo -u rcf pm2 reload rcf` |
| Health | `curl https://order.<your-domain>/healthz` |
| Deploy history | `cat /home/rcf/shared/deploys.log` |

| Version | What it added |
|---|---|
| v0.1–v0.7 | Web ordering, nearest outlet, WhatsApp bot, UPI, Shadowfax |
| v0.8–v0.11 | CRM and points, menu management, analytics, reviews, Supabase |
| v0.12–v0.13 | Separate outlet and head office panels, stock, add outlets |
| v0.14 | Separate demo pages |
| v0.15 | Real menu with Half/Full |
| v0.16 | Performance for a year of data |
| v0.17 | Several delivery partners with smart selection |
| v0.18 | WhatsApp menu pictures and order slip |
| v0.19 | Client profiles (brand per client) |
| v0.20 | Go-live checks, health check, one-command server setup, safe updates with automatic rollback |
| v0.21 | "Pay now" orders reach the kitchen only once paid; unpaid ones are cancelled after 15 minutes |
| v0.22 | Razorpay payment gateway: self-confirming payments, automatic refunds; separate demo links |

Earlier client demos stay online at `https://neofinn.github.io/rcf/versions.html`.

---

## 2. Supabase (database copy for reports and tools)

The app keeps its own SQLite database, so ordering never stops because of an outside service. Supabase gets a live copy of everything for **Power BI**, Metabase or Looker Studio, campaign tools and anything else that talks to Postgres.

1. Create a project at supabase.com. Choose the **Mumbai (ap-south-1)** region, closest to Chandigarh, and save the database password.
2. **SQL Editor → New query**: paste `supabase/schema.sql` and run it. This creates the tables and the reporting views (`v_orders`, `v_order_lines`, `v_item_ratings`, `v_customers`, in rupees and IST).
3. **Project Settings → API**: copy the **Project URL** and the **service_role** key into `.env`:
   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```
   The service-role key bypasses security. It stays in `.env` on the server and never goes into the browser, the repo or a report.
4. Copy what's already there, then restart:
   ```bash
   npm run supabase:backfill
   pm2 restart rcf
   ```
   From now on new orders, status changes, customers, points, ratings and menu changes reach Supabase within ~5 seconds. If Supabase is down, they queue in the app and are sent when it's back. `GET /api/admin/sync` (with the admin token) shows pending rows and the last error.

**Power BI.**
1. Uncomment and run the "read-only user" block at the end of `schema.sql`, with your own password.
2. In Power BI Desktop: **Get data → PostgreSQL database**. For the server, use the **Session pooler** host and port from Supabase's **Connect** button (e.g. `aws-0-ap-south-1.pooler.supabase.com:5432`). Database `postgres`, user `reporting.<project-ref>`.
3. Start with the `v_` views. Scheduled refresh in the Power BI service works directly against Supabase over the internet; if your tenant requires it, use a gateway.

**Plan.** The free plan (500 MB database) holds years of orders for 7 outlets. Free projects pause after a week with no activity, which a live shop doesn't hit; move to Pro (~$25/month) for daily backups and no pausing.

Moving the app itself onto Supabase as its main database is possible later. It is a bigger change (every data call becomes asynchronous) and only worth it if several servers must share one database.

---

## 3. WhatsApp: yes, you need a number

The WhatsApp Business **Platform** (Cloud API, which the bot uses) needs a phone number registered to it. You have two choices.

**A. A new number just for ordering (recommended).**
- Any Indian mobile or landline that can receive an SMS or voice call for the one-time code.
- It must not be on WhatsApp already. If it is, delete that WhatsApp account first.
- One number serves all 7 outlets: the bot routes each order by location. Print it on menus, bags and posters as "Order on WhatsApp".
- Customers chat with the bot. Staff reply from the dashboard's **Chats** tab, not from a phone.

**B. Keep an existing WhatsApp Business app number ("Coexistence").** Use this if the Sector 15 number customers already know (e.g. +91 92170 02598) should become the ordering number.
- Meta lets one number be on the WhatsApp Business **app** and the Cloud API at the same time. You connect it by scanning a QR code from the app during setup, and past chats sync.
- Limits:
  - the app must be version 2.24.17 or newer and opened at least every 13 days;
  - groups, broadcast lists and disappearing messages don't carry over;
  - throughput is lower (about 20 messages per second, plenty here).
- Both the phone and the bot see and can answer chats, so agree who replies.

**Setup (either option):**
1. **Meta Business portfolio** at business.facebook.com, in the restaurant's legal name. Start **Business verification**: GST certificate or Udyam/shop licence, plus a website or domain in the same name. Allow a few days.
2. **developers.facebook.com → Create app → Business → add WhatsApp.** Add the phone number:
   - for option A, enter it and verify by code;
   - for option B, choose "connect existing WhatsApp Business app" and scan the QR code.
3. **Display name** "Raju Chinese" (Meta reviews it; it should match your signage and website).
4. **Permanent token.** Business settings → System users → add an admin system user. Assign it the app and the WhatsApp account, then generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. Put it in `WHATSAPP_TOKEN`, along with the **Phone number ID** (`WHATSAPP_PHONE_NUMBER_ID`) and **App secret** (`WHATSAPP_APP_SECRET`).
5. **Webhook.** WhatsApp → Configuration:
   - Callback URL `https://order.your-domain.in/webhooks/whatsapp`.
   - Verify token = the `WHATSAPP_VERIFY_TOKEN` you chose.
   - Subscribe to **messages**.
6. **Add a payment method** to the WhatsApp account in Business settings. Templates are billed per message.
7. **Templates** (WhatsApp Manager → Message templates). The bot replies freely within 24 hours of a customer's message. To message first, Meta requires an approved template:
   - `review_request` (Utility):
     - body "Hi {{1}}, how was your Raju Chinese order {{2}}? Tap below to rate it."
     - quick-reply button "Rate order"
     - set `WHATSAPP_REVIEW_TEMPLATE=review_request`
     - This asks web customers for reviews; WhatsApp customers are asked without a template.
   - Offers (Marketing), e.g. "This weekend: 20% off momos at {{1}}". Send these only to customers who opted in (CRM → filter "opted in" → export).
8. **Payments in the chat (optional).** WhatsApp Manager → Payments (India):
   - Link a UPI ID or a payment gateway (Razorpay or PayU) and create one **payment configuration per outlet**.
   - Put its name in that outlet's `wa_payment_config` (seed `rc-<outlet>`), then set `WHATSAPP_PAYMENTS=on`.
   - Without this, customers get the order's UPI QR and pay-link instead.

**Costs.** Replies to customers within the 24-hour window are free. Templates are charged per message by category: in India, utility costs roughly ₹0.1–0.2 and marketing roughly ₹0.8–1. Check Meta's current rate card. There is no monthly fee when you connect directly to Meta like this. A provider (Interakt, AiSensy, Gupshup and similar) adds a monthly fee and isn't needed.

---

## Online payments: Razorpay (recommended)

Without a gateway, "Pay now" goes straight to each outlet's UPI ID, and staff confirm every payment by hand. With Razorpay:
- payments confirm themselves;
- paid orders that the outlet cancels are refunded automatically.

Hosting, WhatsApp and gateway options are compared in [docs/GO-LIVE-OPTIONS.md](docs/GO-LIVE-OPTIONS.md).

1. Sign up at razorpay.com with the business's PAN, GST and bank account, and complete KYC. Payments settle to that bank account.
2. Dashboard → **Account & Settings → API keys**: generate a key. Start with the **Test mode** key (`rzp_test_…`), then switch to the **Live** key after a test order.
3. Dashboard → **Webhooks → Add new webhook**:
   - URL `https://order.<your-domain>/webhooks/razorpay`;
   - a secret you choose (`openssl rand -hex 24`);
   - event **`payment_link.paid`**.
4. In `/home/rcf/shared/.env`, set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, then `sudo -u rcf pm2 reload rcf`. `npm run check` confirms the setup, and production refuses to start if the webhook secret is missing.
5. **Test with a test key:**
   - place a "Pay now" order;
   - open its pay link and pay with Razorpay's test UPI (`success@razorpay`);
   - the order should move to the outlet panel by itself and WhatsApp should confirm it;
   - cancel it from the outlet panel and check the refund appears in the dashboard.
6. **Optional, for paying inside WhatsApp:**
   - in WhatsApp Manager → Payments (India), create a payment configuration connected to Razorpay;
   - set `WHATSAPP_PAYMENTS=on`;
   - put the configuration's name on each outlet.

   Customers then see "Review and pay" in the chat, with our Razorpay link as the fallback.

Fees: Razorpay's standard rate is 2% + GST per payment, and you can negotiate it at this volume (see docs/GO-LIVE-OPTIONS.md). Pay-on-delivery orders cost nothing.

---

## 4. Shadowfax riders

1. Ask Shadowfax's business team for **Hyperlocal API (dedicated store)** access. You get a staging token first, then production.
2. Each outlet is registered as a store and gets a **store code**. Put it in that outlet's `sfx_store_code`.
3. Give them your callback URL `https://order.your-domain.in/webhooks/shadowfax`, and agree on a secret they'll send in the `X-Callback-Token` header (`SHADOWFAX_CALLBACK_TOKEN`).
4. In `.env`:
   - set `SHADOWFAX_TOKEN`;
   - set `SHADOWFAX_BASE_URL` (staging `https://hlbackend.staging.shadowfax.in`, live `https://api.shadowfax.in`);
   - set your contract's rate card in `DELIVERY_BASE_KM`, `DELIVERY_BASE_FEE_PAISE` and `DELIVERY_PER_KM_PAISE`.
5. Test a few orders on staging before switching the URL to live.

---

## Monthly cost at a glance (indicative)

| Item | Cost |
|---|---|
| Hostinger VPS KVM 1–2 | ~₹450–750/month on a 24-month term |
| Domain | ~₹800–1,200/year |
| Supabase | Free; Pro ~$25/month when you want daily backups |
| WhatsApp | Free for replies; paise per template message |
| Shadowfax | Per delivery, per contract (passed on as the delivery charge) |
