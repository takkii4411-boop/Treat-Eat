const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const { initDb, getDb, saveDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

const sessionConfig = {
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  name: 'treat_eat_sid',
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    maxAge: 24 * 60 * 60 * 1000
  }
};
if (isProd) {
  app.set('trust proxy', 1);
}
app.use(session(sessionConfig));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Please login first' });
  }
  next();
}

function getRows(result) {
  return result.length > 0 && result[0].values ? result[0].values : [];
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    let { name, email, password, phone, address } = req.body;
    name = (name || '').trim();
    email = (email || '').trim().toLowerCase();
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (name.length < 2 || name.length > 50) {
      return res.status(400).json({ error: 'Name must be between 2-50 characters' });
    }
    const db = await getDb();
    const existing = db.exec("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (name, email, password, phone, address) VALUES (?, ?, ?, ?, ?)",
      [name, email, hash, phone || '', address || '']);
    saveDb();
    const user = db.exec("SELECT id, is_admin FROM users WHERE email = ?", [email]);
    if (user.length > 0 && user[0].values.length > 0) {
      req.session.regenerate(function (err) {
        if (err) return res.status(500).json({ error: 'Registration failed' });
        req.session.userId = user[0].values[0][0];
        req.session.isAdmin = user[0].values[0][1] === 1;
        res.json({ success: true });
      });
    } else {
      res.json({ success: true });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const db = await getDb();
    const result = db.exec("SELECT id, name, password, is_admin FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const row = result[0].values[0];
    const valid = bcrypt.compareSync(password, row[2]);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    req.session.regenerate(function (err) {
      if (err) return res.status(500).json({ error: 'Login failed' });
      req.session.userId = row[0];
      req.session.isAdmin = row[3] === 1;
      res.json({ success: true, isAdmin: row[3] === 1 });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(function () {
    res.clearCookie('treat_eat_sid');
    res.json({ success: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  const db = req.app.get('db');
  const result = db.exec("SELECT id, name, email, phone, address, is_admin FROM users WHERE id = ?", [req.session.userId]);
  if (result.length === 0 || result[0].values.length === 0) {
    return res.json({ user: null });
  }
  const row = result[0].values[0];
  res.json({
    user: {
      id: row[0], name: row[1], email: row[2],
      phone: row[3], address: row[4], isAdmin: row[5] === 1
    }
  });
});

// Products API
app.get('/api/products', async (req, res) => {
  const db = await getDb();
  const category = req.query.category;
  let result;
  if (category) {
    result = db.exec("SELECT * FROM products WHERE category = ? AND is_available = 1 ORDER BY id", [category]);
  } else {
    result = db.exec("SELECT * FROM products WHERE is_available = 1 ORDER BY id");
  }
  const products = getRows(result).map(row => ({
    id: row[0], name: row[1], category: row[2], description: row[3],
    price: row[4], image: row[5], tag: row[6], isAvailable: row[7] === 1
  }));
  res.json(products);
});

app.get('/api/products/:id', async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM products WHERE id = ?", [req.params.id]);
  if (result.length === 0 || result[0].values.length === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const row = result[0].values[0];
  res.json({
    id: row[0], name: row[1], category: row[2], description: row[3],
    price: row[4], image: row[5], tag: row[6]
  });
});

// Cart API
app.get('/api/cart', requireAuth, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM cart WHERE user_id = ? ORDER BY id", [req.session.userId]);
  const items = getRows(result).map(row => ({
    id: row[0], userId: row[1], productId: row[2],
    productName: row[3], productPrice: row[4], productImage: row[5],
    quantity: row[6]
  }));
  const total = items.reduce((sum, item) => sum + (item.productPrice * item.quantity), 0);
  res.json({ items, total });
});

app.post('/api/cart/add', requireAuth, async (req, res) => {
  try {
    const { product_id, product_name, product_price, product_image } = req.body;
    if (!product_id || !product_name || !product_price) {
      return res.status(400).json({ error: 'Missing product info' });
    }
    const db = await getDb();
    const existing = db.exec("SELECT id, quantity FROM cart WHERE user_id = ? AND product_id = ?",
      [req.session.userId, product_id]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      const qty = existing[0].values[0][1] + 1;
      db.run("UPDATE cart SET quantity = ? WHERE id = ?", [qty, existing[0].values[0][0]]);
    } else {
      db.run("INSERT INTO cart (user_id, product_id, product_name, product_price, product_image, quantity) VALUES (?, ?, ?, ?, ?, 1)",
        [req.session.userId, product_id, product_name, product_price, product_image || '']);
    }
    saveDb();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cart/update', requireAuth, async (req, res) => {
  try {
    const { cart_id, quantity } = req.body;
    if (!cart_id || quantity < 1) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const db = await getDb();
    db.run("UPDATE cart SET quantity = ? WHERE id = ? AND user_id = ?",
      [quantity, cart_id, req.session.userId]);
    saveDb();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cart/remove', requireAuth, async (req, res) => {
  try {
    const { cart_id } = req.body;
    const db = await getDb();
    db.run("DELETE FROM cart WHERE id = ? AND user_id = ?", [cart_id, req.session.userId]);
    saveDb();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Orders API
app.post('/api/orders/place', requireAuth, async (req, res) => {
  try {
    const { delivery_address, phone, notes } = req.body;
    if (!delivery_address || !phone) {
      return res.status(400).json({ error: 'Delivery address and phone are required' });
    }
    const db = await getDb();
    const cartResult = db.exec("SELECT * FROM cart WHERE user_id = ?", [req.session.userId]);
    if (!cartResult.length || !cartResult[0].values.length) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const userResult = db.exec("SELECT name, email FROM users WHERE id = ?", [req.session.userId]);
    const userName = userResult[0].values[0][0];
    const userEmail = userResult[0].values[0][1];
    const items = getRows(cartResult).map(row => ({
      productId: row[2], productName: row[3], productPrice: row[4], productImage: row[5], quantity: row[6]
    }));
    const total = items.reduce((sum, item) => sum + (item.productPrice * item.quantity), 0);
    db.run("INSERT INTO orders (user_id, user_name, user_email, total, delivery_address, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.session.userId, userName, userEmail, total, delivery_address, phone, notes || '']);
    const orderResult = db.exec("SELECT MAX(id) as id FROM orders");
    const orderId = orderResult[0].values[0][0];
    const stmt = db.prepare("INSERT INTO order_items (order_id, product_id, product_name, quantity, price, product_image) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of items) {
      stmt.run([orderId, item.productId, item.productName, item.quantity, item.productPrice, item.productImage]);
    }
    stmt.free();
    db.run("DELETE FROM cart WHERE user_id = ?", [req.session.userId]);
    saveDb();
    res.json({ success: true, orderId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/orders', requireAuth, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", [req.session.userId]);
  const orders = [];
  for (const row of getRows(result)) {
    const orderId = row[0];
    const itemsResult = db.exec("SELECT * FROM order_items WHERE order_id = ?", [orderId]);
    const items = getRows(itemsResult).map(ir => ({
      id: ir[0], productId: ir[2], productName: ir[3], quantity: ir[4], price: ir[5], productImage: ir[6] || ''
    }));
    orders.push({
      id: orderId, userId: row[1], userName: row[2], userEmail: row[3],
      total: row[4], status: row[5], deliveryAddress: row[6],
      phone: row[7], notes: row[8], createdAt: row[9], items
    });
  }
  res.json(orders);
});

app.get('/api/orders/:id', requireAuth, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM orders WHERE id = ? AND user_id = ?",
    [req.params.id, req.session.userId]);
  if (result.length === 0 || result[0].values.length === 0) {
    return res.status(404).json({ error: 'Order not found' });
  }
  const row = result[0].values[0];
  const itemsResult = db.exec("SELECT * FROM order_items WHERE order_id = ?", [row[0]]);
  const items = getRows(itemsResult).map(ir => ({
    id: ir[0], productId: ir[2], productName: ir[3], quantity: ir[4], price: ir[5], productImage: ir[6] || ''
  }));
  res.json({
    id: row[0], userId: row[1], userName: row[2], userEmail: row[3],
    total: row[4], status: row[5], deliveryAddress: row[6],
    phone: row[7], notes: row[8], createdAt: row[9], items
  });
});

// Image upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const category = req.body.category || 'occasion';
    const dir = category === 'pizza' ? 'public/pizza_images' : 'public/images';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype.split('/')[1]);
    cb(null, ok);
  }
});

app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const category = req.body.category || 'occasion';
    const prefix = category === 'pizza' ? 'pizza_images' : 'images';
    const imagePath = prefix + '/' + req.file.filename;
    res.json({ path: imagePath });
  });
});

// Categories API (public)
app.get('/api/categories', async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM categories ORDER BY sort_order");
  const cats = getRows(result).map(row => ({ id: row[0], key: row[1], label: row[2], icon: row[3], sortOrder: row[4] }));
  res.json(cats);
});

app.post('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    let { key, label, icon, sort_order } = req.body;
    if (!key || !label) return res.status(400).json({ error: 'Key and label are required' });
    key = key.trim().toLowerCase().replace(/\s+/g, '_');
    const db = await getDb();
    db.run("INSERT INTO categories (key, label, icon, sort_order) VALUES (?, ?, ?, ?)",
      [key, label, icon || '', sort_order != null ? parseInt(sort_order) : 0]);
    saveDb();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    let { key, label, icon, sort_order } = req.body;
    const db = await getDb();
    if (key) key = key.trim().toLowerCase().replace(/\s+/g, '_');
    const old = db.exec("SELECT key FROM categories WHERE id = ?", [req.params.id]);
    const oldKey = old.length > 0 && old[0].values.length > 0 ? old[0].values[0][0] : null;
    db.run("UPDATE categories SET key=?, label=?, icon=?, sort_order=? WHERE id=?",
      [key || '', label || '', icon || '', sort_order != null ? parseInt(sort_order) : 0, req.params.id]);
    if (oldKey && key && oldKey !== key) {
      db.run("UPDATE products SET category = ? WHERE category = ?", [key, oldKey]);
    }
    saveDb();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const cat = db.exec("SELECT key FROM categories WHERE id = ?", [req.params.id]);
    if (cat.length > 0 && cat[0].values.length > 0) {
      const key = cat[0].values[0][0];
      db.run("UPDATE products SET category = 'uncategorized' WHERE category = ?", [key]);
    }
    db.run("DELETE FROM categories WHERE id = ?", [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin API
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM orders ORDER BY created_at DESC");
  const orders = [];
  for (const row of getRows(result)) {
    const orderId = row[0];
    const itemsResult = db.exec("SELECT * FROM order_items WHERE order_id = ?", [orderId]);
    const items = getRows(itemsResult).map(ir => ({
      id: ir[0], productId: ir[2], productName: ir[3], quantity: ir[4], price: ir[5], productImage: ir[6] || ''
    }));
    orders.push({
      id: orderId, userId: row[1], userName: row[2], userEmail: row[3],
      total: row[4], status: row[5], deliveryAddress: row[6],
      phone: row[7], notes: row[8], createdAt: row[9], items
    });
  }
  res.json(orders);
});

app.put('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'preparing', 'out for delivery', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const db = await getDb();
    db.run("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin Product Management
app.get('/api/admin/products', requireAdmin, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT * FROM products ORDER BY id");
  const products = getRows(result).map(row => ({
    id: row[0], name: row[1], category: row[2], description: row[3],
    price: row[4], image: row[5], tag: row[6], isAvailable: row[7] === 1
  }));
  res.json(products);
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    let { name, category, description, price, image, tag, is_available } = req.body;
    if (!name || !category) {
      return res.status(400).json({ error: 'Name and category are required' });
    }
    const db = await getDb();
    db.run("INSERT INTO products (name, category, description, price, image, tag, is_available) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [name, category, description || '', price != null ? parseFloat(price) : null, image || '', tag || '', is_available != null ? (is_available ? 1 : 0) : 1]);
    saveDb();
    const result = db.exec("SELECT last_insert_rowid() as id");
    res.json({ success: true, id: result[0].values[0][0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    let { name, category, description, price, image, tag, is_available } = req.body;
    const db = await getDb();
    const existing = db.exec("SELECT id FROM products WHERE id = ?", [req.params.id]);
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    db.run("UPDATE products SET name=?, category=?, description=?, price=?, image=?, tag=?, is_available=? WHERE id=?",
      [name, category, description || '', price != null ? parseFloat(price) : null, image || '', tag || '', is_available != null ? (is_available ? 1 : 0) : 1, req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const before = db.exec("SELECT COUNT(*) as c FROM products");
    db.run("DELETE FROM products WHERE id = ?", [req.params.id]);
    const after = db.exec("SELECT COUNT(*) as c FROM products");
    saveDb();
    console.log(`[DELETE /api/admin/products/${req.params.id}] products: ${before[0]?.values?.[0]?.[0]} -> ${after[0]?.values?.[0]?.[0]}`);
    res.json({ success: true });
  } catch (e) {
    console.error(`[DELETE ERROR]`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// Store db reference for /api/auth/me
app.set('db', null);

async function start() {
  const db = await initDb();
  app.set('db', db);
  app.listen(PORT, () => {
    console.log(`Treat & Eat server running at http://localhost:${PORT}`);
  });
}

start();
