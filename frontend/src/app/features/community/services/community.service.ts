import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Post } from '../models/post.model';

export interface FeedResponse {
  data: Post[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class CommunityService {

  private http = inject(HttpClient);

  private readonly apiUrl = '/api/posts'; // đổi từ 'http://localhost:3000/api/posts'

  getFeed(
    page: number = 1,
    limit: number = 9,
    base: 'MATCHA' | 'COFFEE' | '' = '',
    sort: 'created_at' | 'like_count' = 'created_at'
  ): Observable<FeedResponse> {

    let url = `${this.apiUrl}?page=${page}&limit=${limit}`;

    if (base) {
      url += `&base=${base}`;
    }

    if (sort === 'like_count') {
      url += '&sort=like_count';
    }

    return this.http.get<FeedResponse>(url);

  }

  getPostById(id: string): Observable<Post> {
    return this.http.get<Post>(`${this.apiUrl}/${id}`);
  }

  createPost(data: FormData): Observable<any> {
    return this.http.post(this.apiUrl, data);
  }

  likePost(id: string): Observable<{
    liked: boolean;
    like_count: number;
  }> {

    return this.http.post<{
      liked: boolean;
      like_count: number;
    }>(
      `${this.apiUrl}/${id}/like`,
      {}
    );

  }

}