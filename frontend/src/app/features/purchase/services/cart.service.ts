import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Product, ProductVariant } from '../../../shared/models/product.model';

export interface CartItem {
  product: Product;
  variantSku: string;
  quantity: number;
  selected: boolean;
}

type ProductIdentifier = string | number | null | undefined;

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private platformId = inject(PLATFORM_ID);

  // Cart items signal
  cartItems = signal<CartItem[]>([]);

  // Cart drawer open state
  isOpen = signal<boolean>(false);

  // Tracking if user clicked checkout from cart drawer
  isCheckoutProcessed = signal<boolean>(false);

  // Checkout summary items signal
  checkoutSummaryItems = signal<any[]>([]);

  setCheckoutProcessed(val: boolean): void {
    this.isCheckoutProcessed.set(val);
  }

  constructor() {
    this.loadCart();
    this.loadCheckoutSummary();
  }

  private loadCart(): void {
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem('checkout_cart_items');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            // Map to include selected field if missing, defaulting to true if not specified
            const items: CartItem[] = parsed.map((item: any) => ({
              product: item.product,
              variantSku: item.variantSku,
              quantity: item.quantity,
              selected: item.selected !== undefined ? item.selected : true
            }));
            this.cartItems.set(items);
            return;
          }
        } catch (e) {
          console.error('Failed to parse cart items from localStorage', e);
        }
      }
    }
  }

  private loadCheckoutSummary(): void {
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem('checkout_summary_items');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            this.checkoutSummaryItems.set(parsed);
          }
        } catch (e) {
          console.error('Failed to parse checkout summary from localStorage', e);
        }
      }
    }
  }

  private saveCart(items: CartItem[]): void {
    this.cartItems.set(items);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('checkout_cart_items', JSON.stringify(items));
    }
  }

  private saveCheckoutSummary(items: any[]): void {
    this.checkoutSummaryItems.set(items);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('checkout_summary_items', JSON.stringify(items));
    }
  }

  openCart(): void {
    this.isOpen.set(true);
  }

  closeCart(): void {
    this.isOpen.set(false);
  }

  addToCart(product: Product, variantSku?: string, quantity = 1): void {
    const variant = this.getInStockVariant(product, variantSku);
    if (!variant) return;
    const sku = variant.sku;

    const currentItems = [...this.cartItems()];
    const productKey = this.getProductKey(product);
    const existingIndex = currentItems.findIndex(
      item => this.getProductKey(item.product) === productKey && item.variantSku === sku
    );

    const maxStock = variant.stock ?? 0;
    if (maxStock <= 0) return;

    if (existingIndex > -1) {
      const existingItem = currentItems[existingIndex];
      const newQty = Math.min(existingItem.quantity + Math.max(1, quantity), maxStock);
      if (newQty <= maxStock) {
        currentItems[existingIndex] = {
          ...existingItem,
          quantity: newQty,
          selected: true // Auto select and check when re-adding
        };
      }
    } else {
      currentItems.push({
        product,
        variantSku: sku,
        quantity: Math.min(Math.max(1, quantity), maxStock),
        selected: maxStock > 0 // Only select initially if in stock
      });
    }

    this.saveCart(currentItems);
    this.openCart();
  }

  private getInStockVariant(product: Product, variantSku?: string): ProductVariant | undefined {
    const requestedVariant = variantSku
      ? product.variants.find(variant => variant.sku === variantSku && (variant.stock ?? 0) > 0)
      : undefined;

    return requestedVariant
      ?? product.variants.find(variant => variant.is_default && (variant.stock ?? 0) > 0)
      ?? product.variants.find(variant => (variant.stock ?? 0) > 0);
  }

  private getProductKey(product: Product): string {
    return product._id || String(product.product_id);
  }

  private matchesProduct(product: Product, productId: ProductIdentifier): boolean {
    const id = productId == null ? '' : String(productId);
    return this.getProductKey(product) === id || String(product.product_id) === id;
  }

  buyNow(product: Product, variantSku: string, quantity = 1): void {
    const variant = product.variants.find(v => v.sku === variantSku);
    if (!variant || variant.stock <= 0) return;

    this.saveCheckoutSummary([{
      product,
      variantSku,
      quantity: Math.min(Math.max(1, quantity), variant.stock),
      selected: true
    }]);
    this.setCheckoutProcessed(true);
    this.closeCart();
  }

  removeFromCart(productId: ProductIdentifier, variantSku: string): void {
    const filtered = this.cartItems().filter(
      item => !(this.matchesProduct(item.product, productId) && item.variantSku === variantSku)
    );
    this.saveCart(filtered);
  }

  updateQuantity(productId: ProductIdentifier, variantSku: string, quantity: number): void {
    const currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => this.matchesProduct(item.product, productId) && item.variantSku === variantSku
    );

    if (index > -1) {
      const item = currentItems[index];
      const variant = item.product.variants.find(v => v.sku === variantSku);
      const maxStock = variant ? variant.stock : 99;

      if (quantity > maxStock) {
        quantity = maxStock;
      }
      if (quantity < 1) {
        quantity = 1;
      }

      currentItems[index] = {
        ...item,
        quantity
      };
      this.saveCart(currentItems);
    }
  }

  updateVariant(productId: ProductIdentifier, oldVariantSku: string, newVariantSku: string): void {
    const currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => this.matchesProduct(item.product, productId) && item.variantSku === oldVariantSku
    );

    if (index > -1) {
      const item = currentItems[index];
      // Check if the new variant is already in the cart
      const existingNewIndex = currentItems.findIndex(
        it => this.matchesProduct(it.product, productId) && it.variantSku === newVariantSku
      );

      if (existingNewIndex > -1 && existingNewIndex !== index) {
        // Merge them
        const existingNewItem = currentItems[existingNewIndex];
        const variant = item.product.variants.find(v => v.sku === newVariantSku);
        const maxStock = variant ? variant.stock : 99;

        let mergedQty = existingNewItem.quantity + item.quantity;
        if (mergedQty > maxStock) mergedQty = maxStock;

        currentItems[existingNewIndex] = {
          ...existingNewItem,
          quantity: mergedQty
        };
        // Remove old one
        currentItems.splice(index, 1);
      } else {
        currentItems[index] = {
          ...item,
          variantSku: newVariantSku
        };
      }
      this.saveCart(currentItems);
    }
  }

  toggleSelection(productId: ProductIdentifier, variantSku: string): void {
    const currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => this.matchesProduct(item.product, productId) && item.variantSku === variantSku
    );

    if (index > -1) {
      const item = currentItems[index];
      const variant = item.product.variants.find(v => v.sku === variantSku);
      const inStock = variant ? variant.stock > 0 : false;

      // If out of stock, it cannot be selected
      if (!inStock) {
        currentItems[index] = {
          ...item,
          selected: false
        };
      } else {
        currentItems[index] = {
          ...item,
          selected: !item.selected
        };
      }
      this.saveCart(currentItems);
    }
  }

  setSelectAll(selected: boolean): void {
    const currentItems = this.cartItems().map(item => {
      const variant = item.product.variants.find(v => v.sku === item.variantSku);
      const inStock = variant ? variant.stock > 0 : false;
      return {
        ...item,
        selected: inStock ? selected : false
      };
    });
    this.saveCart(currentItems);
  }

  clearPurchased(): void {
    const remaining = this.cartItems().filter(item => !item.selected);
    this.saveCart(remaining);
  }

  // --- CHECKOUT SUMMARY LOGIC ---

  processCheckout(): void {
    const currentCart = [...this.cartItems()];
    const selected = currentCart.filter(item => item.selected && (item.product.variants.find(v => v.sku === item.variantSku)?.stock ?? 0) > 0);
    const remaining = currentCart.filter(item => !item.selected || (item.product.variants.find(v => v.sku === item.variantSku)?.stock ?? 0) <= 0);

    if (selected.length === 0) return;

    const currentSummary = [...this.checkoutSummaryItems()];
    for (const selItem of selected) {
      const existingIdx = currentSummary.findIndex(
        it => this.getProductKey(it.product) === this.getProductKey(selItem.product) && it.variantSku === selItem.variantSku
      );
      if (existingIdx > -1) {
        currentSummary[existingIdx].quantity += selItem.quantity;
      } else {
        currentSummary.push({
          ...selItem,
          selected: true
        });
      }
    }

    this.saveCart(remaining);
    this.saveCheckoutSummary(currentSummary);
    this.setCheckoutProcessed(true);
    this.closeCart();
  }

  restoreCheckoutToCart(): void {
    const summary = [...this.checkoutSummaryItems()];
    console.log('restoreCheckoutToCart called, summary items:', summary);
    if (summary.length === 0) return;

    const currentCart = [...this.cartItems()];
    for (const sumItem of summary) {
      const existingIdx = currentCart.findIndex(
        it => this.getProductKey(it.product) === this.getProductKey(sumItem.product) && it.variantSku === sumItem.variantSku
      );
      if (existingIdx > -1) {
        currentCart[existingIdx].quantity += sumItem.quantity;
        currentCart[existingIdx].selected = true;
      } else {
        currentCart.push({
          product: sumItem.product,
          variantSku: sumItem.variantSku,
          quantity: sumItem.quantity,
          selected: true
        });
      }
    }

    this.saveCart(currentCart);
    this.checkoutSummaryItems.set([]);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('checkout_summary_items');
    }
  }

  clearCheckoutSummary(): void {
    this.checkoutSummaryItems.set([]);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('checkout_summary_items');
    }
  }

  updateSummaryQuantity(productId: ProductIdentifier, variantSku: string, quantity: number): void {
    const currentSummary = [...this.checkoutSummaryItems()];
    const index = currentSummary.findIndex(
      item => this.matchesProduct(item.product, productId) && item.variantSku === variantSku
    );

    if (index > -1) {
      const item = currentSummary[index];
      const variant = item.product.variants.find((v: any) => v.sku === variantSku);
      const maxStock = variant ? variant.stock : 99;

      if (quantity > maxStock) quantity = maxStock;
      if (quantity < 1) quantity = 1;

      currentSummary[index] = { ...item, quantity };
      this.saveCheckoutSummary(currentSummary);
    }
  }

  updateSummaryVariant(productId: ProductIdentifier, oldVariantSku: string, newVariantSku: string): void {
    const currentSummary = [...this.checkoutSummaryItems()];
    const index = currentSummary.findIndex(
      item => this.matchesProduct(item.product, productId) && item.variantSku === oldVariantSku
    );

    if (index > -1) {
      const item = currentSummary[index];
      const existingNewIndex = currentSummary.findIndex(
        it => this.matchesProduct(it.product, productId) && it.variantSku === newVariantSku
      );

      if (existingNewIndex > -1 && existingNewIndex !== index) {
        const existingNewItem = currentSummary[existingNewIndex];
        const variant = item.product.variants.find((v: any) => v.sku === newVariantSku);
        const maxStock = variant ? variant.stock : 99;

        let mergedQty = existingNewItem.quantity + item.quantity;
        if (mergedQty > maxStock) mergedQty = maxStock;

        currentSummary[existingNewIndex] = {
          ...existingNewItem,
          quantity: mergedQty
        };
        currentSummary.splice(index, 1);
      } else {
        currentSummary[index] = {
          ...item,
          variantSku: newVariantSku
        };
      }
      this.saveCheckoutSummary(currentSummary);
    }
  }

  removeFromSummary(productId: ProductIdentifier, variantSku: string): void {
    const filtered = this.checkoutSummaryItems().filter(
      item => !(this.matchesProduct(item.product, productId) && item.variantSku === variantSku)
    );
    this.saveCheckoutSummary(filtered);
  }

  addComplementToSummary(product: Product, variantSku: string): void {
    const currentSummary = [...this.checkoutSummaryItems()];
    const productKey = this.getProductKey(product);
    const existingIdx = currentSummary.findIndex(
      item => this.getProductKey(item.product) === productKey && item.variantSku === variantSku
    );

    if (existingIdx > -1) {
      currentSummary[existingIdx].quantity += 1;
    } else {
      currentSummary.push({
        product,
        variantSku,
        quantity: 1,
        selected: true,
        isComplement: true
      });
    }
    this.saveCheckoutSummary(currentSummary);
  }
}
