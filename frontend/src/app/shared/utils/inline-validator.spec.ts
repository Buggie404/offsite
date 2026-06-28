// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InlineValidator, FieldConfig } from './inline-validator';

describe('InlineValidator', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Set up mock DOM container
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up DOM and restore body
    document.body.removeChild(container);
  });

  it('should handle EMPTY_CHECK correctly (action: CLEAR_ERROR_AND_STOP)', () => {
    const input = document.createElement('input');
    input.id = 'test-input';
    const errorEl = document.createElement('span');
    errorEl.id = 'test-error';
    container.appendChild(input);
    container.appendChild(errorEl);

    // Initial state: invalid class and error message set
    input.classList.add('invalid');
    errorEl.textContent = 'Initial Error';

    const configs: FieldConfig[] = [
      {
        field_id: 'test-input',
        error_element_id: 'test-error',
        rules: [
          {
            sequence: 1,
            type: 'EMPTY_CHECK',
            condition: "value === ''",
            action: 'CLEAR_ERROR_AND_STOP',
          },
          {
            sequence: 2,
            type: 'LENGTH_CHECK',
            min_length: 5,
            error_message: 'Length must be at least 5',
          },
        ],
      },
    ];

    const validator = new InlineValidator(configs);
    validator.attach(container);

    // Act: Set value to empty and dispatch input event
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Assert: should clear invalid class, clear text, and STOP (no length check error)
    expect(input.classList.contains('invalid')).toBe(false);
    expect(errorEl.textContent).toBe('');

    validator.detach();
  });

  it('should handle FORMAT_CHECK pattern matching (regex checks that CATCH errors)', () => {
    const input = document.createElement('input');
    input.id = 'test-input-format';
    const errorEl = document.createElement('span');
    errorEl.id = 'test-error-format';
    container.appendChild(input);
    container.appendChild(errorEl);

    const configs: FieldConfig[] = [
      {
        field_id: 'test-input-format',
        error_element_id: 'test-error-format',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            // Pattern to catch errors: digits should trigger format error
            regex_pattern: '\\d',
            error_message: 'Digits are not allowed',
          },
        ],
      },
    ];

    const validator = new InlineValidator(configs);
    validator.attach(container);

    // Act: Input valid text (no digits)
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Assert: should be valid
    expect(input.classList.contains('invalid')).toBe(false);
    expect(errorEl.textContent).toBe('');

    // Act: Input invalid text containing a digit
    input.value = 'abc1';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Assert: should trigger error and add class
    expect(input.classList.contains('invalid')).toBe(true);
    expect(errorEl.textContent).toBe('Digits are not allowed');

    validator.detach();
  });

  it('should handle LENGTH_CHECK limits', () => {
    const input = document.createElement('input');
    input.id = 'test-input-len';
    const errorEl = document.createElement('span');
    errorEl.id = 'test-error-len';
    container.appendChild(input);
    container.appendChild(errorEl);

    const configs: FieldConfig[] = [
      {
        field_id: 'test-input-len',
        error_element_id: 'test-error-len',
        rules: [
          {
            sequence: 1,
            type: 'LENGTH_CHECK',
            min_length: 3,
            max_length: 6,
            error_message: 'Length must be between 3 and 6',
          },
        ],
      },
    ];

    const validator = new InlineValidator(configs);
    validator.attach(container);

    // Too short (2 chars)
    input.value = 'ab';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('invalid')).toBe(true);
    expect(errorEl.textContent).toBe('Length must be between 3 and 6');

    // Valid (4 chars)
    input.value = 'abcd';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('invalid')).toBe(false);
    expect(errorEl.textContent).toBe('');

    // Too long (7 chars)
    input.value = 'abcdefg';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('invalid')).toBe(true);
    expect(errorEl.textContent).toBe('Length must be between 3 and 6');

    validator.detach();
  });

  it('should validate all fields and clear them manually', () => {
    const input1 = document.createElement('input');
    input1.id = 'input-1';
    const error1 = document.createElement('span');
    error1.id = 'error-1';

    const input2 = document.createElement('input');
    input2.id = 'input-2';
    const error2 = document.createElement('span');
    error2.id = 'error-2';

    container.appendChild(input1);
    container.appendChild(error1);
    container.appendChild(input2);
    container.appendChild(error2);

    const configs: FieldConfig[] = [
      {
        field_id: 'input-1',
        error_element_id: 'error-1',
        rules: [
          {
            sequence: 1,
            type: 'LENGTH_CHECK',
            min_length: 3,
            error_message: 'Min length 3',
          },
        ],
      },
      {
        field_id: 'input-2',
        error_element_id: 'error-2',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            regex_pattern: 'foo',
            error_message: 'Cannot contain foo',
          },
        ],
      },
    ];

    const validator = new InlineValidator(configs);

    // Set invalid inputs
    input1.value = 'a'; // too short
    input2.value = 'myfoo'; // contains foo

    const result = validator.validateAll();
    expect(result).toBe(false);
    expect(input1.classList.contains('invalid')).toBe(true);
    expect(error1.textContent).toBe('Min length 3');
    expect(input2.classList.contains('invalid')).toBe(true);
    expect(error2.textContent).toBe('Cannot contain foo');

    // Fix values
    input1.value = 'abc';
    input2.value = 'bar';
    const resultAfterFix = validator.validateAll();
    expect(resultAfterFix).toBe(true);
    expect(input1.classList.contains('invalid')).toBe(false);
    expect(error1.textContent).toBe('');
    expect(input2.classList.contains('invalid')).toBe(false);
    expect(error2.textContent).toBe('');

    // Clear manually
    input1.classList.add('invalid');
    error1.textContent = 'Some temporary error';
    validator.clearAll();
    expect(input1.classList.contains('invalid')).toBe(false);
    expect(error1.textContent).toBe('');
  });

  it('should trim leading spaces when followed by a non-whitespace character', () => {
    const input = document.createElement('input');
    input.id = 'trim-input';
    const errorEl = document.createElement('span');
    errorEl.id = 'trim-error';
    container.appendChild(input);
    container.appendChild(errorEl);

    const configs: FieldConfig[] = [
      {
        field_id: 'trim-input',
        error_element_id: 'trim-error',
        rules: [
          {
            sequence: 1,
            type: 'LENGTH_CHECK',
            min_length: 3,
            error_message: 'Min length is 3',
          },
        ],
      },
    ];

    const validator = new InlineValidator(configs);
    validator.attach(container);

    // Act: Set value with leading spaces followed by non-whitespace character
    input.value = '  abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Assert: should trim to 'abc', and should not be invalid
    expect(input.value).toBe('abc');
    expect(input.classList.contains('invalid')).toBe(false);

    validator.detach();
  });

  it('should handle FORMAT_CHECK with custom condition string', () => {
    const input = document.createElement('input');
    input.id = 'cond-input';
    const errorEl = document.createElement('span');
    errorEl.id = 'cond-error';
    container.appendChild(input);
    container.appendChild(errorEl);

    // Expose mock list on window to evaluate in condition
    (window as any).MOCK_LIST = new Set(['valid1', 'valid2']);

    const configs: FieldConfig[] = [
      {
        field_id: 'cond-input',
        error_element_id: 'cond-error',
        rules: [
          {
            sequence: 1,
            type: 'FORMAT_CHECK',
            // Condition evaluates to true if value is NOT in the mock list
            condition: '!window.MOCK_LIST.has(value)',
            error_message: 'Value is not valid',
          },
        ],
      },
    ];

    const validator = new InlineValidator(configs);
    validator.attach(container);

    // Act: Input invalid value
    input.value = 'invalidValue';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('invalid')).toBe(true);
    expect(errorEl.textContent).toBe('Value is not valid');

    // Act: Input valid value
    input.value = 'valid1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('invalid')).toBe(false);
    expect(errorEl.textContent).toBe('');

    delete (window as any).MOCK_LIST;
    validator.detach();
  });
});

