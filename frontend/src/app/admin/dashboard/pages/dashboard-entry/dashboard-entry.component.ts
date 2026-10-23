import { Component, inject } from '@angular/core';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminDashboardComponent } from '../dashboard/dashboard.component';
import { SalesDashboardComponent } from '../../../sales-dashboard/pages/sales-dashboard/sales-dashboard.component';

/** Chooses the dashboard without making the URL role-specific. */
@Component({
  selector: 'app-dashboard-entry',
  standalone: true,
  imports: [AdminDashboardComponent, SalesDashboardComponent],
  template: `@if (role === 'qlsp') { <app-sales-dashboard /> } @else { <app-admin-dashboard /> }`
})
export class DashboardEntryComponent {
  private readonly adminAuth = inject(AdminAuthService);
  get role() { return this.adminAuth.getAdminRole(); }
}
