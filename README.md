# Offsite — Your café, at home

Website thương mại điện tử bán cà phê, matcha, dụng cụ pha chế và bundle quà tặng. Đây là dự án **Web 2** của nhóm 6 người, nâng cấp từ Web 1. Ngoài mua hàng, site còn có cộng đồng (bài viết, công thức), journal (blog), theo dõi đơn hàng real-time và trang quản trị `admin`.

> **Đọc trước khi sửa code.** README này là nguồn chuẩn cho cấu trúc thư mục, quy tắc đặt tên, routing và commit. Chi tiết kiến trúc Angular (MVVM, styling) xem thêm [`frontend/README.md`](frontend/README.md).

**Cập nhật lần cuối:** 11/10/2026

---

## Mục lục

1. [Giới thiệu dự án](#1-giới-thiệu-dự-án)
2. [Chạy dự án local](#2-chạy-dự-án-local)
3. [Kiến trúc tổng quan](#3-kiến-trúc-tổng-quan)
4. [Cấu trúc thư mục](#4-cấu-trúc-thư-mục)
5. [Quy tắc đặt tên](#5-quy-tắc-đặt-tên)
6. [Routing](#6-routing)
7. [Tái cấu trúc Admin cho Web 2 ⚠️](#7-tái-cấu-trúc-admin-cho-web-2)
8. [Lưu ý khi code](#8-lưu-ý-khi-code)
9. [Lưu ý khi commit](#9-lưu-ý-khi-commit)
10. [Quy trình thêm chức năng](#10-quy-trình-thêm-chức-năng)
11. [Hướng dẫn cho AI assistant](#11-hướng-dẫn-cho-ai-assistant)
12. [Vấn đề đã biết & việc cần làm](#12-vấn-đề-đã-biết--việc-cần-làm)

---

## 📚 Tài liệu chi tiết

README này nêu cấu trúc, quy ước và quy trình chung. Hướng dẫn cụ thể cho frontend nằm trong [`frontend/README.md`](frontend/README.md):

| Cần biết | Xem ở `frontend/README.md` |
|---|---|
| Cấu trúc thư mục frontend chi tiết | [Folder Structure](frontend/README.md#folder-structure) |
| Mô hình MVVM và ví dụ code | [Architecture — MVVM](frontend/README.md#architecture--mvvm) |
| Các bước thêm feature mới | [How to Add a Feature](frontend/README.md#how-to-add-a-feature) |
| Gọi API, service, interceptor | [API Integration](frontend/README.md#api-integration) |
| Routing và guard | [Routing](frontend/README.md#routing) |
| SCSS, biến, breakpoint | [Styling](frontend/README.md#styling) |
| Pattern hay dùng: async pipe, reactive form, loading / error | [Common Tasks](frontend/README.md#common-tasks) |
| Lỗi thường gặp: ECONNREFUSED, NullInjectorError, SSR | [Troubleshooting](frontend/README.md#troubleshooting) |
| Lệnh `ng g`, build, format nhanh | [Quick Reference](frontend/README.md#quick-reference) |

> Khi hai tài liệu mâu thuẫn: **README này được ưu tiên** về cấu trúc, tên file và quy trình commit. Với cách viết code Angular cụ thể, xem `frontend/README.md`, nhưng một số chỗ trong đó còn cũ (xem mục 12 #16).

---

## 1. Giới thiệu dự án

**Offsite** — "Your café, at home". Nhắm tới khách hàng muốn có trải nghiệm café ngay tại nhà.

### Chức năng chính

| Nhóm | Chức năng | Thư mục frontend | Ghi chú |
|---|---|---|---|
| Trang chủ | Hero, best seller, new arrivals, collection, recipe, community, promo ticker | `features/home/` | |
| Shop | Danh mục (coffee, matcha, drinkware, tools, sets & bundles), chi tiết sản phẩm, quick view, build your bundle | `features/shop/` | Voucher kiểm tra từ backend |
| Mua hàng | Giỏ hàng, checkout, thanh toán QR (mô phỏng), xác nhận đơn, theo dõi đơn, đổi trả / hoàn tiền | `features/purchase/` | Trạng thái đơn cập nhật real-time |
| Tài khoản | Hồ sơ, sổ địa chỉ, đăng nhập / đăng ký, OAuth Google & Facebook | `features/account/`, `features/auth/` | |
| Nội dung | Recipes, journal (blog), about us, contact, policies | `features/content/` | |
| Cộng đồng | Feed, bài viết, công thức do người dùng tạo, bình luận, chia sẻ | `features/community/` | Upload ảnh qua Cloudinary |
| Admin | Quản lý đơn hàng, cập nhật vận chuyển, duyệt / từ chối hoàn tiền, ghi chú nội bộ | `admin/` (sẽ chuyển, xem mục 7) | Thông báo qua Socket.io |

### Tech stack

| Tầng | Công nghệ |
|---|---|
| Frontend | Angular 21 (SSR với `@angular/ssr`), TypeScript strict, RxJS, SCSS, lucide-angular |
| Backend | Node.js, Express 4, Mongoose 7 (MongoDB), Socket.io, Passport (Google / Facebook), JWT, bcrypt, multer, express-session |
| Dịch vụ ngoài | MongoDB (Atlas hoặc local), Cloudinary (upload ảnh từ trình duyệt), api.qrserver.com (tạo mã QR thanh toán demo) |

---

## 2. Chạy dự án local

### Yêu cầu

- **Node.js ≥ 20** (khuyến nghị bản LTS). Angular 21 không chạy trên Node 16.
- **npm ≥ 11**
- **MongoDB**: MongoDB Atlas (đám mây, có gói miễn phí) hoặc MongoDB Community chạy local (`mongodb://localhost:27017/offsite`).

### Các bước

```bash
# 1. Cài dependencies cho root, backend và frontend
npm run install-all

# 2. Tạo backend/.env  (KHÔNG commit file này)
#    Xin file .env từ leader. Các biến cần có:
#    PORT, MONGODB_URI, NODE_ENV,
#    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL,
#    FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_CALLBACK_URL,
#    BCRYPT_ROUNDS, MIN_PASSWORD_LENGTH, JWT_SECRET, SESSION_SECRET

# 3. Chạy backend + frontend cùng lúc
npm start
```

- Frontend: <http://localhost:4200>
- Backend API: <http://localhost:5000> — health check: <http://localhost:5000/api/health>
- Port backend lấy từ `PORT` trong `backend/.env` (mặc định `5000`). Giá trị này **phải khớp** với `frontend/src/proxy.conf.json`.

### Lệnh npm ở root

| Lệnh | Tác dụng |
|---|---|
| `npm run install-all` | Cài dependencies cho root, `backend/`, `frontend/` |
| `npm start` | Chạy backend (`nodemon`) và frontend (`ng serve`) |
| `npm run build` | Build backend (không cần) và frontend (`frontend/dist/`) |
| `npm run seed:admin` / `seed:reviews` / `seed:refund-requests` | ⚠️ Đang lỗi, file seed không có trong repo. Xem mục 12 |
| `npm run setup:env` | ⚠️ Đang lỗi, thiếu `backend/.env.example`. Xem mục 12 |

### Tài khoản test (chỉ dùng cho local / dev)

| Vai trò | Email | Mật khẩu | Ghi chú |
|---|---|---|---|
| Admin | `admin@offsite.vn` | `P@ssword123` | Trang quản trị `/admin` |
| Khách 1 | `customer1@offsite.vn` | `P@ssword123` | Nguyễn Văn A |
| Khách 2 | `customer2@offsite.vn` | `P@ssword123` | Trần Thị B |
| Khách 3 | `customer3@offsite.vn` | `P@ssword123` | Lê Văn C |

---

## 3. Kiến trúc tổng quan

```
Trình duyệt
   │
   │  HTTP  (dev: /api/* được proxy sang backend)
   ▼
Angular 21 + SSR  :4200 ──────────────────────►  Express API  :5000
                                                    │
                                                    ├──► Mongoose ──► MongoDB
                                                    ├──► Socket.io  (cập nhật trạng thái đơn real-time)
                                                    └──► Passport   (OAuth Google / Facebook)

Trình duyệt ──────────────────────────────────►  Cloudinary  (upload ảnh trực tiếp)
```

### Bảng mount route backend (`backend/src/app.js`)

| Prefix | File route | Ghi chú |
|---|---|---|
| `/api/auth` | `auth.routes.js` | Đăng ký, đăng nhập, đăng nhập admin, tài khoản, phương thức thanh toán, mục đã lưu (`/saved-items`, `/saved-products`, …) |
| `/api/auth/oauth` | `oauth.routes.js` | OAuth |
| `/api/cart` | `cart.routes.js` | Giỏ hàng (có `services/cart-merge.service.js`) |
| `/api/products` | `products.routes.js` | Sản phẩm |
| `/api/vouchers` | `vouchers.routes.js` | Voucher (có `services/voucher.service.js`) |
| `/api/orders` | `orders.routes.js` | Đơn hàng, thanh toán |
| `/api/order-tracking` | `order-tracking.routes.js` | Theo dõi đơn |
| `/api/reviews` | `reviews.routes.js` | Đánh giá sản phẩm |
| `/api/recipes` | `recipes.routes.js` | Công thức |
| `/api/blogs` | `blogs.routes.js` | Journal / blog |
| `/api/posts` | `posts.routes.js` | Bài viết cộng đồng |
| `/api/comments` | `comments.routes.js` | Bình luận |
| `/api/notifications` | `notifications.routes.js` | Thông báo |
| `/api/admin` | `admin.routes.js` | Quản trị (xem mục 7.7) |
| `/auth/callback/google`, `/auth/callback/facebook` | khai báo trực tiếp trong `app.js` | Redirect về `${CLIENT_URL}/oauth-success?token=...` |
| `/api/health` | khai báo trực tiếp trong `app.js` | Health check |

### Frontend theo mô hình MVVM

- **View** (`.html`): chỉ hiển thị, không chứa logic.
- **ViewModel** (`.ts` của component): giữ state, gọi service, không gọi HTTP trực tiếp.
- **Model** (`services/*.service.ts` + `models/*.model.ts`): gọi API, trả về Observable có kiểu rõ ràng.

---

## 4. Cấu trúc thư mục

### 4.1 Tổng quan

```
offsite/
├── README.md                     # File này
├── package.json                  # Script điều phối root (install-all, start, build)
├── .gitignore
│
├── backend/
│   ├── .env                      # Biến môi trường — KHÔNG commit
│   ├── package.json
│   ├── scripts/                  # Script chạy một lần (seed, sửa dữ liệu, migrate)
│   └── src/
│       ├── index.js              # Entry: dotenv, tạo HTTP server, init socket, connectDB
│       ├── app.js                # Express app: middleware, session, passport, mount route
│       ├── config/               # db.js (connectDB, getCollections), passport.js (OAuth)
│       ├── routes/               # <name>.routes.js — khai báo path + middleware
│       ├── controllers/          # <name>.controller.js — đọc request, trả response
│       ├── services/             # <name>.service.js — logic dùng lại (voucher, cart-merge, socket…)
│       ├── models/               # <Model>.js — Mongoose schema (PascalCase)
│       └── middleware/           # auth.middleware.js, optionalAuth.middleware.js
│
└── frontend/
    ├── angular.json, tsconfig*.json, package.json
    ├── .prettierrc, .editorconfig
    ├── set-env.js                # Chạy trước build (prebuild)
    ├── public/                   # favicon.ico
    └── src/
        ├── index.html, main.ts, main.server.ts, server.ts
        ├── proxy.conf.json       # Dev: /api → http://127.0.0.1:5000
        ├── styles.scss           # Import styles/
        ├── styles/               # global.scss, reset.scss, variables.scss
        ├── environments/         # environment.ts
        ├── assets/               # images/, icons/
        └── app/
            ├── app.routes.ts          # Route gốc + lazy load feature
            ├── app.routes.server.ts   # Render mode (SSR / Client) theo route
            ├── app.config.ts          # Provider của app (router, http, interceptor)
            ├── app.config.server.ts   # Provider riêng cho SSR
            │
            ├── core/                  # Singleton, dùng một lần cho cả app
            │   ├── auth.service.ts, auth-modal.service.ts, http.service.ts
            │   ├── guards/            # auth.guard.ts, admin.guard.ts, admin-guest.guard.ts
            │   ├── interceptors/      # auth.interceptor.ts
            │   └── services/          # order-socket.service.ts
            │
            ├── shared/                # Dùng chung cho ≥ 2 feature
            │   ├── components/        # navbar, footer, auth-modal, address-modal, confirmation-modal…
            │   ├── directives/        # animate-in-view, drag-scroll, parallax
            │   ├── models/            # product, recipe, user, voucher
            │   ├── services/          # toast, parallax-scroll
            │   ├── utils/             # inline-validator
            │   └── data/              # mock data
            │
            ├── admin/                 # ⚠️ Sẽ chuyển sang features/admin/ — xem mục 7
            │
            └── features/              # Mỗi thư mục = một cụm chức năng, lazy-load
                ├── account/           # Hồ sơ người dùng
                ├── auth/              # Đăng nhập, OAuth success
                ├── community/         # Feed, bài viết, công thức cộng đồng
                ├── content/           # Recipes, journal, about, contact, policy
                ├── home/              # Trang chủ
                ├── purchase/          # Giỏ hàng, checkout, thanh toán, đơn hàng
                └── shop/              # Danh mục, sản phẩm, bundle
```

### 4.2 Cấu trúc chuẩn của một feature (frontend)

```
features/<feature>/
├── <feature>-module.ts              # NgModule: wrapper để lazy-load
├── <feature>-routing-module.ts      # RouterModule.forChild(routes)
├── components/<ten>/                # Component con, dùng trong page (.ts, .html, .scss)
├── pages/<ten>/                     # Component được gắn trực tiếp vào route (.ts, .html, .scss)
├── services/<ten>.service.ts        # Gọi API của feature
└── models/<ten>.model.ts            # Interface / type của feature
```

**Cách chọn thư mục:**

| Bạn đang viết | Đặt ở |
|---|---|
| Component có route riêng (một URL) | `pages/<ten>/` |
| Component chỉ được page khác dùng | `components/<ten>/` |
| Gọi HTTP / xử lý dữ liệu | `services/` |
| Interface, type dữ liệu | `models/` (nếu dùng ở ≥ 2 feature → `shared/models/`) |
| Component dùng ở ≥ 2 feature | `shared/components/` |
| Hàm / hằng số thuần, không phụ thuộc Angular | `shared/utils/` |

### 4.3 Cấu trúc backend

Backend tổ chức **theo tầng** (không theo feature). Một endpoint mới thường có đủ các file tương ứng:

```
routes/<name>.routes.js  →  controllers/<name>.controller.js  →  services/<name>.service.js  →  models/<Model>.js
```

Chi tiết cách thêm endpoint: mục 10.2.

---

## 5. Quy tắc đặt tên

### 5.1 Frontend (Angular)

| Đối tượng | Quy tắc | Ví dụ đúng |
|---|---|---|
| Thư mục | `kebab-case` | `features/purchase/pages/order-detail/` |
| File component | `<ten>.component.ts / .html / .scss`, cùng tên, nằm trong thư mục cùng tên | `pages/checkout/checkout.component.ts` |
| Selector | `app-<ten>` | `app-product-card` |
| Class component | `PascalCase` + `Component` | `CheckoutComponent` |
| File service | `<ten>.service.ts` | `checkout.service.ts`, `admin-order.service.ts` |
| Class service | `PascalCase` + `Service` | `CheckoutService` |
| File model / interface | `<ten>.model.ts`, interface `PascalCase` | `admin-order.model.ts` → `AdminOrderListItem` |
| File type phụ trợ | `<ten>.types.ts` | `build-your-bundle.types.ts` |
| Guard | `<ten>.guard.ts`, hàm `<ten>Guard` | `auth.guard.ts` → `authGuard` |
| Interceptor | `<ten>.interceptor.ts`, hàm `<ten>Interceptor` | `auth.interceptor.ts` → `authInterceptor` |
| Module | `<feature>-module.ts`, class `<Feature>Module` | `shop-module.ts` → `ShopModule` |
| Routing module | `<feature>-routing-module.ts`, class `<Feature>RoutingModule` | `shop-routing-module.ts` |
| Test | `<ten>.spec.ts` | `inline-validator.spec.ts` |
| Biến, hàm, property | `camelCase`. Observable kết thúc bằng `$` | `products$`, `loadOrders()` |
| Hằng số | `UPPER_SNAKE_CASE` | `THIRD_PARTY_DOMAINS` |
| Route path (URL) | `kebab-case`, tiếng Anh, không dấu | `/checkout/payment-qr`, `/shop/build-your-bundle` |
| Class CSS | `kebab-case` | `.product-title` |

### 5.2 Backend (Node / Express)

| Đối tượng | Quy tắc | Ví dụ đúng |
|---|---|---|
| File route | `<ten>.routes.js`, `kebab-case` | `order-tracking.routes.js` |
| File controller | `<ten>.controller.js`, `kebab-case` | `order-tracking.controller.js` |
| File service | `<ten>.service.js`, `kebab-case` | `voucher.service.js` |
| File middleware | `<ten>.middleware.js` | `auth.middleware.js` |
| File model | `<Model>.js`, `PascalCase`, số ít | `Order.js`, `RefundRequest.js` |
| File script | `kebab-case.js` trong `scripts/` | `update-product-stock.js` |
| Đường dẫn API | `/api/<tài-nguyên>`, số nhiều, `kebab-case` | `/api/order-tracking`, `/api/admin/orders/:id/refund/approve` |
| Biến, hàm | `camelCase` | `getAllOrders` |
| Field trong Mongoose schema | Giữ đúng quy ước của model đang có | `payment_status`, `order_status` |

> Ngoại lệ đã có sẵn: model dùng `PascalCase` trong khi các file khác dùng `kebab-case`. Giữ nguyên cho model.

### 5.3 Quy tắc chung

- Viết tên bằng tiếng Anh, không dấu. Tên hiển thị cho người dùng (nội dung, nút bấm) mới dùng tiếng Việt.
- Tên file phải nói được nó chứa gì. Tránh `utils2.ts`, `temp.ts`, `new-page.ts`.
- Khi chạm vào file có tên theo quy ước cũ (mục 12), đổi về chuẩn trong cùng commit đó.

---

## 6. Routing

### 6.1 Ba quy tắc

1. **`app.routes.ts` chỉ chứa route cấp gốc** và các `loadChildren` / `loadComponent` trỏ tới feature.
2. **Feature mới khai báo route trong `<feature>-routing-module.ts`**, rồi được nạp bằng `loadChildren` từ `app.routes.ts`.
3. **Route mới có cần SSR hay Client-only?** Thêm vào `app.routes.server.ts`. Nếu không khai báo, route rơi vào `**` và chạy ở chế độ Client.

### 6.2 Trạng thái hiện tại

| Feature | Cách khai báo route | Đánh giá |
|---|---|---|
| `account` | `account-routing-module.ts` (`''`), nạp qua `loadChildren`, có `authGuard` | ✅ Đúng chuẩn |
| `community` | `community-routing-module.ts` (`''`, `post/:id`), nạp qua `loadChildren` | ✅ Đúng chuẩn |
| `admin` | `admin-routing-module.ts` (login, layout, orders), nạp qua `loadChildren` | ✅ Đúng chuẩn, cần chuyển thư mục (mục 7) |
| `auth` | `auth-routing.module.ts` có route `login`, nhưng **không được nạp** từ `app.routes.ts` | ⚠️ Kiểm tra (mục 12) |
| `home`, `shop`, `purchase`, `content` | Routing module rỗng. Route khai báo trực tiếp trong `app.routes.ts` | ⚠️ Legacy. Chuyển dần khi chạm vào |

**Quy tắc khi làm việc với legacy:** nếu thêm route vào `home`, `shop`, `purchase` hoặc `content`, thêm vào `app.routes.ts` theo đúng kiểu hiện có. Không tự ý chuyển cả feature trong một commit không liên quan.

### 6.3 Thứ tự route quan trọng

- `shop/build-your-bundle` phải đứng **trước** `shop/:category`, nếu không `build-your-bundle` sẽ bị bắt như một category.
- `products/best-seller`, `shop/best-sellers` là redirect. Không gỡ.
- Route `checkout/pending`, `checkout/canceled`, `checkout/processing`, `checkout/shipping`, `checkout/delivered`, `checkout/refund` đều dùng chung `OrderDetailComponent`. Component đọc trạng thái từ URL.
- Route `**` (404) luôn đứng **cuối cùng**.

### 6.4 Guard

| Guard | File | Áp dụng cho | Hành vi |
|---|---|---|---|
| `authGuard` | `core/guards/auth.guard.ts` | `/account` | Chưa đăng nhập → không cho vào |
| `adminGuard` | `core/guards/admin.guard.ts` | Layout admin (`''` trong admin routing) | Chưa đăng nhập admin → `/admin/login` |
| `adminGuestGuard` | `core/guards/admin-guest.guard.ts` | `/admin/login` | Đã đăng nhập admin → `/admin/orders` |

### 6.5 URL admin phải giữ ổn định

Các URL sau được **hardcode** ở nhiều file (layout, sign-in, not-found, order-detail, cả hai guard):

- `/admin/login`
- `/admin/orders`
- `/admin/orders/:id`
- `/admin/404`

**Không đổi các URL này** nếu không có yêu cầu rõ ràng. Nếu buộc phải đổi, chạy `grep -rn "/admin/" frontend/src` và cập nhật tất cả chỗ dùng.

---

## 7. Tái cấu trúc Admin cho Web 2 ⚠️

> **Trạng thái: CHƯA THỰC HIỆN.** Mục này là kế hoạch để người làm sau biết cần làm gì và phải lưu ý gì. Khi hoàn thành, đánh dấu `[x]` và cập nhật mục 4 và 6.2.

### 7.1 Vì sao phải làm

Web 2 bổ sung **nhiều chức năng cho admin**, không chỉ quản lý đơn như Web 1. Admin hiện nằm ở `src/app/admin/`, **ngoài** cấu trúc `features/` của phần còn lại trong app, nên:

- Thành viên làm admin cho cụm của mình không biết nên đặt file ở đâu.
- Routing của admin khác với các feature, dễ nhầm khi thêm route.
- Bối cảnh Web 2: mỗi thành viên phụ trách **cả phần user lẫn admin** của cụm feature mình. Admin cần được tổ chức theo cùng logic đó.

### 7.2 Hiện trạng (22 file)

```
src/app/admin/
├── admin-module.ts
├── admin-routing-module.ts          # /login (adminGuestGuard), '' (adminGuard) → orders, orders/:id, 404
├── components/
│   └── admin-layout/                # Khung giao diện admin (sidebar, header)
├── models/
│   └── admin-order.model.ts
├── pages/
│   ├── sign-in/
│   ├── orders-listing/
│   ├── order-detail/
│   └── not-found/
└── services/
    ├── admin-auth.service.ts
    ├── admin-order.service.ts
    ├── admin-notification.service.ts
    └── admin-refresh.service.ts
```

Admin đã gần đúng cấu trúc feature về bên trong. Chỗ khác biệt chính là **vị trí** (`app/admin/` thay vì `app/features/admin/`) và **chưa có quy tắc tách theo cụm** khi mở rộng.

### 7.3 Giai đoạn 1: chuyển vị trí, giữ nguyên bên trong

Đích đến:

```
src/app/features/admin/
├── admin-module.ts
├── admin-routing-module.ts
├── components/admin-layout/
├── models/
├── pages/
└── services/
```

Giai đoạn này **chỉ đổi đường dẫn và import**. Không đổi logic, không đổi URL, không đổi tên class.

#### Checklist giai đoạn 1 (làm trong một commit riêng)

- [ ] **Di chuyển thư mục bằng `git mv`** để giữ lịch sử:
  ```bash
  git mv frontend/src/app/admin frontend/src/app/features/admin
  ```
- [ ] **Sửa import đi ra ngoài thư mục admin.** File admin nằm sâu hơn một cấp nên mọi import trỏ ra ngoài `admin/` phải thêm đúng một `../`.
  - `../core/guards/admin.guard` → `../../core/guards/admin.guard` (ở `admin-routing-module.ts`)
  - `../../../core/services/order-socket.service` → `../../../../core/services/order-socket.service` (ở `pages/order-detail/`)
  - Import **nội bộ** trong admin (ví dụ `../../services/admin-order.service`) **giữ nguyên**.
- [ ] **`app/app.routes.ts`:** đổi `import('./admin/admin-module')` thành `import('./features/admin/admin-module')`. Giữ nguyên `path: 'admin'`.
- [ ] **Guard và interceptor** dùng `AdminAuthService` ở đường dẫn cũ. Đổi `../../admin/services/admin-auth.service` thành `../../features/admin/services/admin-auth.service` trong:
  - `core/guards/admin.guard.ts`
  - `core/guards/admin-guest.guard.ts`
  - `core/interceptors/auth.interceptor.ts`
- [ ] **Không đổi URL** `/admin/...` (mục 6.5).
- [ ] **`app.routes.server.ts`:** giữ nguyên `admin/**` với `RenderMode.Client`. URL không đổi nên không cần sửa.
- [ ] **`admin-routing-module.ts`:** các đường dẫn `./pages/...` và `./components/...` vẫn đúng vì cùng cấp. Không cần sửa.
- [ ] **Kiểm tra sót đường dẫn cũ:**
  ```bash
  grep -rn "admin/services\|admin/pages\|admin/components\|admin/models\|admin/admin-module" frontend/src
  ```
  Kết quả phải rỗng.
- [ ] **Build:** `cd frontend && npx ng build` phải pass.
- [ ] **Test thủ công:** đăng nhập admin, danh sách đơn, lọc theo trạng thái, chi tiết đơn, cập nhật trạng thái, duyệt / từ chối hoàn tiền, thông báo real-time, đăng xuất, và guard (vào `/admin/orders` khi chưa đăng nhập phải về `/admin/login`).
- [ ] **Cập nhật tài liệu:** mục 4.1, mục 6.2 và mục 12 của README này.

### 7.4 Giai đoạn 2: tách theo cụm (cần team chốt trước)

Khi mỗi thành viên làm admin cho cụm của mình, tách theo cụm để khớp với cách chia feature:

```
features/admin/
├── admin-module.ts                  # Gom toàn bộ admin
├── admin-routing-module.ts          # Layout + guard + loadChildren từng cụm
├── components/admin-layout/         # Dùng chung cho mọi cụm
├── services/                        # Service dùng chung (admin-auth, admin-refresh, admin-notification)
├── models/                          # Model dùng chung (ví dụ AdminOrderListItem)
│
├── purchase/                        # Cụm đơn hàng, hoàn tiền (tên trùng feature tương ứng)
│   ├── pages/
│   ├── components/
│   ├── services/
│   └── models/
├── shop/                            # Ví dụ: quản lý sản phẩm
├── content/                         # Ví dụ: quản lý recipe, blog
└── community/                       # Ví dụ: kiểm duyệt bài viết
```

**Quy tắc đặt tên cụm:** tên thư mục cụm trùng với tên feature tương ứng để dễ đối chiếu. Cụm admin của `purchase` nằm ở `features/admin/purchase/`.

> ❓ **Quyết định cần chốt với team:** (a) tách theo cụm như trên, hay (b) giữ một admin phẳng, mọi page nằm trong `features/admin/pages/`. Ghi quyết định vào mục này khi đã chốt.

#### Checklist giai đoạn 2

- [ ] Chốt phương án (a) hoặc (b) với team, ghi vào mục này.
- [ ] Mỗi cụm tạo đủ `pages/`, `components/`, `services/`, `models/` theo quy tắc mục 5.
- [ ] Route admin mới được thêm vào `children` của route layout `''` trong `admin-routing-module.ts`. Giữ `canActivate: [adminGuard]` và dùng `loadComponent` như hiện tại.
- [ ] Nếu một cụm có nhiều route, tạo `<cum>/<cum>-admin-routing-module.ts` và nạp bằng `loadChildren` từ `admin-routing-module.ts`.
- [ ] Route `**` → `404` luôn đứng cuối trong `children`.
- [ ] Không import chéo giữa các cụm admin. Thứ dùng chung đưa vào `features/admin/services/` hoặc `features/admin/models/`.
- [ ] Mỗi cụm có endpoint backend tương ứng (mục 7.5).

### 7.5 Backend admin

Hiện tại backend tổ chức theo tầng: `routes/admin.routes.js` và `controllers/admin.controller.js` (**612 dòng**). Khi admin mở rộng, đề xuất:

- Tách controller theo cụm: `controllers/admin-<cum>.controller.js` và route tương ứng `routes/admin-<cum>.routes.js`. Ví dụ: `admin-orders.controller.js`.
- `routes/admin.routes.js` trở thành điểm gom:
  ```js
  router.post('/login', authController.adminLogin);           // public, đặt TRƯỚC middleware
  router.use(authMiddleware, requireRole('admin'));           // áp dụng cho mọi route bên dưới
  router.use('/orders', require('./admin-orders.routes'));
  ```
  Hiện mỗi dòng đang lặp lại `authMiddleware, requireRole('admin')`. Gom một lần để không quên khi thêm route mới.
- Giữ nguyên mount `/api/admin` trong `app.js`.
- Route login phải nằm **trước** `router.use(authMiddleware, ...)`, nếu không sẽ chặn luôn cả việc đăng nhập.

---

## 8. Lưu ý khi code

### 8.1 Frontend (Angular)

- **TypeScript strict** đang bật (`strict`, `strictTemplates`). Không dùng `any`. Khai báo kiểu cho service, model, input và output.
- **Component là standalone** (mặc định của Angular 21). Module của feature chỉ là wrapper và routing, không khai báo component vào `declarations`.
- **Không gọi `HttpClient` trong component.** Đặt trong `services/`. Component chỉ gọi service và nhận Observable (MVVM, xem mục 3).
- **Dùng `inject()`** cho dependency, theo mẫu trong `frontend/README.md`.
- **Quản lý subscription:** ưu tiên `async` pipe. Nếu phải subscribe thủ công, dùng `takeUntilDestroyed()`.
- **SSR:** không truy cập `localStorage`, `window`, `document` trực tiếp khi render phía server. Bọc bằng `isPlatformBrowser(platformId)`. Repo đang dùng `localStorage` ở nhiều file (auth, cart, checkout, order-tracking, account, navbar…). Khi sửa các file này, kiểm tra lại điều kiện này. Xem [Troubleshooting](frontend/README.md#troubleshooting) mục 3.
- **URL API:** dùng đường dẫn tương đối `/api/...` (dev proxy sang backend qua `proxy.conf.json`). **Không hardcode** `http://localhost:5000` trong code. Nếu cần base URL, lấy từ `environments/environment.ts`.
- **Token:** chỉ thao tác qua `AuthService` (người dùng) và `AdminAuthService` (admin). Không đọc/ghi key token trong `localStorage` từ component. Interceptor tự đính kèm Bearer token.
- **Upload ảnh:** đi qua `CloudinaryService` (`features/community/services/`). Không gọi trực tiếp API Cloudinary từ component.
- **Style:** SCSS theo component (`:host` để scope). Dùng biến và mixin trong `styles/variables.scss` và `styles/global.scss`. Không hardcode màu lặp lại ở nhiều file. Chi tiết: [Styling](frontend/README.md#styling).
- **Format:** Prettier (`.prettierrc`: `printWidth` 100, single quote). EditorConfig: 2 khoảng trắng, UTF-8, có dòng trống cuối file.
- **Dùng chung:** đưa vào `shared/` khi ≥ 2 feature cùng dùng. **Không import trực tiếp giữa các feature** (ví dụ `features/home/` không import từ `features/shop/`). Cụm càng độc lập, khi ghép Web 2 càng ít xung đột.
- **Không để `console.log` debug** trong code được commit.
- **Không tạo file trống** làm placeholder (xem mục 12).

### 8.2 Backend (Node / Express)

- **Phân tầng rõ ràng:** `routes` (chỉ khai báo path và middleware) → `controllers` (đọc request, gọi service / model, trả response) → `services` (logic dùng lại) → `models` (Mongoose). Không viết truy vấn DB trực tiếp trong route.
- **Middleware xác thực:**
  - Route cần đăng nhập: `authMiddleware`.
  - Route admin: `authMiddleware` + `requireRole('admin')`.
  - Route cho phép cả khách và người đã đăng nhập: `optionalAuthMiddleware`.
- **Secret và cấu hình** đọc từ `process.env`. Không in giá trị ra log. Không commit `.env`.
- ⚠️ `backend/src/app.js` đang có fallback `'your-secret-key'` và `'fallback-secret-key'`. **Phải bỏ trước khi deploy production**, để app lỗi rõ ràng nếu thiếu biến môi trường.
- **Không trả password hay hash** trong response. Khi trả User, loại field nhạy cảm trước.
- **Lỗi:** bọc trong `try/catch` ở controller. Trả về theo format đang dùng trong các controller hiện có (`res.status(code).json({ ... })`), không tự nghĩ format mới.
- **Validate input** trước khi ghi DB, ví dụ kiểm tra `_id` hợp lệ bằng `mongoose.isValidObjectId()`.
- **Endpoint mới** phải được mount trong `app.js` (nếu là file route mới) và cập nhật bảng mục 3.
- **Script chạy một lần** (seed, sửa dữ liệu, migrate) đặt trong `backend/scripts/`, không để ở root `backend/`.

### 8.3 Dữ liệu

- **Giữ quy ước tên field của model hiện có** (ví dụ `payment_status`, `order_status`). Không đổi tên hàng loạt khi chưa có kế hoạch migrate.
- **Thay đổi schema** ảnh hưởng dữ liệu cũ → viết script migrate trong `backend/scripts/` và ghi rõ cách chạy trong commit message.

---

## 9. Lưu ý khi commit

### 9.1 Không được commit

| Đối tượng | Lý do | Trạng thái |
|---|---|---|
| `backend/.env` | Chứa secret | Đã ignore |
| `node_modules/` | Dependencies | Đã ignore |
| `frontend/dist/`, `frontend/.angular/`, `backend/dist/`, `dist/`, `build/` | Build output | Đã ignore |
| `.DS_Store` | File hệ thống macOS | Đã ignore |
| `.claude/` | Cấu hình cá nhân của máy | ⚠️ **Chưa ignore**. Thêm vào `.gitignore` |
| `Claude outputs/` | File zip ~9 MB, bản nháp UI | ⚠️ **Chưa ignore**. Thêm vào `.gitignore` |
| `walkthrough.md` trong `src/` | Ghi chú phát triển, không phải code | ⚠️ Chuyển ra `docs/` hoặc xóa (mục 12) |

### 9.2 Quy ước commit message

Lịch sử hiện tại không có chuẩn thống nhất (lẫn "fix", "chỉnh", "update", "adjust", tiếng Việt và tiếng Anh). **Từ đây dùng Conventional Commits.** Đây là đề xuất, nhóm cần thống nhất khi review:

```
<type>(<scope>): <mô tả ngắn, dạng mệnh lệnh>

<thân commit, không bắt buộc: giải thích VÌ SAO thay đổi>
```

| `type` | Dùng khi |
|---|---|
| `feat` | Thêm chức năng |
| `fix` | Sửa lỗi |
| `refactor` | Đổi cấu trúc hoặc tên, không đổi hành vi (ví dụ chuyển admin) |
| `style` | Chỉ đổi CSS hoặc format |
| `docs` | README, tài liệu |
| `chore` | Cấu hình, dependency, `.gitignore` |
| `test` | Thêm hoặc sửa test |

**`scope`** là tên feature hoặc tầng: `home`, `shop`, `purchase`, `account`, `auth`, `content`, `community`, `admin`, `backend`, `core`, `shared`.

Ví dụ:

```
feat(purchase): add QR payment countdown and failure handling
fix(admin): refresh order list after status update
refactor(admin): move admin module into features/admin
docs: rewrite root README with structure and naming rules
```

- Dòng tiêu đề tối đa **72 ký tự**, không có dấu chấm cuối.
- Mô tả trong cùng một commit dùng **một ngôn ngữ** (Anh hoặc Việt), không trộn.

### 9.3 Nhánh và quy trình

- Nhánh chính: `main`. Remote: `origin` → `github.com/Buggie404/offsite`.
- Nhánh làm việc đặt theo type và scope: `feat/<scope>-<mo-ta>`, `fix/<scope>-<mo-ta>`, `refactor/<scope>-<mo-ta>`.
- **Mỗi commit một mục đích.** Không gộp refactor với feature. Ví dụ chuyển admin (mục 7.3) phải là commit riêng.
- **Trước khi commit:**
  1. `git status`: chỉ có file liên quan đến thay đổi.
  2. Nếu sửa frontend: `cd frontend && npx ng build` phải pass.
  3. Nếu sửa backend: kiểm tra cú pháp `node --check <file>`, sau đó `npm start` và mở `/api/health`.
  4. Không còn `console.log` debug, không có secret trong code.
- **Không `git push --force` lên `main`.**

---

## 10. Quy trình thêm chức năng

### 10.1 Thêm feature mới (frontend)

1. **Tạo khung thư mục** `src/app/features/<feature>/` với `<feature>-module.ts`, `<feature>-routing-module.ts`, `components/`, `pages/`, `services/`, `models/` (mục 4.2). Xem thêm [How to Add a Feature](frontend/README.md#how-to-add-a-feature).
2. **Tạo page:**
   ```bash
   cd frontend
   npx ng generate component features/<feature>/pages/<ten>
   ```
   Đổi tên file theo mục 5 nếu CLI tạo khác quy ước.
3. **Khai báo route** trong `<feature>-routing-module.ts` (xem [Routing](frontend/README.md#routing)):
   ```ts
   const routes: Routes = [
     { path: '', component: <Ten>Component }
   ];
   ```
4. **Nạp lazy trong `app.routes.ts`:**
   ```ts
   {
     path: '<feature>',
     loadChildren: () =>
       import('./features/<feature>/<feature>-module').then(m => m.<Feature>Module)
   }
   ```
5. **SSR / Client:** nếu route có tham số động hoặc cần render phía server, thêm vào `app.routes.server.ts`.
6. **Service:** tạo `services/<ten>.service.ts` với `@Injectable({ providedIn: 'root' })`. Xem [API Integration](frontend/README.md#api-integration).
7. **Model:** tạo `models/<ten>.model.ts`.
8. **Kiểm tra:** `npx ng build` pass, `npm start` và thử luồng trên trình duyệt.
9. **Commit** theo mục 9.

### 10.2 Thêm endpoint backend

1. **Model** (nếu cần dữ liệu mới): `backend/src/models/<Model>.js`.
2. **Service** (nếu logic phức tạp hoặc dùng lại): `backend/src/services/<ten>.service.js`.
3. **Controller:** `backend/src/controllers/<ten>.controller.js`.
4. **Route:** `backend/src/routes/<ten>.routes.js`, gắn middleware xác thực đúng mục 8.2.
5. **Mount** trong `backend/src/app.js` (nếu là file route mới).
6. **Test** bằng Postman hoặc `curl`.
7. **Cập nhật** bảng mount ở mục 3.

### 10.3 Thêm chức năng admin

Admin đang trong giai đoạn chuyển (mục 7). Khi chuyển xong, làm theo mục 10.1 nhưng đặt trong `features/admin/` (hoặc `features/admin/<cum>/` nếu đã chốt tách cụm). Route thêm vào `admin-routing-module.ts` dưới layout `''` có `adminGuard`.

---

## 11. Hướng dẫn cho AI assistant

Phần này dành cho AI (Claude, Copilot, …) khi đọc repo để sửa code. Người đọc cũng nên tuân theo.

1. **Đọc README này và `frontend/README.md` trước khi sửa.** Cấu trúc và tên chuẩn nằm ở mục 4, 5 và 6.
2. **Chọn thư mục theo vai trò:** component có route → `pages/`, component con → `components/`, gọi API → `services/`, kiểu dữ liệu → `models/`, dùng chung ≥ 2 feature → `shared/`.
3. **Không đổi URL route** (đặc biệt `/admin/*`) nếu không được yêu cầu. Nếu buộc phải đổi, `grep` toàn bộ `frontend/src` và cập nhật mọi chỗ dùng.
4. **Khi di chuyển file:** dùng `git mv`, sau đó `grep` đường dẫn cũ, sửa import, rồi build để xác nhận.
5. **Không tạo file trống hoặc placeholder.** Không thêm `declarations` vào feature module.
6. **Không đọc, in hoặc commit giá trị trong `backend/.env`.**
7. **Không commit hoặc push** khi người dùng chưa yêu cầu.
8. **Không sửa** `node_modules/`, `dist/`, `.angular/`.
9. **Sau khi sửa frontend:** `cd frontend && npx ng build`. **Sau khi sửa backend:** `node --check <file>` và kiểm tra `GET /api/health`.
10. **Khi chưa chắc quy ước** (ví dụ admin có tách theo cụm không), hỏi người dùng thay vì tự quyết. Ghi quyết định vào mục 7.
11. **Code cũ có thể không theo chuẩn** (mục 12). Không bắt chước code legacy khi viết code mới. Viết mới thì theo mục 5.
12. **Thông tin trong mục 12** là các vấn đề đã biết. Không tự ý sửa hàng loạt. Chỉ sửa khi việc đó nằm trong yêu cầu hiện tại.

---

## 12. Vấn đề đã biết & việc cần làm

| # | Vấn đề | Vị trí | Hướng xử lý |
|---|---|---|---|
| 1 | Script seed khai báo nhưng file không tồn tại: `seed_admin.js`, `seed_reviews.js`, `seed_refund_requests.js` | `package.json` (root và `backend/`) | Khôi phục file từ máy đồng đội hoặc xóa script |
| 2 | `setup:env` đọc `backend/.env.example`, nhưng file không có trong repo | `package.json` (root) | Tạo `backend/.env.example` với tên biến và giá trị placeholder, **không có secret thật** |
| 3 | Module `auth` không được nạp ở `app.routes.ts` | `features/auth/auth.module.ts`, `auth-routing.module.ts` | Xác nhận có dùng không. Nếu không, xóa. Nếu có, nạp đúng và đổi tên theo mục 5 (`auth-module.ts`, `auth-routing-module.ts`) |
| 4 | File trống làm placeholder | `features/shop/components/product-card/product-card.ts` | Xóa. Component thật nằm ở `product-card.component.ts` |
| 5 | File component nằm ngoài thư mục con | `features/shop/pages/listing.component.ts` | Chuyển vào `pages/listing/listing.component.ts` |
| 6 | Sai tên file (thừa chữ `s`) | `shared/components/success-modal/success-modal.components.ts` | Đổi thành `success-modal.component.ts` và sửa import |
| 7 | Model trùng lặp | `features/home/models/product.model.ts` trùng `shared/models/product.model.ts` | Hợp nhất vào `shared/models/` |
| 8 | Ghi chú phát triển nằm trong `src/` | `features/purchase/walkthrough.md`, `features/purchase/pages/payment-qr/walkthrough.md` | Chuyển ra `docs/` ở root hoặc xóa |
| 9 | Script migrate nằm ở root backend | `backend/migrate_comment_author.js`, `backend/migrate_post_author.js` | Chuyển vào `backend/scripts/` |
| 10 | Trùng logic: `saved-items.controller.js` không được require ở đâu, trong khi logic mục đã lưu thực tế nằm trong `auth.controller.js` (`getSavedItems`, `toggleSaved*`, `deleteSavedItemsBatch`) | `backend/src/controllers/saved-items.controller.js`, `backend/src/controllers/auth.controller.js` | Xác nhận `saved-items.controller.js` là code thừa rồi xóa. Gom logic mục đã lưu về một chỗ duy nhất |
| 11 | `.claude/` và `Claude outputs/` chưa ignore | `.gitignore` | Thêm vào `.gitignore` |
| 12 | Routing không đồng nhất | `home`, `shop`, `purchase`, `content` (mục 6.2) | Chuyển dần sang routing module khi chạm vào feature |
| 13 | Fallback secret trong code | `backend/src/app.js` | Bỏ trước khi deploy production |
| 14 | Controller admin quá dài | `backend/src/controllers/admin.controller.js` (612 dòng) | Tách theo cụm khi admin mở rộng (mục 7.5) |
| 15 | README cũ ghi sai port và Node | README gốc: port `5001`, Node `≥ 16` | **Đã sửa** trong README này: port `5000` (khớp proxy), Node `≥ 20` (Angular 21) |
| 16 | `frontend/README.md` còn vài chỗ cũ: cây admin ghi `components/order-list/` và `status-updater/` (thực tế là `admin-layout/`); ví dụ Routing lazy-load `shop` không khớp `app.routes.ts`; ví dụ `AdminGuard` dùng `AuthService` (thực tế dùng `AdminAuthService`); các mục "⚠️ create" cho guard và interceptor đã có file thật (`error.interceptor.ts` vẫn chưa có) | `frontend/README.md` | Cập nhật `frontend/README.md` theo code thực tế. Đến lúc đó, khi mâu thuẫn, README này được ưu tiên |
