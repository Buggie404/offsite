import { Product } from '../../../shared/models/product.model';

export interface BundleComponentSelection {
  product: Product;
  variantSku: string;
  slotLabel: string;
  quantity?: number;
}

export interface BundleCartMeta {
  bundleKey: string;
  displaySku: string;
  title: string;
  purchaseType: string;
  displayImage: string;
  packSize: 2 | 3;
  kitType: string;
  components: BundleComponentSelection[];
  originalTotal: number;
  discountedTotal: number;
  discountRate: number;
}

export const BUNDLE_DISCOUNT_RATE = 0.2;
export const KIT_PACK_2_IMAGE = 'assets/images/build-bundle/packof2kit.png';
export const KIT_PACK_3_IMAGE = 'assets/images/build-bundle/packof3kit.png';
export const BUNDLE_PACK_2_IMAGE = 'assets/images/build-bundle/packof2bundle.png';
export const BUNDLE_PACK_3_IMAGE = 'assets/images/build-bundle/packof3bundle.png';

/** @deprecated use KIT_PACK_2_IMAGE */
export const MATCHA_KIT_PACK_2_IMAGE = KIT_PACK_2_IMAGE;
/** @deprecated use displaySku on bundle meta */
export const MATCHA_KIT_PACK_2_SKU = 'matcha-kit-pack-2';
/** @deprecated use createKitBundle */
export const MATCHA_KIT_PACK_2_KEY = 'matcha-kit-pack-2';

export function isBundleCartItem(item: { bundle?: BundleCartMeta }): boolean {
  return !!item.bundle;
}

export function getBundleComponentVariant(product: Product, variantSku?: string) {
  if (variantSku) {
    return (
      product.variants.find((variant) => variant.sku === variantSku) ??
      product.variants.find((variant) => variant.is_default) ??
      product.variants[0]
    );
  }

  return (
    product.variants.find((variant) => variant.is_default && variant.stock > 0) ??
    product.variants.find((variant) => variant.stock > 0) ??
    product.variants[0]
  );
}

export function computeKitBundleTotals(components: BundleComponentSelection[]) {
  const originalTotal = components.reduce((sum, component) => {
    const variant = getBundleComponentVariant(component.product, component.variantSku);
    const qty = component.quantity ?? 1;
    return sum + (variant?.price ?? 0) * qty;
  }, 0);

  const discountedTotal = originalTotal * (1 - BUNDLE_DISCOUNT_RATE);
  return { originalTotal, discountedTotal };
}

export function mergeBundleComponents(
  components: BundleComponentSelection[]
): BundleComponentSelection[] {
  const merged = new Map<string, BundleComponentSelection>();

  for (const component of components) {
    const key = `${component.product.product_id}:${component.variantSku}`;
    const existing = merged.get(key);
    const addQty = component.quantity ?? 1;

    if (existing) {
      existing.quantity = (existing.quantity ?? 1) + addQty;
      continue;
    }

    merged.set(key, {
      ...component,
      quantity: addQty
    });
  }

  return Array.from(merged.values());
}

export function getBundleContentToggleLabel(bundle: BundleCartMeta): string {
  return bundle.kitType === 'bundle' ? 'VIEW BUNDLE CONTENT' : 'VIEW KIT CONTENT';
}

export function getBundleContentComponents(
  bundle: BundleCartMeta
): BundleComponentSelection[] {
  return mergeBundleComponents(bundle.components);
}

export function getBundleComponentLineQuantity(
  item: { quantity: number },
  component: BundleComponentSelection
): number {
  return item.quantity * (component.quantity ?? 1);
}

export function buildBundleKey(
  kitType: string,
  packSize: number,
  components: BundleComponentSelection[]
): string {
  const signature = components
    .flatMap((component) => {
      const qty = component.quantity ?? 1;
      const token = `${component.product.product_id}:${component.variantSku}`;
      return Array.from({ length: qty }, () => token);
    })
    .join('|');
  return `${kitType}-pack-${packSize}-${signature}`;
}

export function getDefaultBundleTitle(kitType: string, packSize: number): string {
  if (kitType === 'matcha_kit') return `Matcha Kit Pack of ${packSize}`;
  if (kitType === 'coffee_kit') return `Coffee Kit Pack of ${packSize}`;
  return `Bundle Pack of ${packSize}`;
}

export function getDefaultBundleImage(kitType: string, packSize: number): string {
  if (kitType === 'bundle') {
    return packSize === 3 ? BUNDLE_PACK_3_IMAGE : BUNDLE_PACK_2_IMAGE;
  }

  return packSize === 3 ? KIT_PACK_3_IMAGE : KIT_PACK_2_IMAGE;
}

export function createKitBundle(params: {
  kitType: string;
  packSize: 2 | 3;
  components: BundleComponentSelection[];
  pricing?: { original: number; sale: number };
  title?: string;
  displayImage?: string;
}): BundleCartMeta {
  const components =
    params.kitType === 'bundle'
      ? mergeBundleComponents(params.components)
      : params.components.map((component) => ({
          ...component,
          quantity: component.quantity ?? 1
        }));
  const computed = computeKitBundleTotals(components);
  const bundleKey = buildBundleKey(params.kitType, params.packSize, components);

  return {
    bundleKey,
    displaySku: bundleKey,
    title: params.title ?? getDefaultBundleTitle(params.kitType, params.packSize),
    purchaseType: 'One Time Purchase',
    displayImage: params.displayImage ?? getDefaultBundleImage(params.kitType, params.packSize),
    packSize: params.packSize,
    kitType: params.kitType,
    components,
    originalTotal: params.pricing?.original ?? computed.originalTotal,
    discountedTotal: params.pricing?.sale ?? computed.discountedTotal,
    discountRate: BUNDLE_DISCOUNT_RATE
  };
}

export function createMatchaKitPack2Bundle(
  packageProduct: Product,
  toolProduct: Product,
  packageSku: string,
  toolSku: string,
  pricing?: { original: number; sale: number }
): BundleCartMeta {
  return createKitBundle({
    kitType: 'matcha_kit',
    packSize: 2,
    components: [
      { product: packageProduct, variantSku: packageSku, slotLabel: 'Package' },
      { product: toolProduct, variantSku: toolSku, slotLabel: 'Tool' }
    ],
    pricing
  });
}

export function getBundleMaxStock(bundle: BundleCartMeta): number {
  const requiredBySku = new Map<string, { stock: number; count: number }>();

  for (const component of bundle.components) {
    const variant = getBundleComponentVariant(component.product, component.variantSku);
    const sku = variant?.sku ?? '';
    const stock = variant?.stock ?? 0;
    const qty = component.quantity ?? 1;
    const existing = requiredBySku.get(sku);

    if (existing) {
      existing.count += qty;
    } else {
      requiredBySku.set(sku, { stock, count: qty });
    }
  }

  let maxBundles = Number.POSITIVE_INFINITY;
  for (const { stock, count } of requiredBySku.values()) {
    maxBundles = Math.min(maxBundles, Math.floor(stock / count));
  }

  return Number.isFinite(maxBundles) ? maxBundles : 0;
}

export function isBundleOutOfStock(bundle: BundleCartMeta): boolean {
  return getBundleMaxStock(bundle) <= 0;
}

export function createBundleDisplayProduct(bundle: BundleCartMeta): Product {
  const now = new Date().toISOString();

  return {
    _id: bundle.bundleKey,
    product_id: 999902,
    name: bundle.title,
    slug: bundle.bundleKey,
    category: 'sets_bundles',
    variant_type: 'none',
    images: [
      {
        url: bundle.displayImage,
        public_id: bundle.bundleKey,
        sort_order: 0
      }
    ],
    variants: [
      {
        sku: bundle.displaySku,
        label: bundle.purchaseType,
        price: bundle.discountedTotal,
        stock: getBundleMaxStock(bundle),
        is_default: true,
        images: [
          {
            url: bundle.displayImage,
            public_id: bundle.bundleKey,
            sort_order: 0
          }
        ]
      }
    ],
    review_count: 0,
    is_active: true,
    createdAt: now,
    updatedAt: now
  };
}

export function getCartItemUnitPrice(item: {
  product: Product;
  variantSku: string;
  bundle?: BundleCartMeta;
}): number {
  if (item.bundle) {
    return item.bundle.discountedTotal;
  }

  const variant =
    item.product.variants.find((entry) => entry.sku === item.variantSku) ??
    item.product.variants[0];
  return variant?.price ?? 0;
}

export function getBundleSaleLineTotal(item: {
  quantity: number;
  bundle?: BundleCartMeta;
}): number {
  if (!item.bundle) return 0;
  return item.bundle.discountedTotal * item.quantity;
}

export function refreshBundleCartItem<T extends {
  product: Product;
  variantSku: string;
  bundle?: BundleCartMeta;
}>(item: T): T {
  if (!item.bundle) return item;

  const displayImage = getDefaultBundleImage(item.bundle.kitType, item.bundle.packSize);
  const bundle: BundleCartMeta = {
    ...item.bundle,
    displayImage
  };

  return {
    ...item,
    bundle,
    product: createBundleDisplayProduct(bundle),
    variantSku: bundle.displaySku
  };
}

export function getCartItemLineTotal(item: {
  product: Product;
  variantSku: string;
  quantity: number;
  bundle?: BundleCartMeta;
}): number {
  return getCartItemUnitPrice(item) * item.quantity;
}

export function getCartItemImage(item: {
  product: Product;
  variantSku: string;
  bundle?: BundleCartMeta;
}): string {
  if (item.bundle) {
    return getDefaultBundleImage(item.bundle.kitType, item.bundle.packSize);
  }

  const variant =
    item.product.variants.find((entry) => entry.sku === item.variantSku) ??
    item.product.variants[0];
  return variant?.images?.[0]?.url ?? item.product.images?.[0]?.url ?? '';
}

export function getBundleComponentImage(component: BundleComponentSelection): string {
  const variant = getBundleComponentVariant(component.product, component.variantSku);
  return variant?.images?.[0]?.url ?? component.product.images?.[0]?.url ?? '';
}

export function getBundleComponentDisplayName(component: BundleComponentSelection): string {
  const variant = getBundleComponentVariant(component.product, component.variantSku);
  const variantLabel = variant?.label?.trim();
  return variantLabel ? `${component.product.name} - ${variantLabel}` : component.product.name;
}

export function expandBundleForBackendItems(item: {
  quantity: number;
  bundle: BundleCartMeta;
}) {
  const factor = 1 - item.bundle.discountRate;

  return item.bundle.components.map((component) => {
    const variant = getBundleComponentVariant(component.product, component.variantSku)!;
    const unitPrice = Math.round(variant.price * factor * 100) / 100;
    const quantity = item.quantity * (component.quantity ?? 1);

    return {
      product_id: component.product._id,
      variant_id: variant.sku,
      product_name: component.product.name,
      variant_name: variant.label || 'Default',
      image: {
        url: variant.images?.[0]?.url || component.product.images?.[0]?.url || '',
        public_id:
          variant.images?.[0]?.public_id ||
          component.product.images?.[0]?.public_id ||
          'default'
      },
      unit_price: unitPrice,
      quantity,
      subtotal: unitPrice * quantity
    };
  });
}
