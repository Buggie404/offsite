import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminAuthService } from '../../auth/services/admin-auth.service';
import { AdminProductService, AdminProductPayload } from './admin-product.service';

describe('Admin product cache', () => {
  let api: AdminProductService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: AdminAuthService, useValue: { getUser: () => ({ user_id: 'A1' }) } }
    ] });
    api = TestBed.inject(AdminProductService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it('uses separate API routes for draft listing, discard and publishing', () => {
    api.drafts().subscribe();
    http.expectOne('/api/admin/products/drafts').flush({ data: [], total: 0 });
    api.discardDraft(10001).subscribe();
    const discard = http.expectOne('/api/admin/products/10001/draft');
    expect(discard.request.method).toBe('DELETE');
    discard.flush({ data: { product_id: 10001 } });
    api.publishDraft(10001).subscribe();
    const publish = http.expectOne('/api/admin/products/10001/publish-draft');
    expect(publish.request.method).toBe('POST');
    publish.flush({ data: {} });
  });

  it('returns fresh cached rows synchronously without another request', () => {
    api.list().subscribe();
    http.expectOne('/api/admin/products').flush({ data: [], total: 0 });
    let emitted = false;
    api.list().subscribe(() => emitted = true);
    expect(emitted).toBe(true);
    http.expectNone('/api/admin/products');
  });

  it('does not cache a stale list response that arrives after saving', () => {
    let staleEmitted = false;
    api.list().subscribe(() => staleEmitted = true);
    const stale = http.expectOne('/api/admin/products');
    api.update(10001, {} as AdminProductPayload).subscribe();
    http.expectOne('/api/admin/products/10001').flush({ data: {} });
    api.list().subscribe();
    const fresh = http.expectOne('/api/admin/products');
    stale.flush({ data: [{ product_id: 10001, name: 'Old' }], total: 1 });
    expect(staleEmitted).toBe(false);
    expect(api.cachedRows()).toBeNull();
    // Completing the old request must not clear the newer in-flight request.
    api.list().subscribe();
    http.expectNone('/api/admin/products');
    fresh.flush({ data: [{ product_id: 10001, name: 'Updated' }], total: 1 });
    expect(api.cachedRows()?.[0].name).toBe('Updated');
  });
});
