import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AdminAuthService } from '../../admin/auth/services/admin-auth.service';
import { ToastService } from '../../shared/services/toast.service';
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

  // A caller that already set a token (e.g. first sign-in password change) keeps it.
  if (request.headers.has('Authorization')) {
    return next(request);
  }

  // Support chat shares /api/chat with customers: on admin pages staff call it with their own token.
  const isStaffChat = request.url.includes('/api/chat/') && window.location.pathname.startsWith('/admin');
  const isAdminApi = request.url.includes('/api/admin/') || isStaffChat;
  const adminAuth = inject(AdminAuthService);
  const token = isAdminApi ? adminAuth.getToken() : localStorage.getItem('token');

  if (!token) {
    return next(request);
  }

  const authorized = request.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!isAdminApi) {
    // Community suspension: every blocked action explains itself the same way.
    const toast = inject(ToastService);
    return next(authorized).pipe(
      catchError((err) => {
        if (err?.status === 403 && err?.error?.code === 'COMMUNITY_RESTRICTED') toast.error(err.error.error);
        return throwError(() => err);
      })
    );
  }

  // Password reset while signed in: the session is useless until the new temporary password is replaced.
  const router = inject(Router);
  return next(authorized).pipe(
    catchError((err) => {
      if (err?.status === 403 && err?.error?.code === 'PASSWORD_CHANGE_REQUIRED') {
        adminAuth.logout();
        void router.navigateByUrl('/admin/login', { replaceUrl: true });
      }
      return throwError(() => err);
    })
  );
};