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
    path: 'checkout/payment-qr',
    loadComponent: () => import('./features/purchase/pages/payment-qr/payment-qr.component').then(m => m.PaymentQrComponent)
  },
  {
    path: 'checkout/payment-qr/scan',
    loadComponent: () => import('./features/purchase/pages/payment-qr-scan/payment-qr-scan.component').then(m => m.PaymentQrScanComponent)
  },
  {
    path: 'checkout/confirmed',
    loadComponent: () => import('./features/purchase/pages/order-confirmed/order-confirmed.component').then(m => m.OrderConfirmedComponent)
  },
  {
    path: 'checkout/pending',
    loadComponent: () => import('./features/purchase/pages/order-detail/order-detail.component').then(m => m.OrderDetailComponent)
  },
  {
    path: 'checkout/canceled',
    loadComponent: () => import('./features/purchase/pages/order-detail/order-detail.component').then(m => m.OrderDetailComponent)
  },
  {
    path: 'checkout/processing',
    loadComponent: () => import('./features/purchase/pages/order-detail/order-detail.component').then(m => m.OrderDetailComponent)
  },
  {
    path: 'checkout/shipping',
    loadComponent: () => import('./features/purchase/pages/order-detail/order-detail.component').then(m => m.OrderDetailComponent)
  },
  {
    path: 'checkout/delivered',
    loadComponent: () => import('./features/purchase/pages/order-detail/order-detail.component').then(m => m.OrderDetailComponent)
  },
  {
    path: 'checkout/refund',
    loadComponent: () => import('./features/purchase/pages/order-detail/order-detail.component').then(m => m.OrderDetailComponent)
  },
  {
    path: 'orders/:id/return',
    loadComponent: () => import('./features/purchase/pages/order-return/order-return.component').then(m => m.OrderReturnComponent)
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
    path: 'order-tracking',
    loadComponent: () => import('./features/purchase/pages/order-tracking/order-tracking.component').then(m => m.OrderTrackingComponent)
  },
  {
    path: 'products/best-seller',
    redirectTo: 'shop/best-seller',
    pathMatch: 'full'
  },
  {
    path: 'shop/best-sellers',
    redirectTo: 'shop/best-seller',
    pathMatch: 'full'
  },
  {
    path: 'shop/build-your-bundle',
    loadComponent: () =>
      import('./features/shop/pages/build-your-bundle/build-your-bundle.component').then(
        (m) => m.BuildYourBundleComponent
      )
  },
  {
    path: 'shop/:category',
    loadComponent: () => import('./features/shop/pages/category/category.component').then(m => m.CategoryComponent)
  },
  {
    path: 'products/:id',
    loadComponent: () => import('./features/shop/pages/product-detail/product-detail.component').then(m => m.ProductDetailComponent)
  },
  {
    path: 'search',
    loadComponent: () => import('./shared/components/search-results/search-results.component').then(m => m.SearchResultsComponent)
  },
  {
    path: 'community',
    loadChildren: () => import('./features/community/community-module').then(m => m.CommunityModule)
  },
  {
    path: '404',
    loadComponent: () => import('./shared/components/not-found/not-found.component').then(m => m.NotFoundComponent)
  },
  {
    path: '**',
    loadComponent: () => import('./shared/components/not-found/not-found.component').then(m => m.NotFoundComponent)
  },
];

