import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { Post, ProductTag } from '../models/post.model';
import { Comment } from '../models/comment.model';
import { Notification } from '../models/notification.model';

export interface FeedResponse {
  data: Post[];
  total: number;
  page: number;
  limit: number;
}

export interface PublicProfile {
  user_id: string;
  username: string;
  avatar_url: string | null;
  membership_tier: 'Seed' | 'Leaf' | 'Bloom' | 'Zen';
  ritual_dna_completed: boolean;
  joined_at: string;
  post_count: number;
  follower_count: number;
  following_count: number;
  is_following: boolean;
  is_self: boolean;
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
  private readonly notificationsApiUrl = '/api/notifications';

  // ── STATE ĐỂ LƯU CACHE VÀ PHỤC HỒI SCROLL POSITION ──
  feedState = {
    posts: [] as Post[],
    page: 1,
    hasMore: true,
    activeCategory: '' as 'MATCHA' | 'COFFEE' | 'RECIPE' | 'MY_POST' | 'FOLLOWING' | '',
    sort: 'created_at' as 'created_at' | 'like_count',
    scrollY: 0
  };
  shouldRestoreState = false;
  // ────────────────────────────────────────────────────────

  getFeed(
    page: number = 1,
    limit: number = 9,
    activeCategory: 'MATCHA' | 'COFFEE' | 'RECIPE' | 'MY_POST' | 'FOLLOWING' | '' = '',
    sort: 'created_at' | 'like_count' = 'created_at',
    userId?: string
  ): Observable<FeedResponse> {
    let url = `${this.apiUrl}?page=${page}&limit=${limit}`;
    if (activeCategory === 'COFFEE' || activeCategory === 'MATCHA') {
      url += `&base=${activeCategory}`;
    } else if (activeCategory === 'RECIPE') {
      url += `&post_type=recipe`;
    } else if (activeCategory === 'FOLLOWING') {
      url += `&following=true`;
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
  
  searchProducts(q: string): Observable<ProductTag[]> {
    return this.http
      .get<{ data: ProductTag[] }>(`${this.apiUrl}/product-search`, { params: { q } })
      .pipe(map(r => r.data));
  }

  suggestProducts(body: { content: string; base: string | null; exclude: number[] }): Observable<ProductTag[]> {
    return this.http
      .post<{ data: ProductTag[] }>(`${this.apiUrl}/product-suggestions`, body)
      .pipe(map(r => r.data));
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

  reportPost(id: string, reason: string, note: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/${id}/report`, { reason, note }
    );
  }

  getPublicProfile(userId: string): Observable<PublicProfile> {
    return this.http.get<PublicProfile>(`/api/profiles/${userId}`);
  }

  // ── Follow ──

  toggleFollow(userId: string): Observable<{ following: boolean }> {
    return this.http.post<{ following: boolean }>(`/api/follows/${userId}`, {});
  }

  getFollowingIds(): Observable<{ data: string[] }> {
    return this.http.get<{ data: string[] }>('/api/follows/ids');
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

  reportComment(id: string, reason: string, note: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.commentsApiUrl}/${id}/report`, { reason, note }
    );
  }

  likeComment(id: string, action: 'like' | 'unlike'): Observable<{ message: string; like_count: number }> {
    return this.http.post<{ message: string; like_count: number }>(
      `${this.commentsApiUrl}/${id}/like`,
      { action }
    );
  }

  // ── Notifications ──

  getNotifications(): Observable<{ data: Notification[] }> {
    return this.http.get<{ data: Notification[] }>(this.notificationsApiUrl);
  }

  markNotificationAsRead(id: string): Observable<{ message: string; data: Notification }> {
    return this.http.put<{ message: string; data: Notification }>(`${this.notificationsApiUrl}/${id}/read`, {});
  }

  markAllNotificationsAsRead(): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.notificationsApiUrl}/read-all`, {});
  }

  deleteNotification(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.notificationsApiUrl}/${id}`);
  }

  deleteAllNotifications(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.notificationsApiUrl}/delete-all`);
  }
}

