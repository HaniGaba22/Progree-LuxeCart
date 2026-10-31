const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'luxecart.db'));

db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  image_url TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  PRIMARY KEY(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL
);
`);

const sampleProducts = [
  ['Classic White Tee', 'Women', 'Soft everyday cotton essential', 2499, 20, ''],
  ['Tailored Blazer', 'Women', 'Elegant structured blazer', 8999, 12, ''],
  ['Relaxed Linen Shirt', 'Men', 'Breathable relaxed-fit linen', 4599, 18, ''],
  ['Everyday Denim', 'Men', 'Classic straight-leg denim', 6499, 16, ''],
  ['Minimal Leather Tote', 'Accessories', 'Spacious modern tote', 7499, 10, ''],
  ['City Sneakers', 'Footwear', 'Versatile casual sneakers', 7999, 14, '']
];

const count = db.prepare('SELECT COUNT(*) AS total FROM products').get();

if (count.total === 0) {
  const insert = db.prepare(`
    INSERT INTO products
    (name, category, description, price_cents, stock, image_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const product of sampleProducts) {
    insert.run(...product);
  }
}

module.exports = db;