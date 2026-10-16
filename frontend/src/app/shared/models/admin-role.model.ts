export const ADMIN_ROLES = ['admin_cc', 'cskh', 'qlsp'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

// Labels hiển thị trên UI (sidebar badge, 403 page, user menu...)
export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  admin_cc: 'Senior Admin',
  cskh:     'Services-Ops',
  qlsp:     'Sales-Ops',
};

// Badge‑only role labels – chỉ dùng để hiển thị trên UI, không ảnh hưởng vào auth
export const BADGE_ROLE_LABELS: Record<string, string> = {
  senior_admin:  'Senior Admin',
  sales_ops:     'Sales‑Ops',
  services_ops:  'Services‑Ops',
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole);
}