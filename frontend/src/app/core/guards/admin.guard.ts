import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { AdminAuthService } from '../../admin/services/admin-auth.service';

export const adminGuard: CanActivateFn = () => {
  const platformId = inject(PLATFORM_ID);
  const router = inject(Router);
  const adminAuth = inject(AdminAuthService);

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  if (adminAuth.isAdmin()) {
    return true;
  }

  if (adminAuth.getToken()) {
    adminAuth.logout();
  }
  return router.createUrlTree(['/admin/login']);
};
