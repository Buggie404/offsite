# Offsite Frontend — Development Guide

> Hướng dẫn phát triển frontend Angular cho dự án Offsite (your café, at home).
> 
> **Status:** Dự án đang trong giai đoạn phát triển  
> **Version:** 1.0.0  
> **Angular Version:** 15.x (Standalone Components + Routing)  

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Prerequisites](#prerequisites)
3. [Folder Structure](#folder-structure)
4. [Running the App](#running-the-app)
5. [Architecture & Patterns](#architecture--patterns)
6. [How to Add Features](#how-to-add-features)
7. [API Integration](#api-integration)
8. [Routing](#routing)
9. [Styling](#styling)
10. [Common Tasks](#common-tasks)
11. [Troubleshooting](#troubleshooting)

---

## Tech Stack

**Framework & Runtime**
- **Angular** (v15.x) — Frontend framework with Standalone Components
- **TypeScript** (v4.8.x) — Type-safe JavaScript
- **RxJS** (v7.x) — Reactive programming library (Observables)

**Styling**
- **SCSS** — CSS preprocessor (nesting, variables, mixins)

**Development Tools**
- **Angular CLI** — Command-line tool
- **Standalone Routing** — Tree-shakeable routing (no NgModules required)

**Optional**
- **Server-side Rendering (SSR)** — Files: `main.server.ts`, `server.ts`, `app.config.server.ts`

---

## Prerequisites

### Yêu cầu bắt buộc

```bash
node --version  # v16.x hoặc cao hơn
npm --version   # v8.x hoặc cao hơn

# Angular CLI v15
npm install -g @angular/cli@15
ng version
```

---

## Folder Structure

### Complete Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── app.ts                     ← Root component (standalone)
│   │   ├── app.html                   ← Root template
│   │   ├── app.scss                   ← Root styles
│   │   ├── app.spec.ts                ← Root unit tests
│   │   ├── app.routes.ts              ← Routing (standalone)
│   │   ├── app.routes.server.ts       ← SSR routing
│   │   ├── app.config.ts              ← App config (providers, interceptors)
│   │   ├── app.config.server.ts       ← SSR config
│   │   │
│   │   ├── core/                      ← Singleton services & core logic
│   │   │   ├── core-module.ts         ├─ Core module (imports core services)
│   │   │   ├── auth.service.ts        ├─ Authentication service
│   │   │   ├── http.service.ts        ├─ HTTP wrapper (optional)
│   │   │   ├── interceptors/
│   │   │   │   └── auth.interceptor.ts├─ Add JWT token to requests
│   │   │   └── guards/
│   │   │       ├── auth.guard.ts      ├─ Protect routes (login required)
│   │   │       └── admin.guard.ts     └─ Protect admin routes
│   │   │
│   │   ├── shared/                    ← Reusable across features
│   │   │   ├── components/
│   │   │   │   ├── navbar/
│   │   │   │   │   ├── navbar.component.ts
│   │   │   │   │   ├── navbar.component.html
│   │   │   │   │   └── navbar.component.scss
│   │   │   │   ├── footer/
│   │   │   │   ├── loading-spinner/
│   │   │   │   └── modals/            (reusable modal dialogs)
│   │   │   ├── models/
│   │   │   │   ├── user.model.ts
│   │   │   │   ├── product.model.ts
│   │   │   │   ├── order.model.ts
│   │   │   │   ├── cart.model.ts
│   │   │   │   ├── recipe.model.ts
│   │   │   │   └── ...
│   │   │   ├── pipes/                 ├─ Custom pipes (currency, date, etc)
│   │   │   │   └── currency.pipe.ts
│   │   │   ├── services/
│   │   │   │   └── shared.service.ts  ├─ Shared utilities
│   │   │   └── shared-module.ts       ← Shared module (import shared components)
│   │   │
│   │   ├── features/                  ← 6 Feature modules (lazy-loaded)
│   │   │   ├── auth/
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth-routing.module.ts
│   │   │   │   ├── pages/
│   │   │   │   │   ├── login.component.ts
│   │   │   │   │   ├── register.component.ts
│   │   │   │   │   └── ...
│   │   │   │   ├── components/
│   │   │   │   │   └── login-form/
│   │   │   │   └── services/
│   │   │   │
│   │   │   ├── home/
│   │   │   │   ├── home.module.ts     ← Feature module
│   │   │   │   ├── home-routing.module.ts
│   │   │   │   ├── pages/
│   │   │   │   │   └── home.component.ts (main page/ViewModel)
│   │   │   │   ├── components/
│   │   │   │   │   ├── hero-banner/
│   │   │   │   │   ├── featured-products/
│   │   │   │   │   └── ...
│   │   │   │   └── services/
│   │   │   │       └── home.service.ts (API calls)
│   │   │   │
│   │   │   ├── shop/
│   │   │   │   ├── shop.module.ts
│   │   │   │   ├── shop-routing.module.ts
│   │   │   │   ├── pages/
│   │   │   │   │   ├── listing.component.ts   (search, filter, list)
│   │   │   │   │   └── product-detail.component.ts
│   │   │   │   ├── components/
│   │   │   │   │   ├── product-card/
│   │   │   │   │   ├── filters/
│   │   │   │   │   └── reviews/
│   │   │   │   └── services/
│   │   │   │       └── shop.service.ts
│   │   │   │
│   │   │   ├── purchase/
│   │   │   │   ├── purchase.module.ts
│   │   │   │   ├── purchase-routing.module.ts
│   │   │   │   ├── pages/
│   │   │   │   │   ├── cart.component.ts
│   │   │   │   │   ├── checkout.component.ts
│   │   │   │   │   └── payment.component.ts
│   │   │   │   ├── components/
│   │   │   │   │   ├── cart-summary/
│   │   │   │   │   ├── address-form/
│   │   │   │   │   └── payment-method/
│   │   │   │   └── services/
│   │   │   │       ├── cart.service.ts
│   │   │   │       └── checkout.service.ts
│   │   │   │
│   │   │   ├── account/
│   │   │   │   ├── account.module.ts
│   │   │   │   ├── account-routing.module.ts
│   │   │   │   ├── pages/
│   │   │   │   │   ├── profile.component.ts
│   │   │   │   │   └── order-history.component.ts
│   │   │   │   ├── components/
│   │   │   │   │   └── profile-form/
│   │   │   │   └── services/
│   │   │   │       └── account.service.ts
│   │   │   │
│   │   │   ├── content/
│   │   │   │   ├── content.module.ts
│   │   │   │   ├── content-routing.module.ts
│   │   │   │   ├── pages/
│   │   │   │   │   ├── recipes.component.ts
│   │   │   │   │   ├── recipe-detail.component.ts
│   │   │   │   │   └── blog.component.ts
│   │   │   │   ├── components/
│   │   │   │   │   ├── recipe-card/
│   │   │   │   │   └── recipe-filter/
│   │   │   │   └── services/
│   │   │   │       └── content.service.ts
│   │   │   │
│   │   │   └── community/
│   │   │       ├── community.module.ts
│   │   │       ├── community-routing.module.ts
│   │   │       ├── pages/
│   │   │       │   └── feed.component.ts
│   │   │       ├── components/
│   │   │       │   ├── post-card/
│   │   │       │   └── post-form/
│   │   │       └── services/
│   │   │           └── community.service.ts
│   │   │
│   │   └── admin/
│   │       ├── admin.module.ts
│   │       ├── admin-routing.module.ts
│   │       ├── pages/
│   │       │   └── order-status-dashboard.component.ts
│   │       ├── components/
│   │       │   ├── order-list/
│   │       │   │   ├── order-list.component.ts
│   │       │   │   ├── order-list.component.html
│   │       │   │   └── order-list.component.scss
│   │       │   └── status-updater/
│   │       │       ├── status-updater.component.ts
│   │       │       ├── status-updater.component.html
│   │       │       └── status-updater.component.scss
│   │       └── services/
│   │           └── admin-order.service.ts
│   │
│   ├── assets/
│   │   ├── images/
│   │   ├── icons/
│   │   └── data/
│   │
│   ├── styles/
│   │   ├── global.scss                ← Import tất cả styles
│   │   ├── variables.scss             ← Colors, fonts, spacing
│   │   ├── mixins.scss                ← Reusable mixins
│   │   └── reset.scss                 ← CSS reset
│   │
│   ├── main.ts                        ← Bootstrap Angular (standalone app)
│   ├── main.server.ts                 ← SSR entry point
│   ├── server.ts                      ← Express server (SSR)
│   ├── index.html                     ← Main HTML
│   ├── styles.scss                    ← Global styles entry
│   ├── environment.ts                 ← Dev environment config
│   └── environment.prod.ts            ← Prod environment config
│
├── public/
│   └── favicon.ico
│
├── angular.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.spec.json
├── package.json
├── proxy.conf.json
├── .editorconfig, .prettierrc, .gitignore
├── .vscode/
└── README.md
```

### Folder Purposes

| Folder | Purpose | Details |
|---|---|---|
| **core/** | Singleton services | AuthService, HttpInterceptor, Guards — imported once in AppModule |
| **shared/** | Reusable components & models | Navbar, Footer, Loading Spinner, TypeScript interfaces |
| **features/** | Feature modules (user-facing) | 6 lazy-loaded modules + auth. Each self-contained with pages, components, services |
| **admin/** | Admin dashboard | Order status management (only feature in admin scope) |
| **styles/** | Global SCSS | Variables, mixins, reset. Component styles in `.component.scss` files |
| **assets/** | Static files | Images, icons, JSON data |

### Naming Conventions

**Files:**
- Root component: `app.ts` (standalone)
- Routing: `app.routes.ts` (standalone routing)
- Config: `app.config.ts` (provides: interceptors, guards, services)
- Components: `[feature].component.ts` — `home.component.ts`, `product-card.component.ts`
- Services: `[feature].service.ts` — `shop.service.ts`, `cart.service.ts`
- Models: `[entity].model.ts` — `product.model.ts`, `user.model.ts`
- Modules: `[feature].module.ts` — `home.module.ts` (traditional NgModule wrapper)
- Routing: `[feature]-routing.module.ts` — `shop-routing.module.ts`

**Classes & Functions:**
- Components: `PascalCase` — `HomeComponent`, `ProductCardComponent`
- Services: `PascalCase + Service` — `ShopService`, `CartService`
- Interfaces: `PascalCase` — `Product`, `User`, `Order`
- Functions: `camelCase` — `getProducts()`, `addToCart()`

**Selectors (HTML tags):**
- `app-[feature]-[component]` — `<app-product-card>`, `<app-cart-summary>`

---

## Running the App

### Setup lần đầu

```bash
# 1. Cài dependencies
npm install

# 2. Verify Angular CLI
ng version

# 3. Check backend running
curl http://localhost:5000/api/health
```

### Start dev server

```bash
ng serve
# or
npm start
```

- App: **http://localhost:4200**
- Auto-reload on file changes

### Build for production

```bash
ng build --configuration production
# Output: dist/frontend/
```

---

## Architecture & Patterns

### MVVM (Model-View-ViewModel) in Angular 15

```
View (HTML Template)
   ↕ two-way binding: [(ngModel)], async pipe
ViewModel (Component Class - Standalone)
   ↕ dependency injection
Model (Service - Provided in app.config.ts)
   ↕ HTTP calls (with AuthInterceptor)
Backend REST API
```

**Example:**

```typescript
// ViewModel: shop-listing.component.ts
import { Component, OnInit } from '@angular/core';
import { ShopService } from '../services/shop.service';
import { Product } from '@app/shared/models/product.model';

@Component({
  selector: 'app-shop-listing',
  standalone: true,  // Standalone component (no NgModule needed)
  imports: [CommonModule],
  templateUrl: './shop-listing.component.html',
  styleUrls: ['./shop-listing.component.scss']
})
export class ShopListingComponent implements OnInit {
  // ViewModel state
  products: Product[] = [];
  loading = false;
  selectedCategory = 'all';

  constructor(private shopService: ShopService) {}

  ngOnInit(): void {
    this.loadProducts();
  }

  // ViewModel logic
  loadProducts(): void {
    this.loading = true;
    this.shopService.getProducts(this.selectedCategory).subscribe({
      next: (data) => {
        this.products = data;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading products', err);
        this.loading = false;
      }
    });
  }

  filterByCategory(category: string): void {
    this.selectedCategory = category;
    this.loadProducts();
  }
}
```

```html
<!-- View: shop-listing.component.html -->
<div class="shop-container">
  <app-category-filter
    [categories]="categories"
    [(selectedCategory)]="selectedCategory"
    (onChange)="filterByCategory($event)"
  ></app-category-filter>

  <app-loading-spinner *ngIf="loading"></app-loading-spinner>

  <div class="products-grid">
    <app-product-card
      *ngFor="let product of products"
      [product]="product"
      (onAddToCart)="addToCart($event)"
    ></app-product-card>
  </div>
</div>
```

```typescript
// Model: shop.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Product } from '@app/shared/models/product.model';

@Injectable({ providedIn: 'root' })
export class ShopService {
  private apiUrl = 'http://localhost:5000/api/products';

  constructor(private http: HttpClient) {}

  getProducts(category?: string): Observable<Product[]> {
    const params = category ? { category } : {};
    return this.http.get<Product[]>(this.apiUrl, { params });
  }

  getProductById(id: string): Observable<Product> {
    return this.http.get<Product>(`${this.apiUrl}/${id}`);
  }
}
```

### Key Principles

- **Standalone Components** — No NgModule wrapper needed (Angular 15+)
- **ViewModel** = Component class (holds state + logic)
- **View** = Template (displays data via binding)
- **Model** = Service (API calls + business logic)
- **Reactive** = Use RxJS Observables, unsubscribe properly

---

## How to Add Features

### Step 1: Create folder structure

```bash
# From frontend/src/app/features/
mkdir -p [feature-name]/{pages,components,services}
touch [feature-name]/[feature-name].module.ts
touch [feature-name]/[feature-name]-routing.module.ts
```

### Step 2: Create page component (ViewModel)

```bash
ng generate component features/[feature-name]/pages/[page-name] --skip-tests
```

### Step 3: Create service (Model)

```bash
ng generate service features/[feature-name]/services/[feature-name] --skip-tests
```

### Step 4: Create models

```typescript
// shared/models/[feature].model.ts
export interface FeatureEntity {
  _id: string;
  name: string;
  createdAt: Date;
}
```

### Step 5: Setup module

```typescript
// features/[feature-name]/[feature-name].module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { [FeatureName]RoutingModule } from './[feature-name]-routing.module';
import { [FeatureName]Component } from './pages/[page-name].component';

@NgModule({
  declarations: [[FeatureName]Component],
  imports: [CommonModule, [FeatureName]RoutingModule]
})
export class [FeatureName]Module { }
```

### Step 6: Setup routing

```typescript
// features/[feature-name]/[feature-name]-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { [FeatureName]Component } from './pages/[page-name].component';

const routes: Routes = [
  { path: '', component: [FeatureName]Component }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class [FeatureName]RoutingModule { }
```

### Step 7: Add to app.routes.ts

```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: '[feature-name]',
    loadChildren: () => import('./features/[feature-name]/[feature-name].module')
      .then(m => m.[FeatureName]Module),
    canActivate: [AuthGuard]  // If protected
  },
  // ... other routes
];
```

---

## API Integration

### HTTP Interceptor (Auto-add JWT token)

```typescript
// core/interceptors/auth.interceptor.ts
import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from '../auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private authService: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.authService.getToken();

    if (token) {
      req = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`
        }
      });
    }

    return next.handle(req);
  }
}
```

### Register in app.config.ts

```typescript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withInterceptors, HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    }
  ]
};
```

### Service Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class ShopService {
  constructor(private http: HttpClient) {}

  // ✅ One method = one API call
  getProducts(filters?: any): Observable<Product[]> {
    return this.http.get<Product[]>('/api/products', { params: filters });
  }

  getProductById(id: string): Observable<Product> {
    return this.http.get<Product>(`/api/products/${id}`);
  }
}
```

---

## Routing

### Standalone Routing (app.routes.ts)

```typescript
// app.routes.ts
import { Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { AdminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  // User routes (lazy-loaded)
  {
    path: 'home',
    loadChildren: () => import('./features/home/home.module').then(m => m.HomeModule)
  },
  {
    path: 'shop',
    loadChildren: () => import('./features/shop/shop.module').then(m => m.ShopModule)
  },
  {
    path: 'account',
    loadChildren: () => import('./features/account/account.module').then(m => m.AccountModule),
    canActivate: [AuthGuard]  // Protected
  },

  // Admin route
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule),
    canActivate: [AdminGuard]
  },

  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' }
];
```

### Guards

```typescript
// core/guards/auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(): boolean {
    if (this.authService.isLoggedIn()) return true;
    this.router.navigate(['/auth/login']);
    return false;
  }
}
```

---

## Styling

### SCSS Structure

```
styles/
├── global.scss        ← Import all
├── variables.scss     ← Colors, fonts, spacing
├── mixins.scss        ← Reusable mixins
└── reset.scss         ← CSS reset
```

---

## Common Tasks

### Task 1: Call API and display data

```typescript
export class HomeComponent implements OnInit {
  products: Product[] = [];
  loading = false;

  constructor(private shopService: ShopService) {}

  ngOnInit(): void {
    this.loading = true;
    this.shopService.getProducts().subscribe({
      next: (data) => {
        this.products = data;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error:', err);
        this.loading = false;
      }
    });
  }
}
```

### Task 2: Use async pipe (avoid manual unsubscribe)

```typescript
// Component
products$ = this.shopService.getProducts();
```

```html
<!-- Template -->
<div *ngFor="let p of products$ | async">
  {{ p.name }}
</div>
```

### Task 3: Form with validation

```typescript
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

export class LoginComponent {
  form: FormGroup;

  constructor(private fb: FormBuilder, private authService: AuthService) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.authService.login(this.form.value).subscribe({
      next: () => { /* success */ },
      error: (err) => console.error('Login failed', err)
    });
  }
}
```

---

## Troubleshooting

### CORS Error

**Error:** `Access to XMLHttpRequest blocked by CORS`

**Solution:**
```bash
# Run with proxy
ng serve --proxy-config proxy.conf.json
```

### Component not rendering

**Error:** Page is blank or template not showing

**Solution:**
1. Check console for errors
2. Verify component is declared in module
3. Check selector name matches HTML tag

### Route not found

**Error:** Navigation doesn't work or 404

**Solution:**
1. Verify path in `app.routes.ts`
2. Check module is imported correctly
3. Verify RouterModule is in imports

### Tests failing

**Error:** `ng test` shows failures

**Solution:** Run with --watch=false for CI, or fix test files in `.spec.ts`

---

## Quick Reference

```bash
# Generate files (from project root)
ng generate component features/[name]/pages/[name]
ng generate service features/[name]/services/[name]
ng generate module features/[name] --routing

# Run app
ng serve
ng serve --proxy-config proxy.conf.json

# Build
ng build --configuration production

# Test
ng test
ng lint

# Create folder structure
mkdir -p features/[name]/{pages,components,services}
```

---

## File Checklist (Before Commit)

- ✅ All components have `.ts`, `.html`, `.scss` files
- ✅ Services in `/services` folder
- ✅ Models in `shared/models/`
- ✅ No console.log() left (except dev)
- ✅ SCSS imports use `@import '@app/styles/variables'`
- ✅ Observables use `$` suffix (`products$`)
- ✅ Services injected with `private` modifier
- ✅ Unsubscribe or use `async` pipe for Observables

---

**Need help?** Check console errors: `ng serve` shows detailed logs.