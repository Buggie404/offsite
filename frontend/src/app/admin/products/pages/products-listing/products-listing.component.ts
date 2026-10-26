import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminBatchProduct, AdminProductService } from '../../services/admin-product.service';

@Component({
  selector: 'app-admin-products',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './products-listing.component.html',
  styleUrl: './products-listing.component.scss'
})
export class ProductsListingComponent implements OnInit {
  private productsApi = inject(AdminProductService);

  loading = true;
  error = '';
  search = '';
  rows: AdminBatchProduct[] = [];
  drafts: Record<number, string> = {};
  savingId: number | null = null;
  rowError = '';

  ngOnInit(): void {
    this.productsApi.list().subscribe({
      next: (response) => {
        this.rows = response.data || [];
        this.drafts = Object.fromEntries(this.rows.map(row => [row.product_id, row.batch_expiry_date || '']));
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load products.';
        this.loading = false;
      }
    });
  }

  get visibleRows(): AdminBatchProduct[] {
    const query = this.search.trim().toLowerCase();
    if (!query) return this.rows;
    return this.rows.filter(row =>
      row.name.toLowerCase().includes(query) || String(row.product_id).includes(query)
    );
  }

  dirty(row: AdminBatchProduct): boolean {
    return (this.drafts[row.product_id] || '') !== (row.batch_expiry_date || '');
  }

  save(row: AdminBatchProduct): void {
    if (!this.dirty(row) || this.savingId != null) return;
    this.savingId = row.product_id;
    this.rowError = '';
    const next = this.drafts[row.product_id]?.trim() || null;
    this.productsApi.updateBatchExpiry(row.product_id, next).subscribe({
      next: (response) => {
        const saved = response.data;
        this.rows = this.rows.map(item => item.product_id === saved.product_id ? saved : item);
        this.drafts[saved.product_id] = saved.batch_expiry_date || '';
        this.savingId = null;
      },
      error: () => {
        this.rowError = `Could not save batch expiry for ${row.name}.`;
        this.savingId = null;
      }
    });
  }
}
