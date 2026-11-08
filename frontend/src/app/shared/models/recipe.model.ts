export interface RecipeHeroImage {
  url: string;
  public_id: string;
}

export interface RecipeMetadata {
  servings: number;
  prepTime: number;
  cookTime: number | null;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  base?: 'MATCHA' | 'COFFEE' | 'OTHERS';
  tags: string[];
}

export interface RecipeIngredient {
  name: string;
  quantity?: number | string;
  unit?: string;
  optional: boolean;
}

export interface RecipeTool {
  name: string;
}

export interface RecipeStep {
  order: number;
  title: string;
  description: string;
  timerSeconds?: number;
  duration?: number;
}

export interface RecipeSource {
  type: string;
  author?: string;
  communityPostId?: string | null;
  communityPostTitle?: string | null;
  creatorName?: string | null;
  creatorAvatar?: string | null;
}

export type RecipeAvailability = 'visible' | 'hidden_owner';

export interface RecipeOwnerBanner {
  reason: string | null;
  note: string;
  status: string;
  review_round: number;
  max_review_rounds: number;
}

/** What a guest gets for a hidden recipe: no recipe body, only enough to show a resting page. */
export interface RecipeHiddenStub {
  availability: 'hidden';
  recipe_id: string;
  slug: string;
  title: string;
  message: string;
}

export type RecipeDetailResponse = Recipe | RecipeHiddenStub;

export function isRecipeHidden(recipe: RecipeDetailResponse): recipe is RecipeHiddenStub {
  return recipe.availability === 'hidden';
}

export interface Recipe {
  _id: string;
  recipe_id: string;
  title: string;
  slug: string;
  description?: string;
  heroImage: RecipeHeroImage;
  metadata: RecipeMetadata;
  ingredients: RecipeIngredient[];
  tools: RecipeTool[];
  steps: RecipeStep[];
  relatedProducts: string[];
  source: RecipeSource;
  saves: number;
  published: boolean;
  featured?: boolean;
  availability?: RecipeAvailability;
  can_edit?: boolean;
  can_delete?: boolean;
  can_submit_review?: boolean;
  owner_banner?: RecipeOwnerBanner;
  createdAt: string;
  updatedAt: string;
}
