import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideArrowRight } from '@lucide/angular';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';

@Component({
  selector: 'app-about-us',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideArrowRight, BackToTopComponent],
  templateUrl: './about-us.component.html',
  styleUrl: './about-us.component.scss'
})
export class AboutUsComponent {}
