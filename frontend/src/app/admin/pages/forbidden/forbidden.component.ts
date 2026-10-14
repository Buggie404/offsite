import { Component, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router } from '@angular/router';
import { LucideArrowLeft, LucideLogOut, LucideShieldAlert } from '@lucide/angular';
import { AdminAuthService } from '../../services/admin-auth.service';
import { ADMIN_ROLE_LABELS } from '../../../shared/models/admin-role.model';

@Component({
  selector: 'app-admin-forbidden',
  standalone: true,
  imports: [CommonModule, LucideArrowLeft, LucideLogOut, LucideShieldAlert],
  templateUrl: './forbidden.component.html',
  styleUrl: './forbidden.component.scss'
})
export class AdminForbiddenComponent {
  private readonly adminAuth = inject(AdminAuthService);
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  get roleLabel(): string {
    const role = this.adminAuth.getAdminRole();
    return role ? ADMIN_ROLE_LABELS[role] : 'Unassigned role';
  }

  goBack(): void {
    this.location.back();
  }

  signOut(): void {
    this.adminAuth.logout();
    void this.router.navigateByUrl('/admin/login');
  }
}