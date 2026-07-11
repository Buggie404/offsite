// home/components/best-seller/best-seller.component.ts

import { Component, Input, OnChanges, OnInit, AfterViewInit, ViewChild, ElementRef, SimpleChanges, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ProductService } from '../../services/product.service';
import { Product, getDefaultPrice, getProductDetailSlug, getPrimaryProductImage, isProductOutOfStock } from '../../models/product.model';
import { CartService } from '../../../purchase/services/cart.service';
import { LucideArrowRight, LucideEye, LucideHeart, LucideStar, LucideChevronLeft, LucideChevronRight } from '@lucide/angular';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { DragScrollDirective } from '../../../../shared/directives/drag-scroll.directive';
import { AnimateInViewDirective } from '../../../../shared/directives/animate-in-view.directive';
import { QuickViewModalComponent } from '../../../shop/components/quick-view-modal/quick-view-modal.component';
import { ProductReviewMetric, getDisplayProductReviewMetric } from '../../../../shared/data/mock-product-reviews';

@Component({
  selector: 'app-best-seller',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideArrowRight, LucideEye, LucideHeart, LucideStar, LucideChevronLeft, LucideChevronRight, DragScrollDirective, AnimateInViewDirective, QuickViewModalComponent],
  templateUrl: './best-seller.component.html',
  styleUrls: ['./best-seller.component.scss'],
})
export class BestSellerComponent implements OnInit, OnChanges, AfterViewInit {
  @Input() eyebrowText = 'Best sellers';
  @Input() sectionHeading = "What everyone's drinking";
  @Input() background: 'wheat' | 'page' = 'wheat';
  @Input() headingStyle: 'default' | 'plain' = 'default';
  @Input() compact = false;
  @Input() productsOverride: Product[] | null = null;
  @Input() showEyebrow = true;
  @Input() showViewAll = true;

  @ViewChild('productGrid') productGrid?: ElementRef<HTMLDivElement>;

  products: Product[] = [];
  isLoading = true;
  savedProductIds = new Set<number>();
  quickViewProduct: Product | null = null;
  canScrollLeft = false;
  canScrollRight = true;

  roastSwatches = [
    '#f3f8ec', '#e5f1d5', '#d7eabf', '#c9e3a9', '#b5d48a',
    '#96bf62', '#74a340', '#567d2e', '#43631f', '#375534'
  ];

  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private authService: AuthService,
    private authPromptService: AuthPromptModalService
  ) { }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadSavedProducts();
    if (this.productsOverride) {
      this.products = this.productsOverride;
      this.isLoading = false;
      setTimeout(() => this.checkScrollability(), 300);
      return;
    }

    this.productService.getBestSellers(10).subscribe({
      next: (data: Product[]) => {
        this.products = [...data].sort((a, b) =>
          Number(isProductOutOfStock(a)) - Number(isProductOutOfStock(b))
        );
        this.isLoading = false;
        this.cdr.markForCheck();
        setTimeout(() => this.checkScrollability(), 300);
      },
      error: (err) => {
        console.error('Failed to load best sellers:', err);
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['productsOverride'] || !this.productsOverride) return;
    this.products = this.productsOverride;
    this.isLoading = false;
    this.cdr.markForCheck();
    setTimeout(() => this.checkScrollability(), 300);
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    setTimeout(() => {
      this.checkScrollability();
    }, 500);
  }

  scrollGrid(direction: 'left' | 'right'): void {
    const el = this.productGrid?.nativeElement;
    if (!el) return;
    const cardWidth = 330; // 310px card width + 20px gap
    const scrollAmount = direction === 'left' ? -cardWidth : cardWidth;
    el.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  }

  onGridScroll(event: Event): void {
    const el = event.target as HTMLElement;
    this.updateScrollFlags(el);
  }

  private checkScrollability(): void {
    const el = this.productGrid?.nativeElement;
    if (el) {
      this.updateScrollFlags(el);
    }
  }

  private updateScrollFlags(el: HTMLElement): void {
    this.canScrollLeft = el.scrollLeft > 5;
    this.canScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 5;
    this.cdr.markForCheck();
  }

  // ── ORIGIN LINE ──
  getOrigin(p: Product): string {
    switch (p.category) {
      case 'matcha': return p.matcha?.origin ?? '';
      case 'coffee': return [p.coffee?.product_origin, p.coffee?.process_type]
        .filter(Boolean).join(' · ').toUpperCase();
      case 'tools': return (p.tools?.tool_category ?? '').toUpperCase();
      case 'drinkware': return (p.drinkware?.ware_type ?? '').toUpperCase();
      default: return '';
    }
  }

  // ── TAG PILLS ──
  getTags(p: Product): string[] {
    switch (p.category) {
      case 'matcha':
        return [p.matcha?.product_grade || 'related tea'];
      case 'coffee':
        return p.coffee?.tasting_notes?.slice(0, 3) ?? [];
      case 'tools':
        return p.tools?.tool_type ? [p.tools.tool_type] : [];
      case 'drinkware':
        return p.drinkware?.material ? [p.drinkware.material] : [];
      case 'sets_bundles':
        // Đếm số product trong composition, fallback về product_tag
        if (p.sets_bundles?.is_exclusive === true) return ['Exclusive set'];
        const count = p.sets_bundles?.composition?.length ?? 0;
        return [`${count} ${count === 1 ? 'product' : 'products'}`];
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
    if (roast.includes('dark')) return 8;   // dark
    if (roast.includes('medium') && roast.includes('light')) return 3; // medium light
    if (roast.includes('medium')) return 5;   // medium
    return 1;                                  // light (default)
  }

  isHighlightSwatch(p: Product, index: number): boolean {
    return index === this.getHighlightIndex(p);
  }

  // ── MISC ──
  getPrimaryImage(p: Product): string {
    return getPrimaryProductImage(p)?.url ?? '';
  }

  getPrimaryImageAlt(p: Product): string {
    return getPrimaryProductImage(p)?.alt_text ?? p.name;
  }

  getPrice(p: Product): string {
    return `$${getDefaultPrice(p).toFixed(2)}`;
  }

  getReviewMetric(p: Product): ProductReviewMetric | null {
    return getDisplayProductReviewMetric(p);
  }

  getDetailId(p: Product): string {
    return getProductDetailSlug(p);
  }

  isOutOfStock(p: Product): boolean {
    return isProductOutOfStock(p);
  }

  onAddToCart(p: Product, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.isOutOfStock(p)) return;
    console.log('Add to cart:', p.name);
    this.cartService.addToCart(p as any);
  }

  isSaved(p: Product): boolean {
    return this.savedProductIds.has(p.product_id);
  }

  async onSave(p: Product, event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();

    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }

    try {
      const result = await this.authService.toggleSavedProduct(p.product_id);
      if (result.saved) this.savedProductIds.add(p.product_id);
      else this.savedProductIds.delete(p.product_id);
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to save product:', err);
    }
  }

  openQuickView(product: Product, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isOutOfStock(product)) this.quickViewProduct = product;
  }

  closeQuickView(): void {
    this.quickViewProduct = null;

    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && activeElement.classList.contains('quick-view-trigger')) {
          activeElement.blur();
        }
      });
    }
  }

  private async loadSavedProducts(): Promise<void> {
    if (!this.authService.isAuthenticated()) return;

    try {
      const result = await this.authService.getSavedItems();
      this.savedProductIds = new Set(
        (result.saved_products || [])
          .map((item: any) => Number(item.product?.product_id ?? item.product_id))
          .filter((id: number) => !Number.isNaN(id))
      );
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to load saved products:', err);
    }
  }
}
