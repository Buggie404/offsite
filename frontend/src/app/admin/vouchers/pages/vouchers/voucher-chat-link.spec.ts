import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, expect, it } from 'vitest';
import { VouchersComponent } from './vouchers.component';
import { AdminVouchersService } from '../../services/admin-vouchers.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
afterEach(() => TestBed.resetTestingModule());
it('opens the complaint voucher form from chat with its customer selected', () => {
  TestBed.configureTestingModule({ providers: [
    { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ create: 'complaint', customer_id: 'USR1', customer_name: 'Mai Anh' }) } } },
    { provide: AdminVouchersService, useValue: { list: () => of({ data: [], total: 0, page: 1 }) } },
    { provide: AdminAuthService, useValue: { getAdminRole: () => 'cskh' } }
  ] });
  const fixture = TestBed.createComponent(VouchersComponent);
  fixture.componentInstance.ngOnInit();
  expect(fixture.componentInstance.modalOpen).toBe(true);
  expect(fixture.componentInstance.form.purpose).toBe('complaint');
  expect(fixture.componentInstance.form.assigned_user).toBe('USR1');
  expect(fixture.componentInstance.customerName).toBe('Mai Anh');
  expect(fixture.componentInstance.canManage).toBe(false);
});
