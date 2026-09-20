import { Component, inject, HostListener, ChangeDetectorRef, ElementRef, ViewChild, OnDestroy, AfterViewInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideX, LucideEye, LucideEyeOff } from '@lucide/angular';
import { AuthModalService } from '../../../core/auth-modal.service';
import { AuthService } from '../../../core/auth.service';
import { SuccessModalComponent, SuccessModalConfig } from '../success-modal/success-modal.components';
import { Router, RouterModule } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { InlineValidator, FieldConfig } from '../../utils/inline-validator';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, LucideX, LucideEye, LucideEyeOff, SuccessModalComponent],
  templateUrl: './auth-modal.component.html',
  styleUrl: './auth-modal.component.scss'
})
export class AuthModalComponent implements AfterViewInit, OnDestroy {
  private authModalService = inject(AuthModalService);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router); 

  @ViewChild('loginEmailInput') loginEmailInput!: ElementRef<HTMLInputElement>;
  @ViewChild('loginPhoneInput') loginPhoneInput!: ElementRef<HTMLInputElement>;
  @ViewChild('loginPasswordInput') loginPasswordInput!: ElementRef<HTMLInputElement>;
  @ViewChild('loginPhonePasswordInput') loginPhonePasswordInput!: ElementRef<HTMLInputElement>;
  
  @ViewChild('signupNameInput') signupNameInput!: ElementRef<HTMLInputElement>;
  @ViewChild('signupEmailInput') signupEmailInput!: ElementRef<HTMLInputElement>;
  @ViewChild('signupPhoneInput') signupPhoneInput!: ElementRef<HTMLInputElement>;
  @ViewChild('signupPasswordInput') signupPasswordInput!: ElementRef<HTMLInputElement>;
  @ViewChild('signupConfirmPasswordInput') signupConfirmPasswordInput!: ElementRef<HTMLInputElement>;
  
  // Input tàng hình hứng OTP
  @ViewChild('hiddenOtpInput') hiddenOtpInput!: ElementRef<HTMLInputElement>;

  // Forgot password
  @ViewChild('forgotIdentifierInput') forgotIdentifierInput!: ElementRef<HTMLInputElement>;
  @ViewChild('hiddenForgotOtpInput') hiddenForgotOtpInput!: ElementRef<HTMLInputElement>;

  isOpen = this.authModalService.isOpen;
  mode = this.authModalService.mode;

  signupValidator: InlineValidator | null = null;

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
  signupEmail = '';
  signupPhone = '';
  signupPassword = '';
  signupConfirmPassword = '';

  // Touch states
  emailTouched = false;
  phoneTouched = false;
  passwordTouched = false;

  signupNameTouched = false;
  signupEmailTouched = false;
  signupPhoneTouched = false;
  signupPasswordTouched = false;
  signupConfirmPasswordTouched = false;

  // Server errors
  serverEmailError: string | null = null;
  serverPhoneError: string | null = null;
  serverPasswordError: string | null = null;
  isSubmitting = false;

  showSuccessModal = false;
  successModalConfig: SuccessModalConfig = {
    title: '',
    subtitle: '',
    primaryBtn: '',
  };

  // ══════════════ Forgot password flow ══════════════
  forgotStep: 'request' | 'reset' = 'request';
  forgotIdentifier = '';
  forgotIdentifierTouched = false;
  serverForgotError: string | null = null;
  isSendingForgotOtp = false;
  mockForgotOtp = '';

  forgotOtpValue = '';
  forgotOtpDigits: string[] = ['', '', '', '', '', ''];
  forgotOtpError: string | null = null;
  forgotOtpLocked = false;
  forgotOtpAttemptsLeft = this.OTP_MAX_ATTEMPTS;

  forgotNewPassword = '';
  forgotConfirmPassword = '';
  forgotNewPasswordTouched = false;
  forgotConfirmPasswordTouched = false;
  showForgotPassword = false;
  showForgotConfirmPassword = false;
  isResettingPassword = false;

  setLoginTab(tab: 'email' | 'phone'): void {
    this.loginTab = tab;
    this.resetForm();
  }

  setAuthModalMode(mode: 'login' | 'signup'): void {
    this.authModalService.setMode(mode);
    this.showPassword = false;
    this.showConfirmPassword = false;
    this.resetForm();
    if (mode === 'signup') {
      setTimeout(() => this.setupSignupValidator(), 50);
    } else {
      this.cleanupSignupValidator();
    }
  }

  closeAuthModal(): void {
    this.authModalService.close();
    this.resetForm();
  }

  closeOrCancelOtp(): void {
    if (this.mode() === 'signup' && this.isOtpStep) {
      this.backToSignup();
    } else if (this.mode() === 'forgot' && this.forgotStep === 'reset') {
      this.cancelForgotOtp();
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
    this.serverPhoneError = null;
    this.serverPasswordError = null;
    this.isSubmitting = false;

    if (this.signupValidator) {
      this.signupValidator.clearAll();
    }

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

    this.resetForgotState();
  }

  private resetForgotState(): void {
    this.forgotStep = 'request';
    this.forgotIdentifier = '';
    this.forgotIdentifierTouched = false;
    this.serverForgotError = null;
    this.isSendingForgotOtp = false;
    this.mockForgotOtp = '';

    this.forgotOtpValue = '';
    this.forgotOtpDigits = ['', '', '', '', '', ''];
    this.forgotOtpError = null;
    this.forgotOtpLocked = false;
    this.forgotOtpAttemptsLeft = this.OTP_MAX_ATTEMPTS;

    this.forgotNewPassword = '';
    this.forgotConfirmPassword = '';
    this.forgotNewPasswordTouched = false;
    this.forgotConfirmPasswordTouched = false;
    this.showForgotPassword = false;
    this.showForgotConfirmPassword = false;
    this.isResettingPassword = false;
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

  get signupEmailError(): string | null {
    const emailVal = this.signupEmail ? this.signupEmail.trim() : '';
    const phoneVal = this.signupPhone ? this.signupPhone.trim() : '';

    if (!emailVal) {
      if (!phoneVal && (this.signupEmailTouched || this.signupPhoneTouched)) {
        return 'Either email or phone number is required';
      }
      return null;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailVal)) return 'Invalid email format';
    return null;
  }

  get signupPhoneError(): string | null {
    const emailVal = this.signupEmail ? this.signupEmail.trim() : '';
    const phoneVal = this.signupPhone ? this.signupPhone.trim() : '';

    if (!phoneVal) {
      if (!emailVal && (this.signupEmailTouched || this.signupPhoneTouched)) {
        return 'Either email or phone number is required';
      }
      return null;
    }

    const normalizedPhone = phoneVal.replace(/\s+/g, '');
    if (!/^\d+$/.test(normalizedPhone)) return 'Phone number must contain digits only';
    if (normalizedPhone.length < 10 || normalizedPhone.length > 11) return 'Phone number must be 10 to 11 digits';
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

  // ══════════════ Forgot password getters ══════════════
  get forgotIdentifierError(): string | null {
    if (!this.forgotIdentifier) return this.forgotIdentifierTouched ? 'Email or phone is required' : null;
    const val = this.forgotIdentifier.trim();
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

  get forgotNewPasswordError(): string | null {
    if (!this.forgotNewPassword) return this.forgotNewPasswordTouched ? 'New password is required' : null;
    if (this.forgotNewPassword.length < 8 || this.forgotNewPassword.length > 15) return 'Password must be 8-15 characters';
    if (/\s/.test(this.forgotNewPassword)) return 'Password cannot contain spaces';
    return null;
  }

  get forgotConfirmPasswordError(): string | null {
    if (!this.forgotConfirmPassword) return this.forgotConfirmPasswordTouched ? 'Confirm password is required' : null;
    if (this.forgotConfirmPassword !== this.forgotNewPassword) return 'Passwords do not match';
    return null;
  }

  get isForgotResetFormValid(): boolean {
    const p = this.forgotNewPassword;
    const validNewPassword = !!p && p.length >= 8 && p.length <= 15 && !/\s/.test(p);
    const validConfirmPassword = !!this.forgotConfirmPassword && this.forgotConfirmPassword === p;
    return validNewPassword && validConfirmPassword;
  }

  get forgotPasswordStrengthScore(): number {
    const p = this.forgotNewPassword;
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

  get forgotPasswordStrengthLabel(): string {
    const score = this.forgotPasswordStrengthScore;
    if (score === 3) return 'STRONG';
    if (score === 2) return 'MEDIUM';
    if (score === 1) return 'WEAK';
    return '';
  }

  isFormValid(): boolean {
    if (this.mode() === 'signup') {
      if (!this.signupValidator) {
        this.setupSignupValidator();
      }
      return this.signupValidator ? this.signupValidator.checkAllValid() : false;
    }
    if (this.loginTab === 'email') {
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.loginEmail);
      const passwordValid = !!this.loginPassword && this.loginPassword.length >= 8 && this.loginPassword.length <= 15 && !/\s/.test(this.loginPassword);
      return emailValid && passwordValid;
    } else {
      const normalizedPhone = this.loginPhone.replace(/\s+/g, '');
      const phoneValid = /^\d{10,11}$/.test(normalizedPhone);
      const passwordValid = !!this.loginPassword && this.loginPassword.length >= 8 && this.loginPassword.length <= 15 && !/\s/.test(this.loginPassword);
      return phoneValid && passwordValid;
    }
  }

  togglePasswordVisibility(): void { this.showPassword = !this.showPassword; }
  toggleConfirmPasswordVisibility(): void { this.showConfirmPassword = !this.showConfirmPassword; }

  ngAfterViewInit(): void {
    if (this.isOpen() && this.mode() === 'signup') {
      setTimeout(() => this.setupSignupValidator(), 50);
    }
  }

  setupSignupValidator(): void {
    if (typeof window === 'undefined') return;

    this.cleanupSignupValidator();

    const signupConfigs: FieldConfig[] = [
      {
        field_id: 'signup-name',
        error_element_id: 'signup-name-error',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            regex_pattern: '^\\s*$',
            error_message: 'Full name is required'
          }
        ]
      },
      {
        field_id: 'signup-email',
        error_element_id: 'signup-email-error',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            condition: '!value.trim() && !document.getElementById("signup-phone")?.value?.trim()',
            error_message: 'Either email or phone number is required'
          },
          {
            sequence: 2,
            type: 'FORMAT_CHECK',
            condition: 'value.trim() !== "" && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value.trim())',
            error_message: 'Invalid email format'
          }
        ]
      },
      {
        field_id: 'signup-phone',
        error_element_id: 'signup-phone-error',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            condition: '!value.trim() && !document.getElementById("signup-email")?.value?.trim()',
            error_message: 'Either email or phone number is required'
          },
          {
            sequence: 2,
            type: 'FORMAT_CHECK',
            condition: 'value.trim() !== "" && /[^0-9 ]/.test(value.trim())',
            error_message: 'Phone number must contain digits only'
          },
          {
            sequence: 3,
            type: 'FORMAT_CHECK',
            condition: 'value.trim() !== "" && (/^[0-9 ]+$/.test(value.trim()) && (value.replace(/\\s+/g, "").length < 10 || value.replace(/\\s+/g, "").length > 11))',
            error_message: 'Phone number must be 10 to 11 digits'
          }
        ]
      },
      {
        field_id: 'signup-password',
        error_element_id: 'signup-password-error',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            regex_pattern: '^\\s*$',
            error_message: 'Password is required'
          },
          {
            sequence: 2,
            type: 'FORMAT_CHECK',
            condition: 'value.length < 8 || value.length > 15',
            error_message: 'Password must be 8-15 characters'
          },
          {
            sequence: 3,
            type: 'FORMAT_CHECK',
            condition: '/\\s/.test(value)',
            error_message: 'Password cannot contain spaces'
          }
        ]
      },
      {
        field_id: 'signup-confirm-password',
        error_element_id: 'signup-confirm-password-error',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            regex_pattern: '^\\s*$',
            error_message: 'Confirm password is required'
          },
          {
            sequence: 2,
            type: 'FORMAT_CHECK',
            condition: 'value !== document.getElementById("signup-password")?.value',
            error_message: 'Passwords do not match'
          }
        ]
      }
    ];

    this.signupValidator = new InlineValidator(signupConfigs);
    const container = document.querySelector('.auth-modal-card');
    if (container) {
      this.signupValidator.attach(container as HTMLElement);
    } else {
      this.signupValidator.attach();
    }
  }

  cleanupSignupValidator(): void {
    if (this.signupValidator) {
      this.signupValidator.detach();
      this.signupValidator = null;
    }
  }

  onSignupFieldInput(field: string, event?: Event): void {
    const val = event?.target ? (event.target as HTMLInputElement).value : undefined;

    if (field === 'email') {
      if (val !== undefined) this.signupEmail = val;
      this.serverEmailError = null;
      if (this.signupValidator) {
        this.signupValidator.validateField('signup-email');
        this.signupValidator.validateField('signup-phone');
      }
    } else if (field === 'phone') {
      if (val !== undefined) this.signupPhone = val;
      this.serverPhoneError = null;
      if (this.signupValidator) {
        this.signupValidator.validateField('signup-phone');
        this.signupValidator.validateField('signup-email');
      }
    } else if (field === 'password') {
      if (val !== undefined) this.signupPassword = val;
      if (this.signupValidator) {
        this.signupValidator.validateField('signup-password');
        this.signupValidator.validateField('signup-confirm-password');
      }
    } else if (field === 'confirmPassword') {
      if (val !== undefined) this.signupConfirmPassword = val;
      if (this.signupValidator) {
        this.signupValidator.validateField('signup-confirm-password');
      }
    } else if (field === 'name') {
      if (val !== undefined) this.signupName = val;
      if (this.signupValidator) {
        this.signupValidator.validateField('signup-name');
      }
    }
  }

  async onSubmitAuth(event: Event): Promise<void> {
    if (event) event.preventDefault();

    if (this.mode() === 'signup') {
      if (this.signupNameInput?.nativeElement) this.signupName = this.signupNameInput.nativeElement.value;
      if (this.signupEmailInput?.nativeElement) this.signupEmail = this.signupEmailInput.nativeElement.value;
      if (this.signupPhoneInput?.nativeElement) this.signupPhone = this.signupPhoneInput.nativeElement.value;
      if (this.signupPasswordInput?.nativeElement) this.signupPassword = this.signupPasswordInput.nativeElement.value;
      if (this.signupConfirmPasswordInput?.nativeElement) this.signupConfirmPassword = this.signupConfirmPasswordInput.nativeElement.value;

      this.signupNameTouched = true;
      this.signupEmailTouched = true;
      this.signupPhoneTouched = true;
      this.signupPasswordTouched = true;
      this.signupConfirmPasswordTouched = true;
      this.cdr.detectChanges();

      if (!this.signupValidator) {
        this.setupSignupValidator();
      }

      const isFormValid = this.signupValidator ? this.signupValidator.validateAll() : true;
      if (!isFormValid) {
        setTimeout(() => {
          const firstInvalidInput = document.querySelector('.auth-modal-card .auth-input.input-error, .auth-modal-card .auth-input.invalid') as HTMLInputElement | null;
          if (firstInvalidInput) {
            firstInvalidInput.focus();
            firstInvalidInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
        return;
      }

      this.serverEmailError = null;
      this.serverPhoneError = null;
      this.isSubmitting = true;

      try {
        const submitEmail = this.signupEmail ? this.signupEmail.trim() : '';
        const submitPhone = this.signupPhone ? this.signupPhone.trim().replace(/\s+/g, '') : '';

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
        const errorMessage = err?.error || err?.message;

        if (errorCode === 'EMAIL_EXISTS') {
          const msg = 'This email is already registered.';
          this.serverEmailError = msg;
          this.signupValidator?.setErrorField('signup-email', msg);
          setTimeout(() => {
            const emailEl = document.getElementById('signup-email') as HTMLInputElement | null;
            if (emailEl) {
              emailEl.focus();
              emailEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 50);
        } else if (errorCode === 'PHONE_EXISTS') {
          const msg = 'This phone number is already registered.';
          this.serverPhoneError = msg;
          this.signupValidator?.setErrorField('signup-phone', msg);
          setTimeout(() => {
            const phoneEl = document.getElementById('signup-phone') as HTMLInputElement | null;
            if (phoneEl) {
              phoneEl.focus();
              phoneEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 50);
        } else {
          const msg = errorMessage || 'An error occurred during registration. Please try again.';
          this.serverEmailError = msg;
          this.signupValidator?.setErrorField('signup-email', msg);
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

  // ══════════════ Forgot password flow ══════════════

  openForgotPassword(): void {
    // Mang theo sẵn giá trị user vừa gõ ở tab đang active, khỏi bắt gõ lại
    const prefill = this.loginTab === 'email' ? this.loginEmail : this.loginPhone;
    this.forgotIdentifier = prefill ? prefill.trim() : '';
    this.forgotIdentifierTouched = false;
    this.serverForgotError = null;
    this.forgotStep = 'request';
    this.authModalService.setMode('forgot');
    this.cdr.detectChanges();
    setTimeout(() => this.forgotIdentifierInput?.nativeElement?.focus(), 50);
  }

  backToLoginFromForgot(): void {
    this.clearOtpCountdown();
    this.resetForgotState();
    this.authModalService.setMode('login');
    this.cdr.detectChanges();
  }

  cancelForgotOtp(): void {
    this.clearOtpCountdown();
    this.forgotStep = 'request';
    this.forgotOtpValue = '';
    this.forgotOtpDigits = ['', '', '', '', '', ''];
    this.forgotOtpError = null;
    this.forgotOtpLocked = false;
    this.forgotOtpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
    this.mockForgotOtp = '';
    this.forgotNewPassword = '';
    this.forgotConfirmPassword = '';
    this.forgotNewPasswordTouched = false;
    this.forgotConfirmPasswordTouched = false;
    this.cdr.detectChanges();
  }

  toggleForgotPasswordVisibility(): void { this.showForgotPassword = !this.showForgotPassword; }
  toggleForgotConfirmPasswordVisibility(): void { this.showForgotConfirmPassword = !this.showForgotConfirmPassword; }

  async sendForgotOtp(event?: Event): Promise<void> {
    if (event) event.preventDefault();

    this.forgotIdentifierTouched = true;
    this.cdr.detectChanges();
    if (this.forgotIdentifierError || !this.forgotIdentifier.trim()) return;

    this.serverForgotError = null;
    this.isSendingForgotOtp = true;
    this.cdr.detectChanges();

    try {
      const res = await this.authService.forgotPassword(this.forgotIdentifier.trim());
      this.mockForgotOtp = res?.__mock || '';
      this.forgotOtpValue = '';
      this.forgotOtpDigits = ['', '', '', '', '', ''];
      this.forgotOtpError = null;
      this.forgotOtpLocked = false;
      this.forgotOtpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
      this.forgotStep = 'reset';
      this.startOtpCountdown(this.OTP_DURATION_SECONDS);
      this.cdr.detectChanges();
      setTimeout(() => this.focusHiddenForgotInput(), 50);
    } catch (err: any) {
      this.serverForgotError = err?.error || 'Could not send code. Please try again.';
      this.cdr.detectChanges();
    } finally {
      this.isSendingForgotOtp = false;
      this.cdr.detectChanges();
    }
  }

  async resendForgotOtp(): Promise<void> {
    if (this.isSendingForgotOtp || (!this.canResendOtp && !this.forgotOtpLocked)) return;

    this.isSendingForgotOtp = true;
    this.cdr.detectChanges();

    try {
      const res = await this.authService.forgotPassword(this.forgotIdentifier.trim());
      this.mockForgotOtp = res?.__mock || '';
      this.forgotOtpValue = '';
      this.forgotOtpDigits = ['', '', '', '', '', ''];
      this.forgotOtpError = null;
      this.forgotOtpLocked = false;
      this.forgotOtpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
      this.startOtpCountdown(this.OTP_DURATION_SECONDS);
      setTimeout(() => this.focusHiddenForgotInput(), 50);
    } catch (err: any) {
      this.forgotOtpError = err?.error || 'Could not resend code. Please try again.';
    } finally {
      this.isSendingForgotOtp = false;
      this.cdr.detectChanges();
    }
  }

  focusHiddenForgotInput(): void {
    if (this.hiddenForgotOtpInput?.nativeElement) {
      this.hiddenForgotOtpInput.nativeElement.focus();
    }
  }

  onHiddenForgotOtpInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let val = input.value.replace(/\D/g, '');

    if (val.length > 6) {
      val = val.substring(0, 6);
    }

    this.forgotOtpValue = val;
    input.value = val;

    for (let i = 0; i < 6; i++) {
      this.forgotOtpDigits[i] = val[i] || '';
    }
    this.forgotOtpError = null;
    this.cdr.detectChanges();
  }

  async submitResetPassword(event?: Event): Promise<void> {
    if (event) event.preventDefault();

    this.forgotNewPasswordTouched = true;
    this.forgotConfirmPasswordTouched = true;
    this.cdr.detectChanges();

    if (this.forgotOtpLocked) return;
    if (this.forgotOtpValue.length !== 6) {
      this.forgotOtpError = 'Please enter the 6-digit code.';
      this.cdr.detectChanges();
      return;
    }
    if (this.canResendOtp) {
      this.forgotOtpError = 'This code has expired. Please resend a new one.';
      this.cdr.detectChanges();
      return;
    }
    if (this.forgotNewPasswordError || this.forgotConfirmPasswordError) return;

    this.forgotOtpError = null;
    this.isResettingPassword = true;
    this.cdr.detectChanges();

    try {
      await this.authService.resetPassword(this.forgotIdentifier.trim(), this.forgotOtpValue, this.forgotNewPassword);
      this.clearOtpCountdown();

      const identifier = this.forgotIdentifier.trim();
      const isEmail = identifier.includes('@');

      this.resetForgotState();
      this.authModalService.setMode('login');

      if (isEmail) {
        this.loginTab = 'email';
        this.loginEmail = identifier;
      } else {
        this.loginTab = 'phone';
        this.loginPhone = identifier;
      }
      this.loginPassword = '';

      this.cdr.detectChanges();
    } catch (err: any) {
      const code = err?.code;
      if (code === 'OTP_LOCKED') {
        this.forgotOtpLocked = true;
        this.forgotOtpAttemptsLeft = 0;
        this.clearOtpCountdown();
      } else if (code === 'OTP_EXPIRED') {
        this.forgotOtpError = 'This code has expired. Please resend a new code.';
        this.clearOtpCountdown();
      } else {
        this.forgotOtpAttemptsLeft = typeof err?.remainingAttempts === 'number'
          ? err.remainingAttempts
          : Math.max(0, this.forgotOtpAttemptsLeft - 1);

        this.forgotOtpError = 'Incorrect code. Please try again.';

        if (this.forgotOtpAttemptsLeft <= 0) {
          this.forgotOtpLocked = true;
          this.clearOtpCountdown();
        }
      }

      this.forgotOtpValue = '';
      this.forgotOtpDigits = ['', '', '', '', '', ''];
      setTimeout(() => this.focusHiddenForgotInput(), 50);
    } finally {
      this.isResettingPassword = false;
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
    this.cleanupSignupValidator();
  }

  loginWithGoogle(): void {
    window.location.href = `${environment.apiUrl}/auth/oauth/google`;
  }

  loginWithFacebook(): void {
    window.location.href = `${environment.apiUrl}/auth/oauth/facebook`;
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