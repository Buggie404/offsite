import { Component, Input } from '@angular/core';
import { LucideRepeat, LucideShoppingBag, LucideLayers } from '@lucide/angular';
import { ORDER_TYPE_LABEL, OrderType, getOrderType } from '../../utils/order-type';

/** Small pill: One-time / Subscription / Mixed. Pass the order (or its type). */
@Component({
  selector: 'app-order-type-badge',
  standalone: true,
  imports: [LucideRepeat, LucideShoppingBag, LucideLayers],
  template: `
    <span class="order-type-badge" [class]="'order-type-badge order-type-badge--' + type">
      @switch (type) {
        @case ('subscription') { <svg lucideRepeat [size]="12" aria-hidden="true"></svg> }
        @case ('mixed') { <svg lucideLayers [size]="12" aria-hidden="true"></svg> }
        @default { <svg lucideShoppingBag [size]="12" aria-hidden="true"></svg> }
      }
      {{ label }}
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .order-type-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 9px;
      border-radius: 999px;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 500;
      line-height: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .order-type-badge--one_time { background: #ede4de; color: var(--color-warm-brown); }
    .order-type-badge--subscription { background: var(--color-sage); color: var(--color-forest-green); }
    .order-type-badge--mixed { background: #fbf3d5; color: #8a6a00; }
  `]
})
export class OrderTypeBadgeComponent {
  @Input() order: any = null;
  @Input() orderType: OrderType | null = null;

  get type(): OrderType {
    return this.orderType ?? getOrderType(this.order);
  }

  get label(): string {
    return ORDER_TYPE_LABEL[this.type];
  }
}
