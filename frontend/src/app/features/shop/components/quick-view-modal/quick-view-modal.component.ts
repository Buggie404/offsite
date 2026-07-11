import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  PLATFORM_ID,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideHeart,
  LucideMinus,
  LucidePlus,
  LucideShoppingBag,
  LucideShoppingCart,
  LucideX
} from '@lucide/angular';
import { Product, ProductImage, Variant } from '../../../home/models/product.model';
import { CartService } from '../../../purchase/services/cart.service';
import { DragScrollDirective } from '../../../../shared/directives/drag-scroll.directive';

@Component({
  selector: 'app-quick-view-modal',
  standalone: true,
  imports: [
    CommonModule,
    LucideChevronLeft,
    LucideChevronRight,
    LucideHeart,
    LucideMinus,
    LucidePlus,
    LucideShoppingBag,
    LucideShoppingCart,
    LucideX,
    DragScrollDirective
  ],
  templateUrl: './quick-view-modal.component.html',
  styleUrl: './quick-view-modal.component.scss'
})
export class QuickViewModalComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) product!: Product;
  @Input() isSaved = false;
  @Output() closed = new EventEmitter<void>();
  @Output() saveToggle = new EventEmitter<Product>();
  @ViewChild('closeButton') closeButton?: ElementRef<HTMLButtonElement>;

  selectedVariantIndex = 0;
  activeImageIndex = 0;
  slidePosition = 1;
  isSlideTransitionEnabled = true;
  quantity = 1;
  quantityError = '';
  isCarouselPaused = false;

  private readonly platformId = inject(PLATFORM_ID);
  private carouselTimer?: ReturnType<typeof setInterval>;
  private previousBodyOverflow = '';
  private previouslyFocused?: HTMLElement;

  constructor(
    private readonly cartService: CartService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  get selectedVariant(): Variant | undefined {
    return this.product.variants[this.selectedVariantIndex];
  }

  get images(): ProductImage[] {
    const combined = [
      ...(this.product.images ?? []),
      ...this.product.variants.flatMap(variant => variant.images ?? [])
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

  get activeImage(): ProductImage | undefined {
    return this.images[this.activeImageIndex];
  }

  get showGalleryDots(): boolean {
    return this.images.length > 1;
  }

  get maxQuantity(): number {
    return Math.max(0, this.selectedVariant?.stock ?? 0);
  }

  get isUnavailable(): boolean {
    return !this.selectedVariant || this.maxQuantity <= 0;
  }

  get totalPrice(): number {
    return this.selectedVariant?.price ?? 0;
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.previouslyFocused = document.activeElement as HTMLElement;
    this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.closeButton?.nativeElement.focus();
    this.preloadImages();
    this.startCarousel();
  }

  ngOnDestroy(): void {
    this.stopCarousel();
    if (!isPlatformBrowser(this.platformId)) return;
    document.body.style.overflow = this.previousBodyOverflow;
    this.previouslyFocused?.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  getVariantLabel(variant: Variant): string {
    return variant.label?.trim() || 'DEFAULT';
  }

  selectVariant(index: number): void {
    this.selectedVariantIndex = index;
    this.quantity = 1;
    this.quantityError = '';

    const variantImages = this.product.variants[index]?.images ?? [];
    const variantImage = variantImages.find(image => image.sort_order === 0)
      ?? [...variantImages].sort((a, b) =>
        (a.sort_order ?? Number.MAX_SAFE_INTEGER)
        - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
      )[0];
    if (variantImage) {
      const imageIndex = this.images.findIndex(image =>
        (variantImage.public_id && image.public_id === variantImage.public_id)
        || image.url === variantImage.url
      );
      if (imageIndex >= 0) this.setActiveImage(imageIndex);
    }
    this.restartCarousel();
    this.renderImageImmediately();
  }

  previousImage(): void {
    if (this.images.length < 2) return;
    this.normalizeCarouselPosition();
    this.isSlideTransitionEnabled = true;
    this.activeImageIndex = (this.activeImageIndex - 1 + this.images.length) % this.images.length;
    this.slidePosition -= 1;
    this.restartCarousel();
    this.renderImageImmediately();
  }

  nextImage(): void {
    if (this.images.length < 2) return;
    this.normalizeCarouselPosition();
    this.isSlideTransitionEnabled = true;
    this.activeImageIndex = (this.activeImageIndex + 1) % this.images.length;
    this.slidePosition += 1;
    this.restartCarousel();
    this.renderImageImmediately();
  }

  goToImage(index: number): void {
    this.setActiveImage(index);
    this.restartCarousel();
    this.renderImageImmediately();
  }

  onSlideTransitionEnd(): void {
    const imageCount = this.images.length;
    if (imageCount < 2) return;

    // The track contains a clone at each end. Snap from a clone to its real
    // counterpart without animation, making the carousel loop seamlessly.
    if (this.slidePosition === 0) {
      this.snapTrackTo(imageCount);
    } else if (this.slidePosition === imageCount + 1) {
      this.snapTrackTo(1);
    }
  }

  decreaseQuantity(): void {
    this.quantity = Math.max(1, this.quantity - 1);
    this.validateQuantity();
  }

  increaseQuantity(): void {
    this.quantity = Math.min(this.maxQuantity, this.quantity + 1);
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
    this.quantity = sanitizedValue ? Number(sanitizedValue) : 0;
    this.validateQuantity();
  }

  normalizeQuantity(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!this.quantity || this.quantity < 1) {
      this.quantity = 1;
    } else if (this.quantity > this.maxQuantity) {
      this.quantity = this.maxQuantity;
    }
    this.validateQuantity();
    input.value = String(this.quantity);
  }

  onSave(): void {
    this.saveToggle.emit(this.product);
  }

  addToCart(): void {
    if (!this.selectedVariant || this.isUnavailable || !this.validateQuantity()) return;
    this.cartService.addToCart(this.product as any, this.selectedVariant.sku, this.quantity);
    this.close();
  }

  buyNow(): void {
    if (!this.selectedVariant || this.isUnavailable || !this.validateQuantity()) return;
    this.cartService.buyNow(this.product as any, this.selectedVariant.sku, this.quantity);
    this.close();
    void this.router.navigate(['/checkout']);
  }

  pauseCarousel(): void {
    this.isCarouselPaused = true;
    this.stopCarousel();
  }

  resumeCarousel(): void {
    this.isCarouselPaused = false;
    this.startCarousel();
  }

  private startCarousel(): void {
    if (
      !isPlatformBrowser(this.platformId)
      || this.isCarouselPaused
      || this.images.length < 2
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
    if (this.images.length < 2) return;
    this.normalizeCarouselPosition();
    this.isSlideTransitionEnabled = true;
    this.activeImageIndex = (this.activeImageIndex + 1) % this.images.length;
    this.slidePosition += 1;
    this.cdr.detectChanges();
  }

  private setActiveImage(index: number): void {
    this.isSlideTransitionEnabled = true;
    this.activeImageIndex = index;
    this.slidePosition = this.images.length > 1 ? index + 1 : 0;
  }

  private snapTrackTo(position: number): void {
    this.isSlideTransitionEnabled = false;
    this.slidePosition = position;
    this.cdr.detectChanges();

    // Keep transitions disabled for one complete painted frame. A single rAF
    // can be batched with the snap by the browser, which makes the clone-to-
    // real-slide reset visibly animate a second time.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.isSlideTransitionEnabled = true;
        this.cdr.detectChanges();
      });
    });
  }

  private normalizeCarouselPosition(): void {
    const imageCount = this.images.length;
    if (imageCount < 2) return;
    if (this.slidePosition >= 1 && this.slidePosition <= imageCount) return;

    this.isSlideTransitionEnabled = false;
    this.slidePosition = this.activeImageIndex + 1;
    this.cdr.detectChanges();
  }

  private renderImageImmediately(): void {
    // The app runs zoneless; force the new src/current dot to paint in the
    // same interaction instead of waiting for a later timer or event.
    this.cdr.detectChanges();
  }

  private validateQuantity(): boolean {
    if (this.isUnavailable) {
      this.quantityError = '';
      return false;
    }

    if (!Number.isFinite(this.quantity) || this.quantity < 1) {
      this.quantityError = 'Please enter at least 1 item.';
      return false;
    }

    if (this.quantity > this.maxQuantity) {
      this.quantityError = `Only ${this.maxQuantity} item${this.maxQuantity === 1 ? '' : 's'} left in stock.`;
      return false;
    }

    this.quantityError = '';
    return true;
  }

  private preloadImages(): void {
    for (const productImage of this.images) {
      const preload = new Image();
      preload.decoding = 'async';
      preload.src = productImage.url;
    }
  }
}
