import { Component } from '@angular/core';

@Component({
  selector: 'app-home',
  standalone: true,
  template: `
    <div class="home-container" style="padding: 80px 20px; text-align: center; font-family: 'DM Sans', sans-serif;">
      <h1 style="font-size: 2.5rem; font-weight: 300; letter-spacing: 0.05em; color: #1a1a1a; margin-bottom: 16px;">Offsite Rituals</h1>
      <p style="color: #666; max-width: 600px; margin: 0 auto; line-height: 1.6; font-size: 1.1rem;">
        Welcome to your slow coffee space. Log in to share your favorite origins, discover unique brewing ratios, and connect with a community of slow ritual lovers.
      </p>
    </div>
  `
})
export class HomeComponent {}