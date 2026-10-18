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
import {
  DEFAULT_SUBSCRIPTION_FREQUENCY_DAYS,
  PurchaseType,
  SubscriptionFrequencyDays,
  getSubscribeDiscountPercent,
  getSubscribePrice,
  isSubscriptionEligibleProduct,
  isSubscriptionFrequency
} from '../models/subscription-cart.model';

export interface CartItem {
  product: Product;
  variantSku: string;
  quantity: number;
  selected: boolean;
  bundle?: BundleCartMeta;
  // Missing = 'one_time' (carts saved before Subscribe & Save existed).
  purchaseType?: PurchaseType;
  subscriptionFrequencyDays?: SubscriptionFrequencyDays | null;
}

export interface PurchaseOptions {
  purchaseType: PurchaseType;
  subscriptionFrequencyDays?: SubscriptionFrequencyDays | null;
}

export function getPurchaseType(item: { purchaseType?: PurchaseType }): PurchaseType {
  return item.purchaseType === 'subscription' ? 'subscription' : 'one_time';
}

export function isSubscriptionItem(item: { purchaseType?: PurchaseType; bundle?: unknown }): boolean {
  return !item.bundle && getPurchaseType(item) === 'subscription';
}

// Normalise purchase options against the product: subscription is kept only for
// eligible products with a valid frequency, everything else is one-time.
export function normalizePurchaseOptions(product: Product, options?: Partial<PurchaseOptions> | null): PurchaseOptions {
  const wantsSubscription = options?.purchaseType === 'subscription';
  if (!wantsSubscription || !isSubscriptionEligibleProduct(product)) {
    return { purchaseType: 'one_time', subscriptionFrequencyDays: null };
  }
  const days = Number(options?.subscriptionFrequencyDays);
  return {
    purchaseType: 'subscription',
    subscriptionFrequencyDays: isSubscriptionFrequency(days) ? days : DEFAULT_SUBSCRIPTION_FREQUENCY_DAYS
  };
}

// Original (pre-discount) unit price of a non-bundle cart line.
export function getCartItemOriginalUnitPrice(item: CartItem): number {
  const variant = item.product.variants.find(v => v.sku === item.variantSku) ?? item.product.variants[0];
  return variant?.price ?? 0;
}

// Unit price charged at checkout. Subscribe & Save lines also pay full price
// for the first box (this order); the discount only applies to later boxes
// billed by the subscription charge job, so it can't be gamed by cancelling.
export function getCartItemChargedUnitPrice(item: CartItem): number {
  return getCartItemOriginalUnitPrice(item);
}

// Unit price of each later Ritual Box delivery (subscribe price).
export function getCartItemRecurringUnitPrice(item: CartItem): number {
  const original = getCartItemOriginalUnitPrice(item);
  if (!isSubscriptionItem(item)) return original;
  return getSubscribePrice(original, getSubscribeDiscountPercent(item.product));
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
      this.expireGuestSessionIfStale();
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
                bundle: item.bundle,
                ...normalizePurchaseOptions(item.product, item)
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
                isComplement: item.isComplement,
                ...normalizePurchaseOptions(item.product, item)
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
      this.touchGuestSession(items);
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

  addToCart(
    product: Product,
    variantSku?: string,
    quantity = 1,
    openDrawer = true,
    purchaseOptions?: Partial<PurchaseOptions>
  ): void {
    const variant = this.getInStockVariant(product, variantSku);
    if (!variant) return;
    const sku = variant.sku;
    const purchase = normalizePurchaseOptions(product, purchaseOptions);

    let currentItems = [...this.cartItems()];
    const productKey = this.getProductKey(product);
    const existingIndex = currentItems.findIndex(
      item => this.getProductKey(item.product) === productKey
        && item.variantSku === sku
        && getPurchaseType(item) === purchase.purchaseType
    );

    const maxStock = variant.stock ?? 0;
    if (maxStock <= 0) return;

    if (existingIndex > -1) {
      const existingItem = currentItems[existingIndex];
      const newQty = Math.min(existingItem.quantity + Math.max(1, quantity), maxStock);
      if (newQty <= maxStock) {
        currentItems[existingIndex] = {
          ...existingItem,
          ...purchase, // latest frequency wins
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
        selected: maxStock > 0, // Only select initially if in stock
        ...purchase
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

  // A cart line is product + variant + purchase type. When purchaseType is
  // omitted the line is matched on product + variant only (legacy callers).
  private matchesLine(item: CartItem, productId: ProductIdentifier, variantSku: string, purchaseType?: PurchaseType): boolean {
    return this.matchesProduct(item.product, productId)
      && item.variantSku === variantSku
      && (purchaseType === undefined || getPurchaseType(item) === purchaseType);
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

  removeFromCart(productId: ProductIdentifier, variantSku: string, purchaseType?: PurchaseType): void {
    const filtered = this.cartItems().filter(
      item => !this.matchesLine(item, productId, variantSku, purchaseType)
    );
    this.saveCart(filtered);
  }

  // Remove every currently selected item (bulk delete from the SELECT ALL row).
  removeSelected(): void {
    const remaining = this.cartItems().filter(item => !item.selected);
    this.saveCart(remaining);
  }

  updateQuantity(productId: ProductIdentifier, variantSku: string, quantity: number, purchaseType?: PurchaseType): void {
    let currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => this.matchesLine(item, productId, variantSku, purchaseType)
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

  updateVariant(productId: ProductIdentifier, oldVariantSku: string, newVariantSku: string, purchaseType?: PurchaseType): void {
    let currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => this.matchesLine(item, productId, oldVariantSku, purchaseType)
    );

    if (index > -1 && currentItems[index].bundle) {
      return;
    }

    if (index > -1) {
      const item = currentItems[index];
      // Check if the new variant is already in the cart (same purchase type)
      const existingNewIndex = currentItems.findIndex(
        it => this.matchesLine(it, productId, newVariantSku, getPurchaseType(item))
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

  toggleSelection(productId: ProductIdentifier, variantSku: string, purchaseType?: PurchaseType): void {
    const currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(
      item => this.matchesLine(item, productId, variantSku, purchaseType)
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

  // Switch a line between one-time and Subscribe & Save. If a line with the
  // target purchase type already exists for the same variant, the two merge.
  setPurchaseType(item: CartItem, purchaseType: PurchaseType): void {
    if (item.bundle || getPurchaseType(item) === purchaseType) return;
    const purchase = normalizePurchaseOptions(item.product, {
      purchaseType,
      subscriptionFrequencyDays: item.subscriptionFrequencyDays
    });
    if (purchase.purchaseType !== purchaseType) return; // not eligible

    const productId = this.getProductKey(item.product);
    const currentItems = [...this.cartItems()];
    const index = currentItems.findIndex(it => this.matchesLine(it, productId, item.variantSku, getPurchaseType(item)));
    if (index === -1) return;

    const targetIndex = currentItems.findIndex(it => this.matchesLine(it, productId, item.variantSku, purchaseType));
    if (targetIndex > -1) {
      const target = currentItems[targetIndex];
      const maxStock = item.product.variants.find(v => v.sku === item.variantSku)?.stock ?? 99;
      currentItems[targetIndex] = {
        ...target,
        quantity: Math.min(target.quantity + currentItems[index].quantity, maxStock),
        selected: target.selected || currentItems[index].selected
      };
      currentItems.splice(index, 1);
    } else {
      currentItems[index] = { ...currentItems[index], ...purchase };
    }
    this.saveCart(currentItems);
  }

  setSubscriptionFrequency(item: CartItem, days: SubscriptionFrequencyDays): void {
    if (!isSubscriptionItem(item) || !isSubscriptionFrequency(days)) return;
    const productId = this.getProductKey(item.product);
    const currentItems = this.cartItems().map(it =>
      this.matchesLine(it, productId, item.variantSku, 'subscription')
        ? { ...it, subscriptionFrequencyDays: days }
        : it
    );
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
        it => this.getProductKey(it.product) === this.getProductKey(selItem.product)
          && it.variantSku === selItem.variantSku
          && getPurchaseType(it) === getPurchaseType(selItem)
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
        it => this.getProductKey(it.product) === this.getProductKey(sumItem.product)
          && it.variantSku === sumItem.variantSku
          && getPurchaseType(it) === getPurchaseType(sumItem)
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
          bundle: sumItem.bundle,
          ...normalizePurchaseOptions(sumItem.product, sumItem)
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

  // Summary lines are product + variant + purchase type, like cart lines.
  private findSummaryIndex(items: any[], productId: ProductIdentifier, variantSku: string, purchaseType?: PurchaseType): number {
    return items.findIndex(item => this.matchesLine(item, productId, variantSku, purchaseType));
  }

  updateSummaryQuantity(productId: ProductIdentifier, variantSku: string, quantity: number, purchaseType?: PurchaseType): void {
    const currentSummary = [...this.checkoutSummaryItems()];
    const index = this.findSummaryIndex(currentSummary, productId, variantSku, purchaseType);

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

  updateSummaryVariant(productId: ProductIdentifier, oldVariantSku: string, newVariantSku: string, purchaseType?: PurchaseType): void {
    const currentSummary = [...this.checkoutSummaryItems()];
    const index = this.findSummaryIndex(currentSummary, productId, oldVariantSku, purchaseType);

    if (index > -1) {
      const item = currentSummary[index];
      if (item.bundle) {
        return;
      }

      const existingNewIndex = this.findSummaryIndex(currentSummary, productId, newVariantSku, getPurchaseType(item));

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

  removeFromSummary(productId: ProductIdentifier, variantSku: string, purchaseType?: PurchaseType): void {
    const filtered = this.checkoutSummaryItems().filter(
      item => !this.matchesLine(item, productId, variantSku, purchaseType)
    );
    this.saveCheckoutSummary(filtered);
  }

  // Checkout: move a summary line between one-time and Subscribe & Save.
  // Merges into an existing line of the target type for the same variant.
  setSummaryPurchaseType(item: CartItem, purchaseType: PurchaseType, frequencyDays?: SubscriptionFrequencyDays): void {
    if (item.bundle || getPurchaseType(item) === purchaseType) return;
    const purchase = normalizePurchaseOptions(item.product, {
      purchaseType,
      subscriptionFrequencyDays: frequencyDays ?? item.subscriptionFrequencyDays
    });
    if (purchase.purchaseType !== purchaseType) return; // not eligible

    const productId = this.getProductKey(item.product);
    const summary = [...this.checkoutSummaryItems()];
    const index = this.findSummaryIndex(summary, productId, item.variantSku, getPurchaseType(item));
    if (index === -1) return;

    const targetIndex = this.findSummaryIndex(summary, productId, item.variantSku, purchaseType);
    if (targetIndex > -1) {
      const maxStock = item.product.variants.find(v => v.sku === item.variantSku)?.stock ?? 99;
      summary[targetIndex] = {
        ...summary[targetIndex],
        quantity: Math.min(summary[targetIndex].quantity + summary[index].quantity, maxStock)
      };
      summary.splice(index, 1);
    } else {
      summary[index] = { ...summary[index], ...purchase };
    }
    this.saveCheckoutSummary(summary);
  }

  setSummarySubscriptionFrequency(item: CartItem, days: SubscriptionFrequencyDays): void {
    if (!isSubscriptionItem(item) || !isSubscriptionFrequency(days)) return;
    const productId = this.getProductKey(item.product);
    this.saveCheckoutSummary(this.checkoutSummaryItems().map(it =>
      this.matchesLine(it, productId, item.variantSku, 'subscription')
        ? { ...it, subscriptionFrequencyDays: days }
        : it
    ));
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

  // ===== Guest session lifetime (24h) =====

  // Guest data lives only in localStorage; it expires 24h after the guest
  // first put something in the cart.
  private static readonly GUEST_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly GUEST_SESSION_KEY = 'guest_session_expires_at';

  private isGuestSessionExpired(): boolean {
    const raw = localStorage.getItem(CartService.GUEST_SESSION_KEY);
    return !!raw && Date.now() >= Number(raw);
  }

  private expireGuestSessionIfStale(): void {
    if (this.isAuthed() || !this.isGuestSessionExpired()) return;
    localStorage.removeItem('checkout_cart_items');
    localStorage.removeItem('checkout_summary_items');
    localStorage.removeItem('guest_cart_backup');
    localStorage.removeItem(CartService.GUEST_SESSION_KEY);
  }

  private touchGuestSession(items: CartItem[]): void {
    if (this.isAuthed() || items.length === 0) return;
    if (localStorage.getItem(CartService.GUEST_SESSION_KEY)) return;
    localStorage.setItem(
      CartService.GUEST_SESSION_KEY,
      String(Date.now() + CartService.GUEST_SESSION_TTL_MS)
    );
  }

  // ===== Guest cart merge & logged-in DB sync =====

  private isAuthed(): boolean {
    return isPlatformBrowser(this.platformId) && !!localStorage.getItem('token');
  }

  // Guest cart payload sent to the backend merge (product_id = Product._id, variant = sku).
  getGuestCartPayload(): Array<{
    product_id: string | number;
    variantSku: string;
    quantity: number;
    selected: boolean;
    bundle?: any;
    purchaseType: PurchaseType;
    subscriptionFrequencyDays: SubscriptionFrequencyDays | null;
  }> {
    return this.cartItems().map(item => ({
      product_id: item.product?._id ?? item.product?.product_id,
      variantSku: item.variantSku,
      quantity: item.quantity,
      selected: item.selected,
      bundle: item.bundle,
      purchaseType: getPurchaseType(item),
      subscriptionFrequencyDays: item.subscriptionFrequencyDays ?? null
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
        bundle: it.bundle,
        ...normalizePurchaseOptions(it.product, it)
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
    // A guest cart older than 24h is not restored.
    const backup = this.isGuestSessionExpired() ? null : localStorage.getItem('guest_cart_backup');
    if (!backup) localStorage.removeItem(CartService.GUEST_SESSION_KEY);
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
              bundle: item.bundle,
              ...normalizePurchaseOptions(item.product, item)
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
