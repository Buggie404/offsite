import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideCoffee,
  LucideDroplet,
  LucideHeart,
  LucideLeaf,
  LucideMapPin,
  LucideMinus,
  LucidePackage,
  LucidePlus,
  LucideShoppingBag,
  LucideShoppingCart
} from '@lucide/angular';
import { ProductService } from '../../../../features/home/services/product.service';
import {
  Product,
  ProductImage,
  Variant,
  getPrimaryProductImage
} from '../../../../features/home/models/product.model';
import { CartService } from '../../../purchase/services/cart.service';
import { DragScrollDirective } from '../../../../shared/directives/drag-scroll.directive';
import { AnimateInViewDirective } from '../../../../shared/directives/animate-in-view.directive';

interface ProductTag {
  icon: 'map' | 'drop' | 'package';
  label: string;
}

interface IncludedProduct {
  name: string;
  eyebrow: string;
  description: string;
  price: number | null;
  tag: string;
  icon: 'leaf' | 'coffee' | 'tool' | 'package';
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DragScrollDirective,
    AnimateInViewDirective,
    LucideChevronLeft,
    LucideChevronRight,
    LucideCoffee,
    LucideDroplet,
    LucideHeart,
    LucideLeaf,
    LucideMapPin,
    LucideMinus,
    LucidePackage,
    LucidePlus,
    LucideShoppingBag,
    LucideShoppingCart
  ],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss'
})
export class ProductDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  product = signal<Product | null>(null);
  selectedVariant = signal<Variant | null>(null);
  quantity = signal<number>(1);
  isLoading = signal<boolean>(true);
  errorMessage = signal<string>('');
  isSaved = signal<boolean>(false);
  quantityError = signal<string>('');
  activeImageIndex = signal<number>(0);
  slidePosition = signal<number>(1);
  isSlideTransitionEnabled = signal<boolean>(true);
  isCarouselPaused = signal<boolean>(false);

  private carouselTimer?: ReturnType<typeof setInterval>;

  readonly roastSwatches = [
    '#f3f8ec', '#e5f1d5', '#d7eabf', '#c9e3a9', '#b5d48a',
    '#96bf62', '#74a340', '#567d2e', '#43631f', '#375534'
  ];

  ngOnInit(): void {
    const productId = this.route.snapshot.paramMap.get('id');
    if (!productId) {
      this.errorMessage.set('Product ID not found.');
      this.isLoading.set(false);
      return;
    }

    this.productService.getProductById(productId).subscribe({
      next: (prod: Product) => {
        this.product.set(prod);
        const defaultVariant = prod.variants?.find(variant => variant.is_default) ?? prod.variants?.[0] ?? null;
        this.selectedVariant.set(defaultVariant);
        this.isLoading.set(false);
        this.startCarousel();
      },
      error: (err) => {
        console.error('Failed to load product details:', err);
        this.errorMessage.set('Product not found or has been disabled.');
        this.isLoading.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.stopCarousel();
  }

  selectVariant(variant: Variant): void {
    this.selectedVariant.set(variant);
    this.quantity.set(1);
    this.quantityError.set('');

    const variantImage = variant.images?.find(image => image.sort_order === 0)
      ?? [...(variant.images ?? [])].sort((a, b) =>
        (a.sort_order ?? Number.MAX_SAFE_INTEGER)
        - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
      )[0];

    if (variantImage) {
      const imageIndex = this.images().findIndex(image =>
        (variantImage.public_id && image.public_id === variantImage.public_id)
        || image.url === variantImage.url
      );
      if (imageIndex >= 0) this.goToImage(imageIndex);
    }
  }

  incrementQty(): void {
    this.quantity.update(quantity => Math.min(this.maxQuantity(), quantity + 1));
    this.validateQuantity();
  }

  decrementQty(): void {
    this.quantity.update(quantity => Math.max(1, quantity - 1));
    this.validateQuantity();
  }

  onQuantityInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const sanitizedValue = input.value.replace(/\D/g, '');
    input.value = sanitizedValue;
    this.quantity.set(sanitizedValue ? Number(sanitizedValue) : 0);
    this.validateQuantity();
  }

  normalizeQuantity(): void {
    if (!this.quantity() || this.quantity() < 1) {
      this.quantity.set(1);
    }
    this.validateQuantity();
  }

  images(): ProductImage[] {
    const prod = this.product();
    if (!prod) return [];

    const combined = [
      ...(prod.images ?? []),
      ...(prod.variants ?? []).flatMap(variant => variant.images ?? [])
    ];
    const seen = new Set<string>();

    return combined
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .filter(image => {
        const key = image.public_id || image.url;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  showGalleryDots(): boolean {
    return this.images().length > 1;
  }

  previousImage(): void {
    const imageCount = this.images().length;
    if (imageCount < 2) return;
    this.isSlideTransitionEnabled.set(true);
    this.activeImageIndex.update(index => (index - 1 + imageCount) % imageCount);
    this.slidePosition.update(position => position - 1);
    this.restartCarousel();
  }

  nextImage(): void {
    const imageCount = this.images().length;
    if (imageCount < 2) return;
    this.isSlideTransitionEnabled.set(true);
    this.activeImageIndex.update(index => (index + 1) % imageCount);
    this.slidePosition.update(position => position + 1);
    this.restartCarousel();
  }

  goToImage(index: number): void {
    this.isSlideTransitionEnabled.set(true);
    this.activeImageIndex.set(index);
    this.slidePosition.set(this.images().length > 1 ? index + 1 : 0);
    this.restartCarousel();
  }

  onSlideTransitionEnd(): void {
    const imageCount = this.images().length;
    if (imageCount < 2) return;

    if (this.slidePosition() === 0) {
      this.snapTrackTo(imageCount);
    } else if (this.slidePosition() === imageCount + 1) {
      this.snapTrackTo(1);
    }
  }

  getPrimaryImage(): ProductImage | null {
    const prod = this.product();
    if (!prod) return null;

    const variant = this.selectedVariant();
    if (variant?.images?.length) {
      return variant.images.find(image => image.sort_order === 0) ?? variant.images[0];
    }

    return getPrimaryProductImage(prod) ?? null;
  }

  getProductTags(): ProductTag[] {
    const p = this.product();
    if (!p) return [];

    switch (p.category) {
      case 'matcha':
        return [
          this.makeTag('map', p.matcha?.origin),
          this.makeTag('drop', p.matcha?.product_grade)
        ].filter((tag): tag is ProductTag => !!tag);
      case 'coffee':
        return [
          this.makeTag('map', p.coffee?.product_origin),
          this.makeTag('drop', p.coffee?.process_type)
        ].filter((tag): tag is ProductTag => !!tag);
      case 'tools':
        return [
          this.makeTag('map', p.tools?.tool_category),
          this.makeTag('drop', p.tools?.tool_type)
        ].filter((tag): tag is ProductTag => !!tag);
      case 'drinkware':
        return [
          this.makeTag('map', p.drinkware?.ware_type),
          this.makeTag('drop', p.drinkware?.material)
        ].filter((tag): tag is ProductTag => !!tag);
      case 'sets_bundles': {
        if (p.sets_bundles?.is_exclusive === true) return [{ icon: 'package', label: 'Exclusive set' }];
        const count = p.sets_bundles?.composition?.length ?? 0;
        return [{ icon: 'package', label: `${count} ${count === 1 ? 'product' : 'products'}` }];
      }
      default:
        return (p.product_tag ?? []).map(label => ({ icon: 'package', label }));
    }
  }

  getTastingNotes(): string[] {
    const p = this.product();
    return p?.category === 'coffee' ? (p.coffee?.tasting_notes ?? []) : [];
  }

  getRoastLabel(): string {
    return this.product()?.coffee?.roast_level ?? '';
  }

  getHighlightIndex(): number {
    const roast = this.getRoastLabel().toLowerCase();
    if (roast.includes('dark') && roast.includes('medium')) return 6;
    if (roast.includes('dark')) return 8;
    if (roast.includes('medium') && roast.includes('light')) return 3;
    if (roast.includes('medium')) return 5;
    return 1;
  }

  isHighlightSwatch(index: number): boolean {
    return index === this.getHighlightIndex();
  }

  pauseCarousel(): void {
    this.isCarouselPaused.set(true);
    this.stopCarousel();
  }

  resumeCarousel(): void {
    this.isCarouselPaused.set(false);
    this.startCarousel();
  }

  getVariantLabel(variant: Variant): string {
    return variant.label?.trim() || 'Default';
  }

  getPrice(): number {
    return this.selectedVariant()?.price ?? 0;
  }

  getTotalPrice(): number {
    return this.getPrice() * this.quantity();
  }

  maxQuantity(): number {
    return Math.max(0, this.selectedVariant()?.stock ?? 0);
  }

  isUnavailable(): boolean {
    return !this.selectedVariant() || this.maxQuantity() <= 0;
  }

  getIncludedProducts(): IncludedProduct[] {
    const p = this.product();
    if (p?.category !== 'sets_bundles') return [];

    return (p.sets_bundles?.composition ?? [])
      .map(item => this.normalizeIncludedProduct(item))
      .filter((item): item is IncludedProduct => !!item);
  }

  toggleSave(): void {
    this.isSaved.update(saved => !saved);
  }

  onAddToCart(): void {
    const prod = this.product();
    const variant = this.selectedVariant();
    if (!prod || !variant || this.isUnavailable() || !this.validateQuantity()) return;
    this.cartService.addToCart(prod as any, variant.sku, this.quantity());
  }

  buyNow(): void {
    const prod = this.product();
    const variant = this.selectedVariant();
    if (!prod || !variant || this.isUnavailable() || !this.validateQuantity()) return;
    this.cartService.buyNow(prod as any, variant.sku, this.quantity());
    void this.router.navigate(['/checkout']);
  }

  goBack(): void {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      this.router.navigate(['/']);
    }
  }

  private validateQuantity(): boolean {
    if (this.isUnavailable()) {
      this.quantityError.set('');
      return false;
    }

    const quantity = this.quantity();
    if (!Number.isFinite(quantity) || quantity < 1) {
      this.quantityError.set('Please select at least 1 item.');
      return false;
    }

    if (quantity > this.maxQuantity()) {
      this.quantityError.set(`Only ${this.maxQuantity()} item${this.maxQuantity() === 1 ? '' : 's'} left in stock.`);
      return false;
    }

    this.quantityError.set('');
    return true;
  }

  private makeTag(icon: ProductTag['icon'], value?: string | null): ProductTag | null {
    const label = value?.trim();
    return label ? { icon, label } : null;
  }

  private normalizeIncludedProduct(item: unknown): IncludedProduct | null {
    if (!item || typeof item !== 'object') return null;
    const source = item as Record<string, any>;
    const product = (source['product'] && typeof source['product'] === 'object')
      ? source['product'] as Record<string, any>
      : source;

    const name = this.pickText(product, ['name', 'product_name', 'title']);
    if (!name) return null;

    const category = this.pickText(product, ['category', 'product_category', 'type']);
    const detail = product['matcha'] ?? product['coffee'] ?? product['tools'] ?? product['drinkware'] ?? {};
    const detailRecord = typeof detail === 'object' ? detail as Record<string, any> : {};
    const variants = Array.isArray(product['variants']) ? product['variants'] : [];
    const variant = variants.find((candidate: any) => candidate?.is_default) ?? variants[0] ?? {};

    return {
      name,
      eyebrow: [category, this.pickText(detailRecord, ['product_grade', 'process_type', 'tool_type', 'material', 'pricing_tier'])]
        .filter(Boolean)
        .join(' · '),
      description: this.pickText(product, ['short_description', 'description', 'label'])
        || this.pickText(source, ['description', 'label', 'variant_label'])
        || this.pickText(variant, ['label'])
        || 'Included in this set',
      price: this.pickNumber(product, ['price']) ?? this.pickNumber(variant, ['price']),
      tag: this.pickText(product, ['tag'])
        || this.pickText(detailRecord, ['origin', 'product_origin', 'material', 'tool_category'])
        || category
        || 'included',
      icon: this.getIncludedIcon(category)
    };
  }

  private pickText(source: Record<string, any>, keys: string[]): string {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
    return '';
  }

  private pickNumber(source: Record<string, any>, keys: string[]): number | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
  }

  private getIncludedIcon(category: string): IncludedProduct['icon'] {
    const normalized = category.toLowerCase();
    if (normalized.includes('matcha') || normalized.includes('tea')) return 'leaf';
    if (normalized.includes('coffee')) return 'coffee';
    if (normalized.includes('tool')) return 'tool';
    return 'package';
  }

  private startCarousel(): void {
    if (
      !isPlatformBrowser(this.platformId)
      || this.isCarouselPaused()
      || this.images().length < 2
      || this.carouselTimer
    ) return;

    this.carouselTimer = setInterval(() => {
      this.nextImageWithoutReset();
    }, 1500);
  }

  private stopCarousel(): void {
    if (this.carouselTimer) clearInterval(this.carouselTimer);
    this.carouselTimer = undefined;
  }

  private restartCarousel(): void {
    this.stopCarousel();
    this.startCarousel();
  }

  private nextImageWithoutReset(): void {
    const imageCount = this.images().length;
    if (imageCount < 2) return;
    this.isSlideTransitionEnabled.set(true);
    this.activeImageIndex.update(index => (index + 1) % imageCount);
    this.slidePosition.update(position => position + 1);
    this.cdr.detectChanges();
  }

  private snapTrackTo(position: number): void {
    this.isSlideTransitionEnabled.set(false);
    this.slidePosition.set(position);
    this.cdr.detectChanges();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.isSlideTransitionEnabled.set(true);
        this.cdr.detectChanges();
      });
    });
  }
}
