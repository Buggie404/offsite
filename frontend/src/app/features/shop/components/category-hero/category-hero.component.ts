import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-category-hero',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './category-hero.component.html',
  styleUrls: ['./category-hero.component.scss']
})
export class CategoryHeroComponent {
  @Input() title: string = '';
  @Input() description: string = '';
  @Input() bgColor: string = '#CFE1B8';
  @Input() imageSrc: string = '';
}
