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

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.emailError = null;
    this.passwordError = null;
    this.formError = null;

    const trimmedEmail = this.email.trim();
    if (!trimmedEmail) {
      this.emailError = 'Email is required';
      return;
    }
    if (!this.password) {
      this.passwordError = 'Password is required';
      return;
    }

    this.isSubmitting = true;
    try {
      await this.adminAuth.login(trimmedEmail, this.password, this.rememberMe);
      await this.router.navigateByUrl('/admin/orders', { replaceUrl: true });
    } catch (err: any) {
      const serverError = err?.error;
      const errorCode = serverError?.code;
      const status = err?.status;

      if (status === 0) {
        this.formError = 'Cannot connect to backend. Make sure backend is running on port 5000 (npm start or cd backend && npm run dev).';
      } else if (errorCode === 'ACCOUNT_NOT_FOUND' || errorCode === 'NOT_ADMIN') {
        this.emailError = 'Invalid admin account';
      } else if (errorCode === 'INCORRECT_PASSWORD') {
        this.passwordError = 'Incorrect password';
      } else if (typeof serverError?.error === 'string') {
        this.formError = serverError.error;
      } else if (typeof err?.message === 'string' && err.message) {
        this.formError = err.message;
      } else {
        this.formError = 'An error occurred during sign in.';
      }
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }
}
