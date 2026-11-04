import { Component, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { CurrencyPipe, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DragScrollDirective } from '../../../../shared/directives/drag-scroll.directive';
import { getProductDetailSlug } from '../../../home/models/product.model';
import { Product } from '../../../../shared/models/product.model';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { CartPairing, buildCartPairings } from './cart-pairings.rules';

@Component({
  selector: 'app-cart-pairings',
  standalone: true,
  imports: [CurrencyPipe, DragScrollDirective, RouterLink],
  templateUrl: './cart-pairings.component.html',
  styleUrls: ['./cart-pairings.component.scss']
})
export class CartPairingsComponent {
  private readonly cart = inject(CartService);
  private readonly checkout = inject(CheckoutService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly catalog = signal<Product[]>([]);
  private catalogRequested = false;

  readonly pairings = computed(() => buildCartPairings(this.cart.cartItems(), this.catalog()));

  constructor() {
    effect(() => {
      if (!isPlatformBrowser(this.platformId) || !this.cart.isOpen() || this.catalogRequested) return;
      this.catalogRequested = true;
      void this.loadCatalog();
    });
  }

  imageOf(product: Product): string {
    const images = product.images ?? [];
    return (images.find(image => image.sort_order === 0) ?? images[0] ?? product.variants?.[0]?.images?.[0])?.url ?? '';
  }

  detailLink(product: Product): string[] {
    return ['/products', getProductDetailSlug(product)];
  }

  add(pairing: CartPairing): void {
    this.cart.addToCart(pairing.product, pairing.variant.sku, 1, false);
  }

  close(): void {
    this.cart.closeCart();
  }

  private async loadCatalog(): Promise<void> {
    try {
      this.catalog.set(await this.checkout.getAllProducts());
    } catch {
      // Suggestions are optional: the cart works without them, and the next open retries.
      this.catalogRequested = false;
    }
  }
}
