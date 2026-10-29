import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  ContactMessageRequest,
  ContactMessageResponse,
} from '../models/contact-message.model';

// Used by the Contact Us page and by the chatbot drawer as its fallback when the assistant fails.
@Injectable({
  providedIn: 'root',
})
export class ContactMessageService {
  private http = inject(HttpClient);

  send(payload: ContactMessageRequest): Observable<ContactMessageResponse> {
    return this.http.post<ContactMessageResponse>('/api/contact-messages', payload);
  }
}
