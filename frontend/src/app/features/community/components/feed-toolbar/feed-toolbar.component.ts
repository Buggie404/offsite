import { Component, EventEmitter, Input, Output } from '@angular/core';
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

  onSortChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value as 'created_at' | 'like_count';
    this.sortChange.emit(value);
  }
}