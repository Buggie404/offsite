const mongoose = require('mongoose');

const CONTACT_SUBJECTS = ['General Inquiry', 'Order Status', 'Product Support', 'Partnership', 'Feedback'];
const CONTACT_SOURCES = ['contact_form', 'chatbot'];
const CONTACT_STATUSES = ['new', 'in_progress', 'resolved'];

// One message sent from the Contact Us page, or from the chatbot's fallback form when the assistant fails.
const contactMessageSchema = new mongoose.Schema({
  contact_id: { type: String, required: true, unique: true, default: () => new mongoose.Types.ObjectId().toString() },
  // The chatbot fallback form only asks for email, so the name may be empty there.
  full_name: { type: String, default: null, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  subject: { type: String, enum: CONTACT_SUBJECTS, default: 'General Inquiry' },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  source: { type: String, enum: CONTACT_SOURCES, default: 'contact_form' },
  user_id: { type: String, default: null }, // User.user_id when the sender was signed in
  chat_session_id: { type: String, default: null }, // chatbot fallback: the session that failed
  status: { type: String, enum: CONTACT_STATUSES, default: 'new', index: true },
  handled_by: { type: String, default: null }, // user_id of the CSKH / Admin CC handling it
  handled_at: { type: Date, default: null },
  internal_note: { type: String, default: null, maxlength: 1000 }
}, {
  collection: 'ContactMessages',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false
});

contactMessageSchema.index({ status: 1, created_at: -1 });
contactMessageSchema.index({ email: 1, created_at: -1 });

module.exports = mongoose.model('ContactMessage', contactMessageSchema);
module.exports.CONTACT_SUBJECTS = CONTACT_SUBJECTS;
module.exports.CONTACT_SOURCES = CONTACT_SOURCES;
module.exports.CONTACT_STATUSES = CONTACT_STATUSES;
