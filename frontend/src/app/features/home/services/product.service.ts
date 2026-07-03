// home/services/product.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Product } from '../models/product.model';

export interface ProductCategoryCounts {
  matcha: number;
  coffee: number;
  tools: number;
  drinkware: number;
  sets_bundles: number;
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {

  private api = 'http://localhost:5000/api/products';

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
}
