import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { AdminAuthService } from '../../admin/services/admin-auth.service';

export const adminGuard: CanActivateFn = () => {
  const platformId = inject(PLATFORM_ID);
  const router = inject(Router);
  const adminAuth = inject(AdminAuthService);

  if (!isPlatformBrowser(platformId)) {
    return router.createUrlTree(['/admin/login']);
  }

  if (adminAuth.isAdmin()) {
    return true;
  }

  adminAuth.logout();
  return router.createUrlTree(['/admin/login']);
};
