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
// Ritual Box: CSKH can view (read-only + notes); actions are limited per role on the server.
const SUBSCRIPTION_VIEW_ROLES = ['admin_cc', 'qlsp', 'cskh'] as const;
const SERVICES_OPS_ROLES = ['admin_cc', 'cskh'] as const;
const SYSTEM_ROLES       = ['admin_cc'] as const;
const SALES_DASHBOARD_ROLES = ['admin_cc', 'qlsp'] as const;
const SERVICES_DASHBOARD_ROLES = ['admin_cc', 'cskh'] as const;

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
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./dashboard/pages/dashboard/dashboard.component').then((m) => m.AdminDashboardComponent),
        canActivate: [adminRoleGuard],
        data: { adminRoles: SYSTEM_ROLES }
      },
      {
        path: 'salesops-dashboard',
        loadComponent: () =>
          import('./sales-dashboard/pages/sales-dashboard/sales-dashboard.component').then((m) => m.SalesDashboardComponent),
        canActivate: [adminRoleGuard],
        data: { adminRoles: SALES_DASHBOARD_ROLES }
      },
      {
        path: 'servicesops-dashboard',
        loadComponent: () =>
          import('./services-dashboard/pages/services-dashboard/services-dashboard.component').then((m) => m.ServicesDashboardComponent),
        canActivate: [adminRoleGuard],
        data: { adminRoles: SERVICES_DASHBOARD_ROLES }
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
        data: { adminRoles: SUBSCRIPTION_VIEW_ROLES }
      },

      // ── Services Operations ───────────────────────────────────────────────
      {
        path: 'chat',
        loadComponent: () =>
          import('./chat/pages/chat/chat.component').then((m) => m.AdminChatComponent),
        canActivate: [adminRoleGuard],
        data: { adminRoles: SERVICES_OPS_ROLES }
      },

      {
        path: 'community-reports',
        loadComponent: () =>
          import('./community-reports/pages/community-reports/community-reports.component').then((m) => m.AdminCommunityReportsComponent),
        canActivate: [adminRoleGuard],
        data: { adminRoles: SERVICES_OPS_ROLES }
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
