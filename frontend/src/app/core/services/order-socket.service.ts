// frontend/src/app/core/services/order-socket.service.ts
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

export interface OrderSocketEvent {
  order_id: string;
  order_status?: string;
  payment_status?: string;
  order?: any;
  eventType: string;
  updated_at?: string;
  created_at?: string;
}

@Injectable({
  providedIn: 'root'
})
export class OrderSocketService {
  private platformId = inject(PLATFORM_ID);
  private socket: Socket | null = null;
  private readonly orderUpdatedSubject = new Subject<OrderSocketEvent>();

  readonly orderUpdated$: Observable<OrderSocketEvent> = this.orderUpdatedSubject.asObservable();

  constructor() {
    this.initSocket();
  }

  private initSocket(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      let backendUrl = 'http://localhost:5000';
      if (typeof window !== 'undefined') {
        const port = window.location.port;
        if (port === '4200') {
          backendUrl = `${window.location.protocol}//${window.location.hostname}:5000`;
        } else {
          backendUrl = window.location.origin;
        }
      }

      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

      this.socket = io(backendUrl, {
        transports: ['websocket', 'polling'],
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
      });

      this.socket.on('connect', () => {
        console.log('[OrderSocketService] Socket connected:', this.socket?.id);
      });

      this.socket.on('order_updated', (data: OrderSocketEvent) => {
        console.log('[OrderSocketService] Received order_updated:', data);
        this.orderUpdatedSubject.next(data);
      });

      this.socket.on('new_order', (data: OrderSocketEvent) => {
        console.log('[OrderSocketService] Received new_order:', data);
        this.orderUpdatedSubject.next(data);
      });

      this.socket.on('error', (err: any) => {
        console.warn('[OrderSocketService] Server returned error:', err);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[OrderSocketService] Socket disconnected:', reason);
      });
    } catch (err) {
      console.error('[OrderSocketService] Failed to initialize socket:', err);
    }
  }

  refreshTokenAuth(): void {
    if (!isPlatformBrowser(this.platformId) || !this.socket) return;
    const token = localStorage.getItem('token');
    this.socket.auth = { token };
    if (this.socket.connected) {
      this.socket.disconnect().connect();
    } else {
      this.socket.connect();
    }
  }

  joinAdminRoom(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('join_admin');
    } else if (this.socket) {
      this.socket.once('connect', () => {
        this.socket?.emit('join_admin');
      });
    }
  }

  joinUserRoom(userId: string): void {
    if (!userId) return;
    if (this.socket && this.socket.connected) {
      this.socket.emit('join_user', { user_id: userId });
    } else if (this.socket) {
      this.socket.once('connect', () => {
        this.socket?.emit('join_user', { user_id: userId });
      });
    }
  }

  joinOrderRoom(orderId: string, sessionId?: string | null): void {
    if (!orderId) return;
    const payload = { order_id: orderId, session_id: sessionId || null };
    if (this.socket && this.socket.connected) {
      this.socket.emit('join_order', payload);
    } else if (this.socket) {
      this.socket.once('connect', () => {
        this.socket?.emit('join_order', payload);
      });
    }
  }
}
