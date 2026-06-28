import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideMail, LucidePhone, LucideMapPin } from '@lucide/angular';
import { FooterComponent } from '../../../../shared/components/footer/footer.component';

@Component({
  selector: 'app-contact-us',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideMail,
    LucidePhone,
    LucideMapPin,
    FooterComponent
  ],
  templateUrl: './contact-us.component.html',
  styleUrl: './contact-us.component.scss'
})
export class ContactUsComponent {
  fullName = '';
  email = '';
  subject = 'General Inquiry';
  message = '';

  subjects = [
    'General Inquiry',
    'Order Status',
    'Product Support',
    'Partnership',
    'Feedback'
  ];

  isSubmitting = false;
  submitSuccess = false;
  submitError = false;

  submitMessage(form: any): void {
    if (form.invalid) {
      return;
    }

    this.isSubmitting = true;
    this.submitSuccess = false;
    this.submitError = false;

    // Simulate API request
    setTimeout(() => {
      this.isSubmitting = false;
      this.submitSuccess = true;
      this.fullName = '';
      this.email = '';
      this.subject = 'General Inquiry';
      this.message = '';
      form.resetForm({ subject: 'General Inquiry' });
    }, 1500);
  }
}
