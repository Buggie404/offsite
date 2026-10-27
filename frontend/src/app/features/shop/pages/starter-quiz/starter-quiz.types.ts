export interface QuizOption {
  option_id: string;
  code: string;
  text: string;
  hint: string;
  icon: string;
  score_weights: Record<string, number>;
}

export interface QuizQuestion {
  question_id: string;
  quiz_type: string;
  code: string;
  question: string;
  order: number;
  visible_when: { question_id: string; option_id: string } | null;
  options: QuizOption[];
}

export interface QuizKitItem {
  slotKey: string;
  slotLabel: string;
  productId: number;
  variantSku: string;
  name: string;
  price: number;
  image: string;
  note: string | null;
  product: {
    _id?: string;
    product_id: number;
    name: string;
    slug?: string;
    category: string;
    images?: { url: string; public_id?: string; sort_order?: number }[];
    variants: { sku: string; label?: string; price: number; stock: number; is_default?: boolean; images?: { url: string; public_id?: string }[] }[];
    review_count?: number;
    is_active?: boolean;
  };
}

export interface QuizKit {
  title: string;
  why: string;
  archetypeId: string;
  kitType: 'bundle' | 'matcha_kit' | 'coffee_kit';
  packSize: 2 | 3;
  categoryFilter: 'all' | 'matcha' | 'coffee';
  discountPercent: number;
  pricing: { original: number; sale: number };
  notes: string[];
  items: QuizKitItem[];
  slotProductOrder: Record<string, number[]>;
  bundleId: string;
}

export interface QuizResult {
  result_id: string;
  user_id: string | null;
  session_id: string | null;
  quiz_type: string;
  answers: { question_id: string; option_id: string }[];
  scores: Record<string, number>;
  bundle_id: string | null;
  archetype_id: string | null;
  kit: QuizKit;
  created_at: string;
}
