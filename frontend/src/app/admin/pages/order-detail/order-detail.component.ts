import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="order-detail-placeholder">
      <p class="breadcrumb">
        <a routerLink="/admin/orders">Orders</a>
        <span>/</span>
        <span>{{ orderId }}</span>
      </p>
      <h1>Order detail</h1>
      <p>Detail view for <strong>{{ orderId }}</strong> will be migrated in the next step.</p>
      <a routerLink="/admin/orders" class="back-link">← Back to orders</a>
    </div>
  `,
  styles: `
    .order-detail-placeholder {
      font-family: var(--font-body);
      color: var(--color-near-black);
    }

    .breadcrumb {
      display: flex;
      gap: 8px;
      margin: 0 0 20px;
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .breadcrumb a {
      color: var(--color-forest-green);
      text-decoration: none;
    }

    h1 {
      font-family: var(--font-display);
      font-size: var(--text-h2-size);
      margin: 0 0 12px;
    }

    .back-link {
      display: inline-block;
      margin-top: 20px;
      color: var(--color-forest-green);
      text-decoration: none;
      font-weight: 500;
    }
  `
})
export class OrderDetailComponent {
  private route = inject(ActivatedRoute);
  orderId = this.route.snapshot.paramMap.get('id') || '';
}
