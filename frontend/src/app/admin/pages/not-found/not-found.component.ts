import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  LucideFileQuestion,
  LucideSearch,
  LucideArrowLeft,
  LucideRotateCcw,
  LucideUndo2,
  LucideTruck,
  LucideAlertCircle
} from '@lucide/angular';

@Component({
  selector: 'app-admin-not-found',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    LucideFileQuestion,
    LucideSearch,
    LucideArrowLeft,
    LucideRotateCcw,
    LucideUndo2,
    LucideTruck,
    LucideAlertCircle
  ],
  templateUrl: './not-found.component.html',
  styleUrl: './not-found.component.scss'
})
export class AdminNotFoundComponent implements OnInit {
  private router = inject(Router);
  private location = inject(Location);

  currentUrl = '';

  ngOnInit(): void {
    this.currentUrl = this.router.url;
  }

  onSearch(query: string): void {
    if (!query.trim()) return;
    void this.router.navigate(['/admin/orders'], {
      queryParams: { search: query.trim() }
    });
  }

  goBack(): void {
    this.location.back();
  }
}
