import { ChangeDetectorRef, Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  LucideShieldCheck,
  LucideMail,
  LucideLock,
  LucideEye,
  LucideEyeOff,
  LucideLogIn
} from '@lucide/angular';
import { AdminAuthService } from '../../services/admin-auth.service';

@Component({
  selector: 'app-admin-sign-in',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideShieldCheck,
    LucideMail,
    LucideLock,
    LucideEye,
    LucideEyeOff,
    LucideLogIn
  ],
  templateUrl: './sign-in.component.html',
  styleUrl: './sign-in.component.scss'
})
export class AdminSignInComponent implements OnInit {
  private adminAuth = inject(AdminAuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private platformId = inject(PLATFORM_ID);

  email = '';
  password = '';
  rememberMe = false;
  showPassword = false;
  isSubmitting = false;

  emailError: string | null = null;
  passwordError: string | null = null;
  formError: string | null = null;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.rememberMe = this.adminAuth.isRememberMeEnabled();

    if (this.adminAuth.isAdmin() && this.rememberMe) {
      void this.router.navigateByUrl('/admin/orders', { replaceUrl: true });
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  private extractServerMessage(body: unknown): string | null {
    if (!body) return null;
    if (typeof body === 'string') {
      return body.startsWith('Http failure response') ? null : body;
    }
    if (typeof body === 'object') {
      const record = body as { error?: unknown; message?: unknown };
      if (typeof record.error === 'string') return record.error;
      if (typeof record.message === 'string') return record.message;
    }
    return null;
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.emailError = null;
    this.passwordError = null;
    this.formError = null;

    const trimmedEmail = this.email.trim();
    let hasError = false;

    if (!trimmedEmail) {
      this.emailError = 'Email is required';
      hasError = true;
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        this.emailError = 'Invalid admin account';
        hasError = true;
      }
    }

    if (!this.password) {
      this.passwordError = 'Password is required';
      hasError = true;
    }

    if (hasError) {
      return;
    }

    this.isSubmitting = true;
    this.cdr.detectChanges();

    try {
      await this.adminAuth.login(trimmedEmail, this.password, this.rememberMe);
      await this.router.navigateByUrl('/admin/orders', { replaceUrl: true });
    } catch (err: any) {
      const status = err?.status as number | undefined;
      const body = err?.error;
      const errorCode =
        body && typeof body === 'object' && 'code' in body ? (body as { code?: string }).code : undefined;
      const serverMessage = this.extractServerMessage(body);

      if (err?.name === 'TimeoutError') {
        this.formError =
          'Request timed out. Check that the backend is running on port 5000.';
      } else if (status === 0) {
        this.formError =
          'Cannot connect to backend. Make sure backend is running on port 5000 (npm start or cd backend && npm run dev).';
      } else if (errorCode === 'ACCOUNT_NOT_FOUND' || errorCode === 'NOT_ADMIN' || status === 403 || status === 404) {
        this.emailError = 'Invalid admin account';
      } else if (errorCode === 'INCORRECT_PASSWORD' || status === 401) {
        this.passwordError = 'Incorrect password';
      } else if (status && status >= 500) {
        this.formError = 'Something went wrong on the server. Please try again in a moment.';
      } else if (serverMessage) {
        this.formError = serverMessage;
      } else {
        this.formError = 'An error occurred during sign in. Please try again.';
      }
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }
}
