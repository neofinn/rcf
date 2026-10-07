'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const seed = require('./seed');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS outlets (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  phone TEXT NOT NULL,
  delivery_radius_km REAL NOT NULL DEFAULT 5,
  upi_id TEXT,
  upi_name TEXT,
  opens TEXT NOT NULL DEFAULT '11:00',
  closes TEXT NOT NULL DEFAULT '23:00',
  accepting_orders INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  veg INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Per-outlet stock-outs. A row means the item is unavailable at that outlet.
CREATE TABLE IF NOT EXISTS outlet_unavailable_items (
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  item_id INTEGER NOT NULL REFERENCES menu_items(id),
  PRIMARY KEY (outlet_id, item_id)
);

CREATE TABLE IF NOT EXISTS localities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  channel TEXT NOT NULL,
  fulfilment TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  distance_km REAL,
  notes TEXT,
  subtotal INTEGER NOT NULL,
  packing INTEGER NOT NULL,
  gst INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'cod',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_outlet_status ON orders(outlet_id, status);

CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  item_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS wa_sessions (
  phone TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Conversations handed over from the bot to outlet staff.
CREATE TABLE IF NOT EXISTS wa_handoffs (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT,
  outlet_id INTEGER REFERENCES outlets(id),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wa_handoffs_phone ON wa_handoffs(phone, status);

CREATE TABLE IF NOT EXISTS wa_handoff_messages (
  id INTEGER PRIMARY KEY,
  handoff_id INTEGER NOT NULL REFERENCES wa_handoffs(id),
  direction TEXT NOT NULL, -- 'in' from customer, 'out' from staff, 'bot' context
  body TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_processed (
  message_id TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  seedIfEmpty(db);
  return db;
}

// Additive migrations for databases created by earlier versions.
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(order_items)').all().map((c) => c.name);
  if (!cols.includes('note')) db.exec('ALTER TABLE order_items ADD COLUMN note TEXT');
  const outletCols = db.prepare('PRAGMA table_info(outlets)').all().map((c) => c.name);
  if (!outletCols.includes('upi_id')) {
    db.exec('ALTER TABLE outlets ADD COLUMN upi_id TEXT; ALTER TABLE outlets ADD COLUMN upi_name TEXT;');
    const set = db.prepare("UPDATE outlets SET upi_id = ?, upi_name = 'Raju Chinese' WHERE slug = ?");
    for (const o of seed.outlets) set.run(o.upiId || null, o.slug);
  }
  const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!orderCols.includes('payment_status')) db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'cod'");
}

function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM outlets').get().n > 0) return;
  db.exec('BEGIN');
  try {
    const o = db.prepare(`INSERT INTO outlets
      (slug, name, city, address, lat, lng, phone, delivery_radius_km, opens, closes, upi_id, upi_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const x of seed.outlets) {
      o.run(x.slug, x.name, x.city, x.address, x.lat, x.lng, x.phone, x.radiusKm, x.opens, x.closes, x.upiId || null, 'Raju Chinese');
    }
    const m = db.prepare(`INSERT INTO menu_items (category, name, description, price, veg, sort)
      VALUES (?, ?, ?, ?, ?, ?)`);
    seed.menu.forEach((x, i) => m.run(x.category, x.name, x.description || '', x.price * 100, x.veg ? 1 : 0, i));
    const l = db.prepare('INSERT INTO localities (name, city, lat, lng) VALUES (?, ?, ?, ?)');
    for (const x of seed.localities) l.run(x.name, x.city, x.lat, x.lng);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDb };
