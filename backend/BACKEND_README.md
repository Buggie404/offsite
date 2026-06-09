# Offsite Backend — Development Guide

> Hướng dẫn chi tiết cho team phát triển backend của dự án Offsite (your café, at home).
> 
> **Status:** Dự án đang trong giai đoạn phát triển  
> **Version:** 1.0.0  
> **Last Updated:** Tháng 6, 2026

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Prerequisites](#prerequisites)
3. [Folder Structure](#folder-structure)
4. [Running the Server](#running-the-server)
5. [API Endpoints](#api-endpoints)
6. [Database Collections](#database-collections)
7. [Authentication](#authentication)
8. [Troubleshooting](#troubleshooting)

---

## Tech Stack

**Backend Framework & Runtime**
- **Node.js** (v16.x hoặc cao hơn) — JavaScript runtime
- **Express.js** (v4.x) — Web framework, xử lý HTTP requests/responses
- **Morgan** — Logging middleware, ghi lại mỗi request

**Database**
- **MongoDB** — NoSQL document database
- **Mongoose** (không bắt buộc) — ODM (Object Data Modeling) library, nhưng trong scope này chưa dùng (sẽ dùng native MongoDB client)

**Environment & Configuration**
- **dotenv** — Load environment variables từ `.env` file

**API Design**
- **RESTful API** — HTTP methods: GET, POST, PUT, DELETE
- **JSON** — Format request/response body
- **CORS** — Cross-Origin Resource Sharing (cho frontend call API)

**Development Tools**
- **Nodemon** (dev dependency) — Auto-restart server khi file thay đổi

---

## Prerequisites

Trước khi bắt đầu, đảm bảo team của bạn đã cài:

### Yêu cầu bắt buộc

1. **Node.js & npm**
   - Download từ https://nodejs.org (khuyến nghị LTS version)
   - Verify: 
     ```bash
     node --version  # v16.x hoặc cao hơn
     npm --version   # v8.x hoặc cao hơn
     ```

2. **MongoDB**
   - **Local:** Download từ https://www.mongodb.com/try/download/community, cài và chạy
   - **Cloud (khuyến nghị cho team):** Dùng MongoDB Atlas (cloud service miễn phí)
     - Tạo account tại https://www.mongodb.com/cloud/atlas
     - Tạo cluster (tier M0 free)
     - Lấy connection string dạng: `mongodb+srv://username:password@cluster.mongodb.net/offsite?retryWrites=true&w=majority`

3. **Git**
   - Download từ https://git-scm.com

---

## Folder Structure

Dưới đây là cấu trúc folder backend và mục đích từng thư mục:

```
backend/
├── src/
│   ├── index.js                    ← Entry point (khởi động server)
│   ├── app.js                      ← Express app configuration
│   │
│   ├── routes/                     ← API routes definition
│   │   ├── auth.routes.js          ├─ Login, Register, Logout
│   │   ├── products.routes.js      ├─ Products CRUD, Listing
│   │   ├── orders.routes.js        ├─ Orders CRUD, Order history
│   │   ├── admin.routes.js         ├─ Admin functions (update status)
│   │   └── index.js                └─ Mount tất cả routes vào app
│   │
│   ├── controllers/                ← Business logic, request handling
│   │   ├── auth.controller.js      ├─ Register, Login logic
│   │   ├── products.controller.js  ├─ Product queries
│   │   ├── orders.controller.js    ├─ Order logic
│   │   └── admin.controller.js     └─ Admin logic
│   │
│   ├── models/                     ← (Optional) Data models / schemas
│   │   ├── User.js                 ├─ User schema definition
│   │   ├── Product.js              ├─ Product schema
│   │   └── Order.js                └─ Order schema
│   │
│   ├── middleware/                 ← Express middleware
│   │   ├── auth.middleware.js      ├─ Authentication check, role validation
│   │   ├── error.middleware.js     ├─ Error handling
│   │   └── validation.middleware.js└─ Input validation
│   │
│   ├── config/                     ← Configuration files
│   │   ├── db.js                   ├─ Database connection setup
│   │   └── constants.js            └─ App constants (error messages, status)
│   │
│   └── utils/                      ← Utility functions
│       ├── jwt.util.js             ├─ JWT token generation/validation
│       ├── response.util.js        ├─ Standard response formatting
│       └── validators.js           └─ Input validators
│
├── .env                            ← Environment variables (NOT in git)
├── .env.example                    ← Template for .env (in git)
├── .gitignore                      ← Git ignore rules
├── package.json                    ← Dependencies & scripts
├── package-lock.json               ← Locked dependency versions
└── README.md                       ← Documentation (file này)
```

### Mục đích từng thư mục

| Thư mục | Mục đích | Ghi chú |
|---|---|---|
| **routes/** | Định nghĩa API endpoints (URL paths) | Mỗi feature (auth, products, orders…) có file `.routes.js` riêng |
| **controllers/** | Xử lý business logic (những gì endpoint làm) | Mỗi route file nên có controller tương ứng |
| **models/** | Định nghĩa cấu trúc dữ liệu (schema) | Optional nếu dùng MongoDB raw client. Khuyến nghị để validate input |
| **middleware/** | Hàm chạy trước controller (auth, logging…) | Ví dụ: kiểm tra JWT token trước khi vào admin routes |
| **config/** | Setup database, constants, environment | Tập trung config tại một chỗ, dễ thay đổi |
| **utils/** | Helper functions tái dùng | Không phụ thuộc vào feature cụ thể nào |

### Naming Conventions (Quy tắc đặt tên)

**File naming:**
- Routes: `[feature].routes.js` — ví dụ: `products.routes.js`, `admin.routes.js`
- Controllers: `[feature].controller.js` — ví dụ: `products.controller.js`
- Models: `[Entity].js` (CamelCase) — ví dụ: `User.js`, `Product.js`
- Middleware: `[purpose].middleware.js` — ví dụ: `auth.middleware.js`
- Utils: `[purpose].js` hoặc `[purpose].util.js` — ví dụ: `jwt.util.js`

**Function naming:**
- Controller functions: camelCase, descriptive — ví dụ: `getAllProducts()`, `createOrder()`, `updateOrderStatus()`
- Route paths: kebab-case, RESTful — ví dụ: `/api/products`, `/api/orders/:id/status`
- Middleware names: camelCase — ví dụ: `authMiddleware()`, `validateInput()`

**Environment variables:**
- UPPERCASE with underscores — ví dụ: `MONGODB_URI`, `JWT_SECRET`, `PORT`

---

## Running the Server

### Setup lần đầu

```bash
# 1. Navigate vào backend folder
cd backend

# 2. Cài dependencies
npm install

# 3. Tạo .env file từ .env.example
cp .env.example .env

# 4. Edit .env với MongoDB connection string của bạn
# Mở file .env và thay:
#   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/offsite

# 5. Kiểm tra file .env có đúng không (không commit vào git!)
cat .env
```

### Run server

**Development mode (with auto-restart):**
```bash
npm run dev
```
- Server sẽ chạy tại `http://localhost:5000`
- Khi bạn sửa file, server tự động restart (nhờ Nodemon)

**Production mode:**
```bash
npm start
```
- Server chạy nhưng không auto-restart
- Dùng khi deploy lên production

### Verify server is running

Mở browser hoặc Postman, gọi:
```
GET http://localhost:5000/api/health
```

Response nên là:
```json
{
  "status": "Backend is running",
  "timestamp": "2026-06-09T10:30:00Z"
}
```

---

## API Endpoints

Offsite backend là RESTful API. Tất cả endpoints trả về JSON.

### Endpoint Structure

Cấu trúc một endpoint:
- **Method:** GET, POST, PUT, DELETE
- **Route:** `/api/[feature]/[resource]`
- **Authentication:** Một số endpoint cần JWT token trong header `Authorization: Bearer [token]`
- **Request body:** JSON (với POST/PUT)
- **Response body:** JSON object hoặc array

### Hiện tại có 4 nhóm endpoints

#### 1. Authentication Routes (`/api/auth`)

| Method | Endpoint | Purpose | Auth Required | Notes |
|---|---|---|---|---|
| POST | `/api/auth/register` | Đăng ký user mới | No | Body: email, password, name |
| POST | `/api/auth/login` | Đăng nhập | No | Body: email, password / sđt, password / oauth_provider |
| POST | `/api/auth/logout` | Đăng xuất | Yes | Xoá session |
| POST | `/api/auth/refresh` | Refresh JWT token | Yes | Token hết hạn → lấy cái mới |

**Example: Login**
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response 200:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "_id": "123abc",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "customer"
  }
}
```

#### 2. Products Routes (`/api/products`)

| Method | Endpoint | Purpose | Auth Required |
|---|---|---|---|
| GET | `/api/products` | Danh sách sản phẩm (có filter) | No |
| GET | `/api/products/:id` | Chi tiết 1 sản phẩm | No |

**Example: Get Products**
```
GET /api/products?category=matcha&pricing_tier=everyday_sip

Response 200:
{
  "total": 5,
  "data": [
    {
      "_id": "prod_001",
      "name": "Premium Ceremonial Matcha",
      "category": "matcha",
      "pricing_tier": "ritual_series",
      "price": 150000,
      "stock": 25,
      "rating_avg": 4.8,
      "images": [...]
    },
    ...
  ]
}
```

#### 3. Orders Routes (`/api/orders`)

| Method | Endpoint | Purpose | Auth Required |
|---|---|---|---|
| POST | `/api/orders` | Tạo đơn hàng mới | Yes |
| GET | `/api/orders/:id` | Chi tiết đơn hàng | Yes |
| GET | `/api/orders` | Lịch sử đơn (user của mình) | Yes |

**Example: Create Order**
```
POST /api/orders
Authorization: Bearer [token]
Content-Type: application/json

{
  "items": [
    {
      "product_id": "prod_001",
      "variant_id": "var_001",
      "quantity": 2,
      "price": 150000
    }
  ],
  "shipping_address": {
    "full_name": "John Doe",
    "phone": "0901234567",
    "street": "123 Nguyen Hue",
    "district": "District 1",
    "city": "HCMC"
  },
  "payment_method": "vnpay"
}

Response 201:
{
  "_id": "order_001",
  "order_code": "OFS-20260609-001",
  "status": "pending",
  "total": 300000,
  "created_at": "2026-06-09T10:30:00Z"
}
```

#### 4. Admin Routes (`/api/admin/orders`)

| Method | Endpoint | Purpose | Auth Required | Role Required |
|---|---|---|---|---|
| GET | `/api/admin/orders` | Xem tất cả đơn | Yes | Admin |
| PUT | `/api/admin/orders/:id/status` | Cập nhật status đơn | Yes | Admin |

**Example: Update Order Status**
```
PUT /api/admin/orders/order_001/status
Authorization: Bearer [admin_token]
Content-Type: application/json

{
  "status": "shipped",
  "tracking_number": "GHN-12345"
}

Response 200:
{
  "_id": "order_001",
  "status": "shipped",
  "updated_at": "2026-06-09T11:00:00Z"
}
```

### Cách thêm endpoint mới

Giả sử bạn cần thêm endpoint: `GET /api/products/:id/reviews`

**Step 1: Thêm route trong `src/routes/products.routes.js`**
```javascript
// src/routes/products.routes.js
const express = require('express');
const router = express.Router();
const productsController = require('../controllers/products.controller');

// Endpoint cũ
router.get('/', productsController.getAllProducts);
router.get('/:id', productsController.getProductById);

// Endpoint mới
router.get('/:id/reviews', productsController.getProductReviews);

module.exports = router;
```

**Step 2: Thêm controller function trong `src/controllers/products.controller.js`**
```javascript
// src/controllers/products.controller.js
const { getCollections } = require('../config/db');

async function getProductReviews(req, res) {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const { reviewCollection } = await getCollections();
    
    // Validate product exists
    const product = await getCollections().then(c => 
      c.productCollection.findOne({ _id: ObjectId(id) })
    );
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Query reviews
    const reviews = await reviewCollection
      .find({ product_id: ObjectId(id), status: 'approved' })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .toArray();

    const total = await reviewCollection.countDocuments({ 
      product_id: ObjectId(id), 
      status: 'approved' 
    });

    res.json({
      total,
      page,
      limit,
      data: reviews
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getProductReviews,
  // ... other functions
};
```

**Step 3: Test endpoint**
```bash
curl http://localhost:5000/api/products/prod_001/reviews?page=1&limit=5
```

### Standard Response Format

Tất cả response nên tuân theo cấu trúc này:

**Success (2xx):**
```json
{
  "data": { /* actual data */ },
  "message": "Operation successful"
}
```

**Error (4xx/5xx):**
```json
{
  "error": "Error message here",
  "code": "ERROR_CODE",
  "details": { /* additional info */ }
}
```

---

## Database Collections

Offsite dùng **MongoDB**, dữ liệu được seed sẵn (không có UI admin tạo dữ liệu).

### Collections Overview

| Collection | Purpose | Documents | Notes |
|---|---|---|---|
| **users** | User accounts (customers + admin) | ~100–1000 | email/phone unique |
| **products** | Sản phẩm (matcha, coffee, tools, drinkware) | ~50–200 | seed sẵn |
| **orders** | Đơn hàng của user | Unbounded | Order items là embed, không tách collection |
| **carts** | Giỏ hàng (guest + auth user) | ~100–1000 | TTL 30 ngày (auto-delete) |
| **coupons** | Mã giảm giá | ~20–50 | Admin tạo bằng MongoDB import |
| **reviews** | Đánh giá sản phẩm | Unbounded | Tách riêng vì cần paginate |
| **recipes** | Công thức pha (The Menu) | ~50–100 | seed sẵn |
| **blogs** | Bài viết (Journal) | ~20–50 | seed sẵn |
| **community_posts** | Bài viết cộng đồng | Unbounded | Tách riêng, cần moderation |
| **gift_shells** | Gift bundles | ~10–20 | seed sẵn |

### Cách làm việc với Database

#### Scenario 1: Thêm collection hoặc field mới

1. **Thêm field mới vào sản phẩm** (ví dụ: `origin_info`)
   - Thêm field vào schema file `src/models/Product.js` (nếu có)
   - Update controller function tương ứng để handle field mới
   - **Không cần migration** — MongoDB schema-less, new fields tự động

2. **Thêm collection hoàn toàn mới** (ví dụ: `subscriptions`)
   - Tạo file `src/models/Subscription.js` (schema definition)
   - Update `src/config/db.js` để add collection vào `getCollections()`:
     ```javascript
     subscriptionCollection: database.collection('Subscription')
     ```
   - Tạo routes/controllers mới

#### Scenario 2: Seed dữ liệu ban đầu

Dữ liệu được seed từ bên ngoài (Google Sheets → CSV → JSON import). Không có UI admin:

1. **Chuẩn bị dữ liệu** (CSV hoặc JSON)
   - Tạo file ở `backend/data/products.json`, `backend/data/recipes.json`, v.v.

2. **Tạo seed script** (`backend/seed.js`)
   ```javascript
   // backend/seed.js
   const { MongoClient } = require('mongodb');
   const productsData = require('./data/products.json');

   async function seed() {
     const client = new MongoClient(process.env.MONGODB_URI);
     try {
       await client.connect();
       const db = client.db('offsite');
       await db.collection('products').insertMany(productsData);
       console.log('Seed successful!');
     } finally {
       await client.close();
     }
   }

   seed();
   ```

3. **Chạy seed script**
   ```bash
   node seed.js
   ```

#### Scenario 3: Cập nhật dữ liệu có sẵn

Nếu cần cập nhật sản phẩm hoặc recipe:

1. **Cách dễ nhất: Dùng MongoDB Compass hoặc MongoDB Atlas UI**
   - Mở MongoDB Compass → kết nối → chọn database `offsite`
   - Tìm document → edit trực tiếp

2. **Qua API** (nếu có endpoint CRUD cho admin):
   ```bash
   PUT /api/products/:id
   {
     "stock": 50,
     "price": 200000
   }
   ```

#### Scenario 4: Kiểm tra dữ liệu hiện tại

```bash
# Dùng MongoDB Compass
# Hoặc từ terminal:

# Kết nối và list databases
mongo "mongodb+srv://username:password@cluster.mongodb.net/"

# Switch database
use offsite

# Show collections
show collections

# Count documents
db.products.countDocuments()

# Query một document
db.products.findOne({ _id: ObjectId("...") })

# Export collection ra JSON
mongoexport --uri "mongodb+srv://username:password@cluster.mongodb.net/offsite" \
  --collection products --out products.json
```

---

## Authentication

Offsite backend dùng **JWT (JSON Web Token)** để authenticate requests. Support 2 phương thức: Email/Password (with bcrypt hashing) và OAuth (Google, Facebook).

### 3.1 JWT Flow

```
1. User login (email/password hoặc OAuth) → POST /api/auth/login hoặc /api/auth/oauth/[provider]
   ↓
2. Server verify credentials / OAuth token → tạo JWT token
   ↓
3. Server trả JWT token cho client
   ↓
4. Client lưu token (localStorage / sessionStorage)
   ↓
5. Client gửi token trong header: Authorization: Bearer [token]
   ↓
6. Server middleware authMiddleware check token → nếu valid, xử lý request
```

### 3.2 Password Hashing (bcrypt)

**Packages:** `npm install bcrypt`

**Quy tắc:**
- ✅ Luôn hash mật khẩu trước khi lưu vào DB (không bao giờ lưu plain text)
- ✅ Dùng `bcrypt.hash()` khi register/reset password
- ✅ Dùng `bcrypt.compare()` khi login để so sánh plain password với hashed password
- ✅ Set `BCRYPT_ROUNDS=10` (cost factor, balance giữa security & performance)

**Implementation:**
```javascript
// Hash password on registration
const bcrypt = require('bcrypt');
const hashedPassword = await bcrypt.hash(plainPassword, 10);
// → Lưu hashedPassword vào DB

// Compare password on login
const isMatch = await bcrypt.compare(plainPassword, hashedPassword);
if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });
```

**Ghi chú:** Password phải validate strength (min 6–8 characters). Không hash password đã weak.

### 3.3 OAuth Integration (Google & Facebook)

**Packages:** `npm install passport passport-google-oauth20 passport-facebook express-session`

**Setup steps (high-level):**

1. **Google Cloud Console** (https://console.cloud.google.com/)
   - Create project → Enable Google+ API
   - Create OAuth 2.0 credentials (Web application type)
   - Add redirect URI: `http://localhost:4200/auth/callback/google` (local) + production URLs
   - Copy Client ID & Client Secret → `.env`

2. **Facebook Developers** (https://developers.facebook.com/)
   - Create app → Add Facebook Login product
   - Set redirect URI: `http://localhost:4200/auth/callback/facebook`
   - Copy App ID & App Secret → `.env`

3. **Backend Passport Config** (`src/config/passport.js`)
   - Initialize GoogleStrategy & FacebookStrategy
   - On OAuth success: find-or-create user (match by `oauth_providers.provider_id`)
   - OAuth users có `password_hash = null` (không cần password)
   - Serialize/deserialize user untuk session

4. **Backend Routes** (`src/routes/oauth.routes.js`)
   ```javascript
   // Initiate OAuth flow
   router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
   router.get('/facebook', passport.authenticate('facebook', { scope: ['email'] }));
   
   // Callback: on success, generate JWT token & redirect to frontend with token
   router.get('/google/callback', 
     passport.authenticate('google', { failureRedirect: '/login' }),
     (req, res) => {
       const token = jwt.sign({ user_id: req.user._id, ... }, JWT_SECRET);
       res.redirect(`http://localhost:4200/auth/success?token=${token}`);
     }
   );
   ```

5. **Frontend:** Click OAuth button → redirect to `/api/auth/oauth/[google|facebook]` → user logs in with provider → callback returns token → store in localStorage

**Security notes:**
- OAuth users không có password, chỉ link OAuth provider via `oauth_providers` array
- Nếu user có cả email+password account và OAuth account cùng email → merge (advanced, out-of-scope MVP)
- Validate CSRF state token trong callback (Passport handles automatically)

### 3.4 Middleware: Auth Check & RBAC

Tất cả protected routes phải qua middleware:

```javascript
// src/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer [token]"

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { user_id, email, role }
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// Role-based access (for admin routes)
function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
```

**Dùng trong routes:**
```javascript
router.get('/orders', authMiddleware, requireRole('admin'), adminController.getAllOrders);
```

### 3.5 Register & Login Flow

**Register:**
```javascript
async function register(req, res) {
  const { email, password, name } = req.body;
  
  // Validate: email unique, password strong (min 6–8 chars)
  const existing = await userCollection.findOne({ email });
  if (existing) return res.status(409).json({ error: 'Email exists' });

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user
  const result = await userCollection.insertOne({
    email, password_hash: hashedPassword, name,
    role: 'customer', status: 'active',
    oauth_providers: [], addresses: [], ...
  });

  // Generate & return JWT
  const token = jwt.sign({ user_id: result.insertedId, email, role: 'customer' }, JWT_SECRET);
  res.status(201).json({ token, user: { _id: result.insertedId, email, name } });
}
```

**Login:**
```javascript
async function login(req, res) {
  const { email, password } = req.body;
  
  const user = await userCollection.findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ user_id: user._id, email, role: user.role }, JWT_SECRET);
  res.json({ token, user: { _id: user._id, email, name: user.name } });
}
```

### 3.6 Environment Variables

```env
# JWT
JWT_SECRET=your-strong-random-key (use: openssl rand -base64 32)
JWT_EXPIRES_IN=8h

# Bcrypt
BCRYPT_ROUNDS=10

# OAuth Google
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_CALLBACK_URL=http://localhost:4200/auth/callback/google

# OAuth Facebook
FACEBOOK_APP_ID=xxx
FACEBOOK_APP_SECRET=xxx
FACEBOOK_CALLBACK_URL=http://localhost:4200/auth/callback/facebook

# Session (for Passport)
SESSION_SECRET=your-random-session-secret
```

**⚠️ Security checklist:**
- ✅ Never commit `.env` to git (use `.env.example` template)
- ✅ JWT_SECRET phải random & strong (generate: `openssl rand -base64 32`)
- ✅ Never log passwords hoặc sensitive tokens
- ✅ Use HTTPS in production (set `NODE_ENV=production`)
- ✅ Validate input & sanitize error messages (don't leak "user not found" vs "invalid password")
- ✅ Implement rate limiting on login attempts (prevent brute force)
- ✅ Token expiry: 8 hours for access token (short-lived), optional refresh token logic

---

## Troubleshooting

### Problem: Server không start

**Error:** `Error: listen EADDRINUSE :::5000`

**Nguyên nhân:** Port 5000 đang bị dùng bởi process khác

**Giải pháp:**
```bash
# Tìm process dùng port 5000
lsof -i :5000

# Kill process (ví dụ PID = 12345)
kill -9 12345

# Hoặc dùng port khác
PORT=5001 npm run dev
```

---

### Problem: MongoDB connection error

**Error:** `MongoNetworkError: connect ECONNREFUSED 127.0.0.1:27017`

**Nguyên nhân:** MongoDB local không chạy hoặc connection string sai

**Giải pháp:**

1. **Nếu dùng local MongoDB:**
   ```bash
   # Trên macOS (với Homebrew)
   brew services start mongodb-community
   
   # Trên Ubuntu
   sudo systemctl start mongod
   
   # Verify MongoDB chạy
   mongo --version
   ```

2. **Nếu dùng MongoDB Atlas (cloud):**
   - Kiểm tra `.env` có `MONGODB_URI` đúng không:
     ```
     MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/offsite?retryWrites=true&w=majority
     ```
   - Kiểm tra IP address whitelist trong MongoDB Atlas (thêm `0.0.0.0/0` để allow all)

---

### Problem: JWT token invalid

**Error:** `Invalid token` when calling protected endpoint

**Nguyên nhân:** Token hết hạn, malformed, hoặc JWT_SECRET sai

**Giải pháp:**

1. **Kiểm tra token format:**
   ```javascript
   // Token phải có format: "Bearer eyJhbGc..."
   // Không phải: "eyJhbGc..." (thiếu "Bearer " prefix)
   ```

2. **Kiểm tra JWT_SECRET:**
   ```bash
   # Verify JWT_SECRET trong .env khớp với code
   echo $JWT_SECRET
   ```

3. **Login lại để lấy token mới:**
   ```bash
   curl -X POST http://localhost:5000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password123"}'
   ```

---

### Problem: CORS error

**Error:** `Access to XMLHttpRequest at 'http://localhost:5000/api/products' from origin 'http://localhost:4200' has been blocked by CORS policy`

**Nguyên nhân:** Frontend (port 4200) gọi Backend (port 5000) bị block CORS

**Giải pháp:**

Verify CORS middleware trong `src/app.js`:
```javascript
const cors = require('cors');
app.use(cors({
  origin: 'http://localhost:4200',  // Frontend URL
  credentials: true
}));
```

Hoặc allow tất cả origins (development only):
```javascript
app.use(cors());
```

---

### Problem: 404 Not Found

**Error:** `Cannot POST /api/products` (404)

**Nguyên nhân:** Route không registered hoặc URL path sai

**Giải pháp:**

1. **Kiểm tra route file tồn tại:**
   ```bash
   ls src/routes/
   # Phải có: products.routes.js
   ```

2. **Kiểm tra route mount trong `src/app.js`:**
   ```javascript
   app.use('/api/products', require('./routes/products.routes'));
   ```

3. **Verify endpoint method:** 
   ```bash
   # Test GET endpoint
   curl http://localhost:5000/api/products
   
   # Test POST endpoint
   curl -X POST http://localhost:5000/api/orders
   ```

4. **Check logs:**
   - Morgan middleware sẽ in ra tất cả requests
   - Tìm request URL xem nó vào route nào

---

### Problem: Database query slow

**Nguyên nhân:** Thiếu index, query không optimal

**Giải pháp:**

1. **Tạo index cho fields thường query:**
   ```javascript
   // src/config/db.js
   async function createIndexes() {
     const { userCollection, productCollection, orderCollection } = await getCollections();
     
     await userCollection.createIndex({ email: 1 });
     await userCollection.createIndex({ phone: 1 });
     await productCollection.createIndex({ category: 1 });
     await productCollection.createIndex({ tags: 1 });
     await orderCollection.createIndex({ user_id: 1 });
     await orderCollection.createIndex({ status: 1 });
   }
   ```

2. **Dùng MongoDB Explain:**
   ```javascript
   // Check query plan
   db.products.find({ category: "matcha" }).explain("executionStats")
   ```

---

### Problem: Server crashes sau thay đổi file

**Error:** Server dừng đột ngột (Nodemon restart không hoạt động)

**Nguyên nhân:** Syntax error hoặc module không tìm thấy

**Giải pháp:**

1. **Kiểm tra logs:**
   ```bash
   npm run dev
   # Xem console output có error gì
   ```

2. **Verify file syntax:**
   ```bash
   # Check JavaScript syntax
   node -c src/app.js
   ```

3. **Check require path:**
   ```javascript
   // Phải relative path từ file hiện tại
   const controller = require('../controllers/products.controller');
   // Không phải
   // const controller = require('controllers/products.controller');
   ```

---

### Problem: Webhook không nhận

**Nguyên nhân:** Frontend có proxy, webhook URL sai, hoặc server không listening

**Giải pháp:**

1. **Verify webhook endpoint tồn tại:**
   ```bash
   curl -X POST http://localhost:5000/api/payments/webhook \
     -H "Content-Type: application/json" \
     -d '{"test": "data"}'
   ```

2. **Kiểm tra firewall:**
   ```bash
   # Verify port 5000 open
   netstat -an | grep 5000
   ```

3. **Check proxy config** (nếu dùng Nginx/Apache)

---

## Common Questions

**Q: Làm sao seed dữ liệu product ban đầu?**

A: Tạo file `backend/seed.js`, chạy `node seed.js`. Xem mục [Database Collections - Scenario 2](#scenario-2-seed-dữ-liệu-ban-đầu).

---

**Q: Có thể dùng Mongoose thay vì native MongoDB client không?**

A: Có, nhưng trong phase này dùng native MongoDB client (simple, no ODM overhead). Nếu schema validation phức tạp, có thể add Mongoose sau.

---

**Q: Admin subdomain (`admin.offsite.com`) vs path (`/admin`)?**

A: Hiện tại dùng path `/admin` (backend không quan tâm). Frontend sẽ handle routing.

---

**Q: Cần cache queries không?**

A: Không bắt buộc cho MVP. Nếu performance issue, dùng Redis. Thêm vào `/src/middleware/cache.middleware.js`.

---

**Q: Làm sao handle file upload (images)?**

A: Dùng Cloudinary (external service). Frontend upload → Cloudinary → trả URL → backend lưu URL vào database. Không store file trong backend.

---

## Quick Reference

```bash
# Cài dependencies
npm install

# Run dev
npm run dev

# Run prod
npm start

# Test endpoint
curl http://localhost:5000/api/health

# Check syntax
node -c src/app.js

# View logs
npm run dev 2>&1 | tee logs.txt
```
