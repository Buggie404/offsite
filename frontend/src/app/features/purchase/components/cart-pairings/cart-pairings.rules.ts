import { Product, ProductVariant } from '../../../../shared/models/product.model';
import { CartItem } from '../../services/cart.service';

export interface CartPairing {
  product: Product;
  variant: ProductVariant;
}

type Anchor = 'matcha' | 'leaf_tea' | 'coffee' | 'tea_tool' | 'coffee_tool' | 'drinkware';
type Matcher = (product: Product) => boolean;

// Most natural add-on first: what the customer needs to actually use the anchor.
const toolType = (...types: string[]): Matcher =>
  product => product.category === 'tools' && types.includes(normalize(product.tools?.tool_type));
const wareType = (...types: string[]): Matcher =>
  product => product.category === 'drinkware' && types.includes(normalize(product.drinkware?.ware_type));

const PAIRING_LADDERS: Record<Anchor, Matcher[]> = {
  matcha: [toolType('chasen'), toolType('chashaku'), toolType('chawan'), toolType('whisk stand')],
  leaf_tea: [wareType('teapots'), wareType('mugs')],
  coffee: [toolType('filter'), toolType('dripper'), toolType('brewer'), toolType('kettle'), wareType('mugs')],
  tea_tool: [isMatchaPowder, toolType('chashaku', 'whisk stand'), isMatchaPowder],
  coffee_tool: [isCoffee, isCoffee],
  drinkware: [isCoffee, isMatchaPowder]
};

/** An add-on should not dwarf the cart, so a $25 bag never suggests a $200 grinder. */
const MIN_PRICE_CAP = 50;

function normalize(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function isMatchaPowder(product: Product): boolean {
  return product.category === 'matcha' && (Boolean(product.matcha?.product_grade) || /matcha/i.test(product.name));
}

function isCoffee(product: Product): boolean {
  return product.category === 'coffee';
}

function inStockVariant(product: Product): ProductVariant | undefined {
  const inStock = (product.variants || []).filter(variant => (variant.stock ?? 0) > 0);
  return inStock.find(variant => variant.is_default) ?? inStock[0];
}

function anchorOf(product: Product): Anchor | null {
  switch (product.category) {
    case 'matcha': return isMatchaPowder(product) ? 'matcha' : 'leaf_tea';
    case 'coffee': return 'coffee';
    case 'tools': return normalize(product.tools?.tool_category).startsWith('coffee') ? 'coffee_tool' : 'tea_tool';
    case 'drinkware': return 'drinkware';
    case 'sets_bundles': {
      const setType = normalize(product.sets_bundles?.set_type);
      if (setType.includes('matcha')) return 'matcha';
      if (setType.includes('coffee')) return 'coffee';
      return setType.includes('drinkware') ? 'drinkware' : null;
    }
    default: return null;
  }
}

/** Tools and cups only ask for a drink when the cart does not already have one. */
function relevantAnchors(items: CartItem[]): Anchor[] {
  const anchors = [...new Set(items.map(item => anchorOf(item.product)))]
    .filter((anchor): anchor is Anchor => Boolean(anchor));
  const hasDrink = anchors.some(anchor => anchor === 'matcha' || anchor === 'coffee' || anchor === 'leaf_tea');
  return anchors.filter(anchor => {
    if (anchor === 'tea_tool') return !anchors.includes('matcha') && !anchors.includes('leaf_tea');
    if (anchor === 'coffee_tool') return !anchors.includes('coffee');
    return anchor !== 'drinkware' || !hasDrink;
  });
}

function byPopularity(a: CartPairing, b: CartPairing): number {
  return Number(Boolean(b.product.is_best_seller)) - Number(Boolean(a.product.is_best_seller))
    || (b.product.total_sold_quantity ?? 0) - (a.product.total_sold_quantity ?? 0)
    || a.variant.price - b.variant.price
    || a.product.product_id - b.product.product_id;
}

/**
 * Rule-based, with no personal data: same cart, same suggestions, so the box
 * does not reshuffle while the customer is editing their cart.
 */
export function buildCartPairings(items: CartItem[], catalog: Product[], limit = 3): CartPairing[] {
  const live = items.filter(item => (item.product.variants || []).some(
    variant => variant.sku === item.variantSku && (variant.stock ?? 0) > 0
  ));
  if (!live.length) return [];

  const inCart = new Set(items.map(item => item.product.product_id));
  const ownedTools = new Set(items.map(item => normalize(item.product.tools?.tool_type)).filter(Boolean));
  const subtotal = live.reduce((sum, item) => {
    const variant = item.product.variants.find(row => row.sku === item.variantSku);
    return sum + (variant?.price ?? 0) * item.quantity;
  }, 0);
  const priceCap = Math.max(MIN_PRICE_CAP, subtotal);

  const pool = catalog
    .filter(product => product.is_active !== false && product.category !== 'sets_bundles' && !inCart.has(product.product_id))
    .filter(product => !ownedTools.has(normalize(product.tools?.tool_type)))
    .map(product => ({ product, variant: inStockVariant(product) }))
    .filter((row): row is CartPairing => Boolean(row.variant) && row.variant!.price <= priceCap)
    .sort(byPopularity);

  const picked: CartPairing[] = [];
  const pick = (matches: Matcher) => {
    const next = pool.find(row => matches(row.product) && !picked.includes(row));
    if (next) picked.push(next);
    return Boolean(next);
  };

  // One pick per kind of item in the cart first, so a mixed cart gets a mixed box.
  const ladders = relevantAnchors(live).map(anchor => [...PAIRING_LADDERS[anchor]]);
  while (picked.length < limit && ladders.some(ladder => ladder.length)) {
    for (const ladder of ladders) {
      if (picked.length >= limit) break;
      while (ladder.length && !pick(ladder.shift()!)) { /* step exhausted, try the next rung */ }
    }
  }

  // Thin catalogue: top up with popular items rather than leaving a half-empty box.
  while (picked.length < limit && pick(() => true)) { /* keep filling */ }
  return picked;
}
