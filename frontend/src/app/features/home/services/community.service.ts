// ─────────────────────────────────────────────────────────────
//  home/services/community.service.ts
//  Fetches community post data from the Express/MongoDB backend
// ─────────────────────────────────────────────────────────────

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Post, PostsResponse } from '../models/post.model';
import { environment } from '../../../../environments/environment';

const BASE_URL = environment.apiUrl;

@Injectable({
  providedIn: 'root'
})
export class CommunityService {
  private readonly endpoint = `${BASE_URL}/posts`;

  constructor(private http: HttpClient) { }

  /**
   * Lấy top N bài nhiều like nhất – dùng cho homepage preview section.
   * @param limit  Số bài muốn lấy (mặc định 3)
   */
  getTopLiked(limit = 3): Observable<PostsResponse> {
    const params = new HttpParams()
      .set('limit', limit.toString())
      .set('page', '1')
      .set('sort', 'like_count');

    return this.http.get<PostsResponse>(this.endpoint, { params });
  }
}
