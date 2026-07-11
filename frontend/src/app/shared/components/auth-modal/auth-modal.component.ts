import { Component, inject, HostListener, ChangeDetectorRef, ElementRef, ViewChild, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideX, LucideEye, LucideEyeOff } from '@lucide/angular';
import { AuthModalService } from '../../../core/auth-modal.service';
import { AuthService } from '../../../core/auth.service';
import { SuccessModalComponent, SuccessModalConfig } from '../success-modal/success-modal.components';
import { Router } from '@angular/router';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideX, LucideEye, LucideEyeOff, SuccessModalComponent],
  templateUrl: './auth-modal.component.html',
  styleUrl: './auth-modal.component.scss'
})
export class AuthModalComponent implements OnDestroy {
  private authModalService = inject(AuthModalService);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router); 

  @ViewChild('loginEmailInput') loginEmailInput!: ElementRef<HTMLInputElement>;
  @ViewChild('loginPhoneInput') loginPhoneInput!: ElementRef<HTMLInputElement>;
  @ViewChild('loginPasswordInput') loginPasswordInput!: ElementRef<HTMLInputElement>;
  @ViewChild('loginPhonePasswordInput') loginPhonePasswordInput!: ElementRef<HTMLInputElement>;
  
  @ViewChild('signupIdentifierInput') signupIdentifierInput!: ElementRef<HTMLInputElement>;
  @ViewChild('signupPasswordInput') signupPasswordInput!: ElementRef<HTMLInputElement>;
  @ViewChild('signupConfirmPasswordInput') signupConfirmPasswordInput!: ElementRef<HTMLInputElement>;
  
  // Input tàng hình hứng OTP
  @ViewChild('hiddenOtpInput') hiddenOtpInput!: ElementRef<HTMLInputElement>;

  isOpen = this.authModalService.isOpen;
  mode = this.authModalService.mode;

  loginTab: 'email' | 'phone' = 'email';
  showPassword = false;
  showConfirmPassword = false;

  // OTP registration flow
  isOtpStep = false;
  registrationId = '';
  registrationEmail = '';
  
  otpValue = ''; // Lưu giá trị thực
  otpDigits: string[] = ['', '', '', '', '', '']; // Mảng để render UI an toàn
  
  otpError: string | null = null;
  otpLocked = false;
  readonly OTP_MAX_ATTEMPTS = 3;
  otpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
  maskedContact = '';
  otpChannel: 'email' | 'phone' = 'email';
  isVerifyingOtp = false;
  isResendingOtp = false;
  otpCountdown = signal(0);
  mockOtp = '';
  private otpTimerHandle: ReturnType<typeof setInterval> | null = null;
  private readonly OTP_DURATION_SECONDS = 2 * 60;

  // Form values
  loginEmail = '';
  loginPhone = '';
  loginPassword = '';

  signupName = '';
  signupIdentifier = '';
  signupPassword = '';
  signupConfirmPassword = '';

  // Touch states
  emailTouched = false;
  phoneTouched = false;
  passwordTouched = false;

  signupNameTouched = false;
  signupIdentifierTouched = false;
  signupPasswordTouched = false;
  signupConfirmPasswordTouched = false;

  // Server errors
  serverEmailError: string | null = null;
  serverPhoneError: string | null = null;
  serverPasswordError: string | null = null;
  serverIdentifierError: string | null = null;
  isSubmitting = false;

  showSuccessModal = false;
  successModalConfig: SuccessModalConfig = {
    title: '',
    subtitle: '',
    primaryBtn: '',
  };

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

  closeOrCancelOtp(): void {
    if (this.mode() === 'signup' && this.isOtpStep) {
      this.backToSignup();
    } else {
      this.closeAuthModal();
    }
  }

  resetForm(): void {
    this.loginEmail = '';
    this.loginPhone = '';
    this.loginPassword = '';
    this.emailTouched = false;
    this.phoneTouched = false;
    this.passwordTouched = false;

    this.signupName = '';
    this.signupIdentifier = '';
    this.signupPassword = '';
    this.signupConfirmPassword = '';
    this.signupNameTouched = false;
    this.signupIdentifierTouched = false;
    this.signupPasswordTouched = false;
    this.signupConfirmPasswordTouched = false;

    this.serverEmailError = null;
    this.serverPhoneError = null;
    this.serverPasswordError = null;
    this.serverIdentifierError = null;
    this.isSubmitting = false;

    this.clearOtpCountdown();
    this.isOtpStep = false;
    this.registrationId = '';
    this.registrationEmail = '';
    this.otpValue = '';
    this.otpDigits = ['', '', '', '', '', ''];
    this.otpError = null;
    this.otpLocked = false;
    this.otpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
    this.maskedContact = '';
    this.mockOtp = '';
    this.isVerifyingOtp = false;
    this.isResendingOtp = false;
  }

  onEmailBlur(): void { this.emailTouched = true; }
  onPhoneBlur(): void { this.phoneTouched = true; }
  onPasswordBlur(): void { this.passwordTouched = true; }

  get emailError(): string | null {
    if (!this.loginEmail) return this.emailTouched ? 'Email is required' : null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.loginEmail)) return 'Invalid email format';
    return null;
  }

  get phoneError(): string | null {
    if (!this.loginPhone) return this.phoneTouched ? 'Phone number is required' : null;
    const normalized = this.loginPhone.replace(/\s+/g, '');
    if (!/^\d+$/.test(normalized)) return 'Phone number must contain digits and spaces only';
    if (normalized.length < 10 || normalized.length > 11) return 'Phone number must be 10 to 11 digits';
    return null;
  }

  get passwordError(): string | null {
    if (!this.loginPassword) return this.passwordTouched ? 'Password is required' : null;
    if (this.loginPassword.length < 8 || this.loginPassword.length > 15) return 'Password must be 8-15 characters';
    if (/\s/.test(this.loginPassword)) return 'Password cannot contain spaces';
    return null;
  }

  get signupNameError(): string | null {
    if (!this.signupName) return this.signupNameTouched ? 'Full name is required' : null;
    return null;
  }

  get signupIdentifierError(): string | null {
    if (!this.signupIdentifier) return this.signupIdentifierTouched ? 'Email or phone is required' : null;
    const val = this.signupIdentifier.trim();
    const isEmail = val.includes('@');
    if (isEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(val)) return 'Invalid email format';
    } else {
      const normalizedPhone = val.replace(/\s+/g, '');
      if (!/^\d+$/.test(normalizedPhone)) return 'Phone number must contain digits only';
      if (normalizedPhone.length < 10 || normalizedPhone.length > 11) return 'Phone number must be 10 to 11 digits';
    }
    return null;
  }

  get signupPasswordError(): string | null {
    if (!this.signupPassword) return this.signupPasswordTouched ? 'Password is required' : null;
    if (this.signupPassword.length < 8 || this.signupPassword.length > 15) return 'Password must be 8-15 characters';
    if (/\s/.test(this.signupPassword)) return 'Password cannot contain spaces';
    return null;
  }

  get signupConfirmPasswordError(): string | null {
    if (!this.signupConfirmPassword) return this.signupConfirmPasswordTouched ? 'Confirm password is required' : null;
    if (this.signupConfirmPassword !== this.signupPassword) return 'Passwords do not match';
    return null;
  }

  get signupPasswordStrengthScore(): number {
    const p = this.signupPassword;
    if (!p) return 0;
    const hasLower = /[a-z]/.test(p);
    const hasUpper = /[A-Z]/.test(p);
    const hasDigit = /[0-9]/.test(p);
    const hasSpecial = /[^A-Za-z0-9]/.test(p);
    const groupsCount = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);

    if (p.length < 8) return 1;
    if (p.length >= 10 && groupsCount >= 3) return 3; 
    if (groupsCount >= 2) return 2; 
    return 1; 
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
      const identifierValid = this.signupIdentifierError === null && this.signupIdentifier.trim() !== '';
      const passwordValid = this.signupPassword.length >= 8 && this.signupPassword.length <= 15 && !/\s/.test(this.signupPassword);
      const confirmValid = this.signupPassword === this.signupConfirmPassword;
      return nameValid && identifierValid && passwordValid && confirmValid;
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

  togglePasswordVisibility(): void { this.showPassword = !this.showPassword; }
  toggleConfirmPasswordVisibility(): void { this.showConfirmPassword = !this.showConfirmPassword; }

  async onSubmitAuth(event: Event): Promise<void> {
    if (event) event.preventDefault();

    if (this.mode() === 'signup') {
      if (this.signupIdentifierInput?.nativeElement) this.signupIdentifier = this.signupIdentifierInput.nativeElement.value;
      if (this.signupPasswordInput?.nativeElement) this.signupPassword = this.signupPasswordInput.nativeElement.value;
      if (this.signupConfirmPasswordInput?.nativeElement) this.signupConfirmPassword = this.signupConfirmPasswordInput.nativeElement.value;

      this.signupNameTouched = true;
      this.signupIdentifierTouched = true;
      this.signupPasswordTouched = true;
      this.signupConfirmPasswordTouched = true;
      this.cdr.detectChanges();

      if (!this.isFormValid()) return;

      this.serverIdentifierError = null;
      this.isSubmitting = true;

      try {
        const val = this.signupIdentifier.trim();
        const isEmail = val.includes('@');
        const submitEmail = isEmail ? val : '';
        const submitPhone = isEmail ? '' : val.replace(/\s+/g, '');

        const response = await this.authService.register({
          name: this.signupName,
          email: submitEmail,
          phone: submitPhone,
          password: this.signupPassword
        });

        this.registrationId = response.registration_id;
        this.registrationEmail = submitEmail;
        this.maskedContact = response.maskedContact || '';
        this.otpChannel = response.channel || 'email';
        this.mockOtp = response.__mock || '';

        this.otpLocked = false;
        this.otpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
        this.otpError = null;
        this.otpValue = ''; 
        this.otpDigits = ['', '', '', '', '', ''];
        this.isOtpStep = true;
        this.startOtpCountdown(this.OTP_DURATION_SECONDS);
        this.cdr.detectChanges();
        setTimeout(() => this.focusHiddenInput(), 50);

      } catch (err: any) {
        const errorCode = err?.code;
        if (errorCode === 'EMAIL_EXISTS' || errorCode === 'PHONE_EXISTS') {
          this.serverIdentifierError = 'This email or phone is already registered.';
        } else {
          this.serverIdentifierError = 'An error occurred during registration. Please try again.';
        }
        this.cdr.detectChanges();
      } finally {
        this.isSubmitting = false;
        this.cdr.detectChanges();
      }
      return;
    }

    if (this.loginTab === 'email') {
      if (this.loginEmailInput?.nativeElement) this.loginEmail = this.loginEmailInput.nativeElement.value;
      if (this.loginPasswordInput?.nativeElement) this.loginPassword = this.loginPasswordInput.nativeElement.value;
    } else {
      if (this.loginPhoneInput?.nativeElement) this.loginPhone = this.loginPhoneInput.nativeElement.value;
      if (this.loginPhonePasswordInput?.nativeElement) this.loginPassword = this.loginPhonePasswordInput.nativeElement.value;
    }

    this.emailTouched = true;
    this.phoneTouched = true;
    this.passwordTouched = true;
    this.cdr.detectChanges();

    if (!this.isFormValid()) {
      if (this.loginTab === 'phone' && !this.phoneError) {
        this.serverEmailError = 'Please check your phone number and password.';
      } else if (this.loginTab === 'email' && !this.emailError) {
        this.serverEmailError = 'Please check your email and password.';
      }
      this.cdr.detectChanges();
      return;
    }
    
    this.serverEmailError = null;
    this.serverPasswordError = null;
    this.isSubmitting = true;

    const identifier = this.loginTab === 'email' ? this.loginEmail : this.loginPhone;
    let normalizedIdentifier = identifier;
    if (this.loginTab === 'phone') {
      normalizedIdentifier = identifier.replace(/\s+/g, '');
    }

    try {
      await this.authService.login(normalizedIdentifier, this.loginPassword);
      this.closeAuthModal();

      const isOnHomepage = this.router.url === '/';
      this.successModalConfig = {
        title: 'Log In Successfully',
        subtitle: "Welcome back! You're now signed in.",
        primaryBtn: 'CONTINUE',
        ...(isOnHomepage ? {} : { secondaryBtn: 'BACK TO HOMEPAGE' })
      };
      this.showSuccessModal = true;
      this.cdr.detectChanges();
    } catch (err: any) {
        const errorCode = err?.code;
        if (errorCode === 'ACCOUNT_NOT_FOUND') {
          this.serverEmailError = 'Email or phone not found.';
          setTimeout(() => {
            if (this.loginTab === 'email') this.loginEmailInput?.nativeElement?.focus();
            else this.loginPhoneInput?.nativeElement?.focus();
          }, 50);
        } else if (errorCode === 'OAUTH_ACCOUNT') {
          this.serverEmailError = 'This account was registered with Google or Facebook. Please continue with the same method.';
        } else if (errorCode === 'ADMIN_NOT_ALLOWED') {
          this.serverEmailError = 'Admin accounts cannot log in here.';
        } else if (errorCode === 'INCORRECT_PASSWORD') {
          this.serverPasswordError = 'Incorrect password.';
          setTimeout(() => {
            if (this.loginTab === 'email') this.loginPasswordInput?.nativeElement?.focus();
            else this.loginPhonePasswordInput?.nativeElement?.focus();
          }, 50);
        } else {
          this.serverEmailError = 'An error occurred during login. Please try again.';
        }
        this.cdr.detectChanges();
    } finally {
        this.isSubmitting = false;
        this.cdr.detectChanges();
    }
  }

  // ══════════════ OTP verification step ══════════════

  private startOtpCountdown(seconds: number): void {
    this.clearOtpCountdown();
    this.otpCountdown.set(seconds);
    this.otpTimerHandle = setInterval(() => {
      this.otpCountdown.update(v => v - 1);
      if (this.otpCountdown() <= 0) {
        this.otpCountdown.set(0);
        this.clearOtpCountdown();
      }
    }, 1000);
  }

  private clearOtpCountdown(): void {
    if (this.otpTimerHandle) {
      clearInterval(this.otpTimerHandle);
      this.otpTimerHandle = null;
    }
  }

  get otpCountdownLabel(): string {
    const m = Math.floor(this.otpCountdown() / 60);
    const s = this.otpCountdown() % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  get canResendOtp(): boolean {
    return this.otpCountdown() <= 0;
  }

  trackByFn(index: number): number {
    return index;
  }

  focusHiddenInput(): void {
    if (this.hiddenOtpInput?.nativeElement) {
      this.hiddenOtpInput.nativeElement.focus();
    }
  }

  // Xử lý khi user nhập vào ô tàng hình
  onHiddenOtpInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let val = input.value.replace(/\D/g, ''); // Ép chỉ giữ lại số

    if (val.length > 6) {
      val = val.substring(0, 6);
    }

    this.otpValue = val;
    input.value = val; // Force override lại input

    // Tự động map giá trị sang mảng hiển thị UI
    for (let i = 0; i < 6; i++) {
      this.otpDigits[i] = val[i] || '';
    }

    this.cdr.detectChanges();

    if (this.otpValue.length === 6) {
      this.verifyOtp();
    }
  }

  async verifyOtp(): Promise<void> {
    if (this.isVerifyingOtp || this.otpLocked || !this.registrationId) return;
    if (this.otpValue.length !== 6) return;

    this.otpError = null;
    this.isVerifyingOtp = true;
    this.cdr.detectChanges();

    try {
      await this.authService.verifyRegistrationOtp(this.registrationId, this.otpValue);

      this.clearOtpCountdown();
      this.closeAuthModal();

      const isOnHomepage = this.router.url === '/';
      this.successModalConfig = {
        title: 'Signed Up Successfully',
        subtitle: 'Welcome to Offsite!',
        primaryBtn: 'CONTINUE',
        ...(isOnHomepage ? {} : { secondaryBtn: 'BACK TO HOMEPAGE' })
      };
      this.showSuccessModal = true;
      this.cdr.detectChanges();
    } catch (err: any) {
      const code = err?.code;

      if (code === 'OTP_LOCKED') {
        this.otpLocked = true;
        this.otpAttemptsLeft = 0;
        this.clearOtpCountdown();
      } else if (code === 'OTP_EXPIRED') {
        this.otpError = 'This code has expired. Please resend a new code.';
        this.clearOtpCountdown();
      } else if (code === 'REGISTRATION_NOT_FOUND') {
        this.otpError = 'Session expired. Please sign up again.';
        this.clearOtpCountdown();
        setTimeout(() => this.backToSignup(), 1500);
      } else {
        this.otpAttemptsLeft = typeof err?.remainingAttempts === 'number'
          ? err.remainingAttempts
          : Math.max(0, this.otpAttemptsLeft - 1);

        this.otpError = 'Incorrect code. Please try again.';

        if (this.otpAttemptsLeft <= 0) {
          this.otpLocked = true;
          this.clearOtpCountdown();
        }
      }

      this.otpValue = ''; 
      this.otpDigits = ['', '', '', '', '', ''];
      setTimeout(() => this.focusHiddenInput(), 50);
    } finally {
      this.isVerifyingOtp = false;
      this.cdr.detectChanges();
    }
  }

  async resendOtp(): Promise<void> {
    if (this.isResendingOtp || !this.registrationId || (!this.canResendOtp && !this.otpLocked)) return;

    this.isResendingOtp = true;
    this.cdr.detectChanges();

    try {
      const res = await this.authService.resendRegistrationOtp(this.registrationId);
      this.maskedContact = res.maskedContact || this.maskedContact;
      this.mockOtp = res.__mock || '';
      this.otpLocked = false;
      this.otpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
      this.otpError = null;
      this.otpValue = '';
      this.otpDigits = ['', '', '', '', '', ''];
      this.startOtpCountdown(this.OTP_DURATION_SECONDS);
      setTimeout(() => this.focusHiddenInput(), 50);
    } catch (err: any) {
      this.otpError = err?.code === 'REGISTRATION_NOT_FOUND'
        ? 'Session expired. Please sign up again.'
        : 'Could not resend code. Please try again.';
      if (err?.code === 'REGISTRATION_NOT_FOUND') {
        setTimeout(() => this.backToSignup(), 1500);
      }
    } finally {
      this.isResendingOtp = false;
      this.cdr.detectChanges();
    }
  }

  backToSignup(): void {
    this.clearOtpCountdown();
    this.isOtpStep = false;
    this.otpLocked = false;
    this.registrationId = '';
    this.maskedContact = '';
    this.mockOtp = '';
    this.otpError = null;
    this.otpValue = '';
    this.otpDigits = ['', '', '', '', '', ''];
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    this.clearOtpCountdown();
  }

  loginWithGoogle(): void {
    window.location.href = 'http://localhost:5000/api/auth/oauth/google';
  }

  loginWithFacebook(): void {
    window.location.href = 'http://localhost:5000/api/auth/oauth/facebook';
  }

  onSuccessPrimary(): void {
    this.showSuccessModal = false;
    if (this.successModalConfig.primaryBtn === 'LOG IN') {
      this.closeAuthModal();
      this.authModalService.open('login');
    } else if (this.successModalConfig.primaryBtn === 'CONTINUE') {
      this.closeAuthModal();
    } else {
      this.closeAuthModal();
      this.router.navigate(['/']);
    }
  }

  onSuccessSecondary(): void {
    this.showSuccessModal = false;
    if (this.successModalConfig.secondaryBtn === 'BACK TO HOMEPAGE') {
      this.closeAuthModal();
      this.router.navigate(['/']);
    } else if (this.successModalConfig.secondaryBtn === 'SIGN OUT') {
      this.closeAuthModal();
      this.authService.logout();
    } else {
      this.closeAuthModal();
    }
  }

  onSuccessClose(): void {
    this.showSuccessModal = false;
    this.closeAuthModal();
  }

  @HostListener('document:keydown.escape')
  onEscapeKeydown(): void {
    if (this.isOpen()) {
      this.closeOrCancelOtp();
    }
  }
}