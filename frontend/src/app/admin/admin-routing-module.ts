import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { adminGuard } from '../core/guards/admin.guard';
import { adminGuestGuard } from '../core/guards/admin-guest.guard';

const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/sign-in/sign-in.component').then((m) => m.AdminSignInComponent),
    canActivate: [adminGuestGuard]
  },
  {
    path: '',
    loadComponent: () =>
      import('./pages/order-status-dashboard.component').then((m) => m.OrderStatusDashboardComponent),
    canActivate: [adminGuard]
  },
  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [CommonModule, RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AdminRoutingModule {}
