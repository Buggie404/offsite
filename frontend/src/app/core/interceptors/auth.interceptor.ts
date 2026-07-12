import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AdminAuthService } from '../../admin/services/admin-auth.service';
import { environment } from '../../../environments/environment';

// Các domain bên thứ 3 KHÔNG được gắn Authorization của app vào
// (Cloudinary unsigned upload sẽ bị CORS reject nếu có header này)
const THIRD_PARTY_DOMAINS = ['api.cloudinary.com'];

// Backend origin lấy từ apiUrl (bỏ đuôi "/api"), ví dụ:
// "https://offsite-backend-cfjy.onrender.com/api" -> "https://offsite-backend-cfjy.onrender.com"
const BACKEND_ORIGIN = environment.apiUrl.replace(/\/api\/?$/, '');

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);

  // Viết lại các URL tương đối, bỏ qua URL tuyệt đối.
  const request = /^\/api(\/|$)/.test(req.url)
    ? req.clone({ url: BACKEND_ORIGIN + req.url })
    : req;

  if (!isPlatformBrowser(platformId)) {
    return next(request);
  }

  const isThirdParty = THIRD_PARTY_DOMAINS.some(domain => request.url.includes(domain));
  if (isThirdParty) {
    return next(request);
  }

  if (request.url.includes('/api/admin/login')) {
    return next(request);
  }

  const isAdminApi = request.url.includes('/api/admin/');
  const adminAuth = inject(AdminAuthService);
  const token = isAdminApi ? adminAuth.getToken() : localStorage.getItem('token');

  if (!token) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    })
  );
};