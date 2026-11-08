import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { afterEach, expect, it } from 'vitest';
import { CustomerDetailComponent } from './customer-detail.component';
import { AdminCustomersService } from '../../services/admin-customers.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { ToastService } from '../../../../shared/services/toast.service';

afterEach(() => TestBed.resetTestingModule());
it('opens scoped service customer sections and keeps the service route on the back link', async () => {
  const customer = { user_id: 'USR1', profile_name: 'Mai', status: 'active', membership_tier: 'Seed', points: 0,
    order_count: 0, total_spent: 0, ritual_boxes: 0, notes: [],
    vouchers: [{ code: 'PERSONAL10', discount_value: 10, discount_type: 'percentage', is_active: true, used_count: 0, valid_to: '2026-12-31' }],
    violations: [{ level: 1, reason: 'spam', created_at: '2026-11-08T01:00:00Z' }] };
  TestBed.configureTestingModule({ providers: [
    provideRouter([{ path: 'admin/service-customers/:userId', component: CustomerDetailComponent, data: { serviceCustomers: true } }]),
    { provide: AdminCustomersService, useValue: { get: () => of({ data: customer }), orders: () => of({ data: [], total: 0, page: 1, limit: 20 }) } },
    { provide: AdminAuthService, useValue: { getUser: () => ({ role: 'cskh' }) } },
    { provide: ToastService, useValue: {} }
  ] });
  const harness = await RouterTestingHarness.create('/admin/service-customers/USR1');
  const element = harness.routeNativeElement!;
  expect(element.querySelector('.back-link')?.getAttribute('href')).toBe('/admin/service-customers');
  const tabs = [...element.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  tabs.find(button => button.textContent?.includes('Vouchers'))!.click();
  harness.detectChanges();
  expect(element.textContent).toContain('PERSONAL10');
  expect(element.textContent).not.toContain('Only staff can see these notes.');
  tabs.find(button => button.textContent?.includes('Violations'))!.click();
  harness.detectChanges();
  expect(element.textContent).toContain('spam');
  expect(element.textContent).not.toContain('Unlock account');
});
