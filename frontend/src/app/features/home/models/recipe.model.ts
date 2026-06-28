// ─────────────────────────────────────────────────────────────
//  models/recipe.model.ts
//  Matches the MongoDB document structure from the recipes collection
// ─────────────────────────────────────────────────────────────

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type RecipeTag  = 'HOT' | 'COLD' | 'DESSERT' | 'COCKTAIL';

export interface RecipeHeroImage {
  url:       string;
  public_id: string;
}

export interface RecipeMetadata {
  servings:   number;
  prepTime:   number;             // minutes
  cookTime:   number | null;
  difficulty: Difficulty;
  tags:       RecipeTag[];
}

export interface RecipeIngredient {
  name:     string;
  quantity: number;
  unit:     string;
  optional: boolean;
}

export interface RecipeTool {
  name: string;
}

export interface RecipeStep {
  order:        number;
  title:        string;
  description:  string;
  timerSeconds?: number;
}

export interface RecipeSource {
  type:               string;
  author:             string | null;
  communityPostId:    string | null;
  communityPostTitle: string | null;
  creatorName:        string | null;
  creatorAvatar:      string | null;
}

export interface Recipe {
  _id:             string;
  recipe_id:       string;
  title:           string;
  slug:            string;
  description:     string;
  heroImage:       RecipeHeroImage;
  metadata:        RecipeMetadata;
  ingredients:     RecipeIngredient[];
  tools:           RecipeTool[];
  steps:           RecipeStep[];
  relatedProducts: unknown[];
  source:          RecipeSource;
  saves:           number;
  published:       boolean;
  createdAt:       string;
  updatedAt:       string;
}