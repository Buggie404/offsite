import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import { VouchersComponent } from './vouchers.component';
import { AdminVouchersService } from '../../services/admin-vouchers.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';

afterEach(() => TestBed.resetTestingModule());

function setup(role = 'admin_cc') {
  const stop = vi.fn(() => new Subject());
  TestBed.configureTestingModule({ providers: [
    { provide: ActivatedRoute, useValue: {} },
    { provide: AdminVouchersService, useValue: { stop } },
    { provide: AdminAuthService, useValue: { getAdminRole: () => role } }
  ] });
  const component = TestBed.createComponent(VouchersComponent).componentInstance;
  component.modalMode = 'edit';
  component.modalOpen = true;
  component.editing = { _id: 'voucher-1', code: 'WELCOME10', is_active: true } as NonNullable<typeof component.editing>;
  return { component, stop };
}

it('does not stop before confirmation or after cancel, and sends only one request', () => {
  const { component, stop } = setup();
  component.confirmStop();
  component.stop();
  expect(component.stopConfirmationOpen).toBe(true);
  expect(stop).not.toHaveBeenCalled();
  component.stopConfirmationOpen = false;
  component.confirmStop();
  expect(stop).not.toHaveBeenCalled();
  component.stop();
  component.confirmStop();
  component.confirmStop();
  expect(stop).toHaveBeenCalledExactlyOnceWith('voucher-1');
  expect(component.saving).toBe(true);
});

it('dismisses only the confirmation on Escape and preserves the voucher editor', () => {
  const { component } = setup();
  component.stop();
  component.onEscape(new Event('keydown'));
  expect(component.stopConfirmationOpen).toBe(false);
  expect(component.modalOpen).toBe(true);
  const handled = new Event('keydown', { cancelable: true });
  handled.preventDefault();
  component.onEscape(handled);
  expect(component.modalOpen).toBe(true);
});

it('does not allow Service-Ops to request or confirm a stop', () => {
  const { component, stop } = setup('cskh');
  component.stop();
  expect(component.stopConfirmationOpen).toBe(false);
  component.confirmStop();
  expect(stop).not.toHaveBeenCalled();
});
