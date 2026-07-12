// ─────────────────────────────────────────────────────────────
//  services/recipe.service.ts
//  Fetches recipe data from the Express/MongoDB backend
// ─────────────────────────────────────────────────────────────

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Recipe } from '../models/recipe.model';
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

  /** Fetch the most-saved published recipes for the homepage. */
  getMostSavedRecipes(limit = 3): Observable<Recipe[]> {
    const params = new HttpParams()
      .set('sort', 'saves')
      .set('limit', limit.toString());

    return this.http.get<Recipe[]>(this.endpoint, { params });
  }

  /**
   * Fetch a single recipe by its slug.
   */
  getRecipeBySlug(slug: string): Observable<Recipe> {
    return this.http.get<Recipe>(`${this.endpoint}/${slug}`);
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