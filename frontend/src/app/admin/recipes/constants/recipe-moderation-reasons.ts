export type RecipeModerationAction = 'hide' | 'delete';
export type RecipeModerationSource = 'offsite' | 'community';

export interface RecipeModerationReason {
  value: string;
  label: string;
  applies: RecipeModerationSource[];
}

export const NOTE_MAX = 200;

export const HIDE_REASONS: RecipeModerationReason[] = [
  { value: 'spam', label: 'Spam or advertising', applies: ['community'] },
  { value: 'inappropriate', label: 'Inappropriate content', applies: ['community'] },
  { value: 'off_topic', label: 'Off-topic', applies: ['community'] },
  { value: 'misleading', label: 'Misleading information', applies: ['community', 'offsite'] },
  { value: 'unsafe', label: 'Potentially unsafe instructions', applies: ['community', 'offsite'] },
  { value: 'under_review', label: 'Under review', applies: ['community', 'offsite'] },
  { value: 'low_quality', label: 'Needs fixing (missing or unclear info)', applies: ['community'] },
  { value: 'product_unavailable', label: 'Linked product unavailable', applies: ['offsite'] },
  { value: 'being_updated', label: 'Being updated', applies: ['offsite'] },
  { value: 'seasonal', label: 'Out of season', applies: ['offsite'] },
  { value: 'other', label: 'Other (note required)', applies: ['community', 'offsite'] }
];

export const DELETE_REASONS: RecipeModerationReason[] = [
  { value: 'copyright', label: 'Confirmed copyright violation', applies: ['community'] },
  { value: 'duplicate', label: 'Duplicate recipe', applies: ['community', 'offsite'] },
  { value: 'unsafe_confirmed', label: 'Confirmed unsafe instructions', applies: ['community', 'offsite'] },
  { value: 'created_in_error', label: 'Created by mistake', applies: ['offsite'] },
  { value: 'replaced', label: 'Replaced by a newer recipe', applies: ['offsite'] },
  { value: 'no_longer_relevant', label: 'No longer relevant', applies: ['offsite'] },
  { value: 'other', label: 'Other (note required)', applies: ['community', 'offsite'] }
];

export function reasonsFor(
  action: RecipeModerationAction,
  source: RecipeModerationSource
): RecipeModerationReason[] {
  const list = action === 'delete' ? DELETE_REASONS : HIDE_REASONS;
  return list.filter((item) => item.applies.includes(source));
}

export function noteRequired(reason: string): boolean {
  return reason === 'other' || reason === 'low_quality';
}

export function notePlaceholder(reason: string): string {
  if (reason === 'low_quality') {
    return 'Say what needs fixing, e.g. “Step 2 is missing the water amount”';
  }
  if (reason === 'other') return 'Required note';
  return 'Optional note for the activity log';
}
