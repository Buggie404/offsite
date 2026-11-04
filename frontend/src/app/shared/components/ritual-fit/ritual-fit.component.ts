import { Component, Input, inject } from '@angular/core';
import { RitualFit, RitualFitService } from './ritual-fit.service';

@Component({
  selector: 'app-ritual-fit',
  standalone: true,
  templateUrl: './ritual-fit.component.html',
  styleUrls: ['./ritual-fit.component.scss']
})
export class RitualFitComponent {
  @Input() productId?: number | string | null;
  @Input() recipeId?: string | null;
  /** Fit already returned with a recommendation; skips the shared lookup. */
  @Input() override?: RitualFit | null;

  private readonly fits = inject(RitualFitService);

  get fit(): RitualFit | null {
    if (this.override) return this.override;
    return this.recipeId ? this.fits.forRecipe(this.recipeId) : this.fits.forProduct(this.productId);
  }
}
