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
  LucideLogIn,
  LucideKeyRound
} from '@lucide/angular';
import { AdminAuthService, AdminLoginResponse } from '../../services/admin-auth.service';

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
    LucideLogIn,
    LucideKeyRound
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

  // First sign-in with a temporary password (Staff page): set a new one before entering.
  pendingLogin: AdminLoginResponse | null = null;
  newPassword = '';
  confirmPassword = '';
  newPasswordError: string | null = null;

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

  // ── Realtime validation ───────────────────────────────────────

  private readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Called on each keystroke via ngModelChange */
  onEmailInput(): void {
    this.validateEmail(false);
  }

  /** Always validate when leaving the email field */
  onEmailBlur(): void {
    this.validateEmail(true);
  }

  /** Called on each keystroke via ngModelChange */
  onPasswordInput(): void {
    this.validatePassword(false);
  }

  /** Always validate when leaving the password field */
  onPasswordBlur(): void {
    this.validatePassword(true);
  }

  private validateEmail(showRequiredIfEmpty: boolean): void {
    this.formError = null;

    const trimmed = this.email.trim();
    if (!trimmed) {
      this.emailError = showRequiredIfEmpty ? 'Email is required' : null;
      return;
    }

    if (!this.EMAIL_REGEX.test(trimmed)) {
      this.emailError = 'Please enter a valid email address';
      return;
    }

    this.emailError = null;
  }

  private validatePassword(showRequiredIfEmpty: boolean): void {
    this.formError = null;

    if (!this.password) {
      this.passwordError = showRequiredIfEmpty ? 'Password is required' : null;
      return;
    }

    if (this.password.length < 8 || this.password.length > 15) {
      this.passwordError = 'Password must be 8-15 characters';
      return;
    }

    this.passwordError = null;
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
    this.formError = null;

    // Force-validate both fields (in case user never touched them)
    this.validateEmail(true);
    this.validatePassword(true);

    if (this.emailError || this.passwordError) {
      return;
    }

    const trimmedEmail = this.email.trim();
    this.isSubmitting = true;
    this.cdr.detectChanges();

    try {
      const response = await this.adminAuth.requestLogin(trimmedEmail, this.password);
      if (response.user.must_change_password) {
        this.pendingLogin = response;
        return;
      }
      this.adminAuth.storeSession(response, this.rememberMe);
      await this.router.navigateByUrl(this.adminAuth.getDefaultRoute(), { replaceUrl: true });
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
      } else if (errorCode === 'ACCOUNT_SUSPENDED') {
        this.formError = 'This admin account has been disabled. Contact a Senior Admin.';
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

  // ── First sign-in: replace the temporary password ─────────────

  private validateNewPassword(): boolean {
    if (this.newPassword.length < 8 || this.newPassword.length > 15 || /\s/.test(this.newPassword)) {
      this.newPasswordError = 'Password must be 8-15 characters, without spaces';
    } else if (this.newPassword === this.password) {
      this.newPasswordError = 'Choose a password different from the temporary one';
    } else if (this.newPassword !== this.confirmPassword) {
      this.newPasswordError = 'Passwords do not match';
    } else {
      this.newPasswordError = null;
    }
    return !this.newPasswordError;
  }

  async onSetNewPassword(event: Event): Promise<void> {
    event.preventDefault();
    const pending = this.pendingLogin;
    if (!pending || this.isSubmitting || !this.validateNewPassword()) return;
    this.isSubmitting = true;
    this.cdr.detectChanges();
    try {
      await this.adminAuth.changeTemporaryPassword(pending.token, this.password, this.newPassword);
      this.adminAuth.storeSession({ ...pending, user: { ...pending.user, must_change_password: false } }, this.rememberMe);
      await this.router.navigateByUrl(this.adminAuth.getDefaultRoute(), { replaceUrl: true });
    } catch (err: any) {
      this.newPasswordError = this.extractServerMessage(err?.error) || 'Could not update your password. Please try again.';
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  backToSignIn(): void {
    this.pendingLogin = null;
    this.password = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.newPasswordError = null;
  }
}
