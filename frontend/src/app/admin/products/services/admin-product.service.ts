import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, filter, finalize, shareReplay, tap } from 'rxjs';
import { AdminAuthService } from '../../auth/services/admin-auth.service';

export type ProductCategory = 'matcha' | 'coffee' | 'drinkware' | 'sets_bundles' | 'tools';
export type ProductVariantType = 'none' | 'size' | 'color' | 'type' | 'package';

export interface AdminProductImage {
  url: string;
  public_id: string;
  sort_order: number;
  alt_text: string;
}

export interface AdminProductVariant {
  sku: string;
  label: string;
  price: number;
  stock: number;
  sold_quantity?: number;
  low_stock_threshold?: number;
  is_default: boolean;
  images: AdminProductImage[];
}

export interface AdminProduct {
  is_new_product?: boolean;
  has_draft?: boolean;
  draft_saved_at?: string | null;
  _id?: string;
  product_id: number;
  name: string;
  slug: string;
  description: string;
  seo_title: string;
  category: ProductCategory;
  product_tag: string[];
  is_subscription: boolean;
  is_best_seller: boolean;
  is_new_arrival: boolean;
  is_subscribable: boolean;
  subscribe_discount_percent: number | null;
  total_sold_quantity: number;
  batch_expiry_date: string | null;
  batch_expiry_set_at: string | null;
  variant_type: ProductVariantType;
  images: AdminProductImage[];
  variants: AdminProductVariant[];
  rating_avg: number | null;
  review_count: number;
  createdAt: string;
  updatedAt: string;
  is_active: boolean;
  quiz_eligible: boolean;
  matcha?: { product_grade?: string; origin?: string; pricing_tier?: string };
  coffee?: { roast_level?: string; process_type?: string; product_origin?: string; tasting_notes?: string[] };
  drinkware?: { ware_type?: string; material?: string; product_size?: string };
  sets_bundles?: { set_type?: string; is_exclusive?: boolean; composition?: unknown[] };
  tools?: { tool_category?: string; tool_type?: string };
}

export type AdminProductPayload = Omit<AdminProduct,
  '_id' | 'product_id' | 'total_sold_quantity' | 'rating_avg' | 'review_count' | 'createdAt' | 'updatedAt' | 'batch_expiry_set_at' | 'has_draft' | 'draft_saved_at' | 'is_new_product'>;

export interface ProductBatch {
  _id: string;
  batch_code: string;
  product_id: number;
  variant_sku: string;
  quantity: number;
  received_at: string;
  best_before: string | null;
  added_by_name: string;
}

export interface ProductHistoryEntry {
  action_type: string;
  actor_name: string;
  created_at: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

export type AdminProductRow = Pick<AdminProduct,
  'product_id' | 'name' | 'slug' | 'category' | 'product_tag' | 'is_active' | 'is_best_seller' | 'is_new_arrival' | 'has_draft' | 'draft_saved_at' | 'is_new_product'> & {
    images: Pick<AdminProductImage, 'url' | 'sort_order' | 'alt_text'>[];
    variants: Pick<AdminProductVariant, 'sku' | 'price' | 'stock' | 'is_default' | 'low_stock_threshold'>[];
  };

@Injectable({ providedIn: 'root' })
export class AdminProductService {
  private http = inject(HttpClient);
  private auth = inject(AdminAuthService);
  private readonly cacheTtlMs = 60_000;
  private cachedList: { owner: string; data: AdminProductRow[]; at: number } | null = null;
  private pendingList: Observable<{ data: AdminProductRow[]; total: number }> | null = null;
  private pendingOwner = '';
  private listVersion = 0;

  private invalidateList(clearRows = true): void {
    this.listVersion++;
    this.pendingList = null;
    this.pendingOwner = '';
    if (clearRows) this.cachedList = null;
  }

  private get owner(): string { return this.auth.getUser()?.user_id || ''; }

  cachedRows(): AdminProductRow[] | null {
    return this.cachedList?.owner === this.owner ? this.cachedList.data : null;
  }

  list(forceRefresh = false): Observable<{ data: AdminProductRow[]; total: number }> {
    const cached = this.cachedRows();
    if (!forceRefresh && cached && Date.now() - this.cachedList!.at < this.cacheTtlMs) {
      return new Observable((subscriber) => {
        subscriber.next({ data: cached, total: cached.length });
        subscriber.complete();
      });
    }
    if (this.pendingList && this.pendingOwner === this.owner) return this.pendingList;
    const owner = this.owner;
    const version = this.listVersion;
    const request = this.http.get<{ data: AdminProductRow[]; total: number }>('/api/admin/products').pipe(
      // A response started before a successful edit must not roll the UI back either.
      filter(() => owner === this.owner && version === this.listVersion),
      tap((response) => {
        if (owner === this.owner && version === this.listVersion) this.cachedList = { owner, data: response.data, at: Date.now() };
      }),
      finalize(() => {
        if (this.pendingList === request) {
          this.pendingList = null;
          this.pendingOwner = '';
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.pendingOwner = owner;
    this.pendingList = request;
    return request;
  }

  get(productId: number): Observable<{ data: AdminProduct }> {
    return this.http.get<{ data: AdminProduct }>(`/api/admin/products/${productId}`);
  }

  drafts(): Observable<{ data: AdminProductRow[]; total: number }> {
    return this.http.get<{ data: AdminProductRow[]; total: number }>('/api/admin/products/drafts');
  }

  discardDraft(productId: number): Observable<{ data: { product_id: number } }> {
    return this.http.delete<{ data: { product_id: number } }>(`/api/admin/products/${productId}/draft`).pipe(tap(() => this.invalidateList()));
  }

  publishDraft(productId: number): Observable<{ data: AdminProduct }> {
    return this.http.post<{ data: AdminProduct }>(`/api/admin/products/${productId}/publish-draft`, {}).pipe(tap(() => this.invalidateList()));
  }

  batches(productId: number): Observable<{ data: ProductBatch[] }> {
    return this.http.get<{ data: ProductBatch[] }>(`/api/admin/products/${productId}/batches`);
  }

  addBatch(productId: number, batch: Pick<ProductBatch, 'batch_code' | 'variant_sku' | 'quantity' | 'received_at' | 'best_before'>): Observable<{ data: ProductBatch }> {
    return this.http.post<{ data: ProductBatch }>(`/api/admin/products/${productId}/batches`, batch);
  }

  updateBatchBestBefore(productId: number, batchId: string, bestBefore: string | null): Observable<{ data: ProductBatch }> {
    return this.http.patch<{ data: ProductBatch }>(`/api/admin/products/${productId}/batches/${batchId}/best-before`, { best_before: bestBefore });
  }

  history(productId: number): Observable<{ data: ProductHistoryEntry[] }> {
    return this.http.get<{ data: ProductHistoryEntry[] }>(`/api/admin/products/${productId}/history`);
  }

  create(payload: AdminProductPayload): Observable<{ data: AdminProduct }> {
    return this.http.post<{ data: AdminProduct }>('/api/admin/products', payload).pipe(
      tap(() => this.invalidateList())
    );
  }

  saveDraft(productId: number | null, payload: AdminProductPayload): Observable<{ data: AdminProduct }> {
    const request = productId === null
      ? this.http.post<{ data: AdminProduct }>('/api/admin/products/draft', payload)
      : this.http.put<{ data: AdminProduct }>(`/api/admin/products/${productId}/draft`, payload);
    return request.pipe(tap(() => this.invalidateList()));
  }

  update(productId: number, payload: AdminProductPayload): Observable<{ data: AdminProduct }> {
    return this.http.put<{ data: AdminProduct }>(`/api/admin/products/${productId}`, payload).pipe(
      tap(() => this.invalidateList())
    );
  }

  updateStatus(productId: number, isActive: boolean): Observable<{ data: AdminProduct }> {
    return this.http.patch<{ data: AdminProduct }>(`/api/admin/products/${productId}/status`, { is_active: isActive }).pipe(
      tap(({ data }) => this.updateCachedRow(data))
    );
  }

  updateStatuses(changes: { product_id: number; is_active: boolean }[]): Observable<{ data: { product_id: number; is_active: boolean }[] }> {
    return this.http.patch<{ data: { product_id: number; is_active: boolean }[] }>(
      '/api/admin/products/statuses', { changes }
    ).pipe(tap(({ data }) => {
      this.invalidateList(false);
      if (this.cachedList?.owner !== this.owner) return;
      const statuses = new Map(data.map((item) => [item.product_id, item.is_active]));
      this.cachedList = { ...this.cachedList, data: this.cachedList.data.map((row) =>
        statuses.has(row.product_id) ? { ...row, is_active: statuses.get(row.product_id)! } : row) };
    }));
  }

  updateBatchExpiry(productId: number, batchExpiryDate: string | null): Observable<{ data: AdminProduct }> {
    return this.http.patch<{ data: AdminProduct }>(`/api/admin/products/${productId}/batch-expiry`, {
      batch_expiry_date: batchExpiryDate
    });
  }

  private updateCachedRow(product: AdminProduct): void {
    this.invalidateList(false);
    if (this.cachedList?.owner !== this.owner) return;
    this.cachedList = {
      ...this.cachedList,
      data: this.cachedList.data.map((row) => row.product_id === product.product_id ? product : row)
    };
  }
}
