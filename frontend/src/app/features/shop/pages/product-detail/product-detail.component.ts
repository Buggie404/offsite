import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { CommonModule, Location, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, NavigationStart, Router, RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideChevronDown,
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
  LucideStar,
  LucideShoppingBag,
  LucideShoppingCart,
  LucideX
} from '@lucide/angular';
import { ProductReview as ProductReviewDto, ProductService } from '../../../../features/home/services/product.service';
import {
  Product,
  ProductImage,
  Variant,
  getProductDetailSlug,
  getPrimaryProductImage,
  isProductOutOfStock
} from '../../../../features/home/models/product.model';
import { CartService } from '../../../purchase/services/cart.service';
import { DragScrollDirective } from '../../../../shared/directives/drag-scroll.directive';
import { AnimateInViewDirective } from '../../../../shared/directives/animate-in-view.directive';
import { BestSellerComponent } from '../../../../features/home/components/best-seller/best-seller.component';
import { RecipeSectionComponent } from '../../../../features/home/components/recipes/recipe-section.component';
import { ContentService } from '../../../content/services/content.service';
import { buildMockProductReviews } from '../../../../shared/data/mock-product-reviews';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';
import { Subscription } from 'rxjs';

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
  routeId: string;
  imageUrl: string;
}

interface ProductReviewView {
  author: string;
  date: string;
  rating: number;
  comment: string;
}

type ReviewSortOption = 'oldest' | 'newest' | 'highest';
type ReviewDateSortOption = Exclude<ReviewSortOption, 'highest'>;

interface BrewingMethodCard {
  slug: string;
  stepAnchor: string;
  title: string;
  methodLabel: string;
  steps: string[];
  icon: 'coffee' | 'droplet' | 'leaf';
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DragScrollDirective,
    AnimateInViewDirective,
    BestSellerComponent,
    RecipeSectionComponent,
    LucideArrowRight,
    LucideChevronDown,
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
    LucideStar,
    LucideShoppingBag,
    LucideShoppingCart,
    LucideX,
    BackToTopComponent
  ],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss'
})
export class ProductDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private productService = inject(ProductService);
  private contentService = inject(ContentService);
  private cartService = inject(CartService);
  private authService = inject(AuthService);
  private authPromptService = inject(AuthPromptModalService);
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);
  private location = inject(Location);

  product = signal<Product | null>(null);
  selectedVariant = signal<Variant | null>(null);
  quantity = signal<number>(1);
  isLoading = signal<boolean>(true);
  isSaved = signal<boolean>(false);
  quantityError = signal<string>('');
  activeImageIndex = signal<number>(0);
  slidePosition = signal<number>(1);
  isSlideTransitionEnabled = signal<boolean>(true);
  isCarouselPaused = signal<boolean>(false);
  isReviewModalOpen = signal<boolean>(false);
  reviews = signal<ProductReviewView[]>([]);
  reviewsTotal = signal<number>(0);
  reviewsTotalPages = signal<number>(1);
  isReviewsLoading = signal<boolean>(false);
  selectedReviewFilter = signal<string>('All');
  selectedReviewSort = signal<ReviewSortOption>('highest');
  isReviewSortOpen = signal<boolean>(false);
  reviewModalPage = signal<number>(1);
  brewingMethods = signal<BrewingMethodCard[]>([]);
  isBrewingMethodsLoading = signal<boolean>(false);
  youMayAlsoLikeProducts = signal<Product[]>([]);
  recentlyViewedProducts = signal<Product[]>([]);
  productCatalog = signal<Product[]>([]);

  private carouselTimer?: ReturnType<typeof setInterval>;
  private scrollRestoreTimers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly recentlyViewedKey = 'recently_viewed_products';
  private routeSubscription?: Subscription;
  private routerEventsSubscription?: Subscription;
  private pendingScrollY: number | null = null;
  readonly contentDetailEntryState = { contentEntrySource: 'product-detail' };

  readonly ratingStars = [1, 2, 3, 4, 5];
  readonly ratingFilters = ['All', '5', '4', '3', '2', '1'];
  readonly reviewSortOptions: Array<{ value: ReviewDateSortOption; label: string }> = [
    { value: 'newest', label: 'NEWEST' },
    { value: 'oldest', label: 'OLDEST' }
  ];

  readonly roastSwatches = [
    '#f3f8ec', '#e5f1d5', '#d7eabf', '#c9e3a9', '#b5d48a',
    '#96bf62', '#74a340', '#567d2e', '#43631f', '#375534'
  ];

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.routerEventsSubscription = this.router.events.subscribe(event => {
        if (event instanceof NavigationStart) {
          this.saveProductDetailScrollPosition();
        }
      });
    }

    this.routeSubscription = this.route.paramMap.subscribe(params => {
      const productId = params.get('id');
      this.loadProduct(productId);
    });
  }

  ngOnDestroy(): void {
    this.stopCarousel();
    this.clearScrollRestoreTimers();
    this.routeSubscription?.unsubscribe();
    this.routerEventsSubscription?.unsubscribe();
  }

  private loadProduct(productId: string | null): void {
    if (!productId) {
      this.isLoading.set(false);
      void this.router.navigateByUrl('/404', { skipLocationChange: true });
      return;
    }

    this.pendingScrollY = this.getSavedProductDetailScrollPosition();
    this.clearScrollRestoreTimers();

    this.stopCarousel();
    this.isLoading.set(true);
    this.quantity.set(1);
    this.quantityError.set('');
    this.activeImageIndex.set(0);
    this.slidePosition.set(1);
    this.isSlideTransitionEnabled.set(true);
    this.isCarouselPaused.set(false);
    this.isReviewModalOpen.set(false);
    this.isSaved.set(false);
    this.brewingMethods.set([]);
    this.youMayAlsoLikeProducts.set([]);

    this.productService.getProductById(productId).subscribe({
      next: (prod: Product) => {
        this.product.set(prod);
        this.replaceUrlWithProductSlug(productId, prod);
        const defaultVariant = prod.variants?.find(variant => variant.is_default) ?? prod.variants?.[0] ?? null;
        this.selectedVariant.set(defaultVariant);
        this.isLoading.set(false);
        void this.loadSavedState(prod);
        this.loadProductReviews(prod);
        this.loadBrewingMethods(prod);
        this.loadProductCatalogForRecommendations(prod);
        this.loadRecentlyViewedProducts(prod);
        this.rememberRecentlyViewedProduct(prod);
        this.startCarousel();
        this.restoreProductDetailScrollPosition();
      },
      error: (err) => {
        console.error('Failed to load product details:', err);
        this.isLoading.set(false);
        void this.router.navigateByUrl('/404', { skipLocationChange: true });
      }
    });
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

  onQtyKeydown(event: KeyboardEvent): void {
    const allowedKeys = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'
    ];
    if (allowedKeys.includes(event.key) || (event.ctrlKey || event.metaKey)) {
      return;
    }
    if (!/^[0-9]$/.test(event.key)) {
      event.preventDefault();
    }
  }

  onQuantityInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const sanitizedValue = input.value.replace(/[^0-9]/g, '');
    input.value = sanitizedValue;
    this.quantity.set(sanitizedValue ? Number(sanitizedValue) : 0);
    this.validateQuantity();
  }

  normalizeQuantity(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!this.quantity() || this.quantity() < 1) {
      this.quantity.set(1);
    } else if (this.quantity() > this.maxQuantity()) {
      this.quantity.set(this.maxQuantity());
    }
    this.validateQuantity();
    input.value = String(this.quantity());
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
    this.normalizeCarouselPosition(imageCount);
    this.isSlideTransitionEnabled.set(true);
    this.activeImageIndex.update(index => (index - 1 + imageCount) % imageCount);
    this.slidePosition.update(position => position - 1);
    this.restartCarousel();
  }

  nextImage(): void {
    const imageCount = this.images().length;
    if (imageCount < 2) return;
    this.normalizeCarouselPosition(imageCount);
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
          this.makeTag('drop', p.matcha?.product_grade || 'related tea')
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
        const count = p.sets_bundles?.composition?.length ?? 0;
        return [
          count > 0 ? this.makeTag('package', `${count} ${count === 1 ? 'product' : 'products'}`) : null,
          p.sets_bundles?.is_exclusive === true ? this.makeTag('drop', 'Exclusive for set') : null
        ].filter((tag): tag is ProductTag => !!tag);
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
    return this.getPrice();
  }

  maxQuantity(): number {
    return Math.max(0, this.selectedVariant()?.stock ?? 0);
  }

  isUnavailable(): boolean {
    return !this.selectedVariant() || this.maxQuantity() <= 0;
  }

  shouldShowRecipes(): boolean {
    const category = this.product()?.category;
    return category === 'coffee' || category === 'matcha';
  }

  shouldShowBrewingMethods(): boolean {
    return this.shouldShowRecipes();
  }

  getRecipeBaseFilter(): 'matcha' | 'coffee' | null {
    const category = this.product()?.category;
    return category === 'matcha' || category === 'coffee' ? category : null;
  }

  averageRating(): number {
    const reviews = this.reviews();
    const productRating = this.product()?.rating_avg;
    const productReviewCount = this.product()?.review_count ?? 0;
    if (typeof productRating === 'number' && productReviewCount > 0) return productRating;

    if (!reviews.length) return 0;
    const total = reviews.reduce((sum, review) => sum + review.rating, 0);
    return Math.round((total / reviews.length) * 10) / 10;
  }

  reviewCount(): number {
    const loadedTotal = this.reviewsTotal();
    const localTotal = this.reviews().length;
    if (loadedTotal > 0 || localTotal > 0) return Math.max(loadedTotal, localTotal);
    return this.product()?.review_count ?? 0;
  }

  featuredReviews(): ProductReviewView[] {
    return this.sortReviews([...this.reviews()], 'highest').slice(0, 2);
  }

  hasReviewComment(review: ProductReviewView): boolean {
    return this.getReviewComment(review).length > 0;
  }

  isStarFilled(rating: number, star: number): boolean {
    return star <= Math.floor(rating);
  }

  averageStarFill(star: number): number {
    const fill = this.averageRating() - (star - 1);
    return Math.round(Math.max(0, Math.min(fill, 1)) * 100);
  }

  openReviewModal(): void {
    this.selectedReviewSort.set('highest');
    this.isReviewSortOpen.set(false);
    this.reviewModalPage.set(1);
    this.isReviewModalOpen.set(true);
  }

  closeReviewModal(): void {
    this.isReviewSortOpen.set(false);
    this.isReviewModalOpen.set(false);
  }

  setReviewFilter(filter: string): void {
    this.isReviewSortOpen.set(false);
    this.selectedReviewFilter.set(filter);
    this.reviewModalPage.set(1);
  }

  toggleReviewSort(): void {
    this.isReviewSortOpen.update(isOpen => !isOpen);
  }

  selectReviewSort(value: ReviewDateSortOption): void {
    this.selectedReviewSort.set(value);
    this.isReviewSortOpen.set(false);
    this.reviewModalPage.set(1);
  }

  reviewSortLabel(): string {
    return this.reviewSortOptions.find(option => option.value === this.selectedReviewSort())?.label ?? 'DEFAULT';
  }

  modalReviews(): ProductReviewView[] {
    const filter = this.selectedReviewFilter();
    const filtered = filter === 'All'
      ? [...this.reviews()]
      : this.reviews().filter(review => review.rating === Number(filter));

    return this.sortReviews(filtered, this.selectedReviewSort());
  }

  pagedModalReviews(): ProductReviewView[] {
    const page = this.reviewModalPage();
    const start = (page - 1) * this.reviewModalPageSize();
    return this.modalReviews().slice(start, start + this.reviewModalPageSize());
  }

  modalReviewTotalPages(): number {
    return Math.max(Math.ceil(this.modalReviews().length / this.reviewModalPageSize()), 1);
  }

  canGoPreviousReviewPage(): boolean {
    return this.reviewModalPage() > 1;
  }

  canGoNextReviewPage(): boolean {
    return this.reviewModalPage() < this.modalReviewTotalPages();
  }

  previousReviewPage(): void {
    if (!this.canGoPreviousReviewPage()) return;
    this.reviewModalPage.update(page => page - 1);
  }

  nextReviewPage(): void {
    if (!this.canGoNextReviewPage()) return;
    this.reviewModalPage.update(page => page + 1);
  }

  getMethodIcon(method: BrewingMethodCard): 'coffee' | 'droplet' | 'leaf' {
    return method.icon;
  }

  getIncludedProducts(): IncludedProduct[] {
    const p = this.product();
    if (p?.category !== 'sets_bundles') return [];

    return (p.sets_bundles?.composition ?? [])
      .map(item => this.normalizeIncludedProduct(item))
      .filter((item): item is IncludedProduct => !!item);
  }

  shouldShowIncludedProducts(): boolean {
    const p = this.product();
    return p?.category === 'sets_bundles'
      && p.sets_bundles?.is_exclusive !== true
      && (p.sets_bundles?.composition?.length ?? 0) > 0
      && this.getIncludedProducts().length > 0;
  }

  getIncludedProductLink(item: IncludedProduct): unknown[] {
    return item.routeId ? ['/products', item.routeId] : ['/shop/sets-bundles'];
  }

  async toggleSave(): Promise<void> {
    const prod = this.product();
    if (!prod) return;

    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }

    try {
      const result = await this.authService.toggleSavedProduct(prod.product_id);
      this.isSaved.set(result.saved);
    } catch (err) {
      console.error('Failed to save product:', err);
    }
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
    if (item === null || item === undefined) return null;
    if (typeof item !== 'object') {
      const referencedProduct = this.findCatalogProduct(item);
      return referencedProduct ? this.normalizeIncludedProduct(referencedProduct) : null;
    }

    const source = item as Record<string, any>;
    const referencedProduct = this.findCatalogProduct(source);
    const product = referencedProduct as unknown as Record<string, any>
      || ((source['product'] && typeof source['product'] === 'object')
        ? source['product'] as Record<string, any>
        : source);

    const name = this.pickText(product, ['name', 'product_name', 'component_name', 'title']);
    if (!name) return null;

    const category = this.pickText(product, ['category', 'product_category', 'component_category', 'type']);
    const detail = product['matcha'] ?? product['coffee'] ?? product['tools'] ?? product['drinkware'] ?? {};
    const detailRecord = typeof detail === 'object' ? detail as Record<string, any> : {};
    const variants = Array.isArray(product['variants']) ? product['variants'] : [];
    const variant = variants.find((candidate: any) => candidate?.is_default) ?? variants[0] ?? {};
    const productImages = Array.isArray(product['images']) ? product['images'] : [];
    const image = productImages.find((candidate: any) => candidate?.sort_order === 0) ?? productImages[0] ?? {};

    return {
      name,
      eyebrow: [category, this.pickText(detailRecord, ['product_grade', 'process_type', 'tool_type', 'material', 'pricing_tier'])]
        .filter(Boolean)
        .join(' · '),
      description: this.pickText(product, ['short_description', 'description', 'label'])
        || this.pickText(source, ['description', 'label', 'variant_label'])
        || this.pickText(variant, ['label'])
        || 'Included in this set',
      price: this.pickNumber(product, ['price', 'component_price']) ?? this.pickNumber(variant, ['price']),
      tag: this.pickText(product, ['tag'])
        || this.pickText(detailRecord, ['origin', 'product_origin', 'material', 'tool_category'])
        || category
        || 'included',
      icon: this.getIncludedIcon(category),
      routeId: this.getProductRouteId(product, name),
      imageUrl: this.pickImageUrl(product, image)
    };
  }

  private replaceUrlWithProductSlug(currentId: string, product: Product): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const slug = getProductDetailSlug(product);
    if (!slug || currentId === slug) return;

    this.location.replaceState(`/products/${slug}`, '', window.history.state);
  }

  private saveProductDetailScrollPosition(): void {
    if (!this.product()) return;

    window.history.replaceState(
      { ...window.history.state, productDetailScrollY: window.scrollY },
      '',
      window.location.href
    );
  }

  private getSavedProductDetailScrollPosition(): number | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const scrollY = window.history.state?.productDetailScrollY;
    return typeof scrollY === 'number' && Number.isFinite(scrollY)
      ? Math.max(0, scrollY)
      : null;
  }

  private restoreProductDetailScrollPosition(): void {
    const scrollY = this.pendingScrollY;
    if (scrollY === null || !isPlatformBrowser(this.platformId)) return;

    const restore = (): void => window.scrollTo({ top: scrollY, behavior: 'auto' });
    requestAnimationFrame(() => {
      restore();
      [100, 300, 700].forEach(delay => {
        this.scrollRestoreTimers.push(setTimeout(restore, delay));
      });
    });
  }

  private clearScrollRestoreTimers(): void {
    this.scrollRestoreTimers.forEach(timer => clearTimeout(timer));
    this.scrollRestoreTimers = [];
  }

  private getProductRouteId(product: Record<string, any>, name: string): string {
    return getProductDetailSlug({
      name,
      slug: this.pickText(product, ['slug']),
      _id: this.pickText(product, ['_id']),
      product_id: this.pickNumber(product, ['product_id', 'component_product_id']) ?? 0
    });
  }

  private loadProductCatalogForRecommendations(product: Product): void {
    if (this.productCatalog().length) {
      this.youMayAlsoLikeProducts.set(this.buildYouMayAlsoLikeProducts(product, this.productCatalog()));
      return;
    }

    this.productService.getProducts().subscribe({
      next: products => {
        this.productCatalog.set(products);
        this.youMayAlsoLikeProducts.set(this.buildYouMayAlsoLikeProducts(product, products));
      },
      error: err => console.error('Failed to load product catalog for product detail:', err)
    });
  }

  private buildYouMayAlsoLikeProducts(currentProduct: Product, catalog: Product[]): Product[] {
    const currentKey = this.getProductIdentity(currentProduct);
    const sameCategoryProducts = catalog.filter(product =>
      product.category === currentProduct.category
      && product.is_active !== false
      && !isProductOutOfStock(product)
      && this.getProductIdentity(product) !== currentKey
    );

    const bestSellers = sameCategoryProducts
      .filter(product => product.is_best_seller)
      .sort((a, b) => (b.total_sold_quantity ?? 0) - (a.total_sold_quantity ?? 0))
      .slice(0, 3);

    const usedKeys = new Set(bestSellers.map(product => this.getProductIdentity(product)));
    const newArrival = sameCategoryProducts
      .filter(product => product.is_new_arrival && !usedKeys.has(this.getProductIdentity(product)))
      .sort((a, b) => this.getProductDateTime(b) - this.getProductDateTime(a))[0];

    const recommendations = newArrival ? [...bestSellers, newArrival] : [...bestSellers];
    const recommendationKeys = new Set(recommendations.map(product => this.getProductIdentity(product)));

    if (recommendations.length < 4) {
      recommendations.push(
        ...sameCategoryProducts
          .filter(product => !recommendationKeys.has(this.getProductIdentity(product)))
          .sort((a, b) =>
            Number(b.is_best_seller) - Number(a.is_best_seller)
            || Number(b.is_new_arrival) - Number(a.is_new_arrival)
            || (b.total_sold_quantity ?? 0) - (a.total_sold_quantity ?? 0)
          )
          .slice(0, 4 - recommendations.length)
      );
    }

    return recommendations.slice(0, 4);
  }

  private findCatalogProduct(reference: unknown): Product | null {
    const catalog = this.productCatalog();
    if (!catalog.length) return null;

    if (reference === null || reference === undefined) return null;
    if (typeof reference !== 'object') {
      const key = String(reference);
      return catalog.find(product => this.productMatchesReference(product, key)) ?? null;
    }

    const source = reference as Record<string, any>;
    const nestedProduct = source['product'];
    if (nestedProduct && typeof nestedProduct === 'object') {
      const nestedRecord = nestedProduct as Record<string, any>;
      const nestedId = this.pickText(nestedRecord, ['_id', 'slug', 'product_id', 'component_product_id', 'id']);
      if (nestedId) return catalog.find(product => this.productMatchesReference(product, nestedId)) ?? null;
    }

    const keys = [
      this.pickText(source, ['_id', 'slug', 'product_id', 'component_product_id', 'productId', 'id', 'product'])
    ].filter(Boolean);

    for (const key of keys) {
      const product = catalog.find(candidate => this.productMatchesReference(candidate, key));
      if (product) return product;
    }

    return null;
  }

  private productMatchesReference(product: Product, reference: string): boolean {
    const normalized = reference.trim();
    if (!normalized) return false;

    return String(product._id ?? '') === normalized
      || String(product.slug ?? '') === normalized
      || String(product.product_id ?? '') === normalized;
  }

  private pickImageUrl(product: Record<string, any>, image: Record<string, any>): string {
    const candidates = [
      this.pickText(image, ['url']),
      this.pickText(product, ['component_image_url']),
      this.pickText(product, ['component_image_public_id'])
    ];

    return candidates.find(value => /^https?:\/\//i.test(value)) ?? '';
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

  private async loadSavedState(product: Product): Promise<void> {
    if (!this.authService.isAuthenticated()) {
      this.isSaved.set(false);
      return;
    }

    try {
      const result = await this.authService.getSavedItems();
      const saved = (result.saved_products || []).some((item: any) =>
        Number(item.product?.product_id ?? item.product_id) === product.product_id
      );
      this.isSaved.set(saved);
    } catch (err) {
      console.error('Failed to load saved product state:', err);
      this.isSaved.set(false);
    }
  }

  private loadRecentlyViewedProducts(currentProduct: Product): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const products = this.readRecentlyViewedProducts()
      .filter(product => this.getProductIdentity(product) !== this.getProductIdentity(currentProduct))
      .slice(0, 4);

    this.recentlyViewedProducts.set(products);
  }

  private rememberRecentlyViewedProduct(product: Product): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const productKey = this.getProductIdentity(product);
    const nextProducts = [
      product,
      ...this.readRecentlyViewedProducts().filter(item => this.getProductIdentity(item) !== productKey)
    ].slice(0, 8);

    localStorage.setItem(this.recentlyViewedKey, JSON.stringify(nextProducts));
  }

  private readRecentlyViewedProducts(): Product[] {
    try {
      const raw = localStorage.getItem(this.recentlyViewedKey);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter((item: Partial<Product>): item is Product =>
        !!item
        && typeof item === 'object'
        && typeof item.name === 'string'
        && Array.isArray(item.images)
        && Array.isArray(item.variants)
      );
    } catch {
      return [];
    }
  }

  private getProductIdentity(product: Product): string {
    return String(product._id || product.product_id || product.slug || product.name);
  }

  private getProductDateTime(product: Product): number {
    const source = product as Product & { createdAt?: string; updatedAt?: string };
    const time = new Date(source.createdAt || source.updatedAt || '').getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private loadProductReviews(product: Product): void {
    const productId = product._id;
    if (!productId) {
      this.reviews.set([]);
      this.reviewsTotal.set(product.review_count ?? 0);
      return;
    }

    this.isReviewsLoading.set(true);
    this.productService.getProductReviews(productId, 1, 50, 'oldest').subscribe({
      next: (response) => {
        if (response.pagination.total > 0) {
          this.reviews.set(response.data.map(review => this.mapReview(review)));
          this.reviewsTotal.set(response.pagination.total);
          this.reviewsTotalPages.set(response.pagination.totalPages);
        } else {
          this.applyMockReviews(product);
        }
        this.isReviewsLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load product reviews:', err);
        this.applyMockReviews(product);
        this.isReviewsLoading.set(false);
      }
    });
  }

  private applyMockReviews(product: Product): void {
    const reviews = buildMockProductReviews(product);
    this.reviews.set(reviews);
    this.reviewsTotal.set(reviews.length);
    this.reviewsTotalPages.set(Math.max(Math.ceil(reviews.length / 10), 1));
  }

  private reviewModalPageSize(): number {
    return 5;
  }

  private getReviewTime(review: ProductReviewView): number {
    const time = new Date(review.date).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private getReviewComment(review: ProductReviewView): string {
    const comment = review.comment.trim();
    return comment.toLocaleLowerCase() === 'no written comment.' ? '' : comment;
  }

  private compareReviewCommentPresence(a: ProductReviewView, b: ProductReviewView): number {
    return Number(this.hasReviewComment(b)) - Number(this.hasReviewComment(a));
  }

  private sortReviews(reviews: ProductReviewView[], sort: ReviewSortOption): ProductReviewView[] {
    return reviews.sort((a, b) => {
      switch (sort) {
        case 'newest':
          return b.rating - a.rating
            || this.compareReviewCommentPresence(a, b)
            || this.getReviewTime(b) - this.getReviewTime(a);
        case 'highest':
          return b.rating - a.rating
            || this.compareReviewCommentPresence(a, b)
            || this.getReviewTime(b) - this.getReviewTime(a);
        case 'oldest':
        default:
          return b.rating - a.rating
            || this.compareReviewCommentPresence(a, b)
            || this.getReviewTime(a) - this.getReviewTime(b);
      }
    });
  }

  private loadBrewingMethods(product: Product): void {
    if (product.category !== 'coffee' && product.category !== 'matcha') {
      this.brewingMethods.set([]);
      this.isBrewingMethodsLoading.set(false);
      return;
    }

    this.isBrewingMethodsLoading.set(true);
    this.contentService.getBlogs({ tag: 'brewing guide', limit: 12, page: 1 }).subscribe({
      next: (response) => {
        const blogs = response.data ?? [];
        const categoryBlogs = this.pickBrewingBlogsForProduct(product, blogs);
        if (categoryBlogs.length >= 3) {
          this.brewingMethods.set(categoryBlogs.slice(0, 3).map((blog, index) => this.mapBrewingMethod(blog, index)));
          this.isBrewingMethodsLoading.set(false);
          return;
        }

        this.loadBrewingMethodsByCategory(product, categoryBlogs, blogs);
      },
      error: () => this.loadBrewingMethodsByCategory(product, [], [])
    });
  }

  private loadBrewingMethodsByCategory(product: Product, categoryBlogs: any[], existingBlogs: any[]): void {
    this.contentService.getBlogs({ category: 'BREWING GUIDES', limit: 12, page: 1 }).subscribe({
      next: (response) => {
        const seen = new Set(existingBlogs.map(blog => blog._id || blog.slug));
        const combined = [
          ...existingBlogs,
          ...(response.data ?? []).filter(blog => !seen.has(blog._id || blog.slug))
        ];
        const selectedBlogs = this.pickBrewingBlogsForProduct(product, combined).slice(0, 3);

        this.brewingMethods.set(selectedBlogs.map((blog, index) => this.mapBrewingMethod(blog, index)));
        this.isBrewingMethodsLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load brewing methods:', err);
        const displayBlogs = categoryBlogs.slice(0, 3);
        this.brewingMethods.set(displayBlogs.map((blog, index) => this.mapBrewingMethod(blog, index)));
        this.isBrewingMethodsLoading.set(false);
      }
    });
  }

  private pickBrewingBlogsForProduct(product: Product, blogs: any[]): any[] {
    const category = product.category;
    return blogs.filter(blog => this.blogMatchesBrewingCategory(blog, category));
  }

  private blogMatchesBrewingCategory(blog: any, category: string): boolean {
    const haystack = [
      blog.slug,
      blog.title,
      blog.category,
      ...(Array.isArray(blog.tags) ? blog.tags : []),
      ...(Array.isArray(blog.metadata?.tags) ? blog.metadata.tags : []),
      ...(Array.isArray(blog.content)
        ? blog.content.flatMap((block: any) => [block?.type, block?.text, block?.title, block?.caption])
        : [])
    ].join(' ').toLowerCase();

    const hasMatcha = /\bmatcha\b|\bgreen tea\b|\bchasen\b|\bwhisk\b/.test(haystack);
    const hasCoffee = /\bcoffee\b|\bespresso\b|\bpour over\b|\baeropress\b|\bchemex\b|\bv60\b|\bcold brew\b|\bdrip\b/.test(haystack);

    if (category === 'matcha') {
      if (hasCoffee && !hasMatcha) return false;
      return hasMatcha;
    }

    if (category === 'coffee') {
      if (hasMatcha) return false;
      return hasCoffee;
    }

    return false;
  }

  private mapBrewingMethod(blog: any, index: number): BrewingMethodCard {
    return {
      slug: blog.slug || blog._id || '',
      stepAnchor: this.getBrewingStepAnchor(blog),
      title: blog.title || `Brewing Method ${index + 1}`,
      methodLabel: `METHOD ${String(index + 1).padStart(2, '0')}`,
      steps: this.extractBrewingSteps(blog),
      icon: (['coffee', 'droplet', 'leaf'] as const)[index % 3]
    };
  }

  private extractBrewingSteps(blog: any): string[] {
    const fallbackSteps = [
      'Heat Your Water',
      'Grind Your Coffee',
      'Bloom the Grounds'
    ];

    const headingSteps: string[] = Array.isArray(blog.content)
      ? blog.content
          .filter((block: any) => block?.type === 'heading')
          .filter((block: any) => this.isBrewingGuideHeading(block?.text))
          .map((block: any) => this.normalizeBrewingGuideHeading(block?.text))
          .filter((step: string) => step.length >= 3 && step.length <= 42)
      : [];

    const uniqueSteps = headingSteps.filter((step: string, index: number, list: string[]) =>
      list.findIndex((candidate: string) => candidate.toLowerCase() === step.toLowerCase()) === index
    );

    return [...uniqueSteps, ...fallbackSteps].slice(0, 3);
  }

  private isBrewingGuideHeading(value: unknown): boolean {
    return /^(?:(?:step|method)\s*)?\d+[\).\s:-]+/i.test(String(value ?? '').trim());
  }

  private normalizeBrewingGuideHeading(value: unknown): string {
    return String(value ?? '')
      .replace(/^\s*(?:(?:step|method)\s*)?\d+[\).\s:-]+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getBrewingStepAnchor(blog: any): string {
    const content = Array.isArray(blog.content) ? blog.content : [];
    const hasGuideStep = content.some((block: any) => {
      const step = this.normalizeBrewingGuideHeading(block?.text);
      return block?.type === 'heading'
        && this.isBrewingGuideHeading(block?.text)
        && step.length >= 3
        && step.length <= 42;
    });

    // The list and detail API responses can have different content indexes.
    // Pass a semantic guide-step anchor and let Blog Detail resolve it from
    // the rendered article, rather than coupling navigation to an index.
    return hasGuideStep ? 'guide-step-1' : '';
  }

  private mapReview(review: ProductReviewDto): ProductReviewView {
    return {
      author: review.is_anonymous ? 'Anonymous' : (review.user_snapshot?.name?.trim() || 'Guest'),
      date: this.formatReviewDate(review.created_at),
      rating: review.rating,
      comment: review.content?.trim() ?? ''
    };
  }

  private formatReviewDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
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
    this.normalizeCarouselPosition(imageCount);
    this.isSlideTransitionEnabled.set(true);
    this.activeImageIndex.update(index => (index + 1) % imageCount);
    this.slidePosition.update(position => position + 1);
    this.cdr.detectChanges();
  }

  private normalizeCarouselPosition(imageCount = this.images().length): void {
    if (imageCount < 2) return;

    const position = this.slidePosition();
    if (position >= 1 && position <= imageCount) return;

    this.isSlideTransitionEnabled.set(false);
    this.slidePosition.set(this.activeImageIndex() + 1);
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
