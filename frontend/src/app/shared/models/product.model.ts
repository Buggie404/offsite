export interface ProductImage {
  url: string;
  public_id: string;
  sort_order?: number;
  alt_text?: string;
}

export interface ProductVariant {
  sku: string;
  label?: string;
  price: number;
  stock: number;
  is_default: boolean;
  images?: ProductImage[];
}

export interface MatchaDetails {
  product_grade?: string;
  origin?: string;
  pricing_tier?: string;
}

export interface CoffeeDetails {
  roast_level?: string;
  process_type?: string;
  product_origin?: string;
  tasting_notes?: string[];
}

export interface DrinkwareDetails {
  ware_type?: string;
  material?: string;
  product_size?: string;
}

export interface SetsBundlesDetails {
  set_type?: string;
  is_exclusive?: boolean;
  composition?: string[];
}

export interface ToolsDetails {
  tool_category?: string;
  tool_type?: string;
}

export interface Product {
  _id: string;
  product_id: number;
  name: string;
  slug: string;
  description?: string;
  seo_title?: string;
  category: 'matcha' | 'coffee' | 'drinkware' | 'sets_bundles' | 'tools';
  product_tag?: string[];
  variant_type: 'none' | 'size' | 'color' | 'type';
  images: ProductImage[];
  variants: ProductVariant[];
  rating_avg?: number | null;
  review_count: number;
  createdAt: string;
  updatedAt: string;
  is_active: boolean;

  // Category-specific details
  matcha?: MatchaDetails;
  coffee?: CoffeeDetails;
  drinkware?: DrinkwareDetails;
  sets_bundles?: SetsBundlesDetails;
  tools?: ToolsDetails;
}
