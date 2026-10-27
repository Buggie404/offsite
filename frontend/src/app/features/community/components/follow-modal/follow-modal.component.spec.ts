import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowModalComponent } from './follow-modal.component';
import { CommunityService, FollowListResponse } from '../../services/community.service';
import { AuthService } from '../../../../core/auth.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { ToastService } from '../../../../shared/services/toast.service';

describe('FollowModalComponent', () => {
  let fixture: ComponentFixture<FollowModalComponent>;
  const person = { user_id: 'USR2', username: 'linh.cafe', avatar_url: null, membership_tier: 'Leaf', is_following: false, is_self: false };
  const api = { getFollowList: vi.fn(), toggleFollow: vi.fn() };
  const login = { open: vi.fn() };
  const auth = { isAuthenticated: vi.fn(() => true) };

  beforeEach(async () => {
    vi.clearAllMocks();
    auth.isAuthenticated.mockReturnValue(true);
    api.getFollowList.mockImplementation(() => of({ data: [{ ...person }], total: 1, has_more: false }));
    api.toggleFollow.mockReturnValue(of({ following: true }));
    HTMLDialogElement.prototype.showModal = vi.fn();
    await TestBed.configureTestingModule({
      imports: [FollowModalComponent],
      providers: [provideRouter([]),
        { provide: CommunityService, useValue: api }, { provide: AuthService, useValue: auth },
        { provide: AuthModalService, useValue: login }, { provide: ToastService, useValue: { error: vi.fn() } }]
    }).compileComponents();
    fixture = TestBed.createComponent(FollowModalComponent);
    fixture.componentRef.setInput('userId', 'USR1');
    fixture.componentRef.setInput('username', 'bao.brews');
    fixture.componentRef.setInput('followersCount', 1);
    fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); vi.useRealTimers(); });

  it('renders the profile header, member identity and both follow lists', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h2')?.textContent).toContain('@bao.brews');
    expect(element.querySelector('.avatar')?.textContent?.trim()).toBe('LC');
    expect(element.querySelector('.person-info small')?.textContent).toBe('Leaf');
    (element.querySelectorAll('.list-tabs button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(api.getFollowList).toHaveBeenLastCalledWith('USR1', 'following', 1, '');
    expect(element.querySelector('footer')?.textContent).toContain('Showing 1 of 1');
  });

  it('cancels stale list requests when switching tabs', () => {
    const old = new Subject<FollowListResponse>();
    api.getFollowList.mockReturnValueOnce(old);
    fixture.componentInstance.selectTab('following');
    fixture.componentInstance.selectTab('followers');
    old.next({ data: [{ ...person, username: 'stale' }], total: 1, has_more: false });
    expect(fixture.componentInstance.users[0].username).toBe('linh.cafe');
  });

  it('debounces server search and resets pagination', () => {
    vi.useFakeTimers();
    fixture.componentInstance.search = 'linh';
    fixture.componentInstance.searchChanged();
    vi.advanceTimersByTime(250);
    expect(api.getFollowList).toHaveBeenLastCalledWith('USR1', 'followers', 1, 'linh');
  });

  it('follows a user profile and emits the updated relationship', () => {
    const emit = vi.spyOn(fixture.componentInstance.followChanged, 'emit');
    fixture.componentInstance.toggle(fixture.componentInstance.users[0]);
    expect(api.toggleFollow).toHaveBeenCalledWith('USR2');
    expect(emit).toHaveBeenCalledWith({ userId: 'USR2', following: true });
    expect(fixture.componentInstance.users[0].is_following).toBe(true);
  });

  it('opens login for guests before attempting to follow', () => {
    auth.isAuthenticated.mockReturnValue(false);
    fixture.componentInstance.toggle(fixture.componentInstance.users[0]);
    expect(api.toggleFollow).not.toHaveBeenCalled();
    expect(login.open).toHaveBeenCalledWith('login');
  });
});
