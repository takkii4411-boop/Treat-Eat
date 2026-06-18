const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const { initDb, getDb, getRows } = require('./db');

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
    const existing = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const hash = bcrypt.hashSync(password, 10);
    await db.execute("INSERT INTO users (name, email, password, phone, address) VALUES (?, ?, ?, ?, ?)",
      [name, email, hash, phone || '', address || '']);
    const user = await db.execute("SELECT id, is_admin FROM users WHERE email = ?", [email]);
    if (user.rows.length > 0) {
      req.session.regenerate(function (err) {
        if (err) return res.status(500).json({ error: 'Registration failed' });
        req.session.userId = user.rows[0][0];
        req.session.isAdmin = user.rows[0][2] === 1;
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
    const result = await db.execute("SELECT id, name, password, is_admin FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const row = result.rows[0];
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

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  const db = await getDb();
  const result = await db.execute("SELECT id, name, email, phone, address, is_admin FROM users WHERE id = ?", [req.session.userId]);
  if (result.rows.length === 0) {
    return res.json({ user: null });
  }
  const row = result.rows[0];
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
  const cols = "id,name,category,description,price,image,image_data,image_type,tag,is_available,created_at";
  if (category) {
    result = await db.execute(`SELECT ${cols} FROM products WHERE category = ? AND is_available = 1 ORDER BY id`, [category]);
  } else {
    result = await db.execute(`SELECT ${cols} FROM products WHERE is_available = 1 ORDER BY id`);
  }
  const products = getRows(result).map(row => ({
    id: row[0], name: row[1], category: row[2], description: row[3],
    price: row[4], image: row[5],
    imageUrl: (row[5] || row[6]) ? '/api/products/' + row[0] + '/image' : '',
    tag: row[8], isAvailable: row[9] === 1
  }));
  res.json(products);
});

app.get('/api/products/:id/image', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.execute("SELECT image_data, image_type, image FROM products WHERE id = ?", [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const row = result.rows[0];
    if (row[0]) {
      const imgType = row[1] || 'image/jpeg';
      res.setHeader('Content-Type', imgType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      const imgBuf = Buffer.from(row[0]);
      res.send(imgBuf);
    } else if (row[2]) {
      const imgPath = path.join(__dirname, 'public', row[2]);
      if (fs.existsSync(imgPath)) {
        res.sendFile(imgPath);
      } else {
        res.status(404).json({ error: 'Image file not found' });
      }
    } else {
      res.status(404).json({ error: 'No image' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  const db = await getDb();
  const cols = "id,name,category,description,price,image,image_data,image_type,tag,is_available,created_at";
  const result = await db.execute(`SELECT ${cols} FROM products WHERE id = ?`, [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const row = result.rows[0];
  res.json({
    id: row[0], name: row[1], category: row[2], description: row[3],
    price: row[4], image: row[5], imageUrl: (row[5] || row[6]) ? '/api/products/' + row[0] + '/image' : '',
    tag: row[8]
  });
});

// Cart API
app.get('/api/cart', requireAuth, async (req, res) => {
  const db = await getDb();
  const result = await db.execute("SELECT * FROM cart WHERE user_id = ? ORDER BY id", [req.session.userId]);
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
    const existing = await db.execute("SELECT id, quantity FROM cart WHERE user_id = ? AND product_id = ?",
      [req.session.userId, product_id]);
    if (existing.rows.length > 0) {
      const qty = existing.rows[0][1] + 1;
      await db.execute("UPDATE cart SET quantity = ? WHERE id = ?", [qty, existing.rows[0][0]]);
    } else {
      await db.execute("INSERT INTO cart (user_id, product_id, product_name, product_price, product_image, quantity) VALUES (?, ?, ?, ?, ?, 1)",
        [req.session.userId, product_id, product_name, product_price, product_image || '']);
    }
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
    await db.execute("UPDATE cart SET quantity = ? WHERE id = ? AND user_id = ?",
      [quantity, cart_id, req.session.userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cart/remove', requireAuth, async (req, res) => {
  try {
    const { cart_id } = req.body;
    const db = await getDb();
    await db.execute("DELETE FROM cart WHERE id = ? AND user_id = ?", [cart_id, req.session.userId]);
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
    const cartResult = await db.execute("SELECT * FROM cart WHERE user_id = ?", [req.session.userId]);
    if (!cartResult.rows.length) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const userResult = await db.execute("SELECT name, email FROM users WHERE id = ?", [req.session.userId]);
    const userName = userResult.rows[0][0];
    const userEmail = userResult.rows[0][1];
    const items = getRows(cartResult).map(row => ({
      productId: row[2], productName: row[3], productPrice: row[4], productImage: row[5], quantity: row[6]
    }));
    const total = items.reduce((sum, item) => sum + (item.productPrice * item.quantity), 0);
    const orderInsert = await db.execute("INSERT INTO orders (user_id, user_name, user_email, total, delivery_address, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.session.userId, userName, userEmail, total, delivery_address, phone, notes || '']);
    const orderId = Number(orderInsert.lastInsertRowid);
    for (const item of items) {
      await db.execute("INSERT INTO order_items (order_id, product_id, product_name, quantity, price, product_image) VALUES (?, ?, ?, ?, ?, ?)",
        [orderId, item.productId, item.productName, item.quantity, item.productPrice, item.productImage]);
    }
    await db.execute("DELETE FROM cart WHERE user_id = ?", [req.session.userId]);
    res.json({ success: true, orderId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/orders', requireAuth, async (req, res) => {
  const db = await getDb();
  const result = await db.execute("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", [req.session.userId]);
  const orders = [];
  for (const row of getRows(result)) {
    const orderId = row[0];
    const itemsResult = await db.execute("SELECT * FROM order_items WHERE order_id = ?", [orderId]);
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
  const result = await db.execute("SELECT * FROM orders WHERE id = ? AND user_id = ?",
    [req.params.id, req.session.userId]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Order not found' });
  }
  const row = result.rows[0];
  const itemsResult = await db.execute("SELECT * FROM order_items WHERE order_id = ?", [row[0]]);
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
  const result = await db.execute("SELECT * FROM categories ORDER BY sort_order");
  const cats = getRows(result).map(row => ({ id: row[0], key: row[1], label: row[2], icon: row[3], sortOrder: row[4] }));
  res.json(cats);
});

app.post('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    let { key, label, icon, sort_order } = req.body;
    if (!key || !label) return res.status(400).json({ error: 'Key and label are required' });
    key = key.trim().toLowerCase().replace(/\s+/g, '_');
    const db = await getDb();
    await db.execute("INSERT INTO categories (key, label, icon, sort_order) VALUES (?, ?, ?, ?)",
      [key, label, icon || '', sort_order != null ? parseInt(sort_order) : 0]);
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
    const old = await db.execute("SELECT key FROM categories WHERE id = ?", [req.params.id]);
    const oldKey = old.rows.length > 0 ? old.rows[0][0] : null;
    await db.execute("UPDATE categories SET key=?, label=?, icon=?, sort_order=? WHERE id=?",
      [key || '', label || '', icon || '', sort_order != null ? parseInt(sort_order) : 0, req.params.id]);
    if (oldKey && key && oldKey !== key) {
      await db.execute("UPDATE products SET category = ? WHERE category = ?", [key, oldKey]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const cat = await db.execute("SELECT key FROM categories WHERE id = ?", [req.params.id]);
    if (cat.rows.length > 0) {
      const key = cat.rows[0][0];
      await db.execute("UPDATE products SET category = 'uncategorized' WHERE category = ?", [key]);
    }
    await db.execute("DELETE FROM categories WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin API
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  const db = await getDb();
  const result = await db.execute("SELECT * FROM orders ORDER BY created_at DESC");
  const orders = [];
  for (const row of getRows(result)) {
    const orderId = row[0];
    const itemsResult = await db.execute("SELECT * FROM order_items WHERE order_id = ?", [orderId]);
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
    await db.execute("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin Product Management
app.get('/api/admin/products', requireAdmin, async (req, res) => {
  const db = await getDb();
  const cols = "id,name,category,description,price,image,image_data,image_type,tag,is_available,created_at";
  const result = await db.execute(`SELECT ${cols} FROM products ORDER BY id`);
  const products = getRows(result).map(row => ({
    id: row[0], name: row[1], category: row[2], description: row[3],
    price: row[4], image: row[5], imageUrl: (row[5] || row[6]) ? '/api/products/' + row[0] + '/image' : '',
    tag: row[8], isAvailable: row[9] === 1
  }));
  res.json(products);
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    let { name, category, description, price, image, image_data, image_type, tag, is_available } = req.body;
    if (!name || !category) {
      return res.status(400).json({ error: 'Name and category are required' });
    }
    const db = await getDb();
    let imgBuffer = null;
    if (image_data) {
      imgBuffer = Buffer.from(image_data, 'base64');
    }
    // If image_data was provided, clear the path-based image to avoid confusion
    const insert = await db.execute("INSERT INTO products (name, category, description, price, image, image_data, image_type, tag, is_available) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [name, category, description || '', price != null ? parseFloat(price) : null, imgBuffer ? '' : (image || ''), imgBuffer, image_type || 'image/jpeg', tag || '', is_available != null ? (is_available ? 1 : 0) : 1]);
    res.json({ success: true, id: Number(insert.lastInsertRowid) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    let { name, category, description, price, image, image_data, image_type, tag, is_available } = req.body;
    const db = await getDb();
    const existing = await db.execute("SELECT id FROM products WHERE id = ?", [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    let imgBuffer = null;
    if (image_data) {
      imgBuffer = Buffer.from(image_data, 'base64');
    }
    await db.execute("UPDATE products SET name=?, category=?, description=?, price=?, image=?, image_data=?, image_type=?, tag=?, is_available=? WHERE id=?",
      [name, category, description || '', price != null ? parseFloat(price) : null, imgBuffer ? '' : (image || ''), imgBuffer, image_type || 'image/jpeg', tag || '', is_available != null ? (is_available ? 1 : 0) : 1, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const before = await db.execute("SELECT COUNT(*) as c FROM products");
    await db.execute("DELETE FROM products WHERE id = ?", [req.params.id]);
    const after = await db.execute("SELECT COUNT(*) as c FROM products");
    console.log(`[DELETE /api/admin/products/${req.params.id}] products: ${before.rows[0]?.[0]} -> ${after.rows[0]?.[0]}`);
    res.json({ success: true });
  } catch (e) {
    console.error(`[DELETE ERROR]`, e.message);
    res.status(500).json({ error: e.message });
  }
});

async function cleanupOldData() {
  try {
    const db = await getDb();
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const oldOrders = await db.execute("SELECT id FROM orders WHERE created_at < ?", [sixMonthsAgo]);
    const ids = oldOrders.rows.map(r => r[0]);
    if (ids.length > 0) {
      await db.execute(`DELETE FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`, ids);
      await db.execute(`DELETE FROM orders WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    }
    await db.execute("DELETE FROM cart WHERE created_at < ?", [sixMonthsAgo]);
    if (ids.length > 0) console.log(`[cleanup] deleted ${ids.length} old orders + cart items (>6 months)`);
  } catch (e) {
    console.error('[cleanup] error:', e.message);
  }
}

async function start() {
  const db = await initDb();
  app.set('db', db);
  await cleanupOldData();
  app.listen(PORT, () => {
    console.log(`Treat & Eat server running at http://localhost:${PORT}`);
  });
}

start();
