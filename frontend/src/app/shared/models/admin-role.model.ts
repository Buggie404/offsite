export const ADMIN_ROLES = ['admin_cc', 'cskh', 'qlsp'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  admin_cc: 'Admin CC',
  cskh: 'CSKH',
  qlsp: 'QLSP'
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole);
}