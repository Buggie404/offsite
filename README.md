# Offsite — Your Café, At Home

> Direct-to-consumer e-commerce platform cho café lifestyle products (matcha, coffee, tools, drinkware).  
> Target: Gen Z Vietnam. Aesthetic: Retro Y2K. Brand voice: Warm & knowing.

**Project Status:** Active Development (Phase 4–6 running in parallel)  
**Version:** 1.0.0  
**Last Updated:** Tháng 6, 2026

---

## 🎯 What is Offsite?

An online café-lifestyle marketplace with a curated collection of matcha, coffee, brewing tools, and drinkware. Users can:
- Browse & purchase products
- Discover recipes (The Menu)
- Read café stories (Journal)
- Connect with community
- Track orders in real-time

**Admin scope:** Only update order status for tracking. All content (products, recipes) is pre-seeded via data pipeline.

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Angular 15)                 │
│  (SPA: Homepage, Shop, Purchase, Account, Community)    │
│                                                           │
│  • Standalone Components                                 │
│  • MVVM Pattern (ViewModel ↔ Service ↔ API)             │
│  • 6 Feature Modules (lazy-loaded)                      │
│  • 1 Admin Module (separate /admin route)               │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP + JWT Token
                       ↓
┌─────────────────────────────────────────────────────────┐
│              BACKEND (Node.js + Express)                │
│        RESTful API (4 endpoints groups)                 │
│                                                          │
│  • Auth (email/password + OAuth Google/Facebook)        │
│  • Products (listings, details, search)                 │
│  • Orders (create, history, status tracking)            │
│  • Admin (update order status)                          │
└──────────────────────┬──────────────────────────────────┘
                       │ Mongoose Client (native)
                       ↓
┌─────────────────────────────────────────────────────────┐
│              DATABASE (MongoDB)                         │
│         10 Collections (Embed-First Strategy)           │
│                                                          │
│  • users, products, orders, carts, coupons              │
│  • reviews, recipes, blogs, community_posts, gifts      │
└─────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

**Backend: MVC (Domain-Organized)**
- Routes → Controllers → Models (domain: auth, products, orders, admin)
- Single responsibility per controller
- Middleware for auth, validation, error handling

**Frontend: MVVM (Feature-Based)**
- Component (ViewModel) ↔ Service (Model) ↔ Template (View)
- 6 lazy-loaded feature modules (home, shop, purchase, account, content, community)
- 1 separate admin module (path-based: `/admin/*`)
- Auth interceptor auto-adds JWT token to requests

**Database: Embed-First MongoDB**
- 30+ logical entities → 10 physical collections
- Snapshot denormalization on OrderItem, CartItem, RecipeIngredient
- No SQL joins; data structured for feature needs (function-first)

---

## 🛠️ Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Frontend** | Angular | 15.x | SPA framework, standalone components |
| | TypeScript | 4.8.x | Type-safe development |
| | RxJS | 7.x | Reactive programming |
| | SCSS | 5.x | Styling, variables, mixins |
| **Backend** | Node.js | 16.x+ | JavaScript runtime |
| | Express | 4.x | HTTP server, routing, middleware |
| | Morgan | Latest | Request logging |
| | Dotenv | Latest | Environment variables |
| **Database** | MongoDB | Atlas (cloud) | NoSQL document store |
| | Mongoose | Not used | (Native MongoDB client instead) |
| **Authentication** | JWT | Standard | Stateless auth tokens |
| | Bcrypt | 10 rounds | Password hashing |
| | Passport | v0.6 | OAuth strategy handling |
| **External** | Cloudinary | - | Image storage (CDN) |
| | GHN | - | Shipping (placeholder) |
| | Stripe | Test mode | Payment simulation |

---

## 📁 Folder Structure (Root Level)

```
offsite/
├── backend/                          ← Node.js/Express API
│   ├── src/
│   │   ├── routes/                  (auth, products, orders, admin)
│   │   ├── controllers/
│   │   ├── models/                  (schemas)
│   │   ├── middleware/              (auth, validation, error)
│   │   ├── config/
│   │   └── utils/
│   ├── .env                         (NOT in git)
│   ├── package.json
│   └── README.md                    ← Backend development guide
│
├── frontend/                         ← Angular 15 SPA
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/               (singleton services, interceptors)
│   │   │   ├── shared/             (reusable components, models)
│   │   │   ├── features/           (6 modules: home, shop, purchase, account, content, community)
│   │   │   ├── admin/              (order status dashboard)
│   │   │   ├── app.ts              (root component - standalone)
│   │   │   ├── app.routes.ts       (routing config)
│   │   │   └── app.config.ts       (providers: interceptors, guards)
│   │   ├── styles/                 (global SCSS)
│   │   └── main.ts                 (bootstrap)
│   ├── angular.json
│   ├── package.json
│   └── README.md                    ← Frontend development guide
│
├── package.json                      ← Root (monorepo scripts)
├── .gitignore
├── .env.example                      ← Template (for team reference)
└── README.md                         ← This file

```

---

## 🚀 Quick Start

### Prerequisites

```bash
# Check versions
node --version    # v16.x+
npm --version     # v8.x+

# Install Angular CLI
npm install -g @angular/cli@15

# Verify
ng version
```

### Setup (First Time)

```bash
# Install root dependencies
npm install

# Install all (backend + frontend)
npm run install-all

# Setup environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env  # if exists

# Edit .env with your config (MongoDB URI, OAuth keys, etc)
nano backend/.env
```

### Run Development

**Option A: Run both together**
```bash
npm start
# → Backend: http://localhost:5000
# → Frontend: http://localhost:4200
```

**Option B: Run separately (2 terminals)**
```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && ng serve
```

### Verify Setup

```bash
# Backend health check
curl http://localhost:5000/api/health
# → { "status": "Backend is running" }

# Frontend
open http://localhost:4200
# → Should see homepage
```

### Build for Production

```bash
npm run build
# Outputs:
#   backend/ (ready to deploy)
#   frontend/dist/ (ready to deploy to CDN/static host)
```

---

## 📚 Documentation

### For Developers

**Backend Development?** → [`backend/README.md`](./backend/BACKEND_README.md)
- Tech stack, setup, folder structure
- Running server, API endpoints
- Database management
- Authentication (JWT + OAuth)
- Troubleshooting

**Frontend Development?** → [`frontend/README.md`](./frontend/FRONTEND_README.md)
- Tech stack, setup, folder structure
- Running app, architecture (MVVM)
- How to add features, API integration
- Routing, styling, common tasks
- Troubleshooting

---

## 🔐 Security & Environment

### Environment Variables

Create `.env` files (never commit to git):

**Backend (.env):**
```env
PORT=5000
MONGODB_URI=mongodb+srv://...
NODE_ENV=development
JWT_SECRET=<generate: openssl rand -base64 32>
BCRYPT_ROUNDS=10
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
```

**Frontend (.env) — Optional:**
```env
ANGULAR_ENV=development
API_URL=http://localhost:5000
```

### Git Best Practices

```bash
# Never commit
.env
.env.local
*.log
node_modules/

# Always commit
.env.example (template)
.gitignore
README.md
src/, package.json, etc.
```

---

## 🔄 Development Workflow

### Before Starting Code

1. **Read the relevant README** (backend/ or frontend/)
2. **Check existing patterns** (how components/services are structured)
3. **Ask clarifying questions** if scope is unclear

### While Coding

- Follow **naming conventions** in the README
- Use **consistent patterns** (MVVM for frontend, MVC for backend)
- **Comment complex logic**, keep code self-documenting
- **Test as you go** (unit tests, manual testing)

### Before Committing

- ✅ Code follows project conventions
- ✅ No console.log() left (except dev)
- ✅ No .env or credentials in code
- ✅ Tests pass (if applicable)
- ✅ README updated if adding new patterns

### Pull Request Process

1. Create feature branch: `git checkout -b feature/[feature-name]`
2. Make changes following README guidelines
3. Test locally (backend + frontend working together)
4. Push to origin
5. Create PR with clear description
6. Request review from lead
7. Merge after approval
