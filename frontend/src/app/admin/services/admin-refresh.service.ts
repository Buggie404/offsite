import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AdminRefreshService {
  private readonly ordersListRefresh$ = new Subject<void>();
  private readonly orderDetailRefresh$ = new Subject<void>();

  readonly onOrdersListRefresh$ = this.ordersListRefresh$.asObservable();
  readonly onOrderDetailRefresh$ = this.orderDetailRefresh$.asObservable();

  refreshOrdersList(): void {
    this.ordersListRefresh$.next();
  }

  refreshOrderDetail(): void {
    this.orderDetailRefresh$.next();
  }
}
