const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product_id:   { type: String, required: true },
  variant_id:   { type: String, required: true },
  product_name: { type: String, required: true },
  variant_name: { type: String, required: true },
  image: {
    url:       { type: String, required: true },
    public_id: { type: String, required: true }
  },
  unit_price: { type: Number, required: true },
  quantity:   { type: Number, required: true, min: 1 },
  subtotal:   { type: Number, required: true }, // unit_price * quantity
  is_reviewed: { type: Boolean, default: false },
  review_id:   { type: String, default: null },  // "RV7XXXX"
  // Subscribe & Save: a 'subscription' line starts a Ritual Box once the card payment succeeds.
  purchase_type:               { type: String, enum: ['one_time', 'subscription'], default: 'one_time' },
  subscription_frequency_days: { type: Number, enum: [7, 14, 30, null], default: null },
  // Marked by QLSP / Admin CC when the line can't be fulfilled after the order was placed.
  // The order is then cancelled (and refunded if paid); this line's stock isn't put back.
  out_of_stock: { type: Boolean, default: false }
}, { _id: false });

const deliveryInfoSchema = new mongoose.Schema({
  recipient_name: { type: String, required: true },
  mobile:         { type: String, required: true },
  email:          { type: String, default: null }, // optional at checkout
  city:           { type: String, required: true },
  address:        { type: String, required: true }, // street, ward, district
  note:           { type: String, default: "" }
}, { _id: false });

const shippingSchema = new mongoose.Schema({
  method:          { type: String, enum: ["standard", "express"], required: true },
  cost:            { type: Number, required: true }, // 0 or 15
  tracking_number: { type: String, default: null },
  carrier:         { type: String, default: "GHN" } // "GHN"
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  method: {
    type: String,
    enum: ["cod", "qr", "bank_transfer", "card"],
    required: true
  },
  card_info: {
    brand: { type: String, default: null }, // "Visa" | "Mastercard" | "Napas"
    last4: { type: String, default: null },
    cardholder_name: { type: String, default: null }
  }
}, { _id: false });

const pricingSchema = new mongoose.Schema({
  subtotal:        { type: Number, required: true }, // sum of items.subtotal
  shipping_cost:   { type: Number, required: true },
  discount_amount: { type: Number, default: 0 },
  total:           { type: Number, required: true }, // subtotal + shipping - discount
  currency:        { type: String, default: "USD" }
}, { _id: false });

const couponSchema = new mongoose.Schema({
  code:            { type: String, default: null },
  discount_type:   { type: String, enum: ["percentage", "fixed"], default: null },
  discount_value:  { type: Number, default: null },  // e.g. 10 (%) or 5 ($)
  discount_amount: { type: Number, default: null }   // actual $ deducted
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
  status:     { type: String, required: true },
  changed_at: { type: Date, default: Date.now },
  changed_by: { type: String, required: true }, // "system" | "USR00001" (admin user id)
  note:       { type: String, default: "" }
}, { _id: false });

const refundRequestSchema = new mongoose.Schema({
  type:         { type: String, enum: ["cancel_refund", "return_refund"], default: null },
  reason:       { type: String, default: null },
  description:  { type: String, default: "" },
  evidence:     [{ type: String }],
  items: [{
    product_id: { type: String },
    variant_id: { type: String },
    quantity:   { type: Number },
    reason:     { type: String }
  }],
  requested_at: { type: Date, default: null },
  requested_by: { type: String, default: null }, // "USRXXXXX" or guest email
  status:       { type: String, enum: ["pending", "approved", "rejected"], default: null },
  reviewed_by:  { type: String, default: null }, // admin user_id
  reviewed_at:  { type: Date, default: null },
  admin_note:   { type: String, default: "" }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  // ─── Identity ─────────────────────────────────────────────
  order_id: { type: String, unique: true, index: true }, // generated in pre-save hook

  // ─── User / Guest (ref: Users) ─────────────────────────────────────────
  user_id:    { type: String, default: null, index: true }, // "USR0000X" or null
  session_id: { type: String, default: null },              // for guest (SS0000X)
  is_guest:   { type: Boolean, required: true },

  // ─── Items (snapshot from cart) ───────────────────────────
  items: { type: [orderItemSchema], required: true },

  // ─── Delivery info ────────────────────────────────────────
  delivery_info: { type: deliveryInfoSchema, required: true },

  // ─── Shipping ─────────────────────────────────────────────
  shipping: { type: shippingSchema, required: true },

  // ─── Payment ──────────────────────────────────────────────
  payment: { type: paymentSchema, required: true },

  // ─── Pricing ──────────────────────────────────────────────
  pricing: { type: pricingSchema, required: true },

  // ─── Coupon ───────────────────────────────────────────────
  coupon: { type: couponSchema, default: null },

  // ─── Status ───────────────────────────────────────────────
  order_status: {
    type: String,
    // delivery_failed: the carrier couldn't deliver; admin ships again or cancels (refunding if paid).
    enum: ["pending", "processing", "shipping", "delivery_failed", "delivered", "canceled", "refund", "pending_refund", "refund_rejected"],
    default: "processing",
    index: true
  },
  payment_status: {
    type: String,
    enum: ["pending", "paid", "failed", "refunded"],
    default: "pending",
    index: true
  },

  // ─── Status history ──────────────────────────────────────
  status_history: { type: [statusHistorySchema], default: [] },

  // ─── Refund request ──────────────────────────────────────
  refund_request: { type: refundRequestSchema, default: null },

  // ─── Subscription (only on orders created by the scheduler) ─
  subscription_id:    { type: String, default: null, index: true }, // ref: Subscriptions.subscription_id
  // Checkout with Ritual Box lines: saved card (Users.payment_methods._id) the subscription is billed to.
  subscription_payment_method_id: { type: String, default: null },
  subscription_cycle: { type: Number, default: null, min: 1 },      // lần giao thứ mấy của subscription
  // true: stock was reserved when the order was placed (inventory.service), so the
  // status hooks below don't subtract it again and put it back on any cancel.
  stock_reserved: { type: Boolean, default: false },

  // ─── Admin internal notes ─────────────────────────────────
  internal_notes: { type: String, default: "" },

  // ─── Key timestamps ──────────────────────────────────────
  delivered_at: { type: Date, default: null },
  canceled_at:  { type: Date, default: null },
  // Set when a guest order was moved to the account registered with the same verified email / phone.
  linked_from_guest_at: { type: Date, default: null }
}, {
  collection: 'Orders',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Mutual exclusivity of user_id & session_id based on is_guest
orderSchema.pre('validate', function(next) {
  if (this.is_guest) {
    if (!this.session_id) {
      return next(new Error('session_id is required for guest orders'));
    }
    this.user_id = null;
  } else {
    if (!this.user_id) {
      return next(new Error('user_id is required for registered user orders'));
    }
    this.session_id = null;
  }
  next();
});

// Pre-save hooks: auto-generate order_id, manage state transitions, log history
orderSchema.pre('save', async function(next) {
  // 1. Auto-generate sequential order_id: OFS-YYYY-XXXXX
  if (!this.order_id) {
    const year = new Date().getFullYear();
    const prefix = `OFS-${year}-`;
    try {
      const latestOrder = await this.constructor.findOne(
        { order_id: new RegExp(`^${prefix}`) },
        { order_id: 1 },
        { sort: { order_id: -1 } }
      );
      
      let nextNum = 1;
      if (latestOrder && latestOrder.order_id) {
        const parts = latestOrder.order_id.split('-');
        const lastNum = parseInt(parts[2], 10);
        if (!isNaN(lastNum)) {
          nextNum = lastNum + 1;
        }
      }
      this.order_id = `${prefix}${String(nextNum).padStart(5, '0')}`;
    } catch (err) {
      return next(err);
    }
  }

  // 2. Automate state transitions based on payment status & payment method
  if (this.payment && this.payment.method !== 'cod') {
    if (this.payment_status === 'paid' && this.order_status === 'pending') {
      this.order_status = 'processing';
    } else if (this.payment_status === 'failed') {
      this.order_status = 'pending';
    } else if (this.isNew && this.payment_status === 'pending') {
      this.order_status = 'pending';
    }
  } else if (this.payment && this.payment.method === 'cod') {
    if (this.isNew && !this.order_status) {
      this.order_status = 'pending';
    }
    if (this.order_status === 'delivered') {
      this.payment_status = 'paid';
    }
  }

  // Refund window counts from delivered_at — stamp it on every path into 'delivered'.
  if (this.isModified('order_status') && this.order_status === 'delivered' && !this.delivered_at) {
    this.delivered_at = new Date();
  }

  // 3. Status history logging
  if (this.isNew || this.isModified('order_status')) {
    const alreadyLogged = this.status_history.some(h => h.status === this.order_status && this.status_history.indexOf(h) === this.status_history.length - 1);
    if (!alreadyLogged) {
      const changer = this._changedBy || 'system';
      const note = this._statusChangeNote || (this.isNew ? 'Order created' : `Order status updated to ${this.order_status}`);
      this.status_history.push({
        status: this.order_status,
        changed_at: new Date(),
        changed_by: changer,
        note: note
      });
    }
  }

  // 4. Stock & Total Sold Quantity Updates
  if (this.isModified('order_status')) {
    let originalStatus = null;
    if (!this.isNew) {
      const original = await this.constructor.findById(this._id).select('order_status');
      originalStatus = original ? original.order_status : null;
    }

    const newStatus = this.order_status;

    // Transition to processing, or admin ships directly from pending (e.g. COD) -> subtract stock
    const isConfirmed =
      (newStatus === 'processing' && (this.isNew || originalStatus !== 'processing')) ||
      (newStatus === 'shipping' && originalStatus === 'pending');

    // Transition from confirmed/processing/shipping/delivered/etc. (statuses where stock was subtracted) to canceled -> add back stock
    const wasStockSubtracted = (status) => ['processing', 'shipping', 'delivery_failed', 'delivered', 'pending_refund', 'refund_rejected'].includes(status);
    // Lines marked out of stock after ordering aren't on the shelf, so they aren't put back.
    const restockable = this.items.filter(item => !item.out_of_stock);
    const isCanceled = (newStatus === 'canceled') && (this.stock_reserved
      ? !this.isNew && !['canceled', 'refund'].includes(originalStatus) // refund approval restocks on its own
      : wasStockSubtracted(originalStatus));

    // Transition from not delivered to delivered -> increment total_sold_quantity
    const isDelivered = (newStatus === 'delivered') && (this.isNew || originalStatus !== 'delivered');

    const Product = require('./Product');

    if (isConfirmed && !this.stock_reserved) {
      for (const item of this.items) {
        await Product.updateOne(
          { _id: item.product_id, 'variants.sku': item.variant_id },
          {
            $inc: { 'variants.$.stock': -item.quantity }
          }
        );
      }
    } else if (isCanceled && this.stock_reserved) {
      await require('../services/inventory.service').releaseItems(restockable);
    } else if (isCanceled) {
      for (const item of restockable) {
        await Product.updateOne(
          { _id: item.product_id, 'variants.sku': item.variant_id },
          {
            $inc: { 'variants.$.stock': item.quantity }
          }
        );
      }
    }

    if (isDelivered) {
      for (const item of this.items) {
        await Product.updateOne(
          { _id: item.product_id, 'variants.sku': item.variant_id },
          {
            $inc: { 
              total_sold_quantity: item.quantity,
              'variants.$.sold_quantity': item.quantity
            }
          }
        );
      }
    }

    if (this.user_id && isDelivered) {
      this._pantryEvent = 'delivered';
      this.$locals.pantryEvent = 'delivered';
    }
    if (this.user_id && newStatus === 'refund' && originalStatus !== 'refund') {
      this._pantryEvent = 'refund';
      this.$locals.pantryEvent = 'refund';
    }
  }

  next();
});

// Admin Orders listing: newest first within a date range, paged in the database.
orderSchema.index({ created_at: -1 });

orderSchema.post('save', function pantrySync(doc) {
  const event = this._pantryEvent || this.$locals?.pantryEvent;
  const refundItems = this._refundItems || this.$locals?.refundItems || null;
  this._pantryEvent = undefined;
  if (this.$locals) this.$locals.pantryEvent = undefined;
  if (!event || !doc.user_id) return;
  setImmediate(() => {
    const pantry = require('../services/pantry.service');
    const task = event === 'refund'
      ? pantry.removeItemsForRefund(doc, refundItems)
      : pantry.addItemsForDeliveredOrder(doc);
    task.catch(error => console.error('Pantry sync failed:', error));
  });
});

module.exports = mongoose.model('Order', orderSchema);
