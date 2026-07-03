// home/components/best-seller/best-seller.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductService } from '../../services/product.service';
import { Product, getDefaultPrice } from '../../models/product.model';
import { CartService } from '../../../purchase/services/cart.service';

const BEST_SELLER_IDS = [14001, 12011, 13014, 11010];
const BEST_SELLER_BADGE_IDS = new Set([10004, 10005]);

@Component({
  selector: 'app-best-seller',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './best-seller.component.html',
  styleUrls: ['./best-seller.component.scss'],
})
export class BestSellerComponent implements OnInit {

  products: Product[] = [];
  isLoading = true;

  roastSwatches = [
    '#f3f8ec','#e5f1d5','#d7eabf','#c9e3a9','#b5d48a',
    '#96bf62','#74a340','#567d2e','#43631f','#375534'
  ];

  constructor(
    private productService: ProductService,
    private cartService: CartService
  ) {}

  ngOnInit(): void {
    this.productService.getProducts().subscribe({
      next: (data: Product[]) => {
        const map = new Map(data.map(p => [p.product_id, p]));
        this.products = BEST_SELLER_IDS
          .map(id => map.get(id))
          .filter((p): p is Product => !!p);
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Failed to load best sellers:', err);
        this.isLoading = false;
      }
    });
  }

  // ── ORIGIN LINE ──
  getOrigin(p: Product): string {
    switch (p.category) {
      case 'matcha':     return p.matcha?.origin ?? '';
      case 'coffee':     return [p.coffee?.product_origin, p.coffee?.process_type]
                                .filter(Boolean).join(' · ').toUpperCase();
      case 'tools':      return (p.tools?.tool_category ?? '').toUpperCase();
      case 'drinkware':  return (p.drinkware?.ware_type ?? '').toUpperCase();
      default:           return '';
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
      case 'sets_bundles':
        // Đếm số product trong composition, fallback về product_tag
        const count = (p as any).sets_bundles?.composition?.length
          || p.product_tag?.filter(t => !t.includes('sets')).length
          || 2;
        return [`${count} products`];
      default:
        return p.product_tag ?? [];
    }
  }

  // ── ROAST BAR ──
  showRoastBar(p: Product): boolean {
    return p.category === 'coffee';
  }

  // Trả về index (0-based) của ô vàng
  // light=1, light medium / medium light=3, medium=5, medium dark=6, dark=8
  getHighlightIndex(p: Product): number {
    const roast = (p.coffee?.roast_level ?? '').toLowerCase();
    if (roast.includes('dark') && roast.includes('medium')) return 6;  // medium dark
    if (roast.includes('dark'))   return 8;   // dark
    if (roast.includes('medium') && roast.includes('light')) return 3; // medium light
    if (roast.includes('medium')) return 5;   // medium
    return 1;                                  // light (default)
  }

  isHighlightSwatch(p: Product, index: number): boolean {
    return index === this.getHighlightIndex(p);
  }

  // ── MISC ──
  isBestSeller(p: Product): boolean {
    return BEST_SELLER_BADGE_IDS.has(p.product_id);
  }

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
    this.cartService.addToCart(p as any);
  }

  onSave(p: Product): void {
    console.log('Save:', p.name);
  }
}