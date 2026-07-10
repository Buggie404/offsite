import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { CategoryHeroComponent } from '../../components/category-hero/category-hero.component';
import { CategoryCatalogComponent } from '../../components/category-catalog/category-catalog.component';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';

@Component({
  selector: 'app-category-page',
  standalone: true,
  imports: [CommonModule, CategoryHeroComponent, CategoryCatalogComponent, BackToTopComponent],
  templateUrl: './category.component.html',
  styleUrls: ['./category.component.scss']
})
export class CategoryComponent implements OnInit {
  currentCategoryData: any = null;
  currentCategorySlug: string = '';

  private categoriesData: Record<string, any> = {
    'matcha': {
      title: 'MATCHA',
      description: 'Explore our diverse tea collection, from Japanese matcha and rare Chinese oolongs to delicate white teas and flavored black teas. Sourced from renowned regions like Uji, Yame, Wuyi, and Jinggu, each tea offers a unique expression of variety, terroir, and craftsmanship.',
      bgColor: '#CFE1B8',
      imageSrc: 'assets/images/category_matcha.png'
    },
    'coffee': {
      title: 'COFFEE',
      description: 'Discover our thoughtfully sourced coffee collection from single-origin offerings and decafs to dark roasts and blends. Each coffee reflects enduring partnerships with farmers across Ethiopia, Peru, Colombia, Burundi, Uganda, Bolivia, Sumatra, and beyond, emphasizing quality, sustainability, and transparency in every cup.',
      bgColor: '#E8D5B0',
      imageSrc: 'assets/images/category_coffee.png'
    },
    'tools': {
      title: 'TOOLS',
      description: 'Explore our curated selection of ceramic matcha bowls, bamboo whisks, and traditional accessories alongside essential coffee brewing gear from Chemex and French press to precision grinders and gooseneck kettles. Each tool is chosen for quality, craftsmanship, and the perfect brew, whether you\'re whisking matcha or pouring coffee.',
      bgColor: '#C4A882',
      imageSrc: 'assets/images/category_tools.png'
    },
    'drinkware': {
      title: 'DRINKWARES',
      description: 'Elevate your daily ritual with our thoughtfully curated drinkware from handmade ceramic mugs and stackable vintage cups to vacuum-insulated tumblers, travel bottles, and artisan teapots. Each piece blends form and function, crafted for comfort, temperature retention, and a beautiful tea or coffee experience at home or on the go.',
      bgColor: '#CFE1B8',
      imageSrc: 'assets/images/category_drinkware.png'
    },
    'bundles': {
      title: 'SETS & BUNDLES',
      description: 'Explore our thoughtfully assembled bundles and kits—from pour-over starter sets and matcha gift boxes to coffee sampler trios and artisan teaware collections. Whether you\'re stocking up on your favorites, gifting a coffee lover, or recreating café-style lattes at home, each set is curated for convenience, value, and exceptional taste.',
      bgColor: '#EFB5CF',
      imageSrc: 'assets/images/category_sets%26bundles.png'
    },
    'best-seller': {
      title: 'BEST SELLERS',
      description: '',
      bgColor: '#375534',
      textColor: '#FFFFFF',
      imageSrc: ''
    },
    'new-arrival': {
      title: 'NEW ARRIVALS',
      description: '',
      bgColor: '#375534',
      textColor: '#FFFFFF',
      imageSrc: ''
    }
  };

  constructor(private route: ActivatedRoute) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const slug = params.get('category');
      this.currentCategorySlug = slug ?? '';
      if (slug && this.categoriesData[slug]) {
        this.currentCategoryData = this.categoriesData[slug];
      } else {
        this.currentCategoryData = null;
      }
    });
  }
}
