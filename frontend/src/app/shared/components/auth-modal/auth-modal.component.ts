import { Component, inject, HostListener, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideX, LucideEye, LucideEyeOff } from '@lucide/angular';
import { AuthModalService } from '../../../core/auth-modal.service';
import { AuthService } from '../../../core/auth.service';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideX, LucideEye, LucideEyeOff],
  templateUrl: './auth-modal.component.html',
  styleUrl: './auth-modal.component.scss'
})
export class AuthModalComponent {
  private authModalService = inject(AuthModalService);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('loginEmailInput') loginEmailInput!: ElementRef<HTMLInputElement>;
  @ViewChild('loginPhoneInput') loginPhoneInput!: ElementRef<HTMLInputElement>;
  @ViewChild('loginPasswordInput') loginPasswordInput!: ElementRef<HTMLInputElement>;
  @ViewChild('loginPhonePasswordInput') loginPhonePasswordInput!: ElementRef<HTMLInputElement>;

  isOpen = this.authModalService.isOpen;
  mode = this.authModalService.mode;

  loginTab: 'email' | 'phone' = 'email';
  showPassword = false;
  showConfirmPassword = false;

  // Form values (Login)
  loginEmail = '';
  loginPhone = '';
  loginPassword = '';

  // Form values (Signup)
  signupName = '';
  signupEmail = '';
  signupPhone = '';
  signupPassword = '';
  signupConfirmPassword = '';

  // Touch states (Login)
  emailTouched = false;
  phoneTouched = false;
  passwordTouched = false;

  // Touch states (Signup)
  signupNameTouched = false;
  signupEmailTouched = false;
  signupPhoneTouched = false;
  signupPasswordTouched = false;
  signupConfirmPasswordTouched = false;

  // Server errors
  serverEmailError: string | null = null;
  serverPasswordError: string | null = null;
  isSubmitting = false;

  setLoginTab(tab: 'email' | 'phone'): void {
    this.loginTab = tab;
    this.resetForm();
  }

  setAuthModalMode(mode: 'login' | 'signup'): void {
    this.authModalService.setMode(mode);
    this.showPassword = false;
    this.showConfirmPassword = false;
    this.resetForm();
  }

  closeAuthModal(): void {
    this.authModalService.close();
    this.resetForm();
  }

  resetForm(): void {
    this.loginEmail = '';
    this.loginPhone = '';
    this.loginPassword = '';
    this.emailTouched = false;
    this.phoneTouched = false;
    this.passwordTouched = false;

    this.signupName = '';
    this.signupEmail = '';
    this.signupPhone = '';
    this.signupPassword = '';
    this.signupConfirmPassword = '';
    this.signupNameTouched = false;
    this.signupEmailTouched = false;
    this.signupPhoneTouched = false;
    this.signupPasswordTouched = false;
    this.signupConfirmPasswordTouched = false;

    this.serverEmailError = null;
    this.serverPasswordError = null;
    this.isSubmitting = false;
  }

  onEmailBlur(): void {
    this.emailTouched = true;
  }

  onPhoneBlur(): void {
    this.phoneTouched = true;
  }

  onPasswordBlur(): void {
    this.passwordTouched = true;
  }

  // Validation message getters (Login)
  get emailError(): string | null {
    if (!this.loginEmail) {
      return this.emailTouched ? 'Email is required' : null;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.loginEmail)) {
      return 'Invalid email format';
    }
    return null;
  }

  get phoneError(): string | null {
    if (!this.loginPhone) {
      return this.phoneTouched ? 'Phone number is required' : null;
    }
    
    // Normalise: strip all spaces
    const normalized = this.loginPhone.replace(/\s+/g, '');
    
    if (!/^\d+$/.test(normalized)) {
      return 'Phone number must contain digits and spaces only';
    }
    if (normalized.length < 10 || normalized.length > 11) {
      return 'Phone number must be 10 to 11 digits';
    }
    return null;
  }

  get passwordError(): string | null {
    if (!this.loginPassword) {
      return this.passwordTouched ? 'Password is required' : null;
    }
    if (this.loginPassword.length < 8 || this.loginPassword.length > 15) {
      return 'Password must be 8-15 characters';
    }
    if (/\s/.test(this.loginPassword)) {
      return 'Password cannot contain spaces';
    }
    return null;
  }

  // Validation message getters (Signup)
  get signupNameError(): string | null {
    if (!this.signupName) {
      return this.signupNameTouched ? 'Full name is required' : null;
    }
    return null;
  }

  get signupEmailError(): string | null {
    if (!this.signupEmail && !this.signupPhone) {
      return this.signupEmailTouched ? 'Email or phone is required' : null;
    }
    if (this.signupEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(this.signupEmail)) {
        return 'Invalid email format';
      }
    }
    return null;
  }

  get signupPhoneError(): string | null {
    if (!this.signupPhone && !this.signupEmail) {
      return this.signupPhoneTouched ? 'Email or phone is required' : null;
    }
    if (this.signupPhone) {
      const normalized = this.signupPhone.replace(/\s+/g, '');
      if (!/^\d+$/.test(normalized)) {
        return 'Phone number must contain digits only';
      }
      if (normalized.length < 10 || normalized.length > 11) {
        return 'Phone number must be 10 to 11 digits';
      }
    }
    return null;
  }

  get signupPasswordError(): string | null {
    if (!this.signupPassword) {
      return this.signupPasswordTouched ? 'Password is required' : null;
    }
    if (this.signupPassword.length < 8 || this.signupPassword.length > 15) {
      return 'Password must be 8-15 characters';
    }
    if (/\s/.test(this.signupPassword)) {
      return 'Password cannot contain spaces';
    }
    return null;
  }

  get signupConfirmPasswordError(): string | null {
    if (!this.signupConfirmPassword) {
      return this.signupConfirmPasswordTouched ? 'Confirm password is required' : null;
    }
    if (this.signupConfirmPassword !== this.signupPassword) {
      return 'Passwords do not match';
    }
    return null;
  }

  // Password strength computation for Signup
  get signupPasswordStrengthScore(): number {
    const p = this.signupPassword;
    if (!p) return 0;

    const hasLower = /[a-z]/.test(p);
    const hasUpper = /[A-Z]/.test(p);
    const hasDigit = /[0-9]/.test(p);
    const hasSpecial = /[^A-Za-z0-9]/.test(p);

    const groupsCount = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);

    if (p.length < 8) {
      return 1; // Weak due to short length
    }
    if (p.length >= 10 && groupsCount >= 3) {
      return 3; // Strong
    }
    if (groupsCount >= 2) {
      return 2; // Medium
    }
    return 1; // Weak
  }

  get signupPasswordStrengthLabel(): string {
    const score = this.signupPasswordStrengthScore;
    if (score === 3) return 'STRONG';
    if (score === 2) return 'MEDIUM';
    if (score === 1) return 'WEAK';
    return '';
  }

  isFormValid(): boolean {
    if (this.mode() === 'signup') {
      const nameValid = !!this.signupName;
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.signupEmail);
      const normalizedPhone = this.signupPhone.replace(/\s+/g, '');
      const phoneValid = /^\d{10,11}$/.test(normalizedPhone);
      const passwordValid = this.signupPassword.length >= 8 && this.signupPassword.length <= 15 && !/\s/.test(this.signupPassword);
      const confirmValid = this.signupPassword === this.signupConfirmPassword;
      return nameValid && (emailValid || phoneValid) && passwordValid && confirmValid;
    }

    if (this.loginTab === 'email') {
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.loginEmail);
      const passwordValid = this.loginPassword.length >= 8 && this.loginPassword.length <= 15 && !/\s/.test(this.loginPassword);
      return emailValid && passwordValid;
    } else {
      const normalizedPhone = this.loginPhone.replace(/\s+/g, '');
      const phoneValid = /^\d{10,11}$/.test(normalizedPhone);
      const passwordValid = this.loginPassword.length >= 8 && this.loginPassword.length <= 15 && !/\s/.test(this.loginPassword);
      return phoneValid && passwordValid;
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  async onSubmitAuth(event: Event): Promise<void> {
    if (event) {
      event.preventDefault();
    }

    if (this.mode() === 'signup') {
      this.signupNameTouched = true;
      this.signupEmailTouched = true;
      this.signupPhoneTouched = true;
      this.signupPasswordTouched = true;
      this.signupConfirmPasswordTouched = true;
      this.cdr.detectChanges();

      if (!this.isFormValid()) {
        return;
      }

      this.serverEmailError = null;
      this.serverPasswordError = null;
      this.isSubmitting = true;

      try {
        const normalizedPhone = this.signupPhone.replace(/\s+/g, '');
        await this.authService.register({
          name: this.signupName,
          email: this.signupEmail,
          phone: normalizedPhone,
          password: this.signupPassword
        });
        this.closeAuthModal();
        this.showToast('Account created successfully! Please sign in.');
      } catch (err: any) {
        console.error('Registration error:', err);
        const serverError = err.error;
        this.serverEmailError = serverError?.error || 'An error occurred during registration.';
        this.cdr.detectChanges();
      } finally {
        this.isSubmitting = false;
        this.cdr.detectChanges();
      }
      return;
    }

    this.emailTouched = true;
    this.phoneTouched = true;
    this.passwordTouched = true;
    this.cdr.detectChanges();

    if (!this.isFormValid()) {
      return;
    }
    
    this.serverEmailError = null;
    this.serverPasswordError = null;
    this.isSubmitting = true;

    const identifier = this.loginTab === 'email' ? this.loginEmail : this.loginPhone;
    
    // Normalize: strip all spaces if it's a phone number
    let normalizedIdentifier = identifier;
    if (this.loginTab === 'phone') {
      normalizedIdentifier = identifier.replace(/\s+/g, '');
    }

    try {
      await this.authService.login(normalizedIdentifier, this.loginPassword);
      this.closeAuthModal();
      this.showToast('Welcome back!');
    } catch (err: any) {
      console.error('Login error:', err);
      const serverError = err.error;
      const errorCode = serverError?.code;
      const errorMessage = serverError?.error || 'An error occurred during login.';

      if (errorCode === 'ACCOUNT_NOT_FOUND' || errorCode === 'ADMIN_NOT_ALLOWED') {
        this.serverEmailError = 'Invalid account';
        setTimeout(() => {
          if (this.loginTab === 'email') {
            this.loginEmailInput?.nativeElement?.focus();
          } else {
            this.loginPhoneInput?.nativeElement?.focus();
          }
        }, 50);
      } else if (errorCode === 'INCORRECT_PASSWORD') {
        this.serverPasswordError = 'Incorrect password';
        setTimeout(() => {
          if (this.loginTab === 'email') {
            this.loginPasswordInput?.nativeElement?.focus();
          } else {
            this.loginPhonePasswordInput?.nativeElement?.focus();
          }
        }, 50);
      } else {
        this.serverEmailError = errorMessage;
      }
      this.cdr.detectChanges();
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }


  loginWithGoogle(): void {
    window.location.href = 'http://localhost:5000/api/auth/oauth/google';
  }

  loginWithFacebook(): void {
    window.location.href = 'http://localhost:5000/api/auth/oauth/facebook';
  }

  showToast(message: string): void {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 99999;
      background: #FAF0EB;
      color: #1a1a1a;
      padding: 16px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-family: 'DM Sans', sans-serif;
      box-shadow: 0px 20px 50px rgba(26, 26, 26, 0.12);
      border: 1px solid rgba(115, 120, 114, 0.1);
      max-width: 320px;
      opacity: 0;
      transform: translateY(-8px);
      transition: opacity 0.25s ease, transform 0.25s ease;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      setTimeout(() => toast.remove(), 300);
    }, 3700);
  }

  @HostListener('document:keydown.escape')
  onEscapeKeydown(): void {
    if (this.isOpen()) {
      this.closeAuthModal();
    }
  }
}
