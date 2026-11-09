import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { CustomersListingComponent } from './customers-listing.component';
import { AdminCustomersService } from '../../services/admin-customers.service';

afterEach(() => TestBed.resetTestingModule());

it('renders support columns and requests restricted customers and header searches with the right filters', async () => {
  const list = vi.fn(() => of({ data: [{ user_id: 'USR1', profile_name: 'Mai', membership_tier: 'Seed', status: 'active', order_count: 3, restricted_until: '2099-01-01', last_chat_at: '2026-11-08T03:42:00Z', last_chat_status: 'open', open_reports: 2 }], total: 1, page: 1, limit: 20 }));
  TestBed.configureTestingModule({ providers: [
    provideRouter([{ path: 'admin/service-customers', component: CustomersListingComponent, data: { serviceCustomers: true } }]),
    { provide: AdminAuthService, useValue: { getUser: () => ({ role: 'admin_cc' }) } },
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

it('defaults CSKH to assigned customers and locks inaccessible rows in All customers', async () => {
  const list = vi.fn(() => of({ data: [{ user_id: 'OTHER', profile_name: 'Other', membership_tier: 'Seed', status: 'active', order_count: 0, can_view_detail: false }], total: 1, assigned_total: 3, page: 1, limit: 20 }));
  TestBed.configureTestingModule({ providers: [
    provideRouter([{ path: 'admin/service-customers', component: CustomersListingComponent, data: { serviceCustomers: true } }]),
    { provide: AdminAuthService, useValue: { getUser: () => ({ role: 'cskh' }) } },
    { provide: AdminCustomersService, useValue: { list } }
  ] });
  const harness = await RouterTestingHarness.create('/admin/service-customers');
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ assignment: 'mine' }));
  expect(harness.routeNativeElement!.textContent).toContain('Assigned to me (3)');
  await TestBed.inject(Router).navigateByUrl('/admin/service-customers?assignment=all');
  harness.detectChanges();
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ assignment: 'all' }));
  const row = harness.routeNativeElement!.querySelector<HTMLElement>('tbody tr')!;
  expect(row.getAttribute('tabindex')).toBeNull();
  expect(row.querySelector('[lucideLock]')).not.toBeNull();
  row.click();
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  await harness.fixture.whenStable();
  expect(TestBed.inject(Router).url).toBe('/admin/service-customers?assignment=all');
});
