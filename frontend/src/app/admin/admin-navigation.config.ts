import { AdminRole } from '../shared/models/admin-role.model';

export interface AdminNavItem {
  label: string;
  path: string;
  icon: string;
  roles: readonly AdminRole[];
  visibleRoles?: readonly AdminRole[];
}

export interface AdminNavGroup {
  label: string;
  items: readonly AdminNavItem[];
}

// Nhóm quyền — chỉ dùng 3 role thực tế trong DB: admin_cc, cskh, qlsp
// Sales Operations: admin_cc + qlsp
const SALES_OPS_ROLES: readonly AdminRole[] = ['admin_cc', 'qlsp'];

// Community & Support: admin_cc + cskh
const SERVICES_OPS_ROLES: readonly AdminRole[] = ['admin_cc', 'cskh'];

// System: chỉ admin_cc
const SYSTEM_ROLES: readonly AdminRole[] = ['admin_cc'];

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    label: '',
    items: [
      { label: 'Dashboard', path: '/admin/dashboard', icon: 'dashboard', roles: SYSTEM_ROLES },
      { label: 'Dashboard', path: '/admin/salesops-dashboard', icon: 'dashboard', roles: ['qlsp'] as const },
      { label: 'Dashboard', path: '/admin/servicesops-dashboard', icon: 'dashboard', roles: ['cskh'] as const }
    ]
  },
  {
    label: 'Sales Operations',
    items: [
      { label: 'Orders',        path: '/admin/orders',        icon: 'orders',        roles: SALES_OPS_ROLES },
      { label: 'Products',      path: '/admin/products',      icon: 'products',      roles: SALES_OPS_ROLES },
      { label: 'Customers',     path: '/admin/customers',     icon: 'customers',     roles: SALES_OPS_ROLES },
      { label: 'Vouchers',      path: '/admin/vouchers',      icon: 'vouchers',      roles: SALES_OPS_ROLES },
      { label: 'Subscriptions', path: '/admin/subscriptions', icon: 'subscriptions', roles: ['admin_cc', 'qlsp', 'cskh'] }
    ]
  },
  {
    label: 'Community & Support',
    items: [
      { label: 'Support chat',      path: '/admin/chat',              icon: 'support',   roles: SERVICES_OPS_ROLES },
      {
        // Services-Ops Customers — đường dẫn riêng, khác với Sales-Ops /admin/customers
        label: 'Customers',
        path: '/admin/service-customers',
        icon: 'customers',
        roles: SERVICES_OPS_ROLES,
        visibleRoles: ['cskh', 'admin_cc'] as readonly AdminRole[]
      },
      { label: 'Community reports', path: '/admin/community-reports', icon: 'reports',   roles: SERVICES_OPS_ROLES },
      { label: 'Recipes',           path: '/admin/recipes',           icon: 'recipes',   roles: SERVICES_OPS_ROLES }
    ]
  },
  {
    label: 'System',
    items: [
      { label: 'Staff',        path: '/admin/staff',        icon: 'staff',        roles: SYSTEM_ROLES },
      { label: 'Activity log', path: '/admin/activity-log', icon: 'activity-log', roles: SYSTEM_ROLES },
      { label: 'Starter quiz', path: '/admin/starter-quiz', icon: 'starter-quiz', roles: SYSTEM_ROLES },
      { label: 'Ritual DNA',   path: '/admin/ritual-dna',   icon: 'ritual-dna',   roles: SYSTEM_ROLES }
    ]
  }
];

export const ADMIN_DEFAULT_ROUTES: Record<AdminRole, string> = {
  admin_cc: '/admin/dashboard',
  cskh:     '/admin/servicesops-dashboard',
  qlsp:     '/admin/salesops-dashboard',
};
