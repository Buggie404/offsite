const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  method: {
    type: String,
    enum: ['cod', 'qr', 'bank_transfer', 'card'],
    required: true
  },
  card_info: {
    brand: { type: String, default: null },
    last4: { type: String, default: null },
    cardholder_name: { type: String, default: null }
  }
}, { _id: false });

const refundItemSchema = new mongoose.Schema({
  product_id: { type: String, required: true },
  variant_id: { type: String, required: true },
  product_name: { type: String, required: true },
  variant_name: { type: String, required: true },
  image: {
    url: { type: String, required: true },
    public_id: { type: String, default: null }
  },
  unit_price: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  subtotal: { type: Number, required: true }
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, required: true },
  changed_at: { type: Date, default: Date.now },
  changed_by: { type: String, required: true },
  note: { type: String, default: '' }
}, { _id: false });

const refundRequestSchema = new mongoose.Schema({
  // ─── Identity ─────────────────────────────────────────────
  refund_request_id: { type: String, unique: true, index: true },

  // ─── User / Guest (ref: Users) ────────────────────────────
  order_id: { type: String, required: true, index: true },
  user_id: { type: String, default: null, index: true },
  session_id: { type: String, default: null },

  // ─── User refund submission ───────────────────────────────
  reason: {
    type: String,
    required: true,
    enum: ['Damaged item', 'Wrong item', 'Size/color mismatch', 'Other']
  },
  other_reason: { type: String, default: null },
  payment: { type: paymentSchema, required: true },
  description: { type: String, default: null },
  evidence: [{ type: String }],
  refund_item: { type: [refundItemSchema], required: true, minlength: 1 },

  // ─── Admin review ─────────────────────────────────────────
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  status_history: { type: [statusHistorySchema], default: [] },
  admin_reason: { type: String, default: null },
  reviewed_by: { type: String, default: null },
  reviewed_at: { type: Date, default: null }
}, {
  collection: 'RefundRequests',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

refundRequestSchema.index({ order_id: 1, status: 1 });
refundRequestSchema.index({ user_id: 1, created_at: -1 });

refundRequestSchema.pre('validate', function validateUserIdentity(next) {
  const hasUserId = Boolean(this.user_id);
  const hasSessionId = Boolean(this.session_id);

  if (hasUserId === hasSessionId) {
    return next(new Error('Exactly one of user_id or session_id is required.'));
  }

  if (this.reason === 'Other' && !String(this.other_reason || '').trim()) {
    return next(new Error('other_reason is required when reason is Other.'));
  }

  if (!this.evidence || this.evidence.length === 0) {
    return next(new Error('At least one evidence file is required.'));
  }

  next();
});

refundRequestSchema.pre('save', async function generateRefundRequestId(next) {
  if (this.refund_request_id) {
    return next();
  }

  const prefix = 'RR';
  try {
    const latest = await this.constructor.findOne(
      { refund_request_id: new RegExp(`^${prefix}`) },
      { refund_request_id: 1 },
      { sort: { refund_request_id: -1 } }
    );

    let nextNum = 500001;
    if (latest?.refund_request_id) {
      const lastNum = parseInt(latest.refund_request_id.slice(prefix.length), 10);
      if (!Number.isNaN(lastNum)) {
        nextNum = lastNum + 1;
      }
    }

    this.refund_request_id = `${prefix}${nextNum}`;
  } catch (error) {
    return next(error);
  }

  if (this.isNew) {
    this.status_history.push({
      status: 'pending',
      changed_at: new Date(),
      changed_by: this.user_id || this.session_id || 'customer',
      note: 'Refund request submitted by customer'
    });
  }

  return next();
});

module.exports = mongoose.model('RefundRequest', refundRequestSchema);
