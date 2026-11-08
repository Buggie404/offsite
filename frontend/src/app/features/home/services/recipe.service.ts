// ─────────────────────────────────────────────────────────────
//  services/recipe.service.ts
//  Fetches recipe data from the Express/MongoDB backend
// ─────────────────────────────────────────────────────────────

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Recipe } from '../models/recipe.model';
import { RecipeDetailResponse } from '../../../shared/models/recipe.model';
import { environment } from '../../../../environments/environment';

const BASE_URL = environment.apiUrl;

@Injectable({
  providedIn: 'root',
})
export class RecipeService {
  private readonly endpoint = `${BASE_URL}/recipes`;

  constructor(private http: HttpClient) {}

  /**
   * Fetch a paginated list of published recipes.
   * @param limit  How many recipes to return (default 3 for homepage section)
   * @param skip   Offset for pagination
   */
  getRecipes(limit = 3, skip = 0): Observable<Recipe[]> {
    const params = new HttpParams()
      .set('limit', limit.toString())
      .set('skip', skip.toString());

    return this.http.get<Recipe[]>(this.endpoint, { params });
  }

  /** Published recipes marked featured. The homepage rail reads this list. */
  getFeaturedRecipes(): Observable<Recipe[]> {
    const params = new HttpParams().set('featured', 'true');
    return this.http.get<Recipe[]>(this.endpoint, { params });
  }

  /** Most-saved published recipes. The homepage rail uses getFeaturedRecipes instead. */
  getMostSavedRecipes(limit = 3): Observable<Recipe[]> {
    const params = new HttpParams()
      .set('sort', 'saves')
      .set('limit', limit.toString());

    return this.http.get<Recipe[]>(this.endpoint, { params });
  }

  /**
   * Fetch a single recipe by its slug. The auth interceptor sends the bearer token when signed in.
   * Hidden recipes (guest stub or owner preview) are rejected so card rails never show them.
   */
  getRecipeBySlug(slug: string): Observable<Recipe> {
    return this.http.get<Recipe & Pick<RecipeDetailResponse, 'availability'>>(`${this.endpoint}/${slug}`).pipe(
      map(recipe => {
        if (recipe.availability === 'hidden' || recipe.availability === 'hidden_owner') {
          throw new Error('Recipe is hidden');
        }
        return recipe;
      })
    );
  }

  /**
   * Create a new community recipe.
   * Backend expects multipart FormData with JSON-stringified nested fields:
   * heroImage, metadata, ingredients, tools, steps (see recipes.controller.js).
   * Requires auth (JWT) — backend reads req.user.user_id.
   */
  createRecipe(data: FormData): Observable<{ message: string; data: Recipe }> {
    return this.http.post<{ message: string; data: Recipe }>(this.endpoint, data);
  }
}