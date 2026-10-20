import { Recipe } from '../../home/models/recipe.model';
import { getProductDetailSlug } from '../../home/models/product.model';

export interface PostAuthor {
  username: string;
  avatar_url: string | null;
}

export interface PostMedia {
  url: string;
  public_id: string;
  type: 'image' | 'video';
}

export interface PostProductCard {
  product_id: number;
  name: string;
  slug?: string;
  image_url: string | null;
}

export function postProductLink(p: PostProductCard): string[] {
  return ['/products', getProductDetailSlug({ name: p.name, slug: p.slug, product_id: p.product_id })];
}

export interface ProductTag {
  product_id: number;
  name: string;
  image_url: string | null;
  price?: number | null;
  source?: 'manual' | 'ai';
  confidence?: number | null;
}

export interface Post {
  _id: string;
  post_id: string;
  user_id: string;

  author: PostAuthor;
  post_type: string;
  content: string;
  media: PostMedia[];

  recipe_id: string | null;
  base: 'MATCHA' | 'COFFEE' | 'RECIPE';
  like_count: number;
  comment_count: number;
  share_count: number;
  save_count: number;
  liked?: boolean;
  saved?: boolean;

  created_at: string;
  updatedAt: string;

  recipe?: Recipe;

  // Tagged products (max 3) resolved by the API, and visibility state.
  products?: PostProductCard[];
  status?: 'visible' | 'hidden';
}

export interface FeedResponse {
  data: Post[];
  total: number;
  page: number;
  limit: number;
}