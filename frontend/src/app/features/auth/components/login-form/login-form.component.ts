import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth.service';

@Component({
  selector: 'app-login-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div style="max-width: 400px; margin: auto;">
      <h2>Login</h2>

      <input [(ngModel)]="email" placeholder="Email or Phone" />
      <input [(ngModel)]="password" type="password" placeholder="Password" />

      <button (click)="login()" [disabled]="loading">
        {{ loading ? 'Logging in...' : 'Login' }}
      </button>

      <p style="color:red" *ngIf="error">{{ error }}</p>
    </div>
  `
})
export class LoginFormComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  error = '';
  loading = false;

  async login() {
    this.error = '';
    this.loading = true;

    try {
      const res = await this.authService.login(
        this.email.trim(),
        this.password
      );

      const role = res?.user?.role;

      if (role === 'admin') {
        this.router.navigate(['/admin']);
      } else {
        this.router.navigate(['/']);
      }

    } catch (err: any) {
      this.error = err?.error?.error || 'Login failed';
    } finally {
      this.loading = false;
    }
  }
}