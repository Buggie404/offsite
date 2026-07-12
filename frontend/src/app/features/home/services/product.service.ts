// home/services/product.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';
import { Product } from '../models/product.model';

export interface ProductCategoryCounts {
  matcha: number;
  coffee: number;
  tools: number;
  drinkware: number;
  sets_bundles: number;
}

export interface ProductReview {
  review_id: string;
  rating: number;
  content?: string;
  created_at: string;
  is_anonymous?: boolean;
  user_snapshot?: {
    name?: string;
    avatar_url?: string | null;
  };
}

export interface ProductReviewsResponse {
  data: ProductReview[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {

  private api = `${environment.apiUrl}/products`;

  constructor(private http: HttpClient) {}

  getProducts(): Observable<Product[]> {
    return this.http.get<Product[]>(this.api);
  }

  getProductById(id: string): Observable<Product> {
    return this.http.get<Product>(`${this.api}/${id}`);
  }
  getCategoryCounts(): Observable<ProductCategoryCounts> {
    return this.http.get<ProductCategoryCounts>(`${this.api}/category-counts`);
  }

  getBestSellers(limit = 4): Observable<Product[]> {
    const params = new HttpParams()
      .set('sort', 'total_sold_quantity')
      .set('limit', limit.toString());

    return this.http.get<Product[]>(this.api, { params });
  }

  getProductReviews(productId: string, page = 1, limit = 10, sort: 'newest' | 'oldest' = 'oldest'): Observable<ProductReviewsResponse> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString())
      .set('sort', sort);

    return this.http.get<ProductReviewsResponse>(`${environment.apiUrl}/reviews/product/${productId}`, { params });
  }
}
