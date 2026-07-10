// shop/components/category-catalog/category-catalog.component.ts

import { Component, ElementRef, Input, OnInit, OnChanges, SimpleChanges, ViewChild, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideChevronDown, LucideChevronRight, LucideCheck, LucideChevronLeft,
  LucideSearch, LucideX, LucideSearchX, LucideRotateCcw
} from '@lucide/angular';
import { ProductCardComponent } from '../product-card/product-card.component';
import { ProductService } from '../../../home/services/product.service';
import { Product, getDefaultPrice, isProductOutOfStock } from '../../../home/models/product.model';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';

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

interface CatalogReturnState {
  page: number;
  scrollY: number;
  searchQuery: string;
  selectedSort: string;
  filters: Record<string, string[]>;
  createdAt: number;
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
        { label: 'Colombia',  value: 'Colombia',  checked: false },
        { label: 'Costa Rica', value: 'Costa Rica', checked: false },
        { label: 'Ethiopia',  value: 'Ethiopia',  checked: false },
        { label: 'Guatemala', value: 'Guatemala', checked: false },
        { label: 'Honduras',  value: 'Honduras',  checked: false },
        { label: 'Indonesia', value: 'Indonesia', checked: false },
        { label: 'Japan',     value: 'Japan',     checked: false },
        { label: 'Mexico',    value: 'Mexico',    checked: false },
        { label: 'Peru',      value: 'Peru',      checked: false },
        { label: 'Rwanda',    value: 'Rwanda',    checked: false },
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
        { label: 'Chashaku',    value: 'Chashaku',    checked: false },
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
  'best-seller': [
    {
      key: 'productCategory', label: 'BY CATEGORY', isOpen: true,
      options: [
        { label: 'Matcha',        value: 'matcha',       checked: false },
        { label: 'Coffee',        value: 'coffee',       checked: false },
        { label: 'Tools',         value: 'tools',        checked: false },
        { label: 'Drinkwares',    value: 'drinkware',    checked: false },
        { label: 'Sets & Bundles', value: 'sets_bundles', checked: false },
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
    }
  ],
  'new-arrival': [
    {
      key: 'productCategory', label: 'BY CATEGORY', isOpen: true,
      options: [
        { label: 'Matcha',        value: 'matcha',       checked: false },
        { label: 'Coffee',        value: 'coffee',       checked: false },
        { label: 'Tools',         value: 'tools',        checked: false },
        { label: 'Drinkwares',    value: 'drinkware',    checked: false },
        { label: 'Sets & Bundles', value: 'sets_bundles', checked: false },
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
    }
  ],
};

@Component({
  selector: 'app-category-catalog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, LucideChevronDown, LucideChevronRight,
    LucideCheck, LucideChevronLeft, LucideSearch, LucideX,
    LucideSearchX, LucideRotateCcw, ProductCardComponent
  ],
  templateUrl: './category-catalog.component.html',
  styleUrls: ['./category-catalog.component.scss']
})
export class CategoryCatalogComponent implements OnInit, OnChanges {
  @Input() category: string = '';
  @ViewChild('productGrid') productGrid?: ElementRef<HTMLElement>;


  // ── FILTER STATE ──
  filterGroups: FilterGroup[] = [];

  // ── PRODUCT STATE ──
  allProducts: Product[] = [];
  filteredProducts: Product[] = [];
  isLoading = true;

  // ── SEARCH & SORT STATE ──
  searchQuery = '';
  readonly sortOptions = [
    'BEST SELLERS',
    'NEW ARRIVALS',
    'NAME',
    'PRICE - LOW TO HIGH',
    'PRICE - HIGH TO LOW'
  ];
  selectedSort = 'BEST SELLERS';
  isSortOpen = false;

  // ── PAGINATION STATE ──
  readonly PAGE_SIZE = 9;
  currentPage = 1;
  totalPages = 1;
  savedProductIds = new Set<number>();
  private readonly returnStateTtlMs = 30 * 60 * 1000;

  get pagedProducts(): Product[] {
    const start = (this.currentPage - 1) * this.PAGE_SIZE;
    return this.filteredProducts.slice(start, start + this.PAGE_SIZE);
  }

  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private productService: ProductService,
    private authService: AuthService,
    private authPromptService: AuthPromptModalService
  ) {}

  ngOnInit(): void {
    this.loadFilters();
    if (isPlatformBrowser(this.platformId)) {
      this.loadSavedProducts();
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
    const returnState = this.takeCatalogReturnState();
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
        if (catKey === 'best-seller') {
          this.allProducts = data.filter(p => p.is_best_seller);
        } else if (catKey === 'new-arrival') {
          this.allProducts = data.filter(p => p.is_new_arrival);
        } else {
          this.allProducts = data.filter(p => p.category === catKey);
        }
        if (returnState) {
          this.applyCatalogReturnControls(returnState);
        }
        this.applyFilters(!returnState);
        if (returnState) {
          this.currentPage = this.clampPage(returnState.page);
        }
        this.isLoading = false;
        // Angular runs zoneless in this project. markForCheck() both marks this
        // view dirty and schedules a render after the HTTP callback completes.
        this.cdr.markForCheck();
        if (returnState) {
          this.restoreScrollPosition(returnState.scrollY);
        }
      },
      error: (error) => {
        console.error(`Failed to load products for category "${this.category}":`, error);
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ── APPLY FILTERS ──
  applyFilters(resetPage = true): void {
    let products = [...this.allProducts];
    const query = this.searchQuery.trim().toLocaleLowerCase();

    if (query) {
      products = products.filter(product =>
        product.name.toLocaleLowerCase().includes(query)
        || (product.description ?? '').toLocaleLowerCase().includes(query)
      );
    }

    for (const group of this.filterGroups) {
      const selectedValues = group.options
        .filter(option => option.checked)
        .map(option => option.value);

      if (selectedValues.length > 0) {
        products = products.filter(product =>
          selectedValues.some(value => this.matchesFilter(product, group.key, value))
        );
      }
    }

    this.filteredProducts = this.sortProducts(products);
    this.totalPages = Math.max(1, Math.ceil(this.filteredProducts.length / this.PAGE_SIZE));
    this.currentPage = resetPage ? 1 : this.clampPage(this.currentPage);
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.applyFilters();
  }

  get hasActiveFilters(): boolean {
    return this.filterGroups.some(group =>
      group.options.some(option => option.checked)
    );
  }

  clearSearchAndFilters(): void {
    this.searchQuery = '';
    this.filterGroups.forEach(group =>
      group.options.forEach(option => option.checked = false)
    );
    this.applyFilters();
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
    this.applyFilters();
  }

  // ── PAGINATION ──
  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.scrollToFirstProduct();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.scrollToFirstProduct();
    }
  }

  isProductSaved(product: Product): boolean {
    return this.savedProductIds.has(product.product_id);
  }

  async onProductSave(product: Product): Promise<void> {
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }

    try {
      const result = await this.authService.toggleSavedProduct(product.product_id);
      if (result.saved) this.savedProductIds.add(product.product_id);
      else this.savedProductIds.delete(product.product_id);
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to save product:', err);
    }
  }

  private async loadSavedProducts(): Promise<void> {
    if (!this.authService.isAuthenticated()) return;

    try {
      const result = await this.authService.getSavedItems();
      this.savedProductIds = new Set(
        (result.saved_products || [])
          .map((item: any) => Number(item.product?.product_id ?? item.product_id))
          .filter((id: number) => !Number.isNaN(id))
      );
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to load saved products:', err);
    }
  }

  private scrollToFirstProduct(): void {
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      this.productGrid?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  saveCatalogReturnState(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const state: CatalogReturnState = {
      page: this.currentPage,
      scrollY: window.scrollY,
      searchQuery: this.searchQuery,
      selectedSort: this.selectedSort,
      filters: this.getSelectedFilterValues(),
      createdAt: Date.now()
    };

    sessionStorage.setItem(this.getCatalogReturnStateKey(), JSON.stringify(state));
  }

  private takeCatalogReturnState(): CatalogReturnState | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const key = this.getCatalogReturnStateKey();
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    sessionStorage.removeItem(key);

    try {
      const state = JSON.parse(raw) as CatalogReturnState;
      if (!state || Date.now() - state.createdAt > this.returnStateTtlMs) return null;
      return state;
    } catch {
      return null;
    }
  }

  private applyCatalogReturnControls(state: CatalogReturnState): void {
    this.searchQuery = state.searchQuery ?? '';
    if (this.sortOptions.includes(state.selectedSort)) {
      this.selectedSort = state.selectedSort;
    }

    this.filterGroups.forEach(group => {
      const selectedValues = new Set(state.filters?.[group.key] ?? []);
      group.options.forEach(option => {
        option.checked = selectedValues.has(option.value);
      });
    });
  }

  private getSelectedFilterValues(): Record<string, string[]> {
    return this.filterGroups.reduce<Record<string, string[]>>((acc, group) => {
      const selectedValues = group.options
        .filter(option => option.checked)
        .map(option => option.value);

      if (selectedValues.length) {
        acc[group.key] = selectedValues;
      }

      return acc;
    }, {});
  }

  private restoreScrollPosition(scrollY: number): void {
    requestAnimationFrame(() => {
      window.scrollTo({ top: Math.max(0, scrollY), behavior: 'auto' });
      window.setTimeout(() => {
        window.scrollTo({ top: Math.max(0, scrollY), behavior: 'auto' });
      }, 120);
    });
  }

  private clampPage(page: number): number {
    return Math.min(Math.max(1, Number(page) || 1), this.totalPages);
  }

  private getCatalogReturnStateKey(): string {
    return `offsite:category-catalog:${this.category}:return-state`;
  }

  private matchesFilter(product: Product, key: string, value: string): boolean {
    if (key === 'priceRange') {
      const price = getDefaultPrice(product);
      if (value === 'under_25') return price < 25;
      if (value === '25_50') return price >= 25 && price < 50;
      if (value === '50_100') return price >= 50 && price < 100;
      if (value === '100_plus') return price >= 100;
      return false;
    }

    if (key === 'productCategory') {
      return product.category === value;
    }

    if (key === 'grade' && this.normalizeFilterValue(value) === 'related tea') {
      return !product.matcha?.product_grade;
    }

    let productValue = '';
    switch (key) {
      case 'grade':
        productValue = product.matcha?.product_grade ?? '';
        break;
      case 'origin':
        productValue = product.matcha?.origin ?? product.coffee?.product_origin ?? '';
        break;
      case 'roastLevel':
        productValue = product.coffee?.roast_level ?? '';
        break;
      case 'category':
        productValue = product.tools?.tool_category ?? '';
        break;
      case 'material':
        productValue = product.drinkware?.material ?? '';
        break;
      case 'type':
        productValue = product.coffee?.process_type
          ?? product.tools?.tool_type
          ?? product.drinkware?.ware_type
          ?? '';
        break;
      default:
        return false;
    }

    const normalizedProductValue = this.normalizeFilterValue(productValue);
    const normalizedFilterValue = this.normalizeFilterValue(value);

    if (key === 'origin') {
      return normalizedProductValue.includes(normalizedFilterValue);
    }

    if (key === 'roastLevel') {
      return normalizedProductValue.replace(/\s+roast$/, '') === normalizedFilterValue;
    }

    return normalizedProductValue === normalizedFilterValue;
  }

  private normalizeFilterValue(value: string): string {
    const normalized = value
      .trim()
      .toLocaleLowerCase()
      .replace(/\bcolumbia\b/g, 'colombia')
      .replace(/\brawanda\b/g, 'rwanda');
    const aliases: Record<string, string> = {
      wahsed: 'washed',
      columbia: 'colombia',
      rawanda: 'rwanda',
      'matcha tools': 'tea tools',
      chasaku: 'chashaku'
    };
    return aliases[normalized] ?? normalized;
  }

  private sortProducts(products: Product[]): Product[] {
    const sorted = [...products];

    if (this.selectedSort === 'BEST SELLERS') {
      sorted.sort((a, b) =>
        Number(Boolean(b.is_best_seller)) - Number(Boolean(a.is_best_seller))
        || (b.total_sold_quantity ?? 0) - (a.total_sold_quantity ?? 0)
        || a.product_id - b.product_id
      );
    } else if (this.selectedSort === 'NEW ARRIVALS') {
      sorted.sort((a, b) =>
        Number(Boolean(b.is_new_arrival)) - Number(Boolean(a.is_new_arrival))
        || b.product_id - a.product_id
      );
    } else if (this.selectedSort === 'NAME') {
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    } else if (this.selectedSort === 'PRICE - LOW TO HIGH') {
      sorted.sort((a, b) => getDefaultPrice(a) - getDefaultPrice(b));
    } else if (this.selectedSort === 'PRICE - HIGH TO LOW') {
      sorted.sort((a, b) => getDefaultPrice(b) - getDefaultPrice(a));
    }

    // Stable final partition: unavailable products stay below every in-stock
    // product without losing the order produced by the selected sort.
    return sorted.sort((a, b) =>
      Number(isProductOutOfStock(a)) - Number(isProductOutOfStock(b))
    );
  }
}
