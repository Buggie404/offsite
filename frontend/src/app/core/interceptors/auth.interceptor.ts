import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AdminAuthService } from '../../admin/services/admin-auth.service';

// Các domain bên thứ 3 KHÔNG được gắn Authorization của app vào
// (Cloudinary unsigned upload sẽ bị CORS reject nếu có header này)
const THIRD_PARTY_DOMAINS = ['api.cloudinary.com'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return next(req);
  }

  const isThirdParty = THIRD_PARTY_DOMAINS.some(domain => req.url.includes(domain));
  if (isThirdParty) {
    return next(req);
  }

  const isAdminApi = req.url.includes('/api/admin/') && !req.url.endsWith('/api/admin/login');
  const adminAuth = inject(AdminAuthService);
  const token = isAdminApi ? adminAuth.getToken() : localStorage.getItem('token');

  if (!token) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    })
  );
};