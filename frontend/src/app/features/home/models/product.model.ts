// home/models/product.model.ts

export interface ProductImage {
  url: string;
  public_id?: string;
  sort_order: number;
  alt_text: string;
}

export interface Variant {
  sku: string;
  label: string;
  price: number;
  stock: number | null;
  is_default: boolean;
  images: ProductImage[];
}

export interface MatchaMeta {
  product_grade?: string | null;
  origin?: string;
  pricing_tier?: string;
}

export interface CoffeeMeta {
  roast_level?: string;
  process_type?: string;
  product_origin?: string;
  tasting_notes?: string[];
}

export interface DrinkwareMeta {
  ware_type?: string;
  material?: string;
  product_size?: string;
}

export interface ToolsMeta {
  tool_category?: string;
  tool_type?: string;
}

export interface SetsBundlesMeta {
  set_type?: string;
  is_exclusive?: boolean;
  composition?: unknown[];
}

export interface Product {
  _id?: string;
  product_id: number;
  name: string;
  slug?: string;
  description?: string;
  category: string;
  product_tag?: string[];
  variant_type?: string;
  images: ProductImage[];
  variants: Variant[];
  rating_avg?: number | null;
  review_count?: number;
  total_sold_quantity?: number;
  is_best_seller?: boolean;
  is_new_arrival?: boolean;
  is_active?: boolean;

  matcha?: MatchaMeta;
  coffee?: CoffeeMeta;
  drinkware?: DrinkwareMeta;
  tools?: ToolsMeta;
  sets_bundles?: SetsBundlesMeta;
}

// Helper: lấy origin từ bất kỳ category nào
export function slugifyProductName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getProductDetailSlug(p: Pick<Product, 'name' | 'slug' | '_id' | 'product_id'>): string {
  return slugifyProductName(p.name) || p.slug?.trim() || p._id || String(p.product_id);
}

export function getProductOrigin(p: Product): string {
  if (p.matcha?.origin) return p.matcha.origin;
  if (p.coffee?.product_origin) return p.coffee.product_origin;
  if (p.drinkware?.ware_type) return p.drinkware.ware_type;
  if (p.tools?.tool_category) return p.tools.tool_category;
  return '';
}

// Helper: lấy price từ variant is_default
export function getDefaultPrice(p: Product): number {
  const def = p.variants.find(v => v.is_default) ?? p.variants[0];
  return def?.price ?? 0;
}

// The representative image is explicitly the image with sort_order 0.
// Keep a safe fallback for legacy records that do not have that value.
export function getPrimaryProductImage(p: Product): ProductImage | undefined {
  return p.images.find(image => image.sort_order === 0)
    ?? [...p.images].sort((a, b) =>
      (a.sort_order ?? Number.MAX_SAFE_INTEGER)
      - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
    )[0];
}

export function isProductOutOfStock(p: Product): boolean {
  return p.variants.length === 0
    || p.variants.every(variant => (variant.stock ?? 0) <= 0);
}

export function isProductNewArrivalEligible(p: Product): boolean {
  return p.variants.length > 0
    && p.variants.every(variant => (variant.stock ?? 0) > 0);
}
