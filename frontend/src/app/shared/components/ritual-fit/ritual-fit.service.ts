import { Injectable, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../../../core/auth.service';
import { HttpService } from '../../../core/http.service';

export interface RitualFit {
  percent: number;
  name: string;
  archetypeId: string;
}

interface RitualFitsResponse {
  data: {
    archetype: { id: string; name: string } | null;
    products: Record<string, number>;
    recipes: Record<string, number>;
  } | null;
}

/** One lookup per signed-in user, shared by every product and recipe surface. */
@Injectable({ providedIn: 'root' })
export class RitualFitService {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly fits = signal<RitualFitsResponse['data']>(null);
  private loadedFor: string | null = null;
  private revision = 0;

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      const key = this.auth.isAuthenticated() ? String(user?.user_id || user?._id || 'signed-in') : null;
      if (!isPlatformBrowser(this.platformId) || key === this.loadedFor) return;
      this.loadedFor = key;
      this.fits.set(null);
      if (key) void this.load();
    });
  }

  /** Call after the taste profile changes, e.g. when the quiz is retaken. */
  refresh(): void {
    if (this.loadedFor) void this.load();
  }

  forProduct(productId: number | string | null | undefined): RitualFit | null {
    return this.build(this.fits()?.products?.[String(productId)]);
  }

  forRecipe(recipeId: string | null | undefined): RitualFit | null {
    return this.build(this.fits()?.recipes?.[String(recipeId)]);
  }

  private build(percent: number | undefined): RitualFit | null {
    const archetype = this.fits()?.archetype;
    if (!archetype || !Number.isFinite(percent)) return null;
    return { percent: percent!, name: archetype.name, archetypeId: archetype.id };
  }

  private async load(): Promise<void> {
    const revision = ++this.revision;
    try {
      const { data } = await this.http.get('/ritual-dna/fits') as RitualFitsResponse;
      if (revision === this.revision) this.fits.set(data);
    } catch {
      // Fit is an enhancement: cards stay as they are for admins or when the API is unavailable.
    }
  }
}
