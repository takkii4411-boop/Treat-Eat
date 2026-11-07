# Treat & Eat — Cake Shop Online Ordering

![Node](https://img.shields.io/badge/Node-20-green) ![Express](https://img.shields.io/badge/Express-4-blue) ![DB](https://img.shields.io/badge/LibSQL%2FTurso-sql.js-orange)

> Want something truly one-of-a-kind? We bring your vision to life — from theme cakes to photo cakes and beyond.

Full-stack **online ordering system** for a cake shop & bakery — catalog, cart, custom orders, admin panel.

## What it offers

- 🍰 **Product catalog** — categories + products with images (uploaded via admin)
- 🛒 **Cart** — add/update/remove items
- 👤 **Customer accounts** — register / login / session-based orders history
- 📦 **Order placement** — place orders, fetch order details
- 🧑‍💼 **Admin panel** — product & category management (`requireAdmin` protected), incoming orders view
- 💾 **Works offline** — local `data.db` (sql.js), or cloud **Turso/LibSQL** via env

## Install

**Requirement:** Node 18+ (tested on Node 20)

```bash
git clone https://github.com/takkii4411-boop/Treat-Eat.git
cd Treat-Eat
npm install
node server.js
```

Open → **http://localhost:3000**

### Optional cloud database (Turso)

```env
# in .env (project root)
TURSO_URL=libsql://your-db.turso.io
TURSO_TOKEN=your-token
# optional sync
TURSO_SYNC_URL=libsql://your-db-sync.turso.io
```

No env → automatically creates & uses local `data.db` (auto-initialized schema: users, categories, products, cart, orders).

## Usage manual

### Customer flow

| Step | Where | What to do |
|---|---|---|
| 1. Register | `POST /api/auth/register` | create account (name, email, password) |
| 2. Login | `POST /api/auth/login` | session cookie set |
| 3. Browse | `GET /api/products`, `GET /api/categories` | catalog listing |
| 4. Cart | `POST /api/cart/add` → `POST /api/cart/update` → `POST /api/cart/remove` | manage items |
| 5. Order | `POST /api/orders/place` | place the order |
| 6. History | `GET /api/orders`, `GET /api/orders/:id` | past orders |

### Admin flow

```http
POST /api/admin/products      # add product
POST /api/admin/categories    # add category
POST /api/admin/upload        # product image upload (multipart)
GET  /api/admin/orders        # incoming orders
GET  /api/admin/products      # manage catalog
```

Admin routes check the `is_admin` flag on the logged-in user.

### Auth endpoints

```http
POST /api/auth/register   POST /api/auth/login
POST /api/auth/logout     GET  /api/auth/me
```

## Project structure

```
Treat-Eat/
├── server.js         # Express app + API
├── db.js             # LibSQL/sql.js client + schema init
├── public/           # static frontend (shop UI, css, js)
├── images/ pizza_images/   # demo product photos
└── logo.png
```

## License

ISC
