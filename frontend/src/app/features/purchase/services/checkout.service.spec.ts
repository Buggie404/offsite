import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { Product } from '../../../shared/models/product.model';
import { CheckoutItem, CheckoutService } from './checkout.service';

let nextId = 1;
const product = (overrides: Partial<Product> & { stock?: number }): Product => {
  const { stock = 5, ...rest } = overrides;
  const id = nextId++;
  return {
    _id: `p${id}`, product_id: id, name: `Product ${id}`, category: 'tools', is_active: true, images: [],
    variants: [{ sku: `S${id}`, price: 20, stock, is_default: true }],
    ...rest
  } as Product;
};
const line = (p: Product): CheckoutItem => ({ product: p, variantSku: p.variants[0].sku, quantity: 1 });
// Category strings as the catalogue API returns them.
const tool = (tool_type: string, tool_category: string, stock = 5) =>
  product({ category: 'tools', name: tool_type, tools: { tool_category, tool_type }, stock });
const toolNames = (picks: Product[]) => picks.filter(p => p.category === 'tools').map(p => p.name);

describe('CheckoutService.buildComplements', () => {
  let service: CheckoutService;
  const matcha = () => product({ category: 'matcha', name: 'Uji', matcha: { product_grade: 'ceremonial grade' } });
  const leafTea = () => product({ category: 'matcha', name: 'Silver Needles' });
  const coffee = () => product({ category: 'coffee', name: 'Sipi' });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(CheckoutService);
  });

  it('gives a matcha cart a matcha tool, not a coffee tool', () => {
    const picks = service.buildComplements([line(matcha())], [tool('filter', 'coffee tools'), tool('chasen', 'tea tools')]);
    expect(picks[0].name).toBe('chasen');
  });

  it('never treats a dripper or kettle filed under tea tools as a matcha tool', () => {
    const picks = service.buildComplements([line(matcha())],
      [tool('dripper', 'tea tools'), tool('kettle', 'tea tools'), tool('chashaku', 'tea tools')]);
    expect(picks[0].name).toBe('chashaku');
  });

  it('gives a coffee cart a coffee tool first', () => {
    const picks = service.buildComplements([line(coffee())], [tool('chasen', 'tea tools'), tool('filter', 'coffee tools')]);
    expect(picks[0].name).toBe('filter');
  });

  it('does not lead a leaf tea cart with a matcha whisk', () => {
    const cup = product({ category: 'drinkware', name: 'cup', drinkware: { material: 'ceramic' } });
    const picks = service.buildComplements([line(leafTea())], [tool('chasen', 'tea tools'), cup]);
    expect(picks[0].name).toBe('cup');
  });

  it('skips products whose default variant is out of stock', () => {
    const picks = service.buildComplements([line(matcha())], [tool('chawan', 'tea tools', 0), tool('chasen', 'tea tools')]);
    expect(toolNames(picks)).toEqual(['chasen']);
  });

  it('still tops up to three suggestions from the wider pool', () => {
    const cart = matcha();
    const picks = service.buildComplements([line(cart)],
      [cart, tool('chasen', 'tea tools'), coffee(), tool('filter', 'coffee tools'), tool('brewer', 'coffee tools')]);
    expect(picks).toHaveLength(3);
    expect(picks.map(p => p._id)).not.toContain(cart._id);
    expect(picks[0].name).toBe('chasen');
  });
});
