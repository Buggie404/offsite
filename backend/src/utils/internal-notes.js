// Orders.internal_notes holds a JSON array of { text, author, created_at }, newest first.
// Older orders may still hold a plain string.

function parseInternalNotes(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value
      ? [{ text: String(value), author: 'Admin', created_at: new Date().toISOString() }]
      : [];
  }
}

function appendInternalNote(value, note, author) {
  const notes = parseInternalNotes(value);
  notes.unshift({
    text: note,
    author: author || 'Admin',
    created_at: new Date().toISOString()
  });
  return JSON.stringify(notes);
}

module.exports = { parseInternalNotes, appendInternalNote };
