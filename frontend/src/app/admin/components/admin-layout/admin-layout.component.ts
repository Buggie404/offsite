import { AfterViewInit, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucidePackage,
  LucideLogOut,
  LucideSearch,
  LucideBell
} from '@lucide/angular';
import { AdminAuthService } from '../../services/admin-auth.service';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    LucidePackage,
    LucideLogOut,
    LucideSearch,
    LucideBell
  ],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss'
})
export class AdminLayoutComponent implements OnInit, AfterViewInit {
  private adminAuth = inject(AdminAuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  searchQuery = '';
  ordersLinkActive = false;

  ngOnInit(): void {
    this.updateOrdersLinkActive();

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.updateOrdersLinkActive());

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.searchQuery = params['search'] || '';
    });
  }

  ngAfterViewInit(): void {
    this.ensureChildRoute();
  }

  private ensureChildRoute(): void {
    if (this.route.firstChild) return;

    const url = this.router.url.split('?')[0];
    const adminPath = url.replace(/^\/admin\/?/, '') || 'orders';

    void this.router.navigate([adminPath], { relativeTo: this.route, replaceUrl: true });
  }

  private updateOrdersLinkActive(): void {
    const url = this.router.url.split('?')[0];
    this.ordersLinkActive = url === '/admin/orders' || url.startsWith('/admin/orders/');
  }

  get avatarInitials(): string {
    const user = this.adminAuth.getUser();
    const source = user?.profile_name || user?.email || 'AD';
    const parts = source.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
  }

  onSearchInput(value: string): void {
    this.searchQuery = value;
    this.router.navigate(['/admin/orders'], {
      queryParams: { search: value || null },
      queryParamsHandling: 'merge'
    });
  }

  signOut(): void {
    this.adminAuth.logout();
    this.router.navigate(['/admin/login']);
  }
}
