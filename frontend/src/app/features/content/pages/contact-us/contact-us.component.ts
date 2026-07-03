import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideMail, LucidePhone, LucideMapPin, LucideChevronDown } from '@lucide/angular';
import { FooterComponent } from '../../../../shared/components/footer/footer.component';
import { InlineValidator, FieldConfig } from '../../../../shared/utils/inline-validator';

@Component({
  selector: 'app-contact-us',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideMail,
    LucidePhone,
    LucideMapPin,
    LucideChevronDown,
    FooterComponent
  ],
  templateUrl: './contact-us.component.html',
  styleUrl: './contact-us.component.scss'
})
export class ContactUsComponent implements AfterViewInit, OnDestroy {
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

  contactValidator: InlineValidator | null = null;

  ngAfterViewInit() {
    const contactConfigs: FieldConfig[] = [
      {
        field_id: 'fullName',
        error_element_id: 'fullName-error',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            regex_pattern: '^\\s*$',
            error_message: 'Full name is required'
          }
        ]
      },
      {
        field_id: 'email',
        error_element_id: 'email-error',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            regex_pattern: '^\\s*$',
            error_message: 'Email is required'
          },
          {
            sequence: 2,
            type: 'FORMAT_CHECK',
            regex_pattern: '^(?![a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$)',
            error_message: 'Invalid email address'
          }
        ]
      }
    ];

    this.contactValidator = new InlineValidator(contactConfigs);
    this.contactValidator.attach();
  }

  ngOnDestroy() {
    if (this.contactValidator) {
      this.contactValidator.detach();
    }
  }

  submitMessage(form: any): void {
    if (this.contactValidator && !this.contactValidator.validateAll()) {
      return;
    }
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
      if (this.contactValidator) {
        this.contactValidator.clearAll();
      }
    }, 1500);
  }
}
