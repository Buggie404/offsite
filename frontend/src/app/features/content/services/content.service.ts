import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Recipe } from '../../../shared/models/recipe.model';

@Injectable({
  providedIn: 'root',
})
export class ContentService {
  private http = inject(HttpClient);
  private apiUrl = '/api/recipes';

  /**
   * Fetch all active/published recipes, optionally filtered by difficulty, tag, or source type.
   */
  getRecipes(filters?: { difficulty?: string; tag?: string; source_type?: string }): Observable<Recipe[]> {
    return this.http.get<Recipe[]>(this.apiUrl, { params: filters });
  }

  /**
   * Fetch a single recipe by its custom recipe_id, slug, or MongoDB ObjectId.
   */
  getRecipe(slugOrId: string): Observable<Recipe> {
    return this.http.get<Recipe>(`${this.apiUrl}/${slugOrId}`);
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