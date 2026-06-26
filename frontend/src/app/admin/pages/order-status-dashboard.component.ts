import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AdminAuthService } from '../services/admin-auth.service';

@Component({
  selector: 'app-order-status-dashboard',
  standalone: true,
  imports: [],
  template: `
    <div class="admin-dashboard">
      <header class="admin-dashboard__header">
        <h1>Admin Dashboard</h1>
        <button type="button" class="logout-btn" (click)="logout()">Sign out</button>
      </header>
      <p class="admin-dashboard__text">Welcome, {{ adminAuth.getUser()?.email || 'Admin' }}.</p>
      <p class="admin-dashboard__hint">Order management screens will be added in the next migration step.</p>
    </div>
  `,
  styles: `
    .admin-dashboard {
      min-height: 100vh;
      padding: var(--space-6) var(--space-5);
      background: var(--color-cream);
      color: var(--color-near-black);
      font-family: var(--font-body);
    }

    .admin-dashboard__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      margin-bottom: var(--space-4);
    }

    h1 {
      font-family: var(--font-display);
      font-size: var(--text-h2-size);
      margin: 0;
    }

    .logout-btn {
      border: 1px solid var(--divider-color);
      border-radius: var(--radius-pill);
      background: var(--color-white);
      color: var(--color-forest-green);
      font-family: var(--font-mono);
      font-size: var(--text-label-size);
      letter-spacing: var(--text-label-tracking);
      text-transform: uppercase;
      padding: var(--space-2) var(--space-4);
      cursor: pointer;
    }

    .admin-dashboard__text,
    .admin-dashboard__hint {
      color: var(--color-warm-brown);
      line-height: var(--text-body-line-height);
    }
  `
})
export class OrderStatusDashboardComponent {
  adminAuth = inject(AdminAuthService);
  private router = inject(Router);

  logout(): void {
    this.adminAuth.logout();
    this.router.navigate(['/admin/login']);
  }
}
