export function avatarInitials(name?: string | null): string {
  const parts = (name || '').trim().replace(/^@/, '').split(/[\s._-]+/u).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : Array.from(parts[0]).slice(0, 2).join('')).toLocaleUpperCase();
}
