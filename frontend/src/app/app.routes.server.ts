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
    path: 'journal/:slug',
    renderMode: RenderMode.Server
  },
  {
    path: 'shop/:category',
    renderMode: RenderMode.Server
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender
  }
];