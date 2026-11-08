import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import { CreatePostModalComponent } from './create-post-modal.component';
import { CommunityService } from '../../services/community.service';
import { CloudinaryService } from '../../services/cloudinary.service';
import { Post, ProductTag } from '../../models/post.model';

afterEach(() => TestBed.resetTestingModule());
function setup() {
  const api = { suggestProducts: vi.fn((body: unknown) => of({ data: [1, 2, 3].map(id => tag(id)), remaining: 2, suggestion_session_id: 'S1' })) };
  TestBed.configureTestingModule({ providers: [
    { provide: CommunityService, useValue: api }, { provide: CloudinaryService, useValue: {} }, { provide: Router, useValue: {} }
  ] });
  return { component: TestBed.runInInjectionContext(() => new CreatePostModalComponent()), api };
}
const tag = (id: number): ProductTag => ({ product_id: id, name: `Product ${id}`, image_url: null });

it('keeps up to three AI tags alongside manual tags within the five product cap', () => {
  const { component, api } = setup();
  component.content = 'Making coffee';
  component.selectedProducts = [tag(10), tag(11)];
  component.requestSuggestions();
  expect(component.aiProducts).toHaveLength(3);
  expect(component.totalTagged).toBe(5);
  component.toggleProduct(tag(12));
  expect(component.selectedProducts).toHaveLength(3);
  expect(component.aiProducts).toHaveLength(2);
  expect(component.totalTagged).toBe(5);
  component.requestSuggestions(true);
  expect(api.suggestProducts.mock.calls.at(-1)?.[0]).toMatchObject({ suggestion_session_id: 'S1' });
});

it('restores the saved AI provenance when editing instead of converting every tag to manual', () => {
  const { component } = setup();
  component.post = { base: 'COFFEE', content: 'coffee', products: [tag(1), tag(2)], ai_product_ids: [2], media: [] } as unknown as Post;
  component.ngOnInit();
  expect(component.selectedProducts.map(p => p.product_id)).toEqual([1]);
  expect(component.aiProducts.map(p => p.product_id)).toEqual([2]);
});
