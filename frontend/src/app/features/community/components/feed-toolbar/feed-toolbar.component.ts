import { Component, EventEmitter, Input, Output, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-feed-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feed-toolbar.component.html',
  styleUrls: ['./feed-toolbar.component.scss']
})
export class FeedToolbarComponent {

  @Input() activeCategory: 'MATCHA' | 'COFFEE' | 'RECIPE' | 'MY_POST' | '' = '';
  @Input() sort: 'created_at' | 'like_count' = 'created_at';

  @Output() createPost = new EventEmitter<void>();
  @Output() createRecipe = new EventEmitter<void>();
  @Output() categoryChange = new EventEmitter<'MATCHA' | 'COFFEE' | 'RECIPE' | 'MY_POST' | ''>();
  @Output() sortChange = new EventEmitter<'created_at' | 'like_count'>();

  isDropdownOpen = false;

  constructor(private elementRef: ElementRef) {}

  onCreatePost() {
    this.createPost.emit();
  }

  onCreateRecipe() {
    this.createRecipe.emit();
  }

  onFilterClick(value: 'MATCHA' | 'COFFEE' | 'RECIPE' | 'MY_POST' | '') {
    if (this.activeCategory === value) return;
    this.categoryChange.emit(value);
  }

  toggleDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  selectSort(value: 'created_at' | 'like_count', event: MouseEvent) {
    event.stopPropagation();
    if (this.sort !== value) {
      this.sortChange.emit(value);
    }
    this.isDropdownOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isDropdownOpen = false;
    }
  }
}