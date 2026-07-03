import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/home/pages/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'oauth-success',
    loadComponent: () =>
      import('./features/auth/pages/oauth-success.component')
        .then(m => m.OAuthSuccessComponent)
  },
  {
    path: 'account',
    loadChildren: () => import('./features/account/account-module').then(m => m.AccountModule),
    canActivate: [authGuard]
  },
  {
    path: 'checkout',
    loadComponent: () => import('./features/purchase/pages/checkout/checkout.component').then(m => m.CheckoutComponent)
  },
  {
    path: 'checkout/confirmed',
    loadComponent: () => import('./features/purchase/pages/order-confirmed/order-confirmed.component').then(m => m.OrderConfirmedComponent)
  },
  {
    path: 'checkout/canceled',
    loadComponent: () => import('./features/purchase/pages/order-canceled/order-canceled.component').then(m => m.OrderCanceledComponent)
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin-module').then(m => m.AdminModule)
  },
  {
    path: 'recipes',
    loadComponent: () => import('./features/content/pages/recipes/recipes.component').then(m => m.RecipesComponent)
  },
  {
    path: 'recipes/:slug',
    loadComponent: () => import('./features/content/pages/recipe-detail/recipe-detail.component').then(m => m.RecipeDetailComponent)
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
  },
  {
    path: 'journal',
    loadComponent: () => import('./features/content/pages/journal/journal.component').then(m => m.JournalComponent),
    resolve: {
      // Preload data on route activation (client-side only)
    }
  },
  {
    path: 'journal/:slug',
    loadComponent: () => import('./features/content/pages/blog-detail/blog-detail.component').then(m => m.BlogDetailComponent)
  },
  {
    path: 'shop/:category',
    loadComponent: () => import('./features/shop/pages/category/category.component').then(m => m.CategoryComponent)
  }
];

