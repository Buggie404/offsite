const ContactMessage = require('../models/ContactMessage');
const contactService = require('../services/contact-message.service');
const { resolveCommunityUserId } = require('../services/follow.service');

function snap(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

// POST /api/contact-messages  – public (Contact Us page, chatbot fallback form)
async function createContactMessage(req, res) {
  try {
    const body = req.body || {};
    const { value, error } = contactService.validateInput(body, { requireName: body.source !== 'chatbot' });
    if (error) return res.status(400).json({ success: false, ...error });

    const chatSessionId = typeof body.chat_session_id === 'string' ? body.chat_session_id.trim().slice(0, 100) || null : null;
    const saved = await contactService.createContactMessage(value, {
      userId: await resolveCommunityUserId(req),
      chatSessionId
    });

    res.status(201).json({
      success: true,
      contact_id: saved.contact_id,
      message: 'Your message has been received. We will reply by email.'
    });
  } catch (error) {
    console.error('Error saving contact message:', error);
    res.status(500).json({ success: false, message: 'Could not send your message. Please try again.' });
  }
}

// GET /api/admin/contact-messages?status=&source=&search=&page=&limit=  (CSKH, Admin CC)
async function listContactMessages(req, res) {
  try {
    const result = await contactService.listContactMessages(req.query);
    res.json({ ...result, data: result.data.map(snap) });
  } catch (error) {
    console.error('Error listing contact messages:', error);
    res.status(500).json({ error: 'Failed to load contact messages' });
  }
}

// GET /api/admin/contact-messages/:contactId
async function getContactMessage(req, res) {
  try {
    const doc = await ContactMessage.findOne({ contact_id: req.params.contactId }).lean();
    if (!doc) return res.status(404).json({ error: 'Contact message not found' });
    res.json({ data: snap(doc) });
  } catch (error) {
    console.error('Error loading contact message:', error);
    res.status(500).json({ error: 'Failed to load contact message' });
  }
}

// PATCH /api/admin/contact-messages/:contactId  body: { status?, internal_note? }
async function updateContactMessage(req, res) {
  try {
    const { status, internal_note: internalNote } = req.body || {};
    const update = {};

    if (status !== undefined) {
      if (!contactService.CONTACT_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      update.status = status;
      update.handled_by = req.user.user_id;
      update.handled_at = new Date();
    }
    if (internalNote !== undefined) {
      if (internalNote !== null && typeof internalNote !== 'string') return res.status(400).json({ error: 'Invalid note' });
      update.internal_note = internalNote ? internalNote.trim().slice(0, 1000) || null : null;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });

    const before = await ContactMessage.findOne({ contact_id: req.params.contactId }).lean();
    if (!before) return res.status(404).json({ error: 'Contact message not found' });

    const after = await ContactMessage.findOneAndUpdate(
      { contact_id: before.contact_id },
      { $set: update },
      { new: true, runValidators: true }
    ).lean();

    await req.writeActivityLog({
      actionType: 'contact.update',
      targetEntity: 'ContactMessages',
      targetId: after.contact_id,
      oldValue: { status: before.status, internal_note: before.internal_note },
      newValue: { status: after.status, internal_note: after.internal_note }
    });
    res.json({ data: snap(after) });
  } catch (error) {
    console.error('Error updating contact message:', error);
    res.status(500).json({ error: 'Failed to update contact message' });
  }
}

module.exports = {
  createContactMessage,
  listContactMessages,
  getContactMessage,
  updateContactMessage
};
