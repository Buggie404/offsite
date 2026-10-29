import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { AuthModalService } from './core/auth-modal.service';
import { AuthService } from './core/auth.service';
import { NavbarComponent } from './shared/components/navbar/navbar.component';
import { FooterComponent } from './shared/components/footer/footer.component';
import { AuthModalComponent } from './shared/components/auth-modal/auth-modal.component';
import { AuthPromptModalComponent } from './shared/components/auth-prompt-modal/auth-prompt-modal.component';
import { ToastComponent } from './shared/services/toast.component';
import { AiChatDrawerComponent } from './shared/components/ai-chat-drawer/ai-chat-drawer.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavbarComponent, FooterComponent, AuthModalComponent, AuthPromptModalComponent, ToastComponent, AiChatDrawerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private router = inject(Router);
  private authModalService = inject(AuthModalService);
  private authService = inject(AuthService);

  protected readonly title = signal('frontend');

  constructor() {
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe(() => {
      const ref = this.router.parseUrl(this.router.url).queryParams['ref'];
      if (!ref || this.authService.isAuthenticated()) return;

      this.authModalService.openSignupWithReferral(String(ref));

      void this.router.navigate([], {
        queryParams: { ref: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    });
  }

  protected readonly isAdminRoute = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/admin')),
      startWith(this.router.url.startsWith('/admin'))
    ),
    { initialValue: false }
  );
}
