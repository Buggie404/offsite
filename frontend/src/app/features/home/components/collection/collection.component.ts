import { Component, OnInit, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProductCategoryCounts, ProductService } from '../../services/product.service';

export interface Collection {
  id: string;
  name: string;
  description: string;
  image: string;       // path từ assets/, ví dụ: 'assets/images/matcha.png'
  imageAlt: string;
  productCount: number | null;
  productLabel: string; // 'PRODUCTS' | 'ITEMS' | 'SETS'
  size: 'large' | 'small';
}

import { AnimateInViewDirective } from '../../../../shared/directives/animate-in-view.directive';

@Component({
  selector: 'app-collection',
  standalone: true,
  imports: [CommonModule, RouterLink, AnimateInViewDirective],
  templateUrl: './collection.component.html',
  styleUrls: ['./collection.component.scss'],
})
export class CollectionComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  constructor(private productService: ProductService) {}

  // Mock data — sau này thay bằng API từ service
  largeCollections: Collection[] = [
    {
      id: 'matcha',
      name: 'Matcha',
      description: 'Bright and grassy with a clean, slightly sweet finish. Best cold or straight.',
      image: 'assets/images/category_matcha.png',
      imageAlt: 'Matcha pixel art illustration',
      productCount: null,
      productLabel: 'PRODUCTS',
      size: 'large',
    },
    {
      id: 'coffee',
      name: 'Coffee',
      description: 'Deeply aromatic roasts sourced from ethical farms across the globe.',
      image: 'assets/images/category_coffee.png',
      imageAlt: 'Coffee pixel art illustration',
      productCount: null,
      productLabel: 'PRODUCTS',
      size: 'large',
    },
  ];

  smallCollections: Collection[] = [
    {
      id: 'tools',
      name: 'Tools',
      description: '',
      image: 'assets/images/category_tools.png',
      imageAlt: 'Tools pixel art illustration',
      productCount: null,
      productLabel: 'PRODUCTS',
      size: 'small',
    },
    {
      id: 'drinkware',
      name: 'Drinkware',
      description: '',
      image: 'assets/images/category_drinkware.png',
      imageAlt: 'Drinkware pixel art illustration',
      productCount: null,
      productLabel: 'PRODUCTS',
      size: 'small',
    },
    {
      id: 'bundles',
      name: 'Sets & Bundles',
      description: '',
      image: 'assets/images/category_sets&bundles.png',
      imageAlt: 'Sets & Bundles pixel art illustration',
      productCount: null,
      productLabel: 'SETS',
      size: 'small',
    },
  ];

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.productService.getCategoryCounts().subscribe({
      next: (counts) => {
        this.applyCategoryCounts(counts);
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Unable to load collection product counts:', error);
        this.cdr.markForCheck();
      }
    });
  }

  private applyCategoryCounts(counts: ProductCategoryCounts): void {
    const categoryMap: Record<string, keyof ProductCategoryCounts> = {
      matcha: 'matcha',
      coffee: 'coffee',
      tools: 'tools',
      drinkware: 'drinkware',
      bundles: 'sets_bundles'
    };

    const withCount = (collection: Collection): Collection => ({
      ...collection,
      productCount: counts[categoryMap[collection.id]] ?? 0
    });

    this.largeCollections = this.largeCollections.map(withCount);
    this.smallCollections = this.smallCollections.map(withCount);
  }

  // Format hiển thị số lượng — "12 PRODUCTS", "08 PRODUCTS", "05 SETS"
  formatCount(count: number | null, label: string): string {
    if (count === null) return `-- ${label}`;
    return `${String(count).padStart(2, '0')} ${label}`;
  }
}
