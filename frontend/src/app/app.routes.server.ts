import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'admin/**',
    renderMode: RenderMode.Server
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
    renderMode: RenderMode.Server
  },
  {
    path: 'products/:id',
    renderMode: RenderMode.Server
  },
  {
    path: 'orders/:id/return',
    renderMode: RenderMode.Server
  },
  {
    path: 'order-tracking',
    renderMode: RenderMode.Server
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender
  }
];