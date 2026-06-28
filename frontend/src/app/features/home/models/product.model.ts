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
  is_active?: boolean;

  matcha?: MatchaMeta;
  coffee?: CoffeeMeta;
  drinkware?: DrinkwareMeta;
  tools?: ToolsMeta;
}

// Helper: lấy origin từ bất kỳ category nào
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