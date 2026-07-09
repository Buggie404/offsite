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

  private readonly apiUrl = '/api/posts'; // đổi từ 'http://localhost:3000/api/posts'
  private readonly commentsApiUrl = '/api/comments';

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

  savePost(id: string): Observable<{
    saved: boolean;
    save_count: number;
  }> {

    return this.http.post<{
      saved: boolean;
      save_count: number;
    }>(
      `${this.apiUrl}/${id}/save`,
      {}
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