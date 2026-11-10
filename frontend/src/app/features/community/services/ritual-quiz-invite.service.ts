import { Injectable, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../../../core/auth.service';
import { HttpService } from '../../../core/http.service';

@Injectable({ providedIn: 'root' })
export class RitualQuizInviteService {
  private auth = inject(AuthService);
  private http = inject(HttpService);
  private platform = inject(PLATFORM_ID);
  readonly visible = signal(false);
  private revision = 0;

  constructor() {
    effect(() => {
      this.auth.currentUser();
      const signedIn = this.auth.isAuthenticated();
      const revision = ++this.revision;
      this.visible.set(false);
      if (!isPlatformBrowser(this.platform)) return;
      if (!signedIn) { this.visible.set(true); return; }
      void this.http.get('/ritual-dna/me').then(response => {
        if (revision === this.revision) this.visible.set(!(response as { result: { quiz_taken_at?: string } | null }).result?.quiz_taken_at);
      }).catch(() => { /* Keep the invitation hidden until quiz status is known. */ });
    });
  }

  quizCompleted(): void { ++this.revision; this.visible.set(false); }
}
