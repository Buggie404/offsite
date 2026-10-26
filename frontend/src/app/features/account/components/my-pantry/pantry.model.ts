export type PantrySource = 'order' | 'subscription' | 'manual';
export type PantryFilter = 'all' | 'expiring' | 'expired' | 'offsite' | 'me';
export type PantryCountdown = 'normal' | 'warning' | 'danger' | 'expired' | 'unknown' | 'used_up';
export type PantryItemStatus = 'active' | 'used_up' | 'expired';
export type PantryRecipeStatus = 'progress' | 'done';
export type PantryCategory = 'matcha' | 'coffee' | 'tools' | 'drinkware' | 'sets_bundles' | 'other';

export interface PantryItem {
  id: string;
  name: string;
  source: PantrySource;
  status: PantryItemStatus;
  category: PantryCategory | null;
  imageUrl: string | null;
  quantity: number | null;
  unit: string;
  quantityLabel: string;
  daysLeft: number | null;
  countdown: PantryCountdown;
  expiryLabel: string;
  productId: string | null;
  productSlug?: string | null;
  productName?: string | null;
  purchasable?: boolean;
}

export interface PantryRecipe {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  matchLabel: string;
  matchTone: 'success' | 'warning';
  status: PantryRecipeStatus;
  step: number;
  totalSteps: number;
  completedOn: string | null;
  doneCount: number;
}

export interface PantrySuggestion {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  matchLabel: string;
  matchTone: 'success' | 'warning';
}

export interface PantrySuggestions {
  ready: PantrySuggestion[];
  almost: PantrySuggestion[];
  readyTotal: number;
  almostTotal: number;
}

export interface PantryCartImage {
  url: string;
  public_id?: string;
  sort_order?: number;
  alt_text?: string;
}

export interface PantryCartVariant {
  sku: string;
  label?: string;
  price: number;
  stock: number;
  is_default: boolean;
  images?: PantryCartImage[];
}

export interface PantryCartProduct {
  _id: string;
  product_id: number;
  name: string;
  slug: string;
  category: string;
  variant_type?: string;
  images: PantryCartImage[];
  variants: PantryCartVariant[];
  is_subscribable?: boolean;
  is_subscription?: boolean;
  subscribe_discount_percent?: number | null;
  is_active?: boolean;
  review_count?: number;
}

export interface PantryMissing {
  id: string;
  productId: number;
  name: string;
  slug: string;
  imageUrl: string | null;
  unlocks: string;
  price: number | null;
  product?: PantryCartProduct | null;
}

export interface PantrySnapshot {
  items: PantryItem[];
  recipes: PantryRecipe[];
  suggestions?: PantrySuggestions;
  missing: PantryMissing[];
}

export type PantryCoverageStatus = 'deducted' | 'partial' | 'staple' | 'unconverted' | 'missing' | 'tool';

export interface PantryCoverageItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
}

export interface PantryCoverageRow {
  name: string;
  covered: boolean;
  staple: boolean;
  status: PantryCoverageStatus;
  quantity: number | null;
  unit: string;
  deductQuantity: number | null;
  deductUnit: string | null;
  drawQuantity: number | null;
  drawUnit: string | null;
  note: string;
  items: PantryCoverageItem[];
  candidates: PantryCoverageItem[];
}

export interface PantryCoverage {
  recipeId: string;
  stock?: { id: string; quantity: number | null; unit: string }[];
  ingredients: PantryCoverageRow[];
  tools: PantryCoverageRow[];
}
