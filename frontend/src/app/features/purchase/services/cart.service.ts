import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Product, ProductVariant } from '../../../shared/models/product.model';
import { HttpService } from '../../../core/http.service';
import {
  BundleCartMeta,
  createBundleDisplayProduct,
  getBundleMaxStock,
  isBundleOutOfStock,
  refreshBundleCartItem,
  updateBundleComponentVariant
} from '../models/bundle-cart.model';

export interface CartItem {
  product: Product;
  variantSku: string;
  quantity: number;
  selected: boolean;
  bundle?: BundleCartMeta;
}

type ProductIdentifier = string | number | null | undefined;

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpService);

  // When true, saveCart() will not push to the server. Used while hydrating
  // the cart FROM the server so we don't echo it straight back.
  private suppressSync = false;
  private syncTimer: any = null;

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
    // When logged in, the DB cart is authoritative — hydrate from it on load
    // so edits/removals made in a previous session are reflected.
    this.loadFromServerIfAuthed();
  }

  private loadCart(): void {
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem('checkout_cart_items');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            // Map to include selected field if missing, defaulting to true if not specified
            const items: CartItem[] = parsed.map((item: any) =>
              refreshBundleCartItem({
                product: item.product,
                variantSku: item.variantSku,
                quantity: item.quantity,
                selected: item.selected !== undefined ? item.selected : true,
                bundle: item.bundle
              })
            );
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
            this.checkoutSummaryItems.set(
              parsed.map((item: any) => refreshBundleCartItem({
                product: item.product,
                variantSku: item.variantSku,
                quantity: item.quantity,
                selected: item.selected !== undefined ? item.selected : true,
                bundle: item.bundle,
                isComplement: item.isComplement
              }))
            );
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
    // While logged in, mirror every change to the DB cart (add/edit/remove),
    // unless we are currently hydrating from the server.
    if (!this.suppressSync) {
      this.scheduleServerSync();
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

  addToCart(product: Product, variantSku?: string, quantity = 1, openDrawer = true): void {
    const variant = this.getInStockVariant(product, variantSku);
    if (!variant) return;
    const sku = variant.sku;

    let currentItems = [...this.cartItems()];
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
        currentItems = this.moveItemToFront(currentItems, existingIndex);
      }
    } else {
      currentItems.unshift({
        product,
        variantSku: sku,
        quantity: Math.min(Math.max(1, quantity), maxStock),
        selected: maxStock > 0 // Only select initially if in stock
      });
    }

    this.saveCart(currentItems);
    if (openDrawer) {
      this.openCart();
    }
  }

  addKitBundleToCart(bundle: BundleCartMeta, quantity = 1, openDrawer = true): void {
    if (isBundleOutOfStock(bundle)) return;

    const displayProduct = createBundleDisplayProduct(bundle);
    const sku = bundle.displaySku;
    let currentItems = [...this.cartItems()];
    const existingIndex = currentItems.findIndex(
      (item) => item.bundle?.bundleKey === bundle.bundleKey
    );
    const maxStock = getBundleMaxStock(bundle);
    const addQty = Math.max(1, quantity);

    if (existingIndex > -1) {
      const existingItem = currentItems[existingIndex];
      currentItems[existingIndex] = {
        ...existingItem,
        product: displayProduct,
        bundle,
        quantity: Math.min(existingItem.quantity + addQty, maxStock),
        selected: true
      };
      currentItems = this.moveItemToFront(currentItems, existingIndex);
    } else {
      currentItems.unshift({
        product: displayProduct,
        variantSku: sku,
        quantity: Math.min(addQty, maxStock),
        selected: true,
        bundle
      });
    }

    this.saveCart(currentItems);
    if (openDrawer) {
      this.openCart();
    }
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

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('checkout_delivery_info');
      localStorage.removeItem('checkout_card_info');
      localStorage.removeItem('checkout_bank_info');
    }

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

  // Remove every currently selected item (bulk delete from the SELECT ALL row).
  removeSelected(): void {
    const remaining = this.cartItems().filter(item => !item.selected);
    this.saveCart(remaining);
  }

  updateQuantity(productId: ProductIdentifier, variantSku: string, quantity: number): void {
    let currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => this.matchesProduct(item.product, productId) && item.variantSku === variantSku
    );

    if (index > -1) {
      const item = currentItems[index];
      const maxStock = item.bundle
        ? getBundleMaxStock(item.bundle)
        : (item.product.variants.find((variant) => variant.sku === variantSku)?.stock ?? 99);

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
      currentItems = this.moveItemToFront(currentItems, index);
      this.saveCart(currentItems);
    }
  }

  updateVariant(productId: ProductIdentifier, oldVariantSku: string, newVariantSku: string): void {
    let currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => this.matchesProduct(item.product, productId) && item.variantSku === oldVariantSku
    );

    if (index > -1 && currentItems[index].bundle) {
      return;
    }

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

        const mergedItem = {
          ...existingNewItem,
          quantity: mergedQty
        };
        currentItems = currentItems.filter((_, itemIndex) =>
          itemIndex !== existingNewIndex && itemIndex !== index
        );
        currentItems.unshift(mergedItem);
      } else {
        currentItems[index] = {
          ...item,
          variantSku: newVariantSku
        };
        currentItems = this.moveItemToFront(currentItems, index);
      }
      this.saveCart(currentItems);
    }
  }

  updateBundleComponentVariant(
    bundleLineSku: string,
    componentProductId: number,
    oldComponentVariantSku: string,
    newComponentVariantSku: string
  ): void {
    const updated = this.applyBundleComponentVariantChange(
      [...this.cartItems()],
      bundleLineSku,
      componentProductId,
      oldComponentVariantSku,
      newComponentVariantSku
    );

    if (updated) {
      this.saveCart(updated);
    }
  }

  updateSummaryBundleComponentVariant(
    bundleLineSku: string,
    componentProductId: number,
    oldComponentVariantSku: string,
    newComponentVariantSku: string
  ): void {
    const updated = this.applyBundleComponentVariantChange(
      [...this.checkoutSummaryItems()],
      bundleLineSku,
      componentProductId,
      oldComponentVariantSku,
      newComponentVariantSku
    );

    if (updated) {
      this.saveCheckoutSummary(updated);
    }
  }

  private applyBundleComponentVariantChange(
    items: CartItem[],
    bundleLineSku: string,
    componentProductId: number,
    oldComponentVariantSku: string,
    newComponentVariantSku: string
  ): CartItem[] | null {
    const index = items.findIndex(
      (item) => item.bundle && item.variantSku === bundleLineSku
    );

    if (index === -1) {
      return null;
    }

    const item = items[index];
    const updatedBundle = updateBundleComponentVariant(
      item.bundle!,
      componentProductId,
      oldComponentVariantSku,
      newComponentVariantSku
    );

    if (!updatedBundle) {
      return null;
    }

    const refreshed = refreshBundleCartItem({
      ...item,
      bundle: updatedBundle,
      variantSku: updatedBundle.displaySku
    });

    const newLineSku = refreshed.variantSku;
    const duplicateIndex = items.findIndex(
      (entry, entryIndex) =>
        entryIndex !== index && entry.bundle && entry.variantSku === newLineSku
    );

    if (duplicateIndex > -1) {
      const duplicate = items[duplicateIndex];
      const maxStock = getBundleMaxStock(updatedBundle);
      let mergedQty = duplicate.quantity + item.quantity;
      if (mergedQty > maxStock) {
        mergedQty = maxStock;
      }

      const mergedItem = {
        ...duplicate,
        quantity: mergedQty,
        bundle: updatedBundle,
        product: refreshed.product,
        variantSku: newLineSku
      };
      return [
        mergedItem,
        ...items.filter((_, itemIndex) => itemIndex !== duplicateIndex && itemIndex !== index)
      ];
    }

    items[index] = refreshed;
    return this.moveItemToFront(items, index);
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

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('checkout_delivery_info');
      localStorage.removeItem('checkout_card_info');
      localStorage.removeItem('checkout_bank_info');
    }

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
          selected: true,
          bundle: sumItem.bundle
        });
      }
    }

    this.saveCart(currentCart);
    this.checkoutSummaryItems.set([]);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('checkout_summary_items');
    }
  }

  restoreItemsToCart(items: any[]): void {
    if (!items || items.length === 0) return;
    const currentCart = [...this.cartItems()];
    for (const item of items) {
      const existingIdx = currentCart.findIndex(
        it => it.product._id === item.product._id && it.variantSku === item.variantSku
      );
      if (existingIdx > -1) {
        currentCart[existingIdx].quantity += item.quantity;
        currentCart[existingIdx].selected = true;
      } else {
        currentCart.push({
          product: item.product,
          variantSku: item.variantSku,
          quantity: item.quantity,
          selected: true,
          bundle: item.bundle
        });
      }
    }
    this.saveCart(currentCart);
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
      const maxStock = item.bundle
        ? getBundleMaxStock(item.bundle)
        : (item.product.variants.find((v: any) => v.sku === variantSku)?.stock ?? 99);

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
      if (item.bundle) {
        return;
      }

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

  private moveItemToFront<T>(items: T[], index: number): T[] {
    if (index <= 0 || index >= items.length) return items;

    const [item] = items.splice(index, 1);
    items.unshift(item);
    return items;
  }

  // ===== Guest cart merge & logged-in DB sync =====

  private isAuthed(): boolean {
    return isPlatformBrowser(this.platformId) && !!localStorage.getItem('token');
  }

  // Guest cart payload sent to the backend merge (product_id = Product._id, variant = sku).
  getGuestCartPayload(): Array<{ product_id: string | number; variantSku: string; quantity: number; selected: boolean; bundle?: any }> {
    return this.cartItems().map(item => ({
      product_id: item.product?._id ?? item.product?.product_id,
      variantSku: item.variantSku,
      quantity: item.quantity,
      selected: item.selected,
      bundle: item.bundle
    }));
  }

  // Overwrite the local cart with an authoritative cart returned by the backend
  // (merge result or GET /cart). Does NOT re-sync back to the server.
  replaceCartFromMerge(mergedItems: any[]): void {
    if (!Array.isArray(mergedItems)) return;
    const items: CartItem[] = mergedItems.map((it) =>
      refreshBundleCartItem({
        product: it.product,
        variantSku: it.variantSku,
        quantity: it.quantity,
        selected: it.selected !== undefined ? it.selected : true,
        bundle: it.bundle
      })
    );
    this.suppressSync = true;
    try {
      this.saveCart(items);
    } finally {
      this.suppressSync = false;
    }
  }

  // Debounced push of the current cart to the DB (logged-in users only).
  private scheduleServerSync(): void {
    if (!this.isAuthed()) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.syncToServer(), 400);
  }

  private async syncToServer(): Promise<void> {
    if (!this.isAuthed()) return;
    try {
      await this.http.put('/cart', { items: this.getGuestCartPayload() });
    } catch (e) {
      console.error('Cart sync to server failed:', e);
    }
  }

  // Load the authoritative DB cart on startup when already logged in.
  private async loadFromServerIfAuthed(): Promise<void> {
    if (!this.isAuthed()) return;
    try {
      const res: any = await this.http.get('/cart');
      if (res?.cart?.items) {
        this.replaceCartFromMerge(res.cart.items);
      }
    } catch (e) {
      // Keep the localStorage cart if the server is unreachable.
    }
  }

  // Before a login overwrites the local cart with the merged user cart, keep a
  // copy of the current guest cart so logout can restore it (one-way merge).
  snapshotGuestCartForLogin(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const current = localStorage.getItem('checkout_cart_items') || '[]';
    localStorage.setItem('guest_cart_backup', current);
  }

  // On logout, drop the user cart from local storage and restore the guest
  // cart captured at login (the user cart stays safe in the DB).
  restoreGuestCartOnLogout(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const backup = localStorage.getItem('guest_cart_backup');
    let items: CartItem[] = [];
    if (backup) {
      try {
        const parsed = JSON.parse(backup);
        if (Array.isArray(parsed)) {
          items = parsed.map((item: any) =>
            refreshBundleCartItem({
              product: item.product,
              variantSku: item.variantSku,
              quantity: item.quantity,
              selected: item.selected !== undefined ? item.selected : true,
              bundle: item.bundle
            })
          );
        }
      } catch { /* fall back to empty guest cart */ }
    }
    localStorage.removeItem('guest_cart_backup');
    // Not authed anymore, and suppressSync guards against any stray push.
    this.suppressSync = true;
    try {
      this.saveCart(items);
    } finally {
      this.suppressSync = false;
    }
  }
}
