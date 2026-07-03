import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Product, ProductVariant } from '../../../shared/models/product.model';

export interface CartItem {
  product: Product;
  variantSku: string;
  quantity: number;
  selected: boolean;
}

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

  addToCart(product: Product, variantSku?: string): void {
    const sku = variantSku || product.variants.find(v => v.is_default)?.sku || product.variants[0]?.sku;
    if (!sku) return;

    const currentItems = [...this.cartItems()];
    const existingIndex = currentItems.findIndex(
      item => item.product._id === product._id && item.variantSku === sku
    );

    const variant = product.variants.find(v => v.sku === sku);
    const maxStock = variant ? variant.stock : 99;

    if (existingIndex > -1) {
      const existingItem = currentItems[existingIndex];
      const newQty = existingItem.quantity + 1;
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
        quantity: 1,
        selected: maxStock > 0 // Only select initially if in stock
      });
    }

    this.saveCart(currentItems);
    this.openCart();
  }

  removeFromCart(productId: string, variantSku: string): void {
    const filtered = this.cartItems().filter(
      item => !(item.product._id === productId && item.variantSku === variantSku)
    );
    this.saveCart(filtered);
  }

  updateQuantity(productId: string, variantSku: string, quantity: number): void {
    const currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => item.product._id === productId && item.variantSku === variantSku
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

  updateVariant(productId: string, oldVariantSku: string, newVariantSku: string): void {
    const currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => item.product._id === productId && item.variantSku === oldVariantSku
    );

    if (index > -1) {
      const item = currentItems[index];
      // Check if the new variant is already in the cart
      const existingNewIndex = currentItems.findIndex(
        it => it.product._id === productId && it.variantSku === newVariantSku
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

  toggleSelection(productId: string, variantSku: string): void {
    const currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => item.product._id === productId && item.variantSku === variantSku
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
        it => it.product._id === selItem.product._id && it.variantSku === selItem.variantSku
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
        it => it.product._id === sumItem.product._id && it.variantSku === sumItem.variantSku
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

  updateSummaryQuantity(productId: string, variantSku: string, quantity: number): void {
    const currentSummary = [...this.checkoutSummaryItems()];
    const index = currentSummary.findIndex(
      item => item.product._id === productId && item.variantSku === variantSku
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

  updateSummaryVariant(productId: string, oldVariantSku: string, newVariantSku: string): void {
    const currentSummary = [...this.checkoutSummaryItems()];
    const index = currentSummary.findIndex(
      item => item.product._id === productId && item.variantSku === oldVariantSku
    );

    if (index > -1) {
      const item = currentSummary[index];
      const existingNewIndex = currentSummary.findIndex(
        it => it.product._id === productId && it.variantSku === newVariantSku
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

  removeFromSummary(productId: string, variantSku: string): void {
    const filtered = this.checkoutSummaryItems().filter(
      item => !(item.product._id === productId && item.variantSku === variantSku)
    );
    this.saveCheckoutSummary(filtered);
  }

  addComplementToSummary(product: Product, variantSku: string): void {
    const currentSummary = [...this.checkoutSummaryItems()];
    const existingIdx = currentSummary.findIndex(
      item => item.product._id === product._id && item.variantSku === variantSku
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