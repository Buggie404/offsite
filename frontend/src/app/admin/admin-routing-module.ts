import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { adminGuard } from '../core/guards/admin.guard';
import { adminGuestGuard } from '../core/guards/admin-guest.guard';
import {
  adminHomeGuard,
  adminRoleGuard,
  adminUnknownRouteGuard
} from '../core/guards/admin-role.guard';
import { OrdersListingComponent } from './pages/orders-listing/orders-listing.component';
import { OrderDetailComponent } from './pages/order-detail/order-detail.component';

const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/sign-in/sign-in.component').then((m) => m.AdminSignInComponent),
    canActivate: [adminGuestGuard]
  },
  {
    path: '',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./components/admin-layout/admin-layout.component').then((m) => m.AdminLayoutComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [adminHomeGuard],
        children: []
      },
      {
        path: 'orders',
        component: OrdersListingComponent,
        canActivate: [adminRoleGuard],
        data: { adminRoles: ['admin_cc', 'cskh', 'qlsp'] }
      },
      {
        path: 'orders/:id',
        component: OrderDetailComponent,
        canActivate: [adminRoleGuard],
        data: { adminRoles: ['admin_cc', 'cskh', 'qlsp'] }
      },
      {
        path: '403',
        loadComponent: () =>
          import('./pages/forbidden/forbidden.component').then((m) => m.AdminForbiddenComponent)
      },
      {
        path: '404',
        loadComponent: () =>
          import('./pages/not-found/not-found.component').then((m) => m.AdminNotFoundComponent)
      },
      {
        path: '**',
        loadComponent: () =>
          import('./pages/not-found/not-found.component').then((m) => m.AdminNotFoundComponent),
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