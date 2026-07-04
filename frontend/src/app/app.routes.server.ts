import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'admin/**',
    renderMode: RenderMode.Client
  },
  {
    path: 'checkout',
    renderMode: RenderMode.Client
  },
  {
    path: 'recipes/:slug',
    renderMode: RenderMode.Server
  },
  {
    path: 'journal/:slug',
    renderMode: RenderMode.Server
  },
  {
    path: 'shop/:category',
    renderMode: RenderMode.Client
  },
  {
    path: 'products/:id',
    renderMode: RenderMode.Client
  },
  {
    path: 'orders/:id/return',
    renderMode: RenderMode.Server
  },
  {
    path: 'order-tracking',
    renderMode: RenderMode.Client
  },
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
