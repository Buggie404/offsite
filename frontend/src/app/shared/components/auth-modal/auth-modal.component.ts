import { Component, inject, HostListener, ChangeDetectorRef, ElementRef, ViewChild, ViewChildren, QueryList, OnDestroy, signal } from '@angular/core';
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
  @ViewChild('signupEmailInput') signupEmailInput!: ElementRef<HTMLInputElement>;
  @ViewChild('signupPhoneInput') signupPhoneInput!: ElementRef<HTMLInputElement>;
  @ViewChild('signupPasswordInput') signupPasswordInput!: ElementRef<HTMLInputElement>;
  @ViewChild('signupConfirmPasswordInput') signupConfirmPasswordInput!: ElementRef<HTMLInputElement>;
  @ViewChildren('otpInput') otpInputs!: QueryList<ElementRef<HTMLInputElement>>;

  isOpen = this.authModalService.isOpen;
  mode = this.authModalService.mode;

  loginTab: 'email' | 'phone' = 'email';
  showPassword = false;
  showConfirmPassword = false;
  // OTP registration flow
  isOtpStep = false;
  registrationId = '';
  registrationEmail = '';
  otpDigits: string[] = ['', '', '', '', '', ''];
  otpError: string | null = null;
  otpLocked = false; // true sau khi hết lượt thử -> chỉ còn cách Resend
  readonly OTP_MAX_ATTEMPTS = 3;
  otpAttemptsLeft = this.OTP_MAX_ATTEMPTS; // hiện cho user biết còn mấy lần thử
  maskedContact = '';
  otpChannel: 'email' | 'phone' = 'email';
  isVerifyingOtp = false;
  isResendingOtp = false;
  otpCountdown = signal(0); // signal để UI tự vẽ lại mỗi giây, không phụ thuộc zone/click
  mockOtp = '';
  private otpTimerHandle: ReturnType<typeof setInterval> | null = null;
  private readonly OTP_DURATION_SECONDS = 2 * 60; // khớp OTP_EXPIRE_MS ở backend (2 phút)

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
  serverPhoneError: string | null = null;
  serverPasswordError: string | null = null;
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

  // Dùng cho nút X, click ra ngoài overlay, và phím Escape.
  // Nếu đang ở giữa bước OTP thì chỉ huỷ bước OTP (như bấm CANCEL) —
  // giữ modal mở, quay về form đăng ký — thay vì đóng sạch cả modal.
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

    this.clearOtpCountdown();
    this.isOtpStep = false;
    this.registrationId = '';
    this.registrationEmail = '';
    this.otpDigits = ['', '', '', '', '', ''];
    this.otpError = null;
    this.otpLocked = false;
    this.otpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
    this.maskedContact = '';
    this.mockOtp = '';
    this.isVerifyingOtp = false;
    this.isResendingOtp = false;
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
      // Đồng bộ lại giá trị thật từ DOM trước khi validate — cùng lý do như
      // ở login: autofill (nhất là số điện thoại) có thể không bắn sự kiện
      // 'input' nên ngModel chưa kịp cập nhật khi bấm submit ngay.
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

      if (!this.isFormValid()) {
        return;
      }

      this.serverEmailError = null;
      this.serverPhoneError = null;
      this.serverPasswordError = null;
      this.isSubmitting = true;

      try {
        const normalizedPhone = this.signupPhone.replace(/\s+/g, '');
        const response = await this.authService.register({
          name: this.signupName,
          email: this.signupEmail,
          phone: normalizedPhone,
          password: this.signupPassword
        });

        this.registrationId = response.registration_id;
        this.registrationEmail = this.signupEmail;
        this.maskedContact = response.maskedContact || '';
        this.otpChannel = response.channel || 'email';
        this.mockOtp = response.__mock || '';

        this.otpLocked = false;
        this.otpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
        this.otpError = null;
        this.otpDigits = ['', '', '', '', '', ''];
        this.isOtpStep = true;
        this.startOtpCountdown(this.OTP_DURATION_SECONDS);
        this.cdr.detectChanges();
        setTimeout(() => this.focusOtpInput(0), 50);

      } catch (err: any) {
        console.error('Registration error:', err);
        const errorCode = err?.code;
        if (errorCode === 'EMAIL_EXISTS') {
          this.serverEmailError = 'This email is already registered.';
        } else if (errorCode === 'PHONE_EXISTS') {
          this.serverPhoneError = 'This phone number is already registered.';
        } else {
          this.serverEmailError = 'An error occurred during registration. Please try again.';
        }
        this.cdr.detectChanges();
      } finally {
        this.isSubmitting = false;
        this.cdr.detectChanges();
      }
      return;
    }

    // Đồng bộ lại giá trị thật từ DOM trước khi validate: một số trình duyệt
    // (đặc biệt autofill số điện thoại trên input type="tel") không bắn sự
    // kiện 'input' nên [(ngModel)] có thể chưa cập nhật, khiến form bị coi
    // là invalid dù ô nhìn có vẻ đã điền đầy đủ.
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
      // Báo lỗi cụ thể thay vì im lặng return — tránh cảm giác nút "đứng yên".
      if (this.loginTab === 'phone' && !this.phoneError) {
        this.serverEmailError = 'Please check your phone number and password.';
        this.cdr.detectChanges();
      } else if (this.loginTab === 'email' && !this.emailError) {
        this.serverEmailError = 'Please check your email and password.';
        this.cdr.detectChanges();
      }
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

      // Hiện ngay lập tức: không dùng setTimeout vì trình duyệt sẽ throttle
      // timer khi tab bị chuyển ra nền, khiến modal có cảm giác "đợi" tới khi
      // quay lại tab mới hiện. Luôn hiện modal dù đang ở trang nào.
      // Nếu đang ở sẵn trang chủ thì chỉ cần "CONTINUE" — "BACK TO HOMEPAGE"
      // chẳng có nghĩa gì khi đã ở đó. Nếu đang ở trang khác thì cho cả 2 lựa
      // chọn: CONTINUE (ở lại trang hiện tại) hoặc BACK TO HOMEPAGE.
      const isOnHomepage = this.router.url === '/';
      this.successModalConfig = {
        title: 'Log In Successfully',
        subtitle: "Welcome back! You're now signed in.",
        primaryBtn: 'CONTINUE',
        ...(isOnHomepage ? {} : { secondaryBtn: 'BACK TO HOMEPAGE' })
      };
      this.showSuccessModal = true;
      this.cdr.detectChanges();
    } 
      catch (err: any) {
        console.error('Login error:', err);
        const errorCode = err?.code;

        if (errorCode === 'ACCOUNT_NOT_FOUND') {
          this.serverEmailError = 'Email or phone not found.';
          setTimeout(() => {
            if (this.loginTab === 'email') {
              this.loginEmailInput?.nativeElement?.focus();
            } else {
              this.loginPhoneInput?.nativeElement?.focus();
            }
          }, 50);
        } else if (errorCode === 'OAUTH_ACCOUNT') {
          this.serverEmailError = 'This account was registered with Google or Facebook. Please continue with the same method.';
        } else if (errorCode === 'ADMIN_NOT_ALLOWED') {
          this.serverEmailError = 'Admin accounts cannot log in here.';
        } else if (errorCode === 'INCORRECT_PASSWORD') {
          this.serverPasswordError = 'Incorrect password.';
          setTimeout(() => {
            if (this.loginTab === 'email') {
              this.loginPasswordInput?.nativeElement?.focus();
            } else {
              this.loginPhonePasswordInput?.nativeElement?.focus();
            }
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

  get otpValue(): string {
    return this.otpDigits.join('');
  }

  private focusOtpInput(index: number): void {
    const el = this.otpInputs?.toArray()[index]?.nativeElement;
    if (el) {
      el.focus();
      el.select();
    }
  }

  // Nhập số vào từng ô, tự nhảy sang ô kế; hỗ trợ paste cả 6 số cùng lúc
  onOtpDigitInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '');

    if (!value) {
      this.otpDigits[index] = '';
      return;
    }

    if (value.length > 1) {
      const chars = value.split('');
      for (let i = index; i < 6 && chars.length; i++) {
        this.otpDigits[i] = chars.shift()!;
      }
      const nextEmpty = this.otpDigits.findIndex((d, i) => i >= index && !d);
      this.focusOtpInput(nextEmpty === -1 ? 5 : nextEmpty);
      input.value = this.otpDigits[index];
      if (this.otpValue.length === 6) {
        this.verifyOtp();
      }
      return;
    }

    this.otpDigits[index] = value;
    if (index < 5) {
      this.focusOtpInput(index + 1);
    } else if (this.otpValue.length === 6) {
      this.verifyOtp();
    }
  }

  onOtpKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.otpDigits[index] && index > 0) {
      this.focusOtpInput(index - 1);
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

      // Hiện ngay lập tức, không dùng setTimeout (bị throttle khi đổi tab).
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
      console.error(err);
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
        // Ưu tiên số lần còn lại backend trả về, nếu không có thì tự đếm ở client
        // (giả định trùng số lượt tối đa với backend, OTP_MAX_ATTEMPTS).
        this.otpAttemptsLeft = typeof err?.remainingAttempts === 'number'
          ? err.remainingAttempts
          : Math.max(0, this.otpAttemptsLeft - 1);

        // Tự dựng message tiếng Anh ở frontend, không lấy err.error (backend trả tiếng Việt).
        // Số lượt còn lại đã hiện riêng ở otp-attempts-hint phía trên, nên ở đây chỉ cần báo sai.
        this.otpError = 'Incorrect code. Please try again.';

        // Fallback: nếu đếm tới 0 mà backend chưa kịp trả OTP_LOCKED (lệch nhịp),
        // tự khoá luôn ở client để tránh cho nhập thêm quá số lượt cho phép.
        if (this.otpAttemptsLeft <= 0) {
          this.otpLocked = true;
          this.clearOtpCountdown();
        }
      }

      this.otpDigits = ['', '', '', '', '', ''];
      setTimeout(() => this.focusOtpInput(0), 50);
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
      this.otpDigits = ['', '', '', '', '', ''];
      this.startOtpCountdown(this.OTP_DURATION_SECONDS);
      setTimeout(() => this.focusOtpInput(0), 50);
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

  // Huỷ bước OTP, quay lại form đăng ký
  backToSignup(): void {
    this.clearOtpCountdown();
    this.isOtpStep = false;
    this.otpLocked = false;
    this.registrationId = '';
    this.maskedContact = '';
    this.mockOtp = '';
    this.otpError = null;
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
      // Already on the homepage — just dismiss, nothing to navigate to.
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