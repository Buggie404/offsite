export type KitType = 'matcha_kit' | 'coffee_kit' | 'bundle';

export type PackSize = 2 | 3;

export type KitSlotId = 'package' | 'tool' | 'drinkware';

export type BundlePackageSlotId = `package-${number}`;

export type SlotKey = KitSlotId | BundlePackageSlotId;

export type BundleCategoryFilter = 'all' | 'matcha' | 'coffee';

export interface PersistedSlotSelection {
  productId: number;
  variantSku: string;
}

export interface BundleBuilderSnapshot {
  kitType: KitType;
  packSize: PackSize;
  activeSlotKey: SlotKey | null;
  categoryFilter: BundleCategoryFilter;
  slots: Partial<Record<SlotKey, PersistedSlotSelection>>;
}
