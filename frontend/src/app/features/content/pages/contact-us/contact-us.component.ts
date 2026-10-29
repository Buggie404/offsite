import { Component, AfterViewInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideMail, LucidePhone, LucideMapPin, LucideChevronDown } from '@lucide/angular';
import { InlineValidator, FieldConfig } from '../../../../shared/utils/inline-validator';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';
import { ContactMessageService } from '../../../../shared/services/contact-message.service';
import {
  CONTACT_SUBJECTS,
  ContactMessageError,
  ContactSubject
} from '../../../../shared/models/contact-message.model';

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
    BackToTopComponent
  ],
  templateUrl: './contact-us.component.html',
  styleUrl: './contact-us.component.scss'
})
export class ContactUsComponent implements AfterViewInit, OnDestroy {
  private contactMessageService = inject(ContactMessageService);
  private cdr = inject(ChangeDetectorRef);

  fullName = '';
  email = '';
  subject: ContactSubject = 'General Inquiry';
  message = '';

  subjects = CONTACT_SUBJECTS;

  isSubmitting = false;
  submitSuccess = false;
  submitError = false;
  submitErrorMessage = '';
  isSubjectDropdownOpen = false;

  contactValidator: InlineValidator | null = null;

  toggleSubjectDropdown(): void {
    this.isSubjectDropdownOpen = !this.isSubjectDropdownOpen;
  }

  selectSubject(opt: ContactSubject): void {
    this.subject = opt;
    this.isSubjectDropdownOpen = false;
  }

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

  submitMessage(form: NgForm): void {
    if (this.contactValidator && !this.contactValidator.validateAll()) {
      return;
    }
    if (form.invalid || this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;
    this.submitSuccess = false;
    this.submitError = false;
    this.submitErrorMessage = '';

    this.contactMessageService.send({
      full_name: this.fullName.trim(),
      email: this.email.trim(),
      subject: this.subject,
      message: this.message.trim(),
      source: 'contact_form'
    }).subscribe({
      next: () => {
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
        this.cdr.markForCheck();
      },
      error: (err: HttpErrorResponse) => {
        const body = (err.error && typeof err.error === 'object' ? err.error : {}) as Partial<ContactMessageError>;
        this.isSubmitting = false;
        this.submitError = true;
        this.submitErrorMessage = err.status === 400 && body.message
          ? body.message
          : 'Oops! Something went wrong. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }
}
