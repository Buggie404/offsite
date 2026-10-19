import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { adminGuard } from '../core/guards/admin.guard';
import { adminGuestGuard } from '../core/guards/admin-guest.guard';
import {
  adminHomeGuard,
  adminRoleGuard,
  adminUnknownRouteGuard
} from '../core/guards/admin-role.guard';
import { OrdersListingComponent } from './orders/pages/orders-listing/orders-listing.component';
import { OrderDetailComponent } from './orders/pages/order-detail/order-detail.component';

// Chỉ dùng 3 role thực tế trong DB
const SALES_OPS_ROLES    = ['admin_cc', 'qlsp'] as const;
const SERVICES_OPS_ROLES = ['admin_cc', 'cskh'] as const;
const SYSTEM_ROLES       = ['admin_cc'] as const;

// One route for /subscriptions and /subscriptions/:id so opening the drawer keeps the list mounted.
function subscriptionsMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments[0]?.path !== 'subscriptions' || segments.length > 2) return null;
  return {
    consumed: segments,
    posParams: segments[1] ? { id: segments[1] } : {}
  };
}

const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./auth/pages/sign-in/sign-in.component').then((m) => m.AdminSignInComponent),
    canActivate: [adminGuestGuard]
  },
  {
    path: '',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./shared/components/admin-layout/admin-layout.component').then((m) => m.AdminLayoutComponent),
    children: [
      // Redirect về trang mặc định theo role
      {
        path: '',
        pathMatch: 'full',
        canActivate: [adminHomeGuard],
        children: []
      },

      // ── Sales Operations ──────────────────────────────────────────────────
      {
        path: 'orders',
        component: OrdersListingComponent,
        canActivate: [adminRoleGuard],
        data: { adminRoles: SALES_OPS_ROLES }
      },
      {
        path: 'orders/:id',
        component: OrderDetailComponent,
        canActivate: [adminRoleGuard],
        data: { adminRoles: SALES_OPS_ROLES }
      },

      {
        matcher: subscriptionsMatcher,
        loadComponent: () =>
          import('./subscriptions/pages/subscriptions-listing/subscriptions-listing.component').then((m) => m.SubscriptionsListingComponent),
        canActivate: [adminRoleGuard],
        data: { adminRoles: SALES_OPS_ROLES }
      },

      // ── Error pages ───────────────────────────────────────────────────────
      {
        path: '403',
        loadComponent: () =>
          import('./errors/pages/forbidden/forbidden.component').then((m) => m.AdminForbiddenComponent)
      },
      {
        path: '404',
        loadComponent: () =>
          import('./errors/pages/not-found/not-found.component').then((m) => m.AdminNotFoundComponent)
      },

      // ── Wildcard — unknown routes qua adminUnknownRouteGuard ──────────────
      {
        path: '**',
        loadComponent: () =>
          import('./errors/pages/not-found/not-found.component').then((m) => m.AdminNotFoundComponent),
        canActivate: [adminUnknownRouteGuard]
      }
    ]
  },
  { path: '**', redirectTo: '404' }
];

@NgModule({
  imports: [CommonModule, RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AdminRoutingModule {}