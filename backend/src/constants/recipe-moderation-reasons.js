// Hide / Delete reason enums for Admin Recipes.
// Values are stored on the recipe and in activity logs; labels are for admin UI and owner notices.
// `applies` filters the dropdown by recipe source (offsite | community).

const HIDE_REASONS = [
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

const DELETE_REASONS = [
  { value: 'copyright', label: 'Confirmed copyright violation', applies: ['community'] },
  { value: 'duplicate', label: 'Duplicate recipe', applies: ['community', 'offsite'] },
  { value: 'unsafe_confirmed', label: 'Confirmed unsafe instructions', applies: ['community', 'offsite'] },
  { value: 'created_in_error', label: 'Created by mistake', applies: ['offsite'] },
  { value: 'replaced', label: 'Replaced by a newer recipe', applies: ['offsite'] },
  { value: 'no_longer_relevant', label: 'No longer relevant', applies: ['offsite'] },
  { value: 'other', label: 'Other (note required)', applies: ['community', 'offsite'] }
];

const NOTE_MAX = 200;
// low_quality and other always need a note; other hide/delete reasons keep the note optional.
const NOTE_REQUIRED = new Set(['other', 'low_quality']);

function reasonsFor(action, source) {
  const list = action === 'delete' ? DELETE_REASONS : HIDE_REASONS;
  return list.filter((item) => item.applies.includes(source));
}

function findReason(action, source, value) {
  return reasonsFor(action, source).find((item) => item.value === value) || null;
}

function parseModerationBody(body, { action, source }) {
  const reasonValue = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  const reason = findReason(action, source, reasonValue);
  if (!reason) return { error: 'Choose a reason.' };
  if (note.length > NOTE_MAX) {
    return { error: `The note must be ${NOTE_MAX} characters or fewer.` };
  }
  if (NOTE_REQUIRED.has(reason.value) && !note) {
    return { error: reason.value === 'low_quality'
      ? 'Add a note explaining what needs fixing.'
      : 'Add a note when the reason is Other.' };
  }
  return { reason: reason.value, label: reason.label, note };
}

function ownerNotice({ action, label, note }) {
  const verb = action === 'delete' ? 'removed' : 'hidden';
  const base = `Your recipe was ${verb} because: ${label}.`;
  return note ? `${base} ${note}` : base;
}

module.exports = {
  HIDE_REASONS,
  DELETE_REASONS,
  NOTE_MAX,
  NOTE_REQUIRED,
  reasonsFor,
  findReason,
  parseModerationBody,
  ownerNotice
};
