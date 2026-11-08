import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';
import { afterEach, expect, it, vi } from 'vitest';
import { CustomerDetailComponent } from './customer-detail.component';
import { AdminCustomersService } from '../../services/admin-customers.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { ChatService } from '../../../../core/services/chat.service';

afterEach(() => TestBed.resetTestingModule());
it('opens scoped service customer sections and keeps the service route on the back link', async () => {
  const addNote = vi.fn(() => of({ data: { note_id: 'N1', content: 'Prefers chat', author_name: 'Ha', author_role: 'cskh', created_at: '2026-11-08' } }));
  const reportCustomer = vi.fn(() => of({}));
  const customer = { user_id: 'USR1', profile_name: 'Mai', status: 'active', membership_tier: 'Seed', points: 0,
    order_count: 0, total_spent: 0, ritual_boxes: 0, notes: [],
    vouchers: [{ code: 'PERSONAL10', discount_value: 10, discount_type: 'percentage', is_active: true, used_count: 0, valid_to: '2026-12-31' }],
    violations: [{ level: 1, reason: 'spam', created_at: '2026-11-08T01:00:00Z' }] };
  TestBed.configureTestingModule({ providers: [
    provideHttpClient(),
    provideRouter([{ path: 'admin/service-customers/:userId', component: CustomerDetailComponent, data: { serviceCustomers: true } }]),
    { provide: AdminCustomersService, useValue: {
      get: () => of({ data: customer }), orders: () => of({ data: [], total: 0, page: 1, limit: 20 }),
      addNote,
      conversations: () => of({ data: [{ conversation_id: 'CHAT1', status: 'open', last_message_at: '2026-11-08T03:42:00Z', last_message_preview: 'Broken bowl', summary: 'Refund forwarded', agent_name: 'Ha', close_outcome: null }] }),
      conversationMessages: () => of({ data: [{ _id: 'M1', conversation_id: 'CHAT1', sender_type: 'customer', sender_id: 'USR1', content: 'My bowl arrived broken', created_at: '2026-11-08T03:39:00Z' }] })
    } },
    { provide: ChatService, useValue: { reportCustomer } },
    { provide: AdminAuthService, useValue: { getUser: () => ({ role: 'cskh' }), getAdminRole: () => 'cskh' } },
    { provide: ToastService, useValue: { success: vi.fn() } }
  ] });
  const harness = await RouterTestingHarness.create('/admin/service-customers/USR1');
  const element = harness.routeNativeElement!;
  expect(element.querySelector('.back-link')?.getAttribute('href')).toBe('/admin/service-customers');
  expect(element.textContent).toContain('My bowl arrived broken');
  expect(element.querySelector('.conversation-footer a')?.getAttribute('href')).toBe('/admin/chat?conversation=CHAT1');
  expect(element.querySelector('.service-sidebar')?.textContent).toContain('Internal notes');
  const tabs = [...element.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  tabs.find(button => button.textContent?.includes('Vouchers'))!.click();
  harness.detectChanges();
  expect(element.textContent).toContain('PERSONAL10');
  expect(element.textContent).not.toContain('Only staff can see these notes.');
  tabs.find(button => button.textContent?.includes('Violations'))!.click();
  harness.detectChanges();
  expect(element.textContent).toContain('spam');
  expect(element.textContent).not.toContain('Unlock account');
  const component = harness.routeDebugElement!.componentInstance as CustomerDetailComponent;
  component.noteDraft = 'Prefers chat';
  component.addNote();
  harness.detectChanges();
  expect(addNote).toHaveBeenCalledWith('USR1', 'Prefers chat');
  expect(element.querySelector('.service-sidebar')?.textContent).toContain('Prefers chat');
  const actions = [...element.querySelectorAll<HTMLButtonElement>('.page-actions button')];
  actions.find(button => button.textContent?.includes('Create voucher'))!.click();
  harness.detectChanges();
  expect(element.querySelector('[role=dialog]')?.textContent).toContain('PERS-MAI-');
  expect(element.querySelector('[role=dialog]')?.textContent).not.toContain('Create & send in chat');
  expect(TestBed.inject(Router).url).toBe('/admin/service-customers/USR1');
  component.voucherCustomer = null;
  harness.routeDebugElement!.injector.get(ChangeDetectorRef).markForCheck();
  harness.detectChanges();
  actions.find(button => button.textContent?.includes('Report account'))!.click();
  harness.detectChanges();
  expect(element.querySelector('app-report-post-modal')).not.toBeNull();
  component.reportCustomer({ reason: 'spam', note: 'Spam in support chat' });
  harness.detectChanges();
  expect(reportCustomer).toHaveBeenCalledWith('USR1', 'spam', 'Spam in support chat');
  expect(element.querySelector('app-report-post-modal')).toBeNull();
});
