import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, expect, it } from 'vitest';
import { CommentSectionComponent } from './comment-section.component';
import { CommunityService } from '../../services/community.service';
import { AuthService } from '../../../../core/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';

@Component({ standalone: true, template: 'Public profile' })
class ProfileStub {}

afterEach(() => TestBed.resetTestingModule());

it('links names and avatars for comments and replies to their respective public profiles', async () => {
  const row = (id: string, user: string, parent: string | null) => ({
    comment_id: id, user_id: user, parent_id: parent, content: 'Hello',
    author: { username: user, avatar_url: null, is_post_author: false },
    created_at: '2026-11-08T01:00:00Z', like_count: 0
  });
  TestBed.configureTestingModule({ providers: [
    provideRouter([{ path: 'community/profile/:id', component: ProfileStub }]),
    { provide: CommunityService, useValue: { getComments: () => of({ data: [row('C1', 'USR2', null), row('C2', 'USR3', 'C1')], total: 2 }) } },
    { provide: AuthService, useValue: { currentUser: signal(null) } },
    { provide: ToastService, useValue: {} }
  ] });
  const fixture = TestBed.createComponent(CommentSectionComponent);
  fixture.componentInstance.postId = 'POST1';
  fixture.detectChanges();
  await fixture.whenStable();
  const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('.comment-avatar, .comment-username')];
  expect(links.map(link => link.getAttribute('href'))).toEqual([
    '/community/profile/USR2', '/community/profile/USR2', '/community/profile/USR3', '/community/profile/USR3'
  ]);
  links[3].click();
  await fixture.whenStable();
  expect(TestBed.inject(Router).url).toBe('/community/profile/USR3');
});
