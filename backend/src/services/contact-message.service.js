const ContactMessage = require('../models/ContactMessage');
const { CONTACT_SUBJECTS, CONTACT_SOURCES, CONTACT_STATUSES } = require('../models/ContactMessage');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE_LENGTH = 2000;
// A second identical submit (double click, retry after a slow response) within this window is not stored again.
const DUPLICATE_WINDOW_MS = 60 * 1000;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Returns { value } or { error: { field, message } } in the format the forms show inline.
function validateInput(body, { requireName }) {
  const fullName = text(body.full_name);
  const email = text(body.email).toLowerCase();
  const message = text(body.message);
  const subject = CONTACT_SUBJECTS.includes(body.subject) ? body.subject : 'General Inquiry';
  const source = CONTACT_SOURCES.includes(body.source) ? body.source : 'contact_form';

  if (requireName && !fullName) return { error: { field: 'full_name', message: 'Full name is required.' } };
  if (fullName.length > 100) return { error: { field: 'full_name', message: 'Full name is too long.' } };
  if (!EMAIL_PATTERN.test(email)) return { error: { field: 'email', message: 'Enter a valid email address.' } };
  if (!message) return { error: { field: 'message', message: 'Message is required.' } };
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: { field: 'message', message: `Message exceeds the ${MAX_MESSAGE_LENGTH}-character limit.` } };
  }

  return { value: { full_name: fullName || null, email, message, subject, source } };
}

async function createContactMessage(input, { userId = null, chatSessionId = null } = {}) {
  const duplicate = await ContactMessage.findOne({
    email: input.email,
    message: input.message,
    created_at: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) }
  }).lean();
  if (duplicate) return duplicate;

  const doc = await ContactMessage.create({ ...input, user_id: userId, chat_session_id: chatSessionId });
  return doc.toObject();
}

async function listContactMessages({ status, source, search, page = 1, limit = 20 }) {
  const query = {};
  if (CONTACT_STATUSES.includes(status)) query.status = status;
  if (CONTACT_SOURCES.includes(source)) query.source = source;
  const q = text(search);
  if (q) {
    const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ email: pattern }, { full_name: pattern }, { message: pattern }];
  }

  const pageNumber = Math.max(1, parseInt(page, 10) || 1);
  const limitCount = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const [data, total, counts] = await Promise.all([
    ContactMessage.find(query).sort({ created_at: -1 }).skip((pageNumber - 1) * limitCount).limit(limitCount).lean(),
    ContactMessage.countDocuments(query),
    ContactMessage.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  ]);

  const statusCounts = Object.fromEntries(CONTACT_STATUSES.map(s => [s, 0]));
  counts.forEach(c => { statusCounts[c._id] = c.count; });

  return { data, total, page: pageNumber, limit: limitCount, status_counts: statusCounts };
}

module.exports = {
  CONTACT_STATUSES,
  validateInput,
  createContactMessage,
  listContactMessages
};
