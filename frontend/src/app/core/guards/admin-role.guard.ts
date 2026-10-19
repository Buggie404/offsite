import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { AdminAuthService } from '../../admin/auth/services/admin-auth.service';
import { ADMIN_NAV_GROUPS } from '../../admin/admin-navigation.config';
import { ADMIN_DEFAULT_ROUTES } from '../../admin/admin-navigation.config';
import { AdminRole } from '../../shared/models/admin-role.model';

export const adminRoleGuard: CanActivateFn = (route, state) => {
  const platformId = inject(PLATFORM_ID);
  const router = inject(Router);
  const adminAuth = inject(AdminAuthService);

  if (!isPlatformBrowser(platformId)) return true;
  if (!adminAuth.isAdmin()) return router.createUrlTree(['/admin/login']);

  const role = adminAuth.getAdminRole();
  const allowedRoles = route.data['adminRoles'] as readonly AdminRole[] | undefined;
  if (role && allowedRoles?.includes(role)) return true;

  return router.createUrlTree(['/admin/403'], { queryParams: { returnUrl: state.url } });
};

export const adminHomeGuard: CanActivateFn = () => {
  const platformId = inject(PLATFORM_ID);
  const router = inject(Router);
  const adminAuth = inject(AdminAuthService);

  if (!isPlatformBrowser(platformId)) return true;
  if (!adminAuth.isAdmin()) return router.createUrlTree(['/admin/login']);

  const role = adminAuth.getAdminRole();
  return router.parseUrl(role ? ADMIN_DEFAULT_ROUTES[role] : '/admin/403');
};

export const adminUnknownRouteGuard: CanActivateFn = (_route, state) => {
  const platformId = inject(PLATFORM_ID);
  const router = inject(Router);
  const adminAuth = inject(AdminAuthService);

  if (!isPlatformBrowser(platformId)) return true;
  if (!adminAuth.isAdmin()) return router.createUrlTree(['/admin/login']);

  const role = adminAuth.getAdminRole();
  const firstSegment = state.url.split('?')[0].replace(/^\/admin\/?/, '').split('/')[0];
  const requestedItems = ADMIN_NAV_GROUPS.flatMap((group) => group.items).filter(
    (item) => item.path === `/admin/${firstSegment}`
  );

  if (requestedItems.length && (!role || !requestedItems.some((item) => item.roles.includes(role)))) {
    return router.createUrlTree(['/admin/403'], { queryParams: { returnUrl: state.url } });
  }

  return true;
};