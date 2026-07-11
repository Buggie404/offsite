import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Post } from '../models/post.model';
import { Comment } from '../models/comment.model';

export interface FeedResponse {
  data: Post[];
  total: number;
  page: number;
  limit: number;
}

export interface CommentsResponse {
  data: Comment[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class CommunityService {

  private http = inject(HttpClient);

  private readonly apiUrl = '/api/posts'; 
  private readonly commentsApiUrl = '/api/comments';

  // ── STATE ĐỂ LƯU CACHE VÀ PHỤC HỒI SCROLL POSITION ──
  feedState = {
    posts: [] as Post[],
    page: 1,
    hasMore: true,
    activeCategory: '' as 'MATCHA' | 'COFFEE' | 'RECIPE' | 'MY_POST' | '',
    sort: 'created_at' as 'created_at' | 'like_count',
    scrollY: 0
  };
  shouldRestoreState = false;
  // ────────────────────────────────────────────────────────

  getFeed(
    page: number = 1,
    limit: number = 9,
    activeCategory: 'MATCHA' | 'COFFEE' | 'RECIPE' | 'MY_POST' | '' = '',
    sort: 'created_at' | 'like_count' = 'created_at',
    userId?: string
  ): Observable<FeedResponse> {
    let url = `${this.apiUrl}?page=${page}&limit=${limit}`;
    if (activeCategory === 'COFFEE' || activeCategory === 'MATCHA') {
      url += `&base=${activeCategory}`;
    } else if (activeCategory === 'RECIPE') {
      url += `&post_type=recipe`;
    } else if (activeCategory === 'MY_POST' && userId) {
      url += `&user_id=${userId}`;
    }
    if (sort === 'like_count') url += '&sort=like_count';
    return this.http.get<FeedResponse>(url);
  }

  getPostById(id: string): Observable<Post> {
    return this.http.get<Post>(`${this.apiUrl}/${id}`);
  }

  createPost(data: FormData): Observable<any> {
    return this.http.post(this.apiUrl, data);
  }
  
  deletePost(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${id}`);
  }

  likePost(id: string): Observable<{ liked: boolean; like_count: number; }> {
    return this.http.post<{ liked: boolean; like_count: number; }>(
      `${this.apiUrl}/${id}/like`, {}
    );
  }

  savePost(id: string): Observable<{ saved: boolean; save_count: number; }> {
    return this.http.post<{ saved: boolean; save_count: number; }>(
      `${this.apiUrl}/${id}/save`, {}
    );
  }

  sharePost(id: string): Observable<{ message: string; share_count: number; }> {
    return this.http.post<{ message: string; share_count: number; }>(
      `${this.apiUrl}/${id}/share`, {}
    );
  }

  // ── Comments ──

  getComments(postId: string, page: number = 1, limit: number = 50): Observable<CommentsResponse> {
    return this.http.get<CommentsResponse>(
      `${this.commentsApiUrl}/post/${postId}?page=${page}&limit=${limit}`
    );
  }

  createComment(
    postId: string,
    content: string,
    parent_id: string | null = null,
    reply_to_username: string | null = null
  ): Observable<{ message: string; data: Comment }> {
    return this.http.post<{ message: string; data: Comment }>(
      `${this.commentsApiUrl}/post/${postId}`,
      { content, parent_id, reply_to_username }
    );
  }

  deleteComment(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.commentsApiUrl}/${id}`);
  }

  likeComment(id: string, action: 'like' | 'unlike'): Observable<{ message: string; like_count: number }> {
    return this.http.post<{ message: string; like_count: number }>(
      `${this.commentsApiUrl}/${id}/like`,
      { action }
    );
  }
}
