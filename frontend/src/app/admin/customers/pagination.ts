// Page buttons for the Customers list and a customer's orders: every page up to 7,
// otherwise first, last and the pages around the current one, with null for "...".
export function pageList(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const around = [page - 1, page, page + 1].filter((p) => p > 1 && p < count);
  const list: (number | null)[] = [1];
  if (around[0] > 2) list.push(null);
  list.push(...around);
  if (around[around.length - 1] < count - 1) list.push(null);
  list.push(count);
  return list;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
