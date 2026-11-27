import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthModalComponent } from './auth-modal.component';

describe('signup referral submission', () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('sends the visible pasted/autofilled referral even when ngModel has not caught up', async () => {
    vi.useFakeTimers();
    const register = vi.fn().mockResolvedValue({ registration_id: 'REG1' });
    const component = Object.create(AuthModalComponent.prototype) as any;
    Object.assign(component, {
      mode: () => 'signup',
      signupName: 'Vivian', signupEmail: 'vivian@example.com', signupPhone: '',
      signupPassword: 'Password1!', signupConfirmPassword: 'Password1!',
      signupReferralCode: '',
      signupReferralInput: { nativeElement: { value: '  anh_ab12cd34  ' } },
      signupValidator: { validateAll: () => true },
      authService: { register }, cdr: { detectChanges: vi.fn() },
      startOtpCountdown: vi.fn(), focusHiddenInput: vi.fn()
    });
    await component.onSubmitAuth({ preventDefault: vi.fn() } as unknown as Event);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ referral_code: 'ANH_AB12CD34' }));
    expect(component.isOtpStep).toBe(true);
  });
});
