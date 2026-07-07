import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { LucidePlus, LucideX } from '@lucide/angular';
import { ProductService } from '../../../home/services/product.service';
import {
  Product,
  getDefaultPrice,
  isProductOutOfStock
} from '../../../home/models/product.model';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { CartService } from '../../../purchase/services/cart.service';
import { Product as CartProduct } from '../../../../shared/models/product.model';

export type KitType =
  | 'matcha_kit'
  | 'coffee_kit'
  | 'matcha_bundle'
  | 'coffee_bundle'
  | 'matcha_coffee_bundle';

export type PackSize = 2 | 3;

export type SlotId = 'package' | 'tool' | 'drinkware';

interface KitTypeOption {
  id: KitType;
  label: string;
}

interface BundleSlot {
  id: SlotId;
  label: string;
  imageSrc: string;
}

interface SlotSelections {
  package: Product | null;
  tool: Product | null;
  drinkware: Product | null;
}

const EMPTY_SELECTIONS: SlotSelections = {
  package: null,
  tool: null,
  drinkware: null
};

const MATCHA_KIT_SLOT_CATEGORIES: Record<SlotId, string> = {
  package: 'matcha',
  tool: 'tools',
  drinkware: 'drinkware'
};

@Component({
  selector: 'app-build-your-bundle',
  standalone: true,
  imports: [CommonModule, LucidePlus, LucideX, ProductCardComponent],
  templateUrl: './build-your-bundle.component.html',
  styleUrl: './build-your-bundle.component.scss'
})
export class BuildYourBundleComponent implements OnInit {
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly kitTypes: KitTypeOption[] = [
    { id: 'matcha_kit', label: 'MATCHA KIT' },
    { id: 'coffee_kit', label: 'COFFEE KIT' },
    { id: 'matcha_bundle', label: 'MATCHA BUNDLE' },
    { id: 'coffee_bundle', label: 'COFFEE BUNDLE' },
    { id: 'matcha_coffee_bundle', label: 'MATCHA & COFFEE BUNDLE' }
  ];

  selectedKitType = signal<KitType>('matcha_kit');
  selectedPackSize = signal<PackSize>(2);
  activeSlotId = signal<SlotId | null>('package');
  slotSelections = signal<SlotSelections>({ ...EMPTY_SELECTIONS });
  products = signal<Product[]>([]);
  loadingProducts = signal(false);

  slots = computed<BundleSlot[]>(() => {
    const baseSlots: BundleSlot[] = [
      {
        id: 'package',
        label: 'Package',
        imageSrc: 'assets/images/build-bundle/package.png'
      },
      {
        id: 'tool',
        label: 'Tool',
        imageSrc: 'assets/images/build-bundle/tool.png'
      }
    ];

    if (this.selectedPackSize() === 2) {
      return baseSlots;
    }

    return [
      ...baseSlots,
      {
        id: 'drinkware',
        label: 'Drinkware',
        imageSrc: 'assets/images/build-bundle/drinkware.png'
      }
    ];
  });

  showCategoryTabs = computed(() => this.selectedKitType() !== 'matcha_kit');

  isMatchaKitPack2 = computed(
    () => this.selectedKitType() === 'matcha_kit' && this.selectedPackSize() === 2
  );

  browserProducts = computed(() => {
    if (!this.isMatchaKitPack2()) return [];

    const slotId = this.activeSlotId();
    if (!slotId) return [];

    const category = MATCHA_KIT_SLOT_CATEGORIES[slotId];
    return this.products().filter(
      (product) => product.category === category && !isProductOutOfStock(product)
    );
  });

  showBundlePricing = computed(() => {
    if (!this.isMatchaKitPack2()) return false;
    const selections = this.slotSelections();
    return !!selections.package && !!selections.tool;
  });

  bundlePricing = computed(() => {
    if (!this.showBundlePricing()) return null;

    const selections = this.slotSelections();
    const original =
      getDefaultPrice(selections.package!) + getDefaultPrice(selections.tool!);

    return {
      original,
      sale: original * 0.8
    };
  });

  canAddBundleToCart = computed(() => this.showBundlePricing());

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadProducts();
    }
  }

  selectKitType(kitType: KitType): void {
    this.selectedKitType.set(kitType);
    this.resetSelections();

    if (kitType === 'matcha_kit') {
      this.activeSlotId.set('package');
    } else {
      this.activeSlotId.set(null);
    }
  }

  selectPackSize(size: PackSize): void {
    this.selectedPackSize.set(size);
    this.resetSelections();
    this.activeSlotId.set(this.selectedKitType() === 'matcha_kit' ? 'package' : null);
  }

  selectSlot(slotId: SlotId): void {
    if (!this.isMatchaKitPack2()) return;
    this.activeSlotId.set(slotId);
  }

  onProductAdd(product: Product): void {
    const slotId = this.activeSlotId();
    if (!slotId || !this.isMatchaKitPack2()) return;

    this.slotSelections.update((selections) => ({
      ...selections,
      [slotId]: product
    }));
  }

  removeSlotProduct(slotId: SlotId, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    this.slotSelections.update((selections) => ({
      ...selections,
      [slotId]: null
    }));
  }

  getSlotProduct(slotId: SlotId): Product | null {
    return this.slotSelections()[slotId];
  }

  getProductPrimaryImage(product: Product): string {
    if (!product.images?.length) return '';

    const primary = product.images.find((image) => image.sort_order === 0);
    if (primary?.url) return primary.url;

    const sorted = [...product.images].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    );
    return sorted[0]?.url ?? '';
  }

  formatPrice(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }

  addBundleToCart(): void {
    if (!this.canAddBundleToCart()) return;

    const selections = this.slotSelections();
    const items = [selections.package, selections.tool].filter(Boolean) as Product[];

    items.forEach((product, index) => {
      this.cartService.addToCart(
        product as unknown as CartProduct,
        undefined,
        1,
        index === items.length - 1
      );
    });
  }

  private loadProducts(): void {
    this.loadingProducts.set(true);

    this.productService.getProducts().subscribe({
      next: (products) => {
        const inStock = products.filter((product) => !isProductOutOfStock(product));
        const outOfStock = products.filter((product) => isProductOutOfStock(product));
        this.products.set([...inStock, ...outOfStock]);
        this.loadingProducts.set(false);
      },
      error: () => {
        this.products.set([]);
        this.loadingProducts.set(false);
      }
    });
  }

  private resetSelections(): void {
    this.slotSelections.set({ ...EMPTY_SELECTIONS });
  }
}
