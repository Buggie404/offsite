import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import { CustomersListingComponent } from './customers-listing.component';
import { AdminCustomersService } from '../../services/admin-customers.service';

afterEach(() => TestBed.resetTestingModule());

it('renders support columns and requests restricted customers and header searches with the right filters', async () => {
  const list = vi.fn(() => of({ data: [{ user_id: 'USR1', profile_name: 'Mai', membership_tier: 'Seed', status: 'active', order_count: 3, restricted_until: '2099-01-01', last_chat_at: '2026-11-08T03:42:00Z', last_chat_status: 'open', open_reports: 2 }], total: 1, page: 1, limit: 20 }));
  TestBed.configureTestingModule({ providers: [
    provideRouter([{ path: 'admin/service-customers', component: CustomersListingComponent, data: { serviceCustomers: true } }]),
    { provide: AdminCustomersService, useValue: { list } }
  ] });
  const harness = await RouterTestingHarness.create('/admin/service-customers?status=restricted');
  const element = harness.routeNativeElement!;
  expect(list).toHaveBeenLastCalledWith({ page: 1, q: '', tier: '', status: 'restricted' });
  expect(element.textContent).toContain('Last chat');
  expect(element.textContent).toContain('2 open');
  expect(element.textContent).toContain('Restricted');
  expect(element.querySelector('thead')?.textContent).not.toContain('Points');
  await TestBed.inject(Router).navigateByUrl('/admin/service-customers?status=restricted&q=Mai');
  harness.detectChanges();
  expect(list).toHaveBeenLastCalledWith({ page: 1, q: 'Mai', tier: '', status: 'restricted' });
});
