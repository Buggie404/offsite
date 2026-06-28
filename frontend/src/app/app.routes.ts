import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

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
    path: 'account',
    loadChildren: () => import('./features/account/account-module').then(m => m.AccountModule),
    canActivate: [authGuard]
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin-module').then(m => m.AdminModule)
  },
  {
    path: 'about-us',
    loadComponent: () => import('./features/content/pages/about-us/about-us.component').then(m => m.AboutUsComponent)
  },
  {
    path: 'contact-us',
    loadComponent: () => import('./features/content/pages/contact-us/contact-us.component').then(m => m.ContactUsComponent)
  },
  {
    path: 'contact',
    redirectTo: 'contact-us',
    pathMatch: 'full'
  },
  {
    path: 'policies',
    loadComponent: () => import('./features/content/pages/policy/policy.component').then(m => m.PolicyComponent)
  }
];
