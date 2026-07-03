import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProductService } from '../../../../features/home/services/product.service';
import { Product, Variant } from '../../../../features/home/models/product.model';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss'
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private productService = inject(ProductService);

  product = signal<Product | null>(null);
  selectedVariant = signal<Variant | null>(null);
  quantity = signal<number>(1);
  isLoading = signal<boolean>(true);
  errorMessage = signal<string>('');

  ngOnInit(): void {
    const productId = this.route.snapshot.paramMap.get('id');
    if (!productId) {
      this.errorMessage.set('Product ID not found.');
      this.isLoading.set(false);
      return;
    }

    this.productService.getProductById(productId).subscribe({
      next: (prod: Product) => {
        this.product.set(prod);
        // Set default variant if available
        if (prod.variants && prod.variants.length) {
          const def = prod.variants.find(v => v.is_default) || prod.variants[0];
          this.selectedVariant.set(def);
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load product details:', err);
        this.errorMessage.set('Product not found or has been disabled.');
        this.isLoading.set(false);
      }
    });
  }

  selectVariant(variant: Variant): void {
    this.selectedVariant.set(variant);
  }

  incrementQty(): void {
    this.quantity.update(q => q + 1);
  }

  decrementQty(): void {
    this.quantity.update(q => (q > 1 ? q - 1 : 1));
  }

  getPrimaryImage(): string {
    const prod = this.product();
    if (!prod) return '';
    
    // Check variant specific images first
    const variant = this.selectedVariant();
    if (variant?.images && variant.images.length) {
      return variant.images[0].url;
    }
    
    // Fallback to product images
    if (prod.images && prod.images.length) {
      return prod.images[0].url;
    }
    return '';
  }

  getOrigin(): string {
    const p = this.product();
    if (!p) return '';
    switch (p.category) {
      case 'matcha':     return p.matcha?.origin ?? '';
      case 'coffee':     return [p.coffee?.product_origin, p.coffee?.process_type].filter(Boolean).join(' · ');
      case 'tools':      return p.tools?.tool_category ?? '';
      case 'drinkware':  return p.drinkware?.ware_type ?? '';
      default:           return '';
    }
  }

  getTags(): string[] {
    const p = this.product();
    if (!p) return [];
    switch (p.category) {
      case 'matcha':
        return p.matcha?.product_grade ? [p.matcha.product_grade] : [];
      case 'coffee':
        return p.coffee?.tasting_notes ?? [];
      case 'tools':
        return p.tools?.tool_type ? [p.tools.tool_type] : [];
      case 'drinkware':
        return p.drinkware?.material ? [p.drinkware.material] : [];
      default:
        return p.product_tag ?? [];
    }
  }

  onAddToCart(): void {
    const prod = this.product();
    if (!prod) return;
    const variant = this.selectedVariant();
    const qty = this.quantity();
    
    const variantStr = variant?.label ? ` (${variant.label})` : '';
    alert(`Successfully added ${qty}x ${prod.name}${variantStr} to cart! (Mock Action)`);
  }

  goBack(): void {
    // Go back in history, or redirect to shop
    if (window.history.length > 1) {
      window.history.back();
    } else {
      this.router.navigate(['/']);
    }
  }
}
