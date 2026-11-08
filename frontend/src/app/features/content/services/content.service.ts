import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Recipe, RecipeDetailResponse } from '../../../shared/models/recipe.model';

export interface OwnRecipeDraft {
  title: string;
  description: string;
  base: string;
  serves: string[];
  difficulty: string;
  servings: number;
  prepTime: number;
  ingredients: { name: string; quantity: number | string | null; unit: string }[];
  tools: { name: string }[];
  steps: { title: string; description: string; timer_seconds: number | null }[];
  /** Product ids shown in “Complete the ritual” (max 3). */
  related_products?: number[];
  hero_image?: { url: string; public_id: string } | null;
}

export interface JournalState {
  articles: any[];
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  searchQuery: string;
  selectedCategory: string;
  selectedSort: string;
  scrollY: number;
}

export interface RecipeState {
  allRecipes: Recipe[];
  filteredRecipes: Recipe[];
  searchQuery: string;
  selectedBase: string;
  selectedStyle: string;
  selectedSort: string;
  scrollY: number;
}

@Injectable({
  providedIn: 'root',
})
export class ContentService {
  private http = inject(HttpClient);
  private apiUrl = '/api/recipes';
  
  public journalState?: JournalState;
  public recipeState?: RecipeState;

  /**
   * Fetch all active/published recipes, optionally filtered by difficulty, tag, or source type.
   */
  getRecipes(filters?: { difficulty?: string; tag?: string; source_type?: string }): Observable<Recipe[]> {
    return this.http.get<Recipe[]>(this.apiUrl, { params: filters });
  }

  /**
   * Fetch a single recipe by its custom recipe_id, slug, or MongoDB ObjectId.
   */
  getRecipe(slugOrId: string): Observable<RecipeDetailResponse> {
    // The auth interceptor adds the bearer token when signed in, so owners get their flags back.
    return this.http.get<RecipeDetailResponse>(`${this.apiUrl}/${slugOrId}`);
  }

  /** Owner edit of a Recipes-page recipe. Returns the recipe as the owner sees it. */
  updateOwnRecipe(recipeId: string, body: OwnRecipeDraft): Observable<Recipe> {
    return this.http.put<Recipe>(`${this.apiUrl}/${encodeURIComponent(recipeId)}`, body);
  }

  /** Owner soft-delete. The recipe 404s afterwards. */
  deleteOwnRecipe(recipeId: string): Observable<{ data: { recipe_id: string; deleted?: boolean } }> {
    return this.http.delete<{ data: { recipe_id: string; deleted?: boolean } }>(
      `${this.apiUrl}/${encodeURIComponent(recipeId)}`
    );
  }

  /** Ask admins to review a recipe hidden as low quality. */
  submitOwnRecipeForReview(recipeId: string): Observable<Recipe> {
    return this.http.post<Recipe>(`${this.apiUrl}/${encodeURIComponent(recipeId)}/submit-for-review`, {});
  }

  /**
   * Fetch all blogs from the database.
   * Returns paginated response with { data, pagination }
   */
  getBlogs(filters?: { 
    category?: string; 
    search?: string; 
    sort?: string; 
    tag?: string;
    page?: number;
    limit?: number;
    skip?: number;
  }): Observable<{ data: any[]; pagination: any }> {
    return this.http.get<{ data: any[]; pagination: any }>('/api/blogs', { params: filters });
  }

  /**
   * Fetch a single blog by its slug
   */
  getBlogBySlug(slug: string): Observable<any> {
    return this.http.get<any>(`/api/blogs/${slug}`);
  }

}