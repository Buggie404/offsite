import { NgModule } from '@angular/core';

import { CommonModule } from '@angular/common';

import { RouterModule, Routes } from '@angular/router';

import { adminGuard } from '../core/guards/admin.guard';

import { adminGuestGuard } from '../core/guards/admin-guest.guard';

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

      { path: '', pathMatch: 'full', redirectTo: 'orders' },

      { path: 'orders', component: OrdersListingComponent },

      { path: 'orders/:id', component: OrderDetailComponent }

    ]

  },

  { path: '**', redirectTo: 'orders' }

];



@NgModule({

  imports: [CommonModule, RouterModule.forChild(routes)],

  exports: [RouterModule]

})

export class AdminRoutingModule {}

