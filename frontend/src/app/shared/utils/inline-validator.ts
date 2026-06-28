export interface ValidationRule {
  sequence: number;
  type: 'EMPTY_CHECK' | 'FORMAT_CHECK' | 'LENGTH_CHECK';
  condition?: string;
  action?: 'CLEAR_ERROR_AND_STOP';
  regex_pattern?: string;
  min_length?: number | string;
  max_length?: number | string;
  error_message?: string;
}

export interface FieldConfig {
  field_id: string;
  error_element_id: string;
  rules: ValidationRule[];
}

export class InlineValidator {
  private configs: FieldConfig[];
  private attachedContainer: HTMLElement | Document | null = null;

  constructor(configs: FieldConfig[]) {
    this.configs = configs;
  }

  /**
   * Universal event handler for input events.
   * Leverages event delegation on the attached container.
   */
  private handleInputEvent = (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (!target || !target.id) return;

    // Apply auto-formatting: trim leading whitespaces if followed by character(s)
    if (/^\s+\S/.test(target.value)) {
      target.value = target.value.trimStart();
      target.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const config = this.configs.find((c) => c.field_id === target.id);
    if (config) {
      this.validateConfig(config, target);
    }
  };

  /**
   * Attaches input event listeners to the given container.
   */
  attach(container: HTMLElement | Document = document): void {
    if (this.attachedContainer) {
      this.detach();
    }
    this.attachedContainer = container;
    this.attachedContainer.addEventListener('input', this.handleInputEvent);
  }

  /**
   * Detaches event listeners to clean up.
   */
  detach(): void {
    if (this.attachedContainer) {
      this.attachedContainer.removeEventListener('input', this.handleInputEvent);
      this.attachedContainer = null;
    }
  }

  /**
   * Validates a specific field by its element ID.
   * Returns true if valid, false if invalid.
   */
  validateField(fieldId: string): boolean {
    const config = this.configs.find((c) => c.field_id === fieldId);
    if (!config) return true;

    const inputEl = document.getElementById(config.field_id) as HTMLInputElement | HTMLTextAreaElement | null;
    return this.validateConfig(config, inputEl);
  }

  /**
   * Validates all registered fields.
   * Returns true if all fields are valid, false otherwise.
   */
  validateAll(): boolean {
    let allValid = true;
    for (const config of this.configs) {
      const isValid = this.validateField(config.field_id);
      if (!isValid) {
        allValid = false;
      }
    }
    return allValid;
  }

  /**
   * Clears errors on all registered fields.
   */
  clearAll(): void {
    for (const config of this.configs) {
      const inputEl = document.getElementById(config.field_id);
      const errorEl = document.getElementById(config.error_element_id);
      this.clearError(inputEl, errorEl);
    }
  }

  /**
   * Internal method to run validation rules on a given field config and input element.
   */
  private validateConfig(config: FieldConfig, inputEl: HTMLInputElement | HTMLTextAreaElement | null): boolean {
    const errorEl = document.getElementById(config.error_element_id);
    const currentValue = inputEl ? inputEl.value : '';

    // Sort rules by sequence ascending (Priority)
    const sortedRules = [...config.rules].sort((a, b) => a.sequence - b.sequence);

    for (const rule of sortedRules) {
      if (rule.type === 'EMPTY_CHECK') {
        let isEmpty = currentValue === '';
        if (rule.condition) {
          try {
            // Safely evaluate condition with 'value' argument
            const evalFn = new Function('value', `return ${rule.condition}`);
            isEmpty = evalFn(currentValue);
          } catch (err) {
            isEmpty = currentValue === '';
          }
        }

        if (isEmpty) {
          // EMPTY_CHECK matches: clear error, remove class, and STOP
          this.clearError(inputEl, errorEl);
          return true;
        }
      } else if (rule.type === 'FORMAT_CHECK') {
        let isInvalid = false;
        if (rule.regex_pattern) {
          try {
            const regex = new RegExp(rule.regex_pattern);
            isInvalid = regex.test(currentValue);
          } catch (err) {
            console.error(`InlineValidator: Invalid regex pattern "${rule.regex_pattern}"`, err);
          }
        } else if (rule.condition) {
          try {
            const evalFn = new Function('value', `return ${rule.condition}`);
            isInvalid = !!evalFn(currentValue);
          } catch (err) {
            console.error(`InlineValidator: Error evaluating condition "${rule.condition}"`, err);
          }
        }

        if (isInvalid) {
          // Pattern matched or condition met (indicates an error): display error, add invalid class, and STOP
          this.setError(inputEl, errorEl, rule.error_message || '');
          return false;
        }
      } else if (rule.type === 'LENGTH_CHECK') {
        const len = currentValue.length;
        const min = rule.min_length !== undefined ? Number(rule.min_length) : undefined;
        const max = rule.max_length !== undefined ? Number(rule.max_length) : undefined;

        if ((min !== undefined && len < min) || (max !== undefined && len > max)) {
          // Length out of bounds: display error, add invalid class, and STOP
          this.setError(inputEl, errorEl, rule.error_message || '');
          return false;
        }
      }
    }

    // Valid: clear error and remove invalid class
    this.clearError(inputEl, errorEl);
    return true;
  }

  private clearError(inputEl: HTMLElement | null, errorEl: HTMLElement | null): void {
    if (inputEl) {
      inputEl.classList.remove('invalid');
    }
    if (errorEl) {
      errorEl.textContent = '';
    }
  }

  private setError(inputEl: HTMLElement | null, errorEl: HTMLElement | null, message: string): void {
    if (inputEl) {
      inputEl.classList.add('invalid');
    }
    if (errorEl) {
      errorEl.textContent = message;
    }
  }
}
