import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import { FeedComponent } from './feed.component';
import { CommunityService, FeedResponse } from '../../services/community.service';
import { AuthService } from '../../../../core/auth.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Post } from '../../models/post.model';

afterEach(() => TestBed.resetTestingModule());
it('loads bounded pages, appends without duplicates and retries a failed page without skipping it', () => {
  const requests: Subject<FeedResponse>[] = [];
  const api = { shouldRestoreState: false, getFeed: vi.fn(() => {
    const request = new Subject<FeedResponse>(); requests.push(request); return request;
  }) };
  TestBed.configureTestingModule({ providers: [
    { provide: CommunityService, useValue: api },
    { provide: AuthService, useValue: { isAuthenticated: signal(true) } },
    { provide: AuthModalService, useValue: { isOpen: signal(false) } },
    { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
    { provide: Router, useValue: {} }, { provide: ToastService, useValue: {} },
    { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } }
  ] });
  const component = TestBed.runInInjectionContext(() => new FeedComponent());
  component.ngOnInit();
  expect(api.getFeed).toHaveBeenLastCalledWith(1, 9, '', 'created_at', undefined);
  const post = (id: string) => ({ post_id: id } as Post);
  requests[0].next({ data: [post('A')], page: 1, limit: 1, total: 3 });
  component.loadMore();
  requests[1].error(new Error('offline'));
  expect(component.page).toBe(1);
  component.loadMore();
  expect(api.getFeed).toHaveBeenLastCalledWith(2, 9, '', 'created_at', undefined);
  requests[2].next({ data: [post('A'), post('B')], page: 2, limit: 1, total: 3 });
  expect(component.posts.map(p => p.post_id)).toEqual(['A', 'B']);
  component.onCategoryChange('COFFEE');
  expect(api.getFeed).toHaveBeenLastCalledWith(1, 9, 'COFFEE', 'created_at', undefined);
  requests[3].next({ data: [post('C')], page: 1, limit: 9, total: 1 });
  expect(component.posts.map(p => p.post_id)).toEqual(['C']);
  expect(component.hasMore).toBe(false);
  component.ngOnDestroy();
});
