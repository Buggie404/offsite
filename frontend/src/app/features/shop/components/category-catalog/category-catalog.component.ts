// shop/components/category-catalog/category-catalog.component.ts

import { Component, Input, OnInit, OnChanges, SimpleChanges, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideChevronDown, LucideChevronRight, LucideCheck, LucideChevronLeft
} from '@lucide/angular';
import { ProductCardComponent } from '../product-card/product-card.component';
import { ProductService } from '../../../home/services/product.service';
import { Product } from '../../../home/models/product.model';

// ── FILTER CONFIG ──
export interface FilterOption {
  label: string;
  value: string;
  checked: boolean;
}

export interface FilterGroup {
  key: string;
  label: string;
  isOpen: boolean;
  options: FilterOption[];
}

// Hardcode filter definitions per category
const CATEGORY_FILTERS: Record<string, FilterGroup[]> = {
  matcha: [
    {
      key: 'grade', label: 'BY GRADE', isOpen: true,
      options: [
        { label: 'Ceremonial Grade', value: 'Ceremonial Grade', checked: false },
        { label: 'Premium Grade',    value: 'Premium Grade',    checked: false },
        { label: 'Barista Grade',    value: 'Barista Grade',    checked: false },
        { label: 'Latte Grade',      value: 'Latte Grade',      checked: false },
        { label: 'Related Tea',      value: 'Related Tea',      checked: false },
      ]
    },
    {
      key: 'priceRange', label: 'PRICE RANGE', isOpen: true,
      options: [
        { label: 'Under $25', value: 'under_25',  checked: false },
        { label: '$25 – $50', value: '25_50',     checked: false },
        { label: '$50 – $100', value: '50_100',   checked: false },
        { label: '$100 +',    value: '100_plus',  checked: false },
      ]
    },
    {
      key: 'origin', label: 'ORIGIN', isOpen: true,
      options: [
        { label: 'Japan', value: 'Japan', checked: false },
        { label: 'China', value: 'China', checked: false },
      ]
    },
  ],

  coffee: [
    {
      key: 'type', label: 'BY TYPE', isOpen: true,
      options: [
        { label: 'Washed',         value: 'Washed',         checked: false },
        { label: 'Decaf',          value: 'Decaf',          checked: false },
        { label: 'Wet-hulled',     value: 'Wet-hulled',     checked: false },
        { label: 'Natural sundried', value: 'Natural sundried', checked: false },
      ]
    },
    {
      key: 'roastLevel', label: 'BY ROAST LEVEL', isOpen: true,
      options: [
        { label: 'Light',        value: 'Light',        checked: false },
        { label: 'Medium light', value: 'Medium light', checked: false },
        { label: 'Medium',       value: 'Medium',       checked: false },
        { label: 'Medium dark',  value: 'Medium dark',  checked: false },
        { label: 'Dark',         value: 'Dark',         checked: false },
      ]
    },
    {
      key: 'priceRange', label: 'PRICE RANGE', isOpen: true,
      options: [
        { label: 'Under $25', value: 'under_25',  checked: false },
        { label: '$25 – $50', value: '25_50',     checked: false },
        { label: '$50 – $100', value: '50_100',   checked: false },
        { label: '$100 +',    value: '100_plus',  checked: false },
      ]
    },
    {
      key: 'origin', label: 'ORIGIN', isOpen: true,
      options: [
        { label: 'America',   value: 'America',   checked: false },
        { label: 'Burundi',   value: 'Burundi',   checked: false },
        { label: 'Bolivia',   value: 'Bolivia',   checked: false },
        { label: 'Columbia',  value: 'Columbia',  checked: false },
        { label: 'Costa Rica', value: 'Costa Rica', checked: false },
        { label: 'Ethiopia',  value: 'Ethiopia',  checked: false },
        { label: 'Guatemala', value: 'Guatemala', checked: false },
        { label: 'Honduras',  value: 'Honduras',  checked: false },
        { label: 'Indonesia', value: 'Indonesia', checked: false },
        { label: 'Japan',     value: 'Japan',     checked: false },
        { label: 'Peru',      value: 'Peru',      checked: false },
        { label: 'Rawanda',   value: 'Rawanda',   checked: false },
        { label: 'Uganda',    value: 'Uganda',    checked: false },
      ]
    },
  ],

  tools: [
    {
      key: 'category', label: 'BY CATEGORY', isOpen: true,
      options: [
        { label: 'Coffee tools', value: 'Coffee tools', checked: false },
        { label: 'Matcha tools', value: 'Matcha tools', checked: false },
      ]
    },
    {
      key: 'type', label: 'BY TYPE', isOpen: true,
      options: [
        { label: 'Brewer',      value: 'Brewer',      checked: false },
        { label: 'Chawan',      value: 'Chawan',      checked: false },
        { label: 'Chasaku',     value: 'Chasaku',     checked: false },
        { label: 'Chasen',      value: 'Chasen',      checked: false },
        { label: 'Dripper',     value: 'Dripper',     checked: false },
        { label: 'Filter',      value: 'Filter',      checked: false },
        { label: 'Grinder',     value: 'Grinder',     checked: false },
        { label: 'Whisk stand', value: 'Whisk stand', checked: false },
        { label: 'Kettle',      value: 'Kettle',      checked: false },
      ]
    },
    {
      key: 'priceRange', label: 'PRICE RANGE', isOpen: true,
      options: [
        { label: 'Under $25', value: 'under_25',  checked: false },
        { label: '$25 – $50', value: '25_50',     checked: false },
        { label: '$50 – $100', value: '50_100',   checked: false },
        { label: '$100 +',    value: '100_plus',  checked: false },
      ]
    },
  ],

  drinkware: [
    {
      key: 'type', label: 'BY TYPE', isOpen: true,
      options: [
        { label: 'Mugs',    value: 'Mugs',    checked: false },
        { label: 'Bottles', value: 'Bottles', checked: false },
        { label: 'Teapots', value: 'Teapots', checked: false },
      ]
    },
    {
      key: 'material', label: 'BY MATERIAL', isOpen: true,
      options: [
        { label: 'Ceramic',   value: 'Ceramic',   checked: false },
        { label: 'Clay',      value: 'Clay',      checked: false },
        { label: 'Glass',     value: 'Glass',     checked: false },
        { label: 'Porcelain', value: 'Porcelain', checked: false },
        { label: 'Steel',     value: 'Steel',     checked: false },
      ]
    },
    {
      key: 'priceRange', label: 'PRICE RANGE', isOpen: true,
      options: [
        { label: 'Under $25', value: 'under_25',  checked: false },
        { label: '$25 – $50', value: '25_50',     checked: false },
        { label: '$50 – $100', value: '50_100',   checked: false },
        { label: '$100 +',    value: '100_plus',  checked: false },
      ]
    },
  ],

  bundles: [
    {
      key: 'priceRange', label: 'PRICE RANGE', isOpen: true,
      options: [
        { label: 'Under $25', value: 'under_25',  checked: false },
        { label: '$25 – $50', value: '25_50',     checked: false },
        { label: '$50 – $100', value: '50_100',   checked: false },
        { label: '$100 +',    value: '100_plus',  checked: false },
      ]
    },
  ],
};

@Component({
  selector: 'app-category-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideChevronDown, LucideChevronRight, LucideCheck, LucideChevronLeft, ProductCardComponent],
  templateUrl: './category-catalog.component.html',
  styleUrls: ['./category-catalog.component.scss']
})
export class CategoryCatalogComponent implements OnInit, OnChanges {
  @Input() category: string = '';


  // ── FILTER STATE ──
  filterGroups: FilterGroup[] = [];

  // ── PRODUCT STATE ──
  allProducts: Product[] = [];
  filteredProducts: Product[] = [];
  isLoading = true;

  // ── SORT STATE ──
  sortOptions = ['New Arrival', 'Best Seller'];
  selectedSort = 'New Arrival';
  isSortOpen = false;

  // ── PAGINATION STATE ──
  readonly PAGE_SIZE = 9;
  currentPage = 1;
  totalPages = 1;

  get pagedProducts(): Product[] {
    const start = (this.currentPage - 1) * this.PAGE_SIZE;
    return this.filteredProducts.slice(start, start + this.PAGE_SIZE);
  }

  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  constructor(private productService: ProductService) {}

  ngOnInit(): void {
    this.loadFilters();
    if (isPlatformBrowser(this.platformId)) {
      this.loadProducts();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['category'] && !changes['category'].firstChange) {
      this.loadFilters();
      this.loadProducts();
    }
  }

  // ── LOAD FILTER CONFIG ──
  loadFilters(): void {
    const config = CATEGORY_FILTERS[this.category];
    // Deep clone to reset state when category changes
    this.filterGroups = config
      ? JSON.parse(JSON.stringify(config))
      : [];
  }

  // ── LOAD PRODUCTS FROM API ──
  loadProducts(): void {
    this.isLoading = true;
    this.currentPage = 1;
    this.productService.getProducts().subscribe({
      next: (data: Product[]) => {
        // Map route slug → product category field
        const slugMap: Record<string, string> = {
          matcha: 'matcha',
          coffee: 'coffee',
          tools: 'tools',
          drinkware: 'drinkware',
          bundles: 'sets_bundles',
        };
        const catKey = slugMap[this.category] ?? this.category;
        this.allProducts = data.filter(p => p.category === catKey);
        this.applyFilters();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── APPLY FILTERS ──
  applyFilters(): void {
    // TODO: apply real filter logic against product fields
    // For now just show all, filter logic can be wired in later
    this.filteredProducts = [...this.allProducts];
    this.totalPages = Math.max(1, Math.ceil(this.filteredProducts.length / this.PAGE_SIZE));
    this.currentPage = 1;
  }

  // ── TOGGLE FILTER SECTION ──
  toggleFilterGroup(group: FilterGroup): void {
    group.isOpen = !group.isOpen;
  }

  // ── TOGGLE CHECKBOX ──
  toggleOption(option: FilterOption): void {
    option.checked = !option.checked;
    this.applyFilters();
  }

  // ── SORT ──
  toggleSort(): void {
    this.isSortOpen = !this.isSortOpen;
  }

  selectSort(option: string): void {
    this.selectedSort = option;
    this.isSortOpen = false;
  }

  // ── PAGINATION ──
  prevPage(): void {
    if (this.currentPage > 1) this.currentPage--;
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) this.currentPage++;
  }
}
