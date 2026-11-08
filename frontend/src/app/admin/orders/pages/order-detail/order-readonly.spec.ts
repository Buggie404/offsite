import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, ROUTES, Router } from '@angular/router';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminRoutingModule } from '../../../admin-routing-module';
import { ADMIN_NAV_GROUPS } from '../../../admin-navigation.config';
import { adminRoleGuard } from '../../../../core/guards/admin-role.guard';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminOrderService } from '../../services/admin-order.service';
import { AdminRefreshService } from '../../../shared/services/admin-refresh.service';
import { OrderSocketService } from '../../../../core/services/order-socket.service';
import { OrderDetailComponent } from './order-detail.component';
import { AdminOrderDetail } from '../../models/admin-order.model';
afterEach(() => TestBed.resetTestingModule());
it('allows CSKH through both Orders routes and exposes the Orders navigation entry', () => {
  TestBed.configureTestingModule({ imports: [AdminRoutingModule], providers: [
    { provide: PLATFORM_ID, useValue: 'browser' },
    { provide: AdminAuthService, useValue: { isAdmin: () => true, getAdminRole: () => 'cskh' } },
    { provide: Router, useValue: { createUrlTree: vi.fn() } }
  ] });
  const routes = TestBed.inject(ROUTES).flat().find(route => route.path === '' && route.children)?.children || [];
  for (const path of ['orders', 'orders/:id']) {
    const route = routes.find(route => route.path === path)!;
    expect(route.data?.['adminRoles']).toContain('cskh');
    expect(TestBed.runInInjectionContext(() => adminRoleGuard({ data: route.data } as any, { url: '/admin/' + path } as any))).toBe(true);
  }
  expect(ADMIN_NAV_GROUPS.flatMap(group => group.items).find(item => item.path === '/admin/orders')?.roles).toContain('cskh');
});
it('CSKH order detail blocks every editing action before it can call a service', () => {
  const writes = { updateStatus: vi.fn(), approveRefund: vi.fn(), rejectRefund: vi.fn(), addInternalNote: vi.fn() };
  TestBed.configureTestingModule({ providers: [
    { provide: AdminOrderService, useValue: writes },
    { provide: AdminAuthService, useValue: { getAdminRole: () => 'cskh' } },
    ...[ActivatedRoute, Router, AdminRefreshService, OrderSocketService, ChangeDetectorRef].map(provide => ({ provide, useValue: {} }))
  ] });
  const component = TestBed.runInInjectionContext(() => new OrderDetailComponent());
  component.order = { order_id: 'OFS-2026-00117', order_status: 'processing' } as AdminOrderDetail;
  expect(component.canManageOrders).toBe(false);
  expect(component.canUpdateStatus).toBe(false);
  expect(component.isRefundModalReadonly).toBe(true);
  component.chooseStatus({ value: 'shipping', label: 'Ship', hint: '' });
  component.approveRefundRequest(); component.submitRejectRefund(); component.noteText='No write'; component.saveNote();
  for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
});
