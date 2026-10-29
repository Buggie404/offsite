import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { LucideChefHat, LucideChevronRight, LucideFlag, LucideMessagesSquare, LucideTicket, LucideTimer, LucideUserX } from '@lucide/angular';
import { ServicesDashboardData, ServicesDashboardService } from '../../services/services-dashboard.service';

@Component({ selector: 'app-services-dashboard', standalone: true, imports: [CommonModule, DecimalPipe, LucideChefHat, LucideChevronRight, LucideFlag, LucideMessagesSquare, LucideTicket, LucideTimer, LucideUserX], templateUrl: './services-dashboard.component.html', styleUrl: './services-dashboard.component.scss' })
export class ServicesDashboardComponent implements OnInit {
  private readonly service = inject(ServicesDashboardService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly adminAuth = inject(AdminAuthService);
  get accountName(): string { return this.adminAuth.getDisplayName(); }
  data: ServicesDashboardData | null = null;
  loading = true;
  error = '';
  ngOnInit(): void { this.load(); }
  load(): void { this.loading = this.data === null; this.error = ''; this.service.getDashboard().subscribe({ next: data => { this.data = data; this.loading = false; this.cdr.markForCheck(); }, error: err => { this.error = err?.error?.error || 'Dashboard data could not be loaded.'; this.loading = false; this.cdr.markForCheck(); } }); }
  get greeting(): string { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }
  formatFirstResponse(milliseconds: number): string {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'No data';
    const minutes = Math.round(milliseconds / 60_000);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  navigate(path: string, queryParams?: Record<string, string>): void { void this.router.navigate([path], { queryParams }); }
}
