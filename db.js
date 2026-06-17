const { createClient } = require('@libsql/client');
const path = require('path');

let client = null;

async function getDb() {
  if (client) return client;

  const url = process.env.TURSO_URL || ('file:' + path.join(__dirname, 'data.db'));
  const authToken = process.env.TURSO_TOKEN;

  client = createClient({
    url,
    ...(authToken ? { authToken } : {}),
    syncUrl: process.env.TURSO_SYNC_URL || undefined,
  });

  console.log('[db] connected:', url.includes('file:') ? 'local data.db' : url);
  return client;
}

function getRows(result) {
  return result && result.rows ? result.rows : [];
}

async function initDb() {
  const db = await getDb();

  // Users table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Products table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT DEFAULT '',
      price REAL,
      image TEXT DEFAULT '',
      tag TEXT DEFAULT '',
      is_available INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Cart table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      product_price REAL NOT NULL,
      product_image TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Orders table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      total REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      delivery_address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Order items table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      product_image TEXT DEFAULT '',
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )
  `);

  try { await db.execute("ALTER TABLE order_items ADD COLUMN product_image TEXT DEFAULT ''"); } catch (e) {}

  // Categories table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      icon TEXT DEFAULT '📦',
      sort_order INTEGER DEFAULT 0
    )
  `);

  // Seed categories
  const catResult = await db.execute("SELECT COUNT(*) as c FROM categories");
  if (catResult.rows.length === 0 || catResult.rows[0][0] === 0) {
    await db.execute("INSERT OR IGNORE INTO categories (key, label, icon, sort_order) VALUES (?, ?, ?, ?)", ['occasion', 'Occasion Cakes', '🎂', 1]);
    await db.execute("INSERT OR IGNORE INTO categories (key, label, icon, sort_order) VALUES (?, ?, ?, ?)", ['flavour', 'Flavour Cakes', '🍰', 2]);
    await db.execute("INSERT OR IGNORE INTO categories (key, label, icon, sort_order) VALUES (?, ?, ?, ?)", ['pizza', 'Pizza', '🍕', 3]);
  }

  // Seed products
  const prodResult = await db.execute("SELECT COUNT(*) as c FROM products");
  if (prodResult.rows.length === 0 || prodResult.rows[0][0] === 0) {
    await seedProducts(db);
  }

  // Seed admin
  const adminResult = await db.execute("SELECT COUNT(*) as c FROM users WHERE is_admin = 1");
  if (adminResult.rows.length === 0 || adminResult.rows[0][0] === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    await db.execute("INSERT INTO users (name, email, password, is_admin) VALUES (?, ?, ?, 1)", ['Admin', 'admin@treateat.com', hash]);
  }

  return db;
}

async function seedProducts(db) {
  const products = [
    { name: 'Anniversary Party', category: 'occasion', description: 'Thoughtful, customised cakes that celebrate years of love and togetherness.', price: 699, image: 'images/Screenshot_2025-05-12_at_16-39-08_Buy_Fresh_Custom_Cakes_Desserts_online_Free_delivery_359d2150-3fa6-477e-8731-4a58321d865c.png', tag: '1 Day Advance' },
    { name: 'Birthday Party', category: 'occasion', description: 'Playful, colourful designs that bring every birthday celebration to life.', price: 599, image: 'images/Screenshot_2025-05-12_at_16-39-41_Buy_Fresh_Custom_Cakes_Desserts_online_Free_delivery_51ab2b30-5399-472b-925c-7f36be20e95e.png', tag: '1 Day Advance' },
    { name: 'Farewell Party', category: 'occasion', description: 'A sweet send-off with a design as memorable as the moment itself.', price: 649, image: 'images/Screenshot_2025-05-12_at_16-39-35_Buy_Fresh_Custom_Cakes_Desserts_online_Free_delivery_6de0b818-123a-4643-82e1-24ecd78a7db6.png', tag: '1 Day Advance' },
    { name: 'Gender Reveal Party', category: 'occasion', description: 'Cute, surprise-filled designs to make your big announcement extra special.', price: 749, image: 'images/Screenshot_2025-05-12_at_16-39-14_Buy_Fresh_Custom_Cakes_Desserts_online_Free_delivery_058d97a9-25c5-43e8-bb88-4af03d61937f.png', tag: '1 Day Advance' },
    { name: 'Wedding Party', category: 'occasion', description: 'Multi-tier showstoppers, beautifully crafted to match your big day.', price: 1499, image: 'images/forever-together-engagement-cake_982ba8cc-2399-414e-a3cd-5565b180f276.png', tag: '1 Day Advance' },
    { name: 'Special Days Party', category: 'occasion', description: 'For Mother\'s Day, Father\'s Day and every special day worth celebrating.', price: 549, image: 'images/WhatsApp Image 2026-06-14 at 6.09.42 PM.jpeg', tag: '1 Day Advance' },
    { name: 'Chocolate Cake', category: 'flavour', description: 'Rich, moist chocolate sponge layered with smooth chocolate cream.', price: 549, image: 'images/WhatsApp Image 2026-06-14 at 5.12.42 PM.jpeg', tag: '100% Veg' },
    { name: 'Vanilla Cake', category: 'flavour', description: 'Light, fluffy vanilla sponge finished with a delicate cream drip.', price: 549, image: 'images/WhatsApp Image 2026-06-14 at 5.14.51 PM.jpeg', tag: '100% Veg' },
    { name: 'Pineapple Cake', category: 'flavour', description: 'Classic fresh pineapple sponge with whipped cream and juicy fruit bits.', price: 499, image: 'images/WhatsApp Image 2026-06-14 at 5.16.58 PM.jpeg', tag: '100% Veg' },
    { name: 'Red Velvet Cake', category: 'flavour', description: 'Soft red velvet sponge with a tang of cocoa and silky cream cheese frosting.', price: 599, image: 'images/WhatsApp Image 2026-06-14 at 5.23.39 PM.jpeg', tag: '100% Veg' },
    { name: 'Butterscotch Cake', category: 'flavour', description: 'Caramel-rich sponge loaded with crunchy praline bits and butterscotch cream.', price: 549, image: 'images/WhatsApp Image 2026-06-14 at 5.21.12 PM.jpeg', tag: '100% Veg' },
    { name: 'Ferrero Rocher Cake', category: 'flavour', description: 'Decadent chocolate-hazelnut cake topped with Ferrero Rocher chocolates.', price: null, image: 'images/WhatsApp Image 2026-06-14 at 5.28.43 PM.jpeg', tag: 'Up Coming' },
    { name: 'Black Forest Cake', category: 'flavour', description: 'Chocolate sponge layered with cream and cherries, finished with chocolate shavings.', price: 499, image: 'images/blackforest-10red.jpg', tag: '100% Veg' },
    { name: 'Mango Cake', category: 'flavour', description: 'Fresh mango sponge with a luscious mango glaze — a seasonal favourite.', price: 599, image: 'images/Pineapple Cake Design.jpg', tag: '100% Veg' },
    { name: 'Fresh Fruit Cake', category: 'flavour', description: 'Vanilla sponge topped with whipped cream and a generous medley of fresh fruit.', price: 649, image: 'images/WhatsApp Image 2026-06-14 at 5.34.27 PM.jpeg', tag: '100% Veg' },
    { name: 'Onion Pizza', category: 'pizza', description: 'Sweet caramelised onions layered over our hand-tossed base — simple, classic, and totally satisfying.', price: 119, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.35.29 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Tomato Pizza', category: 'pizza', description: 'Juicy vine-ripened tomatoes over a rich tomato base — fresh, tangy, and bursting with flavour.', price: 119, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.36.41 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Corn Pizza', category: 'pizza', description: 'Sweet golden corn kernels on a melty cheese bed — the kind of pizza that makes you smile with every bite.', price: 129, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.40.26 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Capsicum Pizza', category: 'pizza', description: 'Crunchy green capsicum on a golden hand-tossed base — light, fresh, and satisfyingly crisp.', price: 129, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.38.45 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Veg Pizza', category: 'pizza', description: 'The full garden experience — corn, onion & capsicum together on one cheesy hand-tossed base.', price: 149, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.44.06 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Paneer Pizza', category: 'pizza', description: 'Soft, pillowy paneer cubes on a cheesy base — rich, wholesome, and made for paneer lovers.', price: 149, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.50.59 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Paneer + Onion', category: 'pizza', description: 'The classic duo — paneer\'s richness balanced by the sweetness of caramelised onion on every slice.', price: 149, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.46.56 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Paneer + Capsicum', category: 'pizza', description: 'Paneer\'s creaminess meets capsicum\'s crunch — a fresh, vibrant combo that hits just right.', price: 159, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.47.48 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Paneer + Corn', category: 'pizza', description: 'Sweet corn pops alongside soft paneer — a match made for those who love texture in every bite.', price: 159, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.54.32 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Loaded Veg Pizza', category: 'pizza', description: 'Our ultimate loaded veg pizza — four flavours, one glorious hand-tossed base. No compromises.', price: 189, image: 'pizza_images/WhatsApp Image 2026-06-14 at 6.01.12 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Baby Corn Pizza', category: 'pizza', description: 'Tender baby corn — delicate, buttery, and beautifully different. A gourmet twist on the classic.', price: 229, image: 'pizza_images/WhatsApp Image 2026-06-14 at 5.59.41 PM.jpeg', tag: 'Hand Made Base' },
    { name: 'Extra Cheese Veg Pizza', category: 'pizza', description: 'Double the cheese, double the joy — our most indulgent veg pizza loaded till the last edge.', price: 239, image: 'pizza_images/WhatsApp Image 2026-06-14 at 6.02.57 PM.jpeg', tag: 'Hand Made Base' },
  ];

  for (const p of products) {
    await db.execute("INSERT INTO products (name, category, description, price, image, tag) VALUES (?, ?, ?, ?, ?, ?)",
      [p.name, p.category, p.description, p.price, p.image, p.tag]);
  }
}

module.exports = { initDb, getDb, getRows };
