import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LucideExternalLink } from '@lucide/angular';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LucideExternalLink],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('frontend');
}
