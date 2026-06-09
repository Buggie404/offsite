# Frontend — Angular 21 SSR

> Angular 21 · TypeScript 5.9 · RxJS 7.8 · SCSS · SSR via `@angular/ssr`

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Prerequisites](#prerequisites)
3. [Folder Structure](#folder-structure)
4. [Running the App](#running-the-app)
5. [Architecture — MVVM](#architecture--mvvm)
6. [How to Add a Feature](#how-to-add-a-feature)
7. [API Integration](#api-integration)
8. [Routing](#routing)
9. [Styling](#styling)
10. [Common Tasks](#common-tasks)
11. [Troubleshooting](#troubleshooting)
12. [Quick Reference](#quick-reference)

---

## Tech Stack

| Layer        | Technology                              |
|--------------|-----------------------------------------|
| Framework    | Angular 21 (SSR with `@angular/ssr`)    |
| Language     | TypeScript 5.9                          |
| Reactivity   | RxJS 7.8                                |
| Styling      | SCSS (component-scoped + global)        |
| Testing      | Vitest                                  |
| HTTP Proxy   | `proxy.conf.json` → `localhost:5000`    |
| Package Mgr  | npm 11                                  |

---

## Prerequisites

```bash
node  >= 20
npm   >= 11
```

```bash
npm install -g @angular/cli   # v21
```

---

## Folder Structure

```
frontend/
├── angular.json                  # CLI workspace config
├── tsconfig.json                 # Base TS config
├── tsconfig.app.json             # App-specific TS config
├── tsconfig.spec.json            # Test TS config
├── package.json
├── .prettierrc
├── .editorconfig
│
├── public/
│   └── favicon.ico
│
└── src/
    ├── index.html                # Shell HTML
    ├── main.ts                   # Browser bootstrap
    ├── main.server.ts            # SSR bootstrap
    ├── server.ts                 # Express SSR server
    ├── styles.scss               # Global styles & SCSS variables
    ├── proxy.conf.json           # Dev proxy: /api → localhost:5000
    │
    └── app/
        ├── app.ts                # Root component
        ├── app.html              # Root template
        ├── app.scss              # Root styles
        ├── app.routes.ts         # Top-level route definitions
        ├── app.routes.server.ts  # SSR-specific routes
        ├── app.config.ts         # ApplicationConfig (providers)
        ├── app.config.server.ts  # SSR providers
        │
        ├── core/                 # Singleton services — imported ONCE in AppModule
        │   ├── core-module.ts
        │   ├── guards/           # ⚠️ create: auth.guard.ts, admin.guard.ts
        │   ├── interceptors/     # ⚠️ create: auth.interceptor.ts, error.interceptor.ts
        │   └── services/         # ⚠️ create: auth.service.ts
        │
        ├── shared/               # Reusable across features
        │   ├── shared-module.ts
        │   ├── components/       # Dumb/presentational components (button, modal, spinner…)
        │   ├── models/           # Interfaces & types (user.model.ts, product.model.ts…)
        │   └── services/         # Shared utilities (loading.service.ts, toast.service.ts…)
        │
        ├── admin/                # Admin panel (role-protected)
        │   ├── admin-module.ts
        │   ├── admin-routing-module.ts
        │   ├── components/
        │   │   ├── order-list/
        │   │   └── status-updater/
        │   ├── pages/            # Routed page components
        │   └── services/         # Admin-scoped services
        │
        └── features/             # Lazy-loaded feature modules
            ├── account/          # User profile, settings
            │   ├── account-module.ts
            │   ├── account-routing-module.ts
            │   ├── components/   # ⚠️ create subdirs for each feature
            │   ├── pages/
            │   └── services/
            ├── community/        # Forum, social features
            ├── content/          # Articles, media
            ├── home/             # Landing / dashboard
            ├── purchase/         # Checkout, payments
            └── shop/             # Product listing, cart
```

### Naming conventions

| Type           | Pattern                    | Example                        |
|----------------|----------------------------|--------------------------------|
| Component      | `kebab-case.ts`            | `product-card.ts`              |
| Template       | same name `.html`          | `product-card.html`            |
| Style          | same name `.scss`          | `product-card.scss`            |
| Service        | `*.service.ts`             | `product.service.ts`           |
| Guard          | `*.guard.ts`               | `auth.guard.ts`                |
| Interceptor    | `*.interceptor.ts`         | `auth.interceptor.ts`          |
| Model          | `*.model.ts`               | `product.model.ts`             |
| Module         | `*-module.ts`              | `shop-module.ts`               |
| Routing module | `*-routing-module.ts`      | `shop-routing-module.ts`       |
| Test           | `*.spec.ts`                | `product-card.spec.ts`         |

---

## Running the App

```bash
# 1. Install dependencies
npm install

# 2. Start dev server (proxies /api → localhost:5000)
npm start                        # ng serve — http://localhost:4200

# 3. Build for production
npm run build                    # output: dist/frontend/

# 4. Run SSR server (after build)
npm run serve:ssr:frontend       # node dist/frontend/server/server.mjs

# 5. Run tests
npm test
```

---

## Architecture — MVVM

```
View (.html)
  ↕ bindings / events
ViewModel (.ts component)
  ↕ Observable streams
Model (service + interface)
  ↕ HttpClient
API (backend :5000)
```

**View** — pure template, no logic. Uses `async` pipe to subscribe.

**ViewModel** — the component class. Holds state via Observables, delegates all data fetching to services.

**Model** — a `*.service.ts` that calls the API and returns typed Observables; a `*.model.ts` interface that describes the shape.

### Example

```ts
// shared/models/product.model.ts
export interface Product {
  id: number;
  name: string;
  price: number;
}
```

```ts
// features/shop/services/product.service.ts
@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);

  getAll(): Observable<Product[]> {
    return this.http.get<Product[]>('/api/products');
  }
}
```

```ts
// features/shop/pages/product-list/product-list.ts  ← ViewModel
@Component({ ... })
export class ProductListComponent {
  private productService = inject(ProductService);
  products$ = this.productService.getAll();       // no subscribe() needed
}
```

```html
<!-- product-list.html  ← View -->
<ul>
  <li *ngFor="let p of products$ | async">{{ p.name }} — {{ p.price | currency }}</li>
</ul>
```

---

## How to Add a Feature

Follow these steps every time you add a new feature module.

### Step 1 — Generate the module skeleton

```bash
ng generate module features/my-feature --routing
# creates: features/my-feature/my-feature-module.ts
#          features/my-feature/my-feature-routing-module.ts
```

### Step 2 — Create subdirectories

```
features/my-feature/
├── my-feature-module.ts
├── my-feature-routing-module.ts
├── components/     # dumb components
├── pages/          # routed components
└── services/       # feature-scoped services
```

### Step 3 — Add a page component

```bash
ng generate component features/my-feature/pages/my-page
```

### Step 4 — Register the route in the feature routing module

```ts
// my-feature-routing-module.ts
const routes: Routes = [
  { path: '', component: MyPageComponent }
];
```

### Step 5 — Lazy-load from app.routes.ts

```ts
// app.routes.ts
export const routes: Routes = [
  {
    path: 'my-feature',
    loadChildren: () =>
      import('./features/my-feature/my-feature-module')
        .then(m => m.MyFeatureModule)
  }
];
```

### Step 6 — Add a service

```bash
ng generate service features/my-feature/services/my-feature
```

---

## API Integration

All API calls go through Angular's `HttpClient`. The dev proxy (`proxy.conf.json`) forwards `/api/*` to `localhost:5000`.

### HTTP Interceptors (add to `core/interceptors/`)

**Auth interceptor** — attaches Bearer token:

```ts
// core/interceptors/auth.interceptor.ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('token');
  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;
  return next(authReq);
};
```

Register in `app.config.ts`:

```ts
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './core/interceptors/auth.interceptor';

providers: [
  provideRouter(routes),
  provideHttpClient(withInterceptors([authInterceptor]))
]
```

### Service pattern

```ts
@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);
  private base = '/api/orders';

  getOrders(): Observable<Order[]>         { return this.http.get<Order[]>(this.base); }
  getById(id: number): Observable<Order>   { return this.http.get<Order>(`${this.base}/${id}`); }
  create(dto: Partial<Order>)              { return this.http.post<Order>(this.base, dto); }
  update(id: number, dto: Partial<Order>)  { return this.http.put<Order>(`${this.base}/${id}`, dto); }
  delete(id: number)                       { return this.http.delete(`${this.base}/${id}`); }
}
```

---

## Routing

### Lazy-loading (app.routes.ts)

```ts
{ path: 'shop',     loadChildren: () => import('./features/shop/shop-module').then(m => m.ShopModule) },
{ path: 'account',  loadChildren: () => import('./features/account/account-module').then(m => m.AccountModule) },
{ path: 'admin',    loadChildren: () => import('./admin/admin-module').then(m => m.AdminModule),
                    canActivate: [adminGuard] },
{ path: '**',       redirectTo: '' }
```

### AuthGuard (create in `core/guards/auth.guard.ts`)

```ts
export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const isLoggedIn = !!localStorage.getItem('token');
  return isLoggedIn ? true : router.createUrlTree(['/login']);
};
```

### AdminGuard (create in `core/guards/admin.guard.ts`)

```ts
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAdmin() ? true : router.createUrlTree(['/']);
};
```

---

## Styling

### Global variables — `src/styles.scss`

```scss
// Colors
$primary:   #3b82f6;
$danger:    #ef4444;
$text:      #1e293b;
$bg:        #f8fafc;

// Spacing
$sp-xs: 4px;  $sp-sm: 8px;  $sp-md: 16px;  $sp-lg: 24px;  $sp-xl: 40px;

// Breakpoints
$mobile:  480px;
$tablet:  768px;
$desktop: 1024px;

// Mixin
@mixin respond($bp) {
  @media (max-width: $bp) { @content; }
}
```

### Component styles

Each component has its own `.scss`. Use `:host` to scope:

```scss
// product-card.scss
:host {
  display: block;
  padding: $sp-md;

  .title { font-weight: 600; }

  @include respond($mobile) {
    padding: $sp-sm;
  }
}
```

---

## Common Tasks

### API call with async pipe

```ts
// component
items$ = inject(ItemService).getAll();
```

```html
<!-- template -->
<ng-container *ngIf="items$ | async as items; else loading">
  <div *ngFor="let item of items">{{ item.name }}</div>
</ng-container>
<ng-template #loading><span>Loading…</span></ng-template>
```

### Reactive form

```ts
form = inject(FormBuilder).group({
  name:  ['', [Validators.required, Validators.minLength(2)]],
  email: ['', [Validators.required, Validators.email]],
});

submit() {
  if (this.form.invalid) return;
  this.myService.create(this.form.value).subscribe();
}
```

```html
<form [formGroup]="form" (ngSubmit)="submit()">
  <input formControlName="name" />
  <span *ngIf="form.get('name')?.hasError('required')">Required</span>
  <button type="submit" [disabled]="form.invalid">Save</button>
</form>
```

### Loading + error state pattern

```ts
vm$ = this.service.getData().pipe(
  map(data    => ({ data, loading: false, error: null })),
  startWith (         { data: null, loading: true,  error: null }),
  catchError(err => of({ data: null, loading: false, error: err.message }))
);
```

---

## Troubleshooting

**1. `ECONNREFUSED` / API calls fail in dev**

Cause: Backend not running on port 5000.

```bash
# Start backend first, then:
npm start
```

Check `src/proxy.conf.json` — `target` must match the backend port.

---

**2. `NullInjectorError: No provider for HttpClient`**

Cause: `provideHttpClient()` missing from `app.config.ts`.

```ts
// app.config.ts
import { provideHttpClient } from '@angular/common/http';

providers: [
  provideRouter(routes),
  provideHttpClient(),   // ← add this
]
```

---

**3. SSR hydration mismatch warning**

Cause: Component accesses `window` / `localStorage` on the server (which doesn't exist).

```ts
constructor(@Inject(PLATFORM_ID) private platformId: object) {}

ngOnInit() {
  if (isPlatformBrowser(this.platformId)) {
    // safe to use window / localStorage here
  }
}
```

---

## Quick Reference

```bash
# Dev server
npm start                                          # localhost:4200

# Build
npm run build                                      # production build
npm run watch                                      # dev build + watch

# SSR
npm run serve:ssr:frontend

# Tests
npm test

# Generate
ng g component features/shop/components/my-comp
ng g service   features/shop/services/my-service
ng g guard     core/guards/auth
ng g pipe      shared/pipes/truncate
ng g class     shared/models/product --type=model

# Format
npx prettier --write "src/**/*.{ts,html,scss}"
```
