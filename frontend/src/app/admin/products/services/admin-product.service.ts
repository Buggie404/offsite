import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AdminBatchProduct {
  product_id: number;
  name: string;
  category: string;
  batch_expiry_date: string | null;
  batch_expiry_set_at: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminProductService {
  private http = inject(HttpClient);

  list(): Observable<{ data: AdminBatchProduct[] }> {
    return this.http.get<{ data: AdminBatchProduct[] }>('/api/admin/products');
  }

  updateBatchExpiry(productId: number, batchExpiryDate: string | null): Observable<{ data: AdminBatchProduct }> {
    return this.http.patch<{ data: AdminBatchProduct }>(
      `/api/admin/products/${productId}/batch-expiry`,
      { batch_expiry_date: batchExpiryDate }
    );
  }
}
