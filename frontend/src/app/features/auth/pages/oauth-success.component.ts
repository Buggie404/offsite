import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { AuthModalService } from '../../../core/auth-modal.service';

@Component({
  selector: 'app-oauth-success',
  standalone: true,
  template: `
    <div class="oauth-success-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; font-family: sans-serif; text-align: center; padding: 20px;">
      <h2 style="font-weight: 300; letter-spacing: 0.05em; color: #1a1a1a; margin-bottom: 8px;">Authenticating...</h2>
      <p style="color: #666; font-size: 0.9rem; margin: 0;">Please wait while we complete your login.</p>
    </div>
  `
})
export class OAuthSuccessComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);
  private platformId = inject(PLATFORM_ID);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.route.queryParams.subscribe(params => {
      const token = params['token'];

      if (!token) {
        this.router.navigate(['/login']);
        return;
      }

      this.authService.handleOAuthSuccess(token);
      this.authModalService.close();

      this.router.navigate(['/']);
    });
  }
}
