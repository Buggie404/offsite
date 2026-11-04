import { describe, expect, it } from 'vitest';
import { Product } from '../../../../shared/models/product.model';
import { CartItem } from '../../services/cart.service';
import { buildCartPairings } from './cart-pairings.rules';

let nextId = 1;
const product = (overrides: Partial<Product> & { price?: number; stock?: number }): Product => {
  const { price = 20, stock = 5, ...rest } = overrides;
  const product_id = nextId++;
  return {
    product_id, name: `Product ${product_id}`, category: 'tools', images: [], is_active: true,
    variants: [{ sku: `S${product_id}`, label: 'Default', price, stock, is_default: true, images: [] }],
    ...rest
  } as Product;
};
const line = (p: Product): CartItem => ({ product: p, variantSku: p.variants[0].sku, quantity: 1, selected: true });
const tool = (tool_type: string, tool_category = 'tea tools', price = 20) =>
  product({ category: 'tools', tools: { tool_type, tool_category }, price, name: tool_type });
const matcha = () => product({ category: 'matcha', matcha: { product_grade: 'ceremonial grade' }, name: 'Uji Matcha' });
const coffee = () => product({ category: 'coffee', name: 'Sipi', price: 25 });

describe('buildCartPairings', () => {
  it('pairs matcha with the whisk, then the scoop', () => {
    const picks = buildCartPairings([line(matcha())], [tool('whisk stand'), tool('chawan'), tool('chashaku'), tool('chasen')]);
    expect(picks.map(row => row.product.name)).toEqual(['chasen', 'chashaku', 'chawan']);
  });

  it('gives a mixed cart one pick for each kind of item', () => {
    const picks = buildCartPairings([line(coffee()), line(matcha())],
      [tool('chashaku'), tool('chasen'), tool('filter', 'coffee tools'), tool('dripper', 'coffee tools')], 2);
    expect(picks.map(row => row.product.name)).toEqual(['filter', 'chasen']);
  });

  it('never repeats a cart item or a tool type the customer already has', () => {
    const owned = tool('chasen');
    const picks = buildCartPairings([line(matcha()), line(owned)], [owned, tool('chasen'), tool('chashaku')], 1);
    expect(picks.map(row => row.product.name)).toEqual(['chashaku']);
  });

  it('skips out-of-stock, inactive, bundled and overpriced products', () => {
    const picks = buildCartPairings([line(coffee())], [
      product({ category: 'tools', tools: { tool_type: 'filter' }, stock: 0 }),
      product({ category: 'tools', tools: { tool_type: 'filter' }, is_active: false }),
      product({ category: 'sets_bundles' }),
      tool('brewer', 'coffee tools', 200)
    ]);
    expect(picks).toEqual([]);
  });

  it('does not push another drink when the cart already has one', () => {
    const filter = tool('filter', 'coffee tools');
    const picks = buildCartPairings([line(filter), line(coffee()), line(matcha())],
      [filter, coffee(), tool('dripper', 'coffee tools'), tool('chasen')], 2);
    expect(picks.map(row => row.product.name)).toEqual(['dripper', 'chasen']);
  });

  it('is stable for the same cart', () => {
    const cart = [line(coffee())];
    const catalog = [tool('filter', 'coffee tools'), tool('dripper', 'coffee tools'), tool('brewer', 'coffee tools')];
    expect(buildCartPairings(cart, catalog)).toEqual(buildCartPairings(cart, catalog));
  });

  it('returns nothing when the cart has no purchasable line', () => {
    expect(buildCartPairings([], [tool('chasen')])).toEqual([]);
  });
});
