import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, shareReplay, tap, throwError } from 'rxjs';

export interface AdminRecipeList {
  data: AdminRecipeRow[];
  featured_recipes: FeaturedSlot[];
  featured_limit: number;
}

export type AdminRecipeSource = 'offsite' | 'community';
export type AdminRecipeLink = 'linked' | 'not_linked' | 'not_allowed';

export type AdminModerationStatus = 'visible' | 'hidden' | 'resubmitted' | 'hidden_final' | 'deleted';

export interface AdminRecipeRow {
  recipe_id: string;
  title: string;
  slug: string;
  image_url: string | null;
  author_line: string;
  source: AdminRecipeSource;
  linked: AdminRecipeLink;
  linked_count: number;
  featured: boolean;
  published: boolean;
  deleted?: boolean;
  moderation_status?: AdminModerationStatus;
  hidden_reason?: string | null;
  review_round?: number;
  updated_at: string | null;
}

export interface LinkableProduct {
  product_id: string;
  name: string;
  sku: string;
  image_url: string | null;
  in_stock: boolean;
  matched_hint?: string | null;
}

export interface FeaturedSlot {
  recipe_id: string;
  title: string;
  image_url: string | null;
}

export interface AdminRecipeStep {
  title: string;
  description: string;
  timer_seconds: number | null;
}

export interface AdminRecipeDetail {
  recipe_id: string;
  title: string;
  slug: string;
  description: string;
  image_url: string | null;
  hero_image: { url: string; public_id: string } | null;
  source: AdminRecipeSource;
  author_line: string;
  base: string;
  serves: string[];
  difficulty: string;
  servings: number;
  prepTime: number;
  ingredients: { name: string; quantity: number | string | null; unit: string }[];
  tools: { name: string; quantity: number | string | null }[];
  steps: AdminRecipeStep[];
  featured: boolean;
  published: boolean;
  deleted?: boolean;
  moderation_status?: AdminModerationStatus;
  hidden_reason?: string | null;
  hidden_note?: string;
  review_round?: number;
  max_review_rounds?: number;
  can_edit_content?: boolean;
  updated_at: string | null;
  can_link_products: boolean;
  linked_products: LinkableProduct[];
  suggestions: LinkableProduct[];
  featured_recipes: FeaturedSlot[];
  featured_limit: number;
}

export interface AdminRecipeDraft {
  title: string;
  description: string;
  base: string;
  serves: string[];
  difficulty: string;
  servings: number;
  prepTime: number;
  ingredients: { name: string; quantity: number | string | null; unit: string }[];
  tools: { name: string }[];
  steps: AdminRecipeStep[];
  published?: boolean;
  featured: boolean;
  related_products: string[];
  replace_recipe_id?: string | null;
  hero_image?: { url: string; public_id: string } | null;
}

export type AdminRecipeFeatureDraft = Pick<AdminRecipeDraft, 'featured' | 'replace_recipe_id'>;

@Injectable({ providedIn: 'root' })
export class AdminRecipeService {
  private http = inject(HttpClient);
  private cache: AdminRecipeList | null = null;
  private pending: Observable<AdminRecipeList> | null = null;

  list(): Observable<AdminRecipeList> {
    if (this.cache) return of(this.cache);
    if (!this.pending) {
      this.pending = this.http.get<AdminRecipeList>('/api/admin/recipes').pipe(
        tap((response) => {
          this.cache = {
            data: response.data || [],
            featured_recipes: response.featured_recipes || [],
            featured_limit: response.featured_limit || 10
          };
          this.pending = null;
        }),
        catchError((error) => {
          this.pending = null;
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.pending;
  }

  /** Start the request while the admin shell is open, before Recipes is clicked. */
  prefetch(): void {
    this.list().subscribe({ error: () => undefined });
  }

  setFeatured(recipeId: string, featured: boolean): Observable<{ data: AdminRecipeRow }> {
    return this.http.patch<{ data: AdminRecipeRow }>(`/api/admin/recipes/${recipeId}`, { featured }).pipe(
      tap(() => this.invalidate())
    );
  }

  setVisibility(
    recipeId: string,
    published: boolean,
    body: { reason?: string; note?: string } = {}
  ): Observable<{ data: AdminRecipeRow }> {
    return this.http.patch<{ data: AdminRecipeRow }>(`/api/admin/recipes/${recipeId}/visibility`, {
      published,
      ...(published ? {} : { reason: body.reason, note: body.note || '' })
    }).pipe(
      tap(() => this.invalidate())
    );
  }

  get(recipeId: string): Observable<{ data: AdminRecipeDetail }> {
    return this.http.get<{ data: AdminRecipeDetail }>(`/api/admin/recipes/${recipeId}`);
  }

  searchProducts(query: string, hints: string[] = []): Observable<{ data: LinkableProduct[] }> {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    hints.forEach((hint) => {
      if (hint.trim()) params.append('hint', hint.trim());
    });
    const search = params.toString();
    return this.http.get<{ data: LinkableProduct[] }>(`/api/admin/recipes/linkable-products${search ? `?${search}` : ''}`);
  }

  create(body: AdminRecipeDraft): Observable<{ data: AdminRecipeDetail }> {
    return this.http.post<{ data: AdminRecipeDetail }>('/api/admin/recipes', body).pipe(
      tap(() => this.invalidate())
    );
  }

  /** Community recipes accept only the featured flag from admins; content is owner-only. */
  update(recipeId: string, body: AdminRecipeDraft | AdminRecipeFeatureDraft): Observable<{ data: AdminRecipeDetail }> {
    return this.http.put<{ data: AdminRecipeDetail }>(`/api/admin/recipes/${recipeId}`, body).pipe(
      tap(() => this.invalidate())
    );
  }

  /** Soft-delete. Public 404; no restore. Prefer hide unless the content should never return. */
  deleteRecipe(
    recipeId: string,
    body: { reason: string; note?: string }
  ): Observable<{ data: { recipe_id: string; deleted?: boolean } }> {
    return this.http.request<{ data: { recipe_id: string; deleted?: boolean } }>('DELETE', `/api/admin/recipes/${recipeId}`, {
      body: { reason: body.reason, note: body.note || '' }
    }).pipe(
      tap(() => this.invalidate())
    );
  }

  requestChanges(recipeId: string, note: string): Observable<{ data: AdminRecipeRow }> {
    return this.http.post<{ data: AdminRecipeRow }>(`/api/admin/recipes/${recipeId}/request-changes`, { note }).pipe(
      tap(() => this.invalidate())
    );
  }

  finalReject(recipeId: string, note = ''): Observable<{ data: AdminRecipeRow }> {
    return this.http.post<{ data: AdminRecipeRow }>(`/api/admin/recipes/${recipeId}/final-reject`, { note }).pipe(
      tap(() => this.invalidate())
    );
  }

  private invalidate(): void {
    this.cache = null;
  }
}
