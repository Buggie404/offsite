import { Component, OnInit, inject, PLATFORM_ID, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import {
  LucideUser,
  LucideShoppingBag,
  LucideHeart,
  LucideMapPin,
  LucideCreditCard,
  LucideLogOut,
  LucideX,
  LucideCheck,
  LucideLoader,
  LucideMenu
} from '@lucide/angular';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    LucideUser,
    LucideShoppingBag,
    LucideHeart,
    LucideMapPin,
    LucideCreditCard,
    LucideLogOut,
    LucideX,
    LucideCheck,
    LucideLoader,
    LucideMenu
  ],
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss'
})
export class AccountComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private authService = inject(AuthService);
  private http = inject(HttpClient);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);

  // Profile data signals
  user = signal<any>(null);
  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);

  // Tab & Modal State
  activeTab = signal<string>('profile');
  showEditModal = signal<boolean>(false);
  showPasswordModal = signal<boolean>(false);
  isSidebarOpen = signal<boolean>(false);

  // Messages
  successMessage = signal<string>('');
  errorMessage = signal<string>('');

  // Forms
  profileForm!: FormGroup;
  passwordForm!: FormGroup;

  ngOnInit(): void {
    this.initForms();
    this.fetchProfile();
    this.route.queryParams.subscribe(params => {
      if (params['tab']) {
        this.activeTab.set(params['tab']);
      }
    });
  }

  private initForms(): void {
    this.profileForm = this.fb.group({
      profile_name: ['', [Validators.required, Validators.minLength(2)]],
      community_name: [''],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.pattern(/^[0-9]{10,11}$/)]]
    });

    this.passwordForm = this.fb.group({
      oldPassword: ['', [Validators.required, Validators.minLength(8)]],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  private passwordMatchValidator(g: FormGroup) {
    return g.get('newPassword')?.value === g.get('confirmPassword')?.value
      ? null : { mismatch: true };
  }

  async fetchProfile(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    this.isLoading.set(true);
    try {
      this.http.get<{ user: any }>('/api/auth/me').subscribe({
        next: (response) => {
          this.user.set(response.user);
          // Sync localStorage
          localStorage.setItem('user', JSON.stringify(response.user));
          
          this.profileForm.patchValue({
            profile_name: response.user.profile_name || '',
            community_name: response.user.community_name || '',
            email: response.user.email || '',
            phone: response.user.phone || ''
          });
          this.isLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to load profile:', err);
          this.errorMessage.set(err.error?.error || 'Failed to load profile information.');
          this.isLoading.set(false);
        }
      });
    } catch (e) {
      this.isLoading.set(false);
    }
  }

  switchTab(tab: string): void {
    this.activeTab.set(tab);
    this.closeSidebar();
    this.scrollToContent();
  }

  private scrollToContent(): void {
    if (isPlatformBrowser(this.platformId)) {
      const contentPanel = document.querySelector('.content-panel') as HTMLElement;
      if (contentPanel) {
        const headerHeight = 160; // promobar (80px) + navbar (80px)
        const elementPosition = contentPanel.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({
          top: elementPosition - headerHeight,
          behavior: 'smooth'
        });
      }
    }
  }

  toggleSidebar(): void {
    this.isSidebarOpen.set(!this.isSidebarOpen());
  }

  closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }

  openEditModal(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    if (this.user()) {
      this.profileForm.patchValue({
        profile_name: this.user().profile_name || '',
        community_name: this.user().community_name || '',
        email: this.user().email || '',
        phone: this.user().phone || ''
      });
    }
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
    this.profileForm.reset();
  }

  openPasswordModal(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.showPasswordModal.set(true);
  }

  closePasswordModal(): void {
    this.showPasswordModal.set(false);
    this.passwordForm.reset();
  }

  onUpdateProfile(): void {
    if (this.profileForm.invalid) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.http.put<{ message: string; user: any }>('/api/auth/profile', this.profileForm.value)
      .subscribe({
        next: (response) => {
          this.user.set(response.user);
          localStorage.setItem('user', JSON.stringify(response.user));
          this.successMessage.set('Profile updated successfully!');
          this.isSubmitting.set(false);
          setTimeout(() => {
            this.closeEditModal();
            this.successMessage.set('');
          }, 1500);
        },
        error: (err) => {
          this.errorMessage.set(err.error?.error || 'Failed to update profile.');
          this.isSubmitting.set(false);
        }
      });
  }

  onChangePassword(): void {
    if (this.passwordForm.invalid) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const { oldPassword, newPassword } = this.passwordForm.value;

    this.http.put<{ message: string }>('/api/auth/change-password', { oldPassword, newPassword })
      .subscribe({
        next: (response) => {
          this.successMessage.set('Password changed successfully!');
          this.isSubmitting.set(false);
          setTimeout(() => {
            this.closePasswordModal();
            this.successMessage.set('');
          }, 1500);
        },
        error: (err) => {
          this.errorMessage.set(err.error?.error || 'Failed to change password.');
          this.isSubmitting.set(false);
        }
      });
  }

  signOut(): void {
    this.authService.logout();
    this.router.navigate(['/']);
  }
}