import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Post } from '../models/post.model';

@Injectable({
  providedIn: 'root'
})
export class CommunityService {

  private http = inject(HttpClient);

  private apiUrl = 'http://localhost:3000/api/posts';

  getPosts(): Observable<Post[]> {
    return this.http.get<Post[]>(this.apiUrl);
  }

  getPostById(id: string): Observable<Post> {
    return this.http.get<Post>(`${this.apiUrl}/${id}`);
  }

  createPost(data: FormData) {
    return this.http.post(this.apiUrl, data);
  }

  updatePost(id: string, data: any) {
    return this.http.put(`${this.apiUrl}/${id}`, data);
  }

  deletePost(id: string) {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }

  likePost(id: string) {
    return this.http.post(`${this.apiUrl}/${id}/like`, {});
  }
}