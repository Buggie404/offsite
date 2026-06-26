import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/home/pages/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'auth/success',
    loadComponent: () => import('./features/auth/pages/oauth-success.component').then(m => m.OAuthSuccessComponent)
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin-module').then(m => m.AdminModule)
  }
];
