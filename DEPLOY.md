# Going live: hosting, Supabase and WhatsApp

This takes the app from the demo to real orders. Rough order of work:

1. Start the WhatsApp/Meta paperwork first: business verification can take days.
2. Set up the server (about an hour).
3. Add Supabase (about 15 minutes).
4. Connect WhatsApp, payments and Shadowfax.

Prices below are indicative (October 2026). Check the providers' pages before buying.

---

## 1. Hosting on Hostinger

### Which plan

| Option | Fits? | Why |
|---|---|---|
| **VPS (KVM 1 or KVM 2)** | **Recommended** | Full control: Node 22, a persistent disk for the SQLite database, background jobs (review requests, Supabase sync) always running. KVM 1 (1 vCPU, 4 GB RAM) is plenty for 7 outlets; KVM 2 gives headroom for growth. |
| Business / Cloud web hosting with "Node.js apps" | Possible, not advised | Hostinger's managed Node.js hosting deploys from GitHub and is easy, but this app needs Node **22.5+** (built-in SQLite) and a data folder that survives redeploys, and the timers must keep running. Use it only if the panel offers Node 22+ and you keep `DB_PATH` outside the deployed folder. |
| Shared hosting (Single/Premium) | No | No long-running Node.js process. |

### Set up the VPS (Ubuntu 24.04)

In hPanel: **VPS → choose the plain Ubuntu 24.04 template**, set a root password or SSH key, note the server's IP.

**DNS.** Point a domain at the server: an `A` record, e.g. `order.<your-domain>` → VPS IP. (`rajuchinesefood.com` did not resolve when checked; register or renew a domain first.)

**Install** (SSH in as root):

```bash
# Node.js 22 LTS, git, nginx, certbot, sqlite3 (for backups)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git nginx certbot python3-certbot-nginx sqlite3
npm install -g pm2

# App user and code
adduser --disabled-password --gecos "" rcf
su - rcf -c "git clone https://github.com/neofinn/rcf.git app && cd app && npm ci --omit=dev"
```

**Configure:**

```bash
su - rcf
cd app
cp .env.example .env
nano .env
```

In `.env`, set at least:
- `NODE_ENV=production`
- `PUBLIC_BASE_URL=https://order.<your-domain>`
- `ADMIN_TOKEN` (generate one with `openssl rand -hex 24`)
- `DB_PATH=/home/rcf/data/rcf.db`

Fill in the WhatsApp, Shadowfax and Supabase settings as you finish those sections below.

Before the first start, correct the outlets, menu prices and UPI IDs in `src/seed.js`, or edit them in the admin later.

**Run it with PM2** (restarts on crash and on reboot):

```bash
pm2 start npm --name rcf -- start
pm2 save
exit                                  # back to root
env PATH=$PATH:/usr/bin pm2 startup systemd -u rcf --hp /home/rcf
```

**Nginx + HTTPS.** HTTPS is required by WhatsApp webhooks and by browser GPS. Create `/etc/nginx/sites-available/rcf`:

```nginx
server {
  server_name order.your-domain.in;
  client_max_body_size 1m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then enable the site, open the firewall and get a certificate:

```bash
ln -s /etc/nginx/sites-available/rcf /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
certbot --nginx -d order.your-domain.in     # free Let's Encrypt certificate, auto-renews
```

Check `https://order.your-domain.in/healthz`. It should return `{"ok":true}`.

**Backups.** The whole business data is one file. Back it up nightly (as user `rcf`, `crontab -e`):

```
15 3 * * * mkdir -p ~/backups && sqlite3 ~/data/rcf.db ".backup '$HOME/backups/rcf-$(date +\%F).db'" && find ~/backups -name 'rcf-*.db' -mtime +30 -delete
```

Two more layers:
- Turn on Hostinger's weekly VPS backups or snapshots.
- With Supabase connected (next section), every change is also copied off the server within seconds.

**Updating the app later:**

```bash
su - rcf
cd app && git pull && npm ci --omit=dev && pm2 restart rcf
```

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
