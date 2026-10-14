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

const ALL_ADMIN_ROLES: readonly AdminRole[] = ['admin_cc', 'cskh', 'qlsp'];
const ADMIN_CC_AND_CSKH: readonly AdminRole[] = ['admin_cc', 'cskh'];
const ADMIN_CC_AND_QLSP: readonly AdminRole[] = ['admin_cc', 'qlsp'];
const ADMIN_CC_ONLY: readonly AdminRole[] = ['admin_cc'];

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    label: '',
    items: [
      { label: 'Dashboard', path: '/admin/dashboard', icon: 'dashboard', roles: ALL_ADMIN_ROLES }
    ]
  },
  {
    label: 'Sales Operations',
    items: [
      { label: 'Orders', path: '/admin/orders', icon: 'orders', roles: ADMIN_CC_AND_QLSP },
      { label: 'Products', path: '/admin/products', icon: 'products', roles: ADMIN_CC_AND_QLSP },
      { label: 'Customers', path: '/admin/customers', icon: 'customers', roles: ADMIN_CC_AND_QLSP },
      { label: 'Vouchers', path: '/admin/vouchers', icon: 'vouchers', roles: ADMIN_CC_AND_QLSP },
      { label: 'Subscriptions', path: '/admin/subscriptions', icon: 'subscriptions', roles: ADMIN_CC_AND_QLSP }
    ]
  },
  {
    label: 'Community & Support',
    items: [
      { label: 'Support chat', path: '/admin/chat', icon: 'support', roles: ADMIN_CC_AND_CSKH },
      {
        label: 'Customers',
        path: '/admin/customers',
        icon: 'customers',
        roles: ALL_ADMIN_ROLES,
        visibleRoles: ['cskh']
      },
      { label: 'Community reports', path: '/admin/community-reports', icon: 'reports', roles: ADMIN_CC_AND_CSKH },
      { label: 'Recipes', path: '/admin/recipes', icon: 'recipes', roles: ADMIN_CC_AND_CSKH }
    ]
  },
  {
    label: 'System',
    items: [
      { label: 'Staff', path: '/admin/staff', icon: 'staff', roles: ADMIN_CC_ONLY },
      { label: 'Activity log', path: '/admin/activity-log', icon: 'activity-log', roles: ADMIN_CC_ONLY },
      { label: 'Starter quiz', path: '/admin/starter-quiz', icon: 'starter-quiz', roles: ADMIN_CC_ONLY },
      { label: 'Ritual DNA', path: '/admin/ritual-dna', icon: 'ritual-dna', roles: ADMIN_CC_ONLY }
    ]
  }
];

export const ADMIN_DEFAULT_ROUTES: Record<AdminRole, string> = {
  admin_cc: '/admin/orders',
  cskh: '/admin/chat',
  qlsp: '/admin/orders'
};