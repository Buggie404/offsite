// shop/components/product-card/product-card.component.ts

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Product, getDefaultPrice } from '../../../home/models/product.model';
import { LucideHeart } from '@lucide/angular';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, LucideHeart],
  templateUrl: './product-card.component.html',
  styleUrls: ['./product-card.component.scss']
})
export class ProductCardComponent {
  @Input() product!: Product;
  @Input() showBestSellerBadge = false;

  roastSwatches = [
    '#f3f8ec', '#e5f1d5', '#d7eabf', '#c9e3a9', '#b5d48a',
    '#96bf62', '#74a340', '#567d2e', '#43631f', '#375534'
  ];

  // ── ORIGIN LINE ──
  getOrigin(p: Product): string {
    switch (p.category) {
      case 'matcha':    return p.matcha?.origin ?? '';
      case 'coffee':    return [p.coffee?.product_origin, p.coffee?.process_type]
                               .filter(Boolean).join(' · ').toUpperCase();
      case 'tools':     return (p.tools?.tool_category ?? '').toUpperCase();
      case 'drinkware': return (p.drinkware?.ware_type ?? '').toUpperCase();
      default:          return '';
    }
  }

  // ── TAG PILLS ──
  getTags(p: Product): string[] {
    switch (p.category) {
      case 'matcha':
        return p.matcha?.product_grade ? [p.matcha.product_grade] : [];
      case 'coffee':
        return p.coffee?.tasting_notes?.slice(0, 3) ?? [];
      case 'tools':
        return p.tools?.tool_type ? [p.tools.tool_type] : [];
      case 'drinkware':
        return p.drinkware?.material ? [p.drinkware.material] : [];
      case 'sets_bundles': {
        const count = p.product_tag?.filter(t => !t.includes('sets')).length ?? 2;
        return [`${count} products`];
      }
      default:
        return p.product_tag ?? [];
    }
  }

  // ── ROAST BAR ──
  showRoastBar(p: Product): boolean {
    return p.category === 'coffee';
  }

  getHighlightIndex(p: Product): number {
    const roast = (p.coffee?.roast_level ?? '').toLowerCase();
    if (roast.includes('dark') && roast.includes('medium')) return 6;
    if (roast.includes('dark'))   return 8;
    if (roast.includes('medium') && roast.includes('light')) return 3;
    if (roast.includes('medium')) return 5;
    return 1;
  }

  isHighlightSwatch(p: Product, index: number): boolean {
    return index === this.getHighlightIndex(p);
  }

  // ── MISC ──
  getPrimaryImage(p: Product): string {
    return p.images[0]?.url ?? '';
  }

  getPrimaryImageAlt(p: Product): string {
    return p.images[0]?.alt_text ?? p.name;
  }

  getPrice(p: Product): string {
    return `$${getDefaultPrice(p).toFixed(2)}`;
  }

  onAddToCart(p: Product): void {
    console.log('Add to cart:', p.name);
  }

  onSave(p: Product): void {
    console.log('Save:', p.name);
  }
}
