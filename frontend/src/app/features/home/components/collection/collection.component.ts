import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Collection {
  id: string;
  name: string;
  description: string;
  image: string;       // path từ assets/, ví dụ: 'assets/images/matcha.png'
  imageAlt: string;
  productCount: number;
  productLabel: string; // 'PRODUCTS' | 'ITEMS' | 'SETS'
  size: 'large' | 'small';
  ctaType: 'shop' | 'explore';
}

@Component({
  selector: 'app-collection',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './collection.component.html',
  styleUrls: ['./collection.component.scss'],
})
export class CollectionComponent {

  // Mock data — sau này thay bằng API từ service
  largeCollections: Collection[] = [
    {
      id: 'matcha',
      name: 'Matcha',
      description: 'Bright and grassy with a clean, slightly sweet finish. Best cold or straight.',
      image: 'assets/images/category_matcha.png',
      imageAlt: 'Matcha pixel art illustration',
      productCount: 12,
      productLabel: 'PRODUCTS',
      size: 'large',
      ctaType: 'shop',
    },
    {
      id: 'coffee',
      name: 'Coffee',
      description: 'Deeply aromatic roasts sourced from ethical farms across the globe.',
      image: 'assets/images/category_coffee.png',
      imageAlt: 'Coffee pixel art illustration',
      productCount: 8,
      productLabel: 'PRODUCTS',
      size: 'large',
      ctaType: 'shop',
    },
  ];

  smallCollections: Collection[] = [
    {
      id: 'tools',
      name: 'Tools',
      description: '',
      image: 'assets/images/category_tools.png',
      imageAlt: 'Tools pixel art illustration',
      productCount: 15,
      productLabel: 'ITEMS',
      size: 'small',
      ctaType: 'explore',
    },
    {
      id: 'drinkware',
      name: 'Drinkware',
      description: '',
      image: 'assets/images/category_drinkware.png',
      imageAlt: 'Drinkware pixel art illustration',
      productCount: 22,
      productLabel: 'ITEMS',
      size: 'small',
      ctaType: 'explore',
    },
    {
      id: 'bundles',
      name: 'Sets & Bundles',
      description: '',
      image: 'assets/images/category_sets&bundles.png',
      imageAlt: 'Sets & Bundles pixel art illustration',
      productCount: 5,
      productLabel: 'SETS',
      size: 'small',
      ctaType: 'explore',
    },
  ];

  // Format hiển thị số lượng — "12 PRODUCTS", "08 PRODUCTS", "05 SETS"
  formatCount(count: number, label: string): string {
    return `${String(count).padStart(2, '0')} ${label}`;
  }

  onShopNow(collectionId: string): void {
    // TODO: router.navigate(['/shop'], { queryParams: { collection: collectionId } })
    console.log('Shop now:', collectionId);
  }

  onExplore(collectionId: string): void {
    // TODO: router.navigate(['/shop', collectionId])
    console.log('Explore:', collectionId);
  }
}