const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Voucher = require('../models/Voucher');
const RefundRequest = require('../models/RefundRequest');
const mongoose = require('mongoose');
const socketService = require('../services/socket.service');
const voucherService = require('../services/voucher.service');
const subscriptionService = require('../services/subscription.service');
const pointsService = require('../services/points.service');
const inventoryService = require('../services/inventory.service');
const { hasAdminRole, isAdminRole, ADMIN_ORDER_VIEW_ROLES } = require('../middleware/auth.middleware');

const REFUND_REASONS = ['Damaged item', 'Wrong item', 'Size/color mismatch', 'Other'];
// Build-your-bundle discount, same as BUNDLE_DISCOUNT_RATE in the frontend bundle-cart.model.ts.
const BUNDLE_DISCOUNT_RATE = 0.2;

const round2 = n => Math.round(n * 100) / 100;

// Order items require a non-empty image; products normally have one.
function pickOrderImage(product, variant) {
  const image = variant.images?.[0] || product.images?.[0] || {};
  return { url: image.url || 'none', public_id: image.public_id || 'none' };
}

// 409 body the Checkout shows next to each line that lacks stock.
function outOfStockResponse(lines) {
  return {
    error: 'Some items in your order are out of stock.',
    code: 'OUT_OF_STOCK',
    items: lines
  };
}

function outOfStockLine(product, line) {
  const variant = (product?.variants || []).find(v => v.sku === line.variant_id);
  return {
    product_id: line.product_id,
    variant_id: line.variant_id,
    product_name: product?.name || '',
    variant_name: variant?.label || 'Default',
    requested: line.quantity,
    available: Math.max(0, variant?.stock ?? 0)
  };
}

function normalizeEvidenceList(evidence) {
  if (!Array.isArray(evidence)) {
    return [];
  }

  return evidence
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function validateEvidenceUrls(evidence) {
  const normalized = normalizeEvidenceList(evidence);

  if (!normalized.length) {
    return { ok: false, error: 'Supporting evidence is required for refund requests.' };
  }

  for (const url of normalized) {
    if (url.startsWith('blob:')) {
      return {
        ok: false,
        error: 'Evidence upload failed. Please re-select your image or video files and submit again.'
      };
    }

    const isHttp = /^https?:\/\//i.test(url);
    const isDataImage = url.startsWith('data:image/');
    const isDataVideo = url.startsWith('data:video/');

    if (!isHttp && !isDataImage && !isDataVideo) {
      return {
        ok: false,
        error: 'Each evidence file must be an uploaded image or video.'
      };
    }
  }

  return { ok: true, evidence: normalized };
}

async function getLatestRefundRequest(orderId) {
  return RefundRequest.findOne({ order_id: orderId })
    .sort({ created_at: -1 })
    .lean();
}

function formatRefundRequestForClient(doc) {
  if (!doc) return null;
  return {
    refund_request_id: doc.refund_request_id,
    order_id: doc.order_id,
    reason: doc.reason,
    other_reason: doc.other_reason,
    description: doc.description,
    evidence: doc.evidence || [],
    refund_item: doc.refund_item || [],
    payment: doc.payment,
    status: doc.status,
    admin_reason: doc.admin_reason,
    created_at: doc.created_at,
    reviewed_at: doc.reviewed_at,
    reviewed_by: doc.reviewed_by
  };
}

// Customer access to an order: the guest session that placed it, or its signed-in owner.
// session_id comes from the body, or the query string on GET/DELETE.
async function authorizeOrderAccess(req, order) {
  const sessionId = req.body?.session_id || req.query?.session_id;
  if (sessionId && order.session_id === sessionId) {
    return { authorized: true, userDoc: null };
  }
  if (req.user && req.user.user_id) {
    const userDoc = await User.findById(req.user.user_id);
    if (userDoc && order.user_id === userDoc.user_id) {
      return { authorized: true, userDoc };
    }
  }
  return { authorized: false, userDoc: null };
}

// States a customer payment action may start from; anything else is a 409.
const CUSTOMER_PAYMENT_TRANSITIONS = {
  confirmPayment: {
    label: 'confirm payment for',
    order_status: ['pending'],
    payment_status: ['pending', 'failed'],
    methods: ['qr', 'card', 'bank_transfer']
  },
  failPayment: {
    label: 'fail payment for',
    order_status: ['pending'],
    payment_status: ['pending']
  },
  retryPayment: {
    label: 'retry payment for',
    order_status: ['pending'],
    payment_status: ['pending', 'failed']
  },
  changePaymentMethod: {
    label: 'change the payment method of',
    order_status: ['pending'],
    payment_status: ['pending', 'failed']
  }
};

function canTransition(order, action) {
  const rule = CUSTOMER_PAYMENT_TRANSITIONS[action];
  return rule.order_status.includes(order.order_status) &&
    rule.payment_status.includes(order.payment_status) &&
    (!rule.methods || rule.methods.includes(order.payment?.method));
}

function invalidOrderStateResponse(res, order, action) {
  const rule = CUSTOMER_PAYMENT_TRANSITIONS[action];
  return res.status(409).json({
    error: `Cannot ${rule.label} an order that is ${order.order_status} (payment ${order.payment_status}).`,
    code: 'INVALID_ORDER_STATE',
    order_status: order.order_status,
    payment_status: order.payment_status,
    payment_method: order.payment?.method || null
  });
}

// Applies a customer payment action only if the order is still in an allowed state, so two
// concurrent requests can't both move it. Returns the updated order, or null when another
// request changed the order first. findOneAndUpdate skips the save hooks, so the history
// entry is written here.
async function applyCustomerTransition(order, action, changes, note) {
  const rule = CUSTOMER_PAYMENT_TRANSITIONS[action];
  const filter = {
    _id: order._id,
    order_status: { $in: rule.order_status },
    payment_status: { $in: rule.payment_status }
  };
  if (rule.methods) filter['payment.method'] = { $in: rule.methods };

  const update = { $set: changes };
  if (changes.order_status && !rule.order_status.includes(changes.order_status)) {
    update.$push = {
      status_history: {
        status: changes.order_status,
        changed_at: new Date(),
        changed_by: order.is_guest ? 'guest' : order.user_id,
        note
      }
    };
  }

  return Order.findOneAndUpdate(filter, update, { new: true, runValidators: true });
}

// One-time lines matching an active Ritual Box suggest a shorter cycle (SUBSCRIPTION_ADJUSTED).
// Not for orders billed by the subscription job; never fails the checkout.
async function suggestRitualBoxAdjustments(order) {
  if (order.subscription_id) return;
  try {
    await subscriptionService.suggestAdjustmentsForOrder(order);
  } catch (err) {
    console.error('Error suggesting Ritual Box adjustments:', err);
  }
}

async function cleanupSession(session) {
  if (!session) return;
  try {
    if (typeof session.inTransaction === 'function' && session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
  } catch (e) {
    // Ignore error if session is already ended/aborted
  }
}

function isTransactionNotSupportedError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === 20 ||
    msg.includes('transaction numbers are only allowed') ||
    msg.includes('replica set') ||
    msg.includes('standalone')
  );
}

// Create Order (POST /api/orders)
async function createOrder(req, res) {
  let session = null;
  let useTransaction = false;
  let appliedVoucherId = null;
  let reservedItems = null;

  try {
    session = await mongoose.startSession();
    session.startTransaction();
    useTransaction = typeof session.inTransaction === 'function' ? session.inTransaction() : true;
  } catch (sessErr) {
    session = null;
    useTransaction = false;
  }

  try {
    const { items, delivery_info, shipping, payment, pricing, coupon, session_id } = req.body;

    if (!items || !items.length || !delivery_info || !shipping || !payment || !pricing) {
      await cleanupSession(session);
      session = null;
      useTransaction = false;
      return res.status(400).json({ error: 'Missing required order fields: items, delivery_info, shipping, payment, pricing.' });
    }

    let user_id = null;
    let is_guest = true;
    let userDoc = null;

    // Check if the user is authenticated (req.user is populated by optionalAuthMiddleware)
    if (req.user && req.user.user_id) {
      userDoc = await User.findById(req.user.user_id);
      if (userDoc) {
        user_id = userDoc.user_id;
        is_guest = false;
      }
    }

    // Validation for guests
    if (is_guest && !session_id) {
      await cleanupSession(session);
      session = null;
      useTransaction = false;
      return res.status(400).json({ error: 'session_id is required for guest checkout.' });
    }

    const rejectOrder = async (status, body) => {
      await cleanupSession(session);
      session = null;
      useTransaction = false;
      return res.status(status).json(body);
    };
    const rejectSubscription = message => rejectOrder(400, { error: message });

    // Every line is rebuilt from the Product: names, image and price never come from the client.
    const productCache = new Map();
    const bundleQuantities = new Map();
    const orderItems = [];
    for (const line of items) {
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        return rejectOrder(400, { error: `Invalid quantity for ${line.product_name || 'an item'}.` });
      }
      const productKey = String(line.product_id);
      if (!productCache.has(productKey)) {
        productCache.set(productKey, await inventoryService.findProduct(productKey));
      }
      const product = productCache.get(productKey);
      const variant = (product?.variants || []).find(v => v.sku === line.variant_id);
      if (!product || product.is_active === false || !variant) {
        return rejectOrder(400, { error: `${product?.name || line.product_name || 'This product'} is no longer available.` });
      }

      const isSubscription = line.purchase_type === 'subscription';
      // Build-your-bundle component lines share a bundle_key and get the bundle discount.
      const bundleKey = !isSubscription && typeof line.bundle_key === 'string' && line.bundle_key ? line.bundle_key : null;
      if (bundleKey) bundleQuantities.set(bundleKey, (bundleQuantities.get(bundleKey) || 0) + quantity);
      const unitPrice = bundleKey ? round2(variant.price * (1 - BUNDLE_DISCOUNT_RATE)) : variant.price;

      orderItems.push({
        product_id: productKey,
        variant_id: variant.sku,
        product_name: product.name,
        variant_name: variant.label || 'Default',
        image: pickOrderImage(product, variant),
        unit_price: unitPrice,
        quantity,
        subtotal: round2(unitPrice * quantity),
        purchase_type: isSubscription ? 'subscription' : 'one_time',
        subscription_frequency_days: isSubscription
          ? ([7, 14, 30].includes(Number(line.subscription_frequency_days)) ? Number(line.subscription_frequency_days) : 14)
          : null
      });
    }
    // Bundles are packs of 2 or 3, so a single discounted line is not a bundle.
    if ([...bundleQuantities.values()].some(qty => qty < 2)) {
      return rejectOrder(400, { error: 'This bundle is incomplete. Please rebuild it.' });
    }

    const shortages = inventoryService.groupLines(orderItems)
      .map(line => outOfStockLine(productCache.get(line.product_id), line))
      .filter(line => line.available < line.requested);
    if (shortages.length) {
      return rejectOrder(409, outOfStockResponse(shortages));
    }

    // Subscribe & Save lines: signed-in customer, credit/debit card, server-side price.
    const subscriptionLines = orderItems.filter(it => it.purchase_type === 'subscription');
    let subscriptionPaymentMethodId = null;
    if (subscriptionLines.length) {
      if (is_guest) {
        return rejectSubscription('Sign in to start a Ritual Box subscription.');
      }
      const isNapas = (payment.card_info?.brand || '').toUpperCase() === 'NAPAS'
        || payment.full_card_info?.card_type === 'NAPAS';
      if (payment.method !== 'card' || isNapas) {
        return rejectSubscription('Ritual Box subscriptions can only be paid by credit or debit card.');
      }
      for (const line of subscriptionLines) {
        const price = await subscriptionService.priceSubscriptionLine(line.product_id, line.variant_id);
        if (!price) {
          return rejectSubscription(`${line.product_name || 'This product'} can't be subscribed to.`);
        }
        // The first box (this order) is charged at full price; the Subscribe & Save
        // price only applies to boxes the charge job bills later, so cancelling
        // before the next charge never keeps a discount.
        line.unit_price = price.original_price;
        line.subtotal = round2(price.original_price * line.quantity);
      }
    }

    // Enforce that delivery address and card details already exist in User profile if registered customer, otherwise save the new address
    if (!is_guest && userDoc && payment.method !== 'cod') {
      // 1. Verify Address
      const addressExists = userDoc.addresses.some(addr => 
        addr.recipient_name === delivery_info.recipient_name &&
        addr.phone === delivery_info.mobile &&
        addr.city === delivery_info.city &&
        addr.detail_address === delivery_info.address
      );

      if (!addressExists) {
        const newAddress = {
          recipient_name: delivery_info.recipient_name,
          phone: delivery_info.mobile,
          city: delivery_info.city,
          detail_address: delivery_info.address,
          label: null,
          is_default: userDoc.addresses.length === 0
        };
        userDoc.addresses.push(newAddress);
        try {
          await userDoc.save(useTransaction ? { session } : undefined);
        } catch (saveErr) {
          if (useTransaction && isTransactionNotSupportedError(saveErr)) {
            await cleanupSession(session);
            session = null;
            useTransaction = false;
            await userDoc.save();
          } else {
            throw saveErr;
          }
        }
      }

      // 2. Verify Payment Method (only for card and bank transfer payments)
      if (payment.method === 'card' || payment.method === 'bank_transfer') {
        const brand = payment.card_info && payment.card_info.brand;
        const last4 = payment.card_info && payment.card_info.last4;
        
        if (!brand || !last4) {
          await cleanupSession(session);
          session = null;
          useTransaction = false;
          return res.status(400).json({ error: 'Card brand and last4 digits are required for card payments.' });
        }

        const cardExists = userDoc.payment_methods.some(p => {
          const endsWithLast4 = p.card_number.endsWith(last4);
          
          let brandMatches = false;
          const type = p.card_type; // 'NAPAS', 'credit', 'debit'
          const brandUpper = brand.toUpperCase();
          if (brandUpper === 'NAPAS' && type === 'NAPAS') brandMatches = true;
          else if (brandUpper !== 'NAPAS' && (type === 'credit' || type === 'debit')) brandMatches = true;

          return endsWithLast4 && brandMatches;
        });

        let newlyAddedCard = null;
        if (!cardExists) {
          if (payment.full_card_info) {
            // Add the new card to user's payment methods
            userDoc.payment_methods.push(payment.full_card_info);
            newlyAddedCard = userDoc.payment_methods[userDoc.payment_methods.length - 1];
            try {
              await userDoc.save(useTransaction ? { session } : undefined);
            } catch (saveErr) {
              if (useTransaction && isTransactionNotSupportedError(saveErr)) {
                await cleanupSession(session);
                session = null;
                useTransaction = false;
                await userDoc.save();
              } else {
                throw saveErr;
              }
            }
          } else {
            await cleanupSession(session);
            session = null;
            useTransaction = false;
            return res.status(400).json({ error: 'Payment card must match one of your saved payment methods.' });
          }
        }

        // Ritual Box lines are charged automatically every cycle, so they need a saved
        // credit/debit card: the one picked at checkout (payment_method_id) or the card
        // saved in this request. Its id is stored on the order and copied to the subscription.
        if (subscriptionLines.length) {
          const requestedId = payment.payment_method_id ? String(payment.payment_method_id) : null;
          const subCard = requestedId
            ? userDoc.payment_methods.find(p => String(p._id) === requestedId)
            : newlyAddedCard;
          const subCardError = !subCard
            ? 'Choose a saved Visa or Mastercard for your Ritual Box.'
            : subCard.card_type === 'NAPAS'
              ? 'Ritual Box subscriptions can only be paid by credit or debit card.'
              : !String(subCard.card_number).endsWith(last4)
                ? 'The card for your Ritual Box must be the card you pay with.'
                : subscriptionService.isCardExpired(subCard.expire_date)
                  ? 'This card has expired. Choose another card.'
                  : null;
          if (subCardError) {
            await cleanupSession(session);
            session = null;
            useTransaction = false;
            return res.status(400).json({ error: subCardError });
          }
          subscriptionPaymentMethodId = String(subCard._id);
        }

        // Clean up before saving to Order
        if (payment.full_card_info) {
          delete payment.full_card_info;
        }
        delete payment.payment_method_id;
      }
    }

    // 3. Verify Voucher (if applied) and Recalculate Pricing on Server via voucher.service
    let verifiedPricing = { ...pricing };
    let verifiedCoupon = null;

    const serverSubtotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
    const serverShippingCost = shipping.method === 'express' ? 15 : 0;
    let calculatedDiscount = 0;

    if (coupon && coupon.code && typeof coupon.code === 'string' && coupon.code.trim()) {
      const vResult = await voucherService.validateAndCalculateVoucher({
        code: coupon.code,
        subtotal: serverSubtotal,
        shippingMethod: shipping.method
      });

      if (!vResult.isValid) {
        await cleanupSession(session);
        session = null;
        useTransaction = false;
        return res.status(400).json({ error: vResult.error });
      }

      calculatedDiscount = vResult.discountAmount;

      let incrementSuccess = false;
      try {
        incrementSuccess = await voucherService.incrementVoucherUsage(
          vResult.voucher._id,
          useTransaction ? session : null
        );
      } catch (incErr) {
        if (useTransaction && isTransactionNotSupportedError(incErr)) {
          await cleanupSession(session);
          session = null;
          useTransaction = false;
          incrementSuccess = await voucherService.incrementVoucherUsage(
            vResult.voucher._id,
            null
          );
        } else {
          throw incErr;
        }
      }

      if (!incrementSuccess) {
        await cleanupSession(session);
        session = null;
        useTransaction = false;
        return res.status(400).json({ 
          error: `Mã giảm giá "${vResult.voucher.code}" vừa hết lượt sử dụng. Vui lòng kiểm tra lại.` 
        });
      }

      appliedVoucherId = vResult.voucher._id;

      verifiedCoupon = {
        code: vResult.voucher.code,
        discount_type: vResult.voucher.discount_type,
        discount_value: vResult.voucher.discount_value,
        discount_amount: calculatedDiscount
      };
    }

    const roundedSubtotal = Math.round(serverSubtotal * 100) / 100;
    const finalTotal = Math.max(0, Math.round((roundedSubtotal + serverShippingCost - calculatedDiscount) * 100) / 100);

    verifiedPricing = {
      subtotal: roundedSubtotal,
      shipping_cost: serverShippingCost,
      discount_amount: calculatedDiscount,
      total: finalTotal,
      currency: pricing.currency || 'USD'
    };

    // Build order fields
    const orderData = {
      order_id: null,
      user_id,
      session_id: session_id || null,
      is_guest,
      items: orderItems,
      stock_reserved: true,
      delivery_info,
      shipping,
      payment,
      subscription_payment_method_id: subscriptionPaymentMethodId,
      pricing: verifiedPricing,
      coupon: verifiedCoupon,
      order_status: 'pending', // defaults to pending initially for verification
      payment_status: 'pending' // defaults to pending initially
    };

    // Take the stock last, inside the transaction when there is one, so every
    // earlier rejection leaves the inventory untouched.
    let reservation;
    try {
      reservation = await inventoryService.reserveItems(orderItems, useTransaction ? session : null);
    } catch (reserveErr) {
      if (useTransaction && isTransactionNotSupportedError(reserveErr)) {
        await cleanupSession(session);
        session = null;
        useTransaction = false;
        reservation = await inventoryService.reserveItems(orderItems, null);
      } else {
        throw reserveErr;
      }
    }
    if (!reservation.ok) {
      // Sold out since the check above. Without a transaction the voucher use is given back by hand.
      if (!useTransaction && appliedVoucherId) {
        await Voucher.updateOne({ _id: appliedVoucherId }, { $inc: { used_count: -1 } });
      }
      const fresh = await inventoryService.findProduct(reservation.failed.product_id);
      return rejectOrder(409, outOfStockResponse([outOfStockLine(fresh, reservation.failed)]));
    }
    reservedItems = orderItems;

    // Instantiate and save Order (pre-save hook generates order_id & updates order_status)
    const newOrder = new Order(orderData);
    if (useTransaction && session) {
      try {
        await newOrder.save({ session });
        await session.commitTransaction();
      } catch (saveCommitErr) {
        if (isTransactionNotSupportedError(saveCommitErr)) {
          await cleanupSession(session);
          session = null;
          useTransaction = false;
          // The aborted transaction also undid the stock reservation, so take it again.
          const retry = await inventoryService.reserveItems(orderItems, null);
          if (!retry.ok) {
            reservedItems = null;
            const fresh = await inventoryService.findProduct(retry.failed.product_id);
            return res.status(409).json(outOfStockResponse([outOfStockLine(fresh, retry.failed)]));
          }
          await newOrder.save();
        } else {
          throw saveCommitErr;
        }
      } finally {
        await cleanupSession(session);
        session = null;
        useTransaction = false;
      }
    } else {
      await newOrder.save();
    }
    // Saved: later errors must not give back the stock or the voucher use.
    reservedItems = null;
    appliedVoucherId = null;

    // Trigger ORDER_PLACED notification if registered customer
    if (!is_guest && user_id) {
      try {
        const notificationService = require('../services/notification.service');
        await notificationService.createNotification({
          recipient_id: user_id,
          sender: null,
          type: 'ORDER_PLACED',
          post_id: newOrder.order_id
        });
      } catch (notifError) {
        console.error('Error creating order placement notification:', notifError);
      }
    }

    // Emit real-time new order event
    socketService.emitNewOrder(newOrder);

    res.status(201).json({
      message: 'Order created successfully',
      data: newOrder
    });
  } catch (error) {
    if (session) {
      await cleanupSession(session);
      session = null;
      useTransaction = false;
    } else {
      if (appliedVoucherId) {
        try {
          await Voucher.updateOne({ _id: appliedVoucherId }, { $inc: { used_count: -1 } });
        } catch (rollbackErr) {
          console.error('Error rolling back voucher used_count:', rollbackErr);
        }
      }
      if (reservedItems) {
        await inventoryService.releaseItems(reservedItems);
      }
    }
    console.error('Error creating order:', error);
    res.status(500).json({ error: error.message || 'Failed to create order' });
  }
}

// Get Order Details (GET /api/orders/:id)
async function getOrderById(req, res) {
  try {
    if (isAdminRole(req.user.role) && !hasAdminRole(req.user, ADMIN_ORDER_VIEW_ROLES)) {
      return res.status(403).json({ error: 'Access denied', code: 'ADMIN_ROLE_FORBIDDEN' });
    }

    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (
      req.user.role === 'cskh' &&
      !(req.user.assigned_chat_customer_ids || []).includes(order.user_id)
    ) {
      return res.status(403).json({ error: 'Access denied', code: 'ROLE_FORBIDDEN' });
    }

    // Auto cancel pending payment order after 24h
    const createdTime = new Date(order.created_at || order.createdAt).getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (order.order_status === 'pending' && order.payment?.method !== 'cod' && (Date.now() - createdTime) >= twentyFourHours) {
      order.order_status = 'canceled';
      order._changedBy = 'system';
      order._statusChangeNote = 'Order automatically canceled: Payment pending for more than 24 hours';
      await order.save();

      // Trigger ORDER_CANCELED notification if registered customer
      if (order.user_id) {
        try {
          const notificationService = require('../services/notification.service');
          await notificationService.createNotification({
            recipient_id: order.user_id,
            sender: null,
            type: 'ORDER_CANCELED',
            post_id: order.order_id
          });
        } catch (notifError) {
          console.error('Error creating order auto-cancel notification:', notifError);
        }
      }
    }

    // Access control: only admin or the order owner can view the details
    if (!isAdminRole(req.user.role)) {
      const userDoc = await User.findById(req.user.user_id);
      if (!userDoc || order.user_id !== userDoc.user_id) {
        return res.status(403).json({ error: 'Access denied. You do not have permission to view this order.' });
      }
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ error: 'Failed to retrieve order details' });
  }
}

// Get Logged-in User's Order History (GET /api/orders)
async function getOrderHistory(req, res) {
  try {
    const userDoc = await User.findById(req.user.user_id);
    if (!userDoc) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const orders = await Order.find({ user_id: userDoc.user_id }).sort({ created_at: -1 });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching order history:', error);
    res.status(500).json({ error: 'Failed to retrieve order history' });
  }
}

// Confirm COD Order (PUT /api/orders/:id/confirm)
async function confirmOrder(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.payment.method !== 'cod') {
      return res.status(400).json({ error: 'Only COD orders can be confirmed via this endpoint.' });
    }

    if (order.order_status !== 'pending') {
      return res.status(400).json({ error: `Order is already in ${order.order_status} status.` });
    }

    const { authorized, userDoc } = await authorizeOrderAccess(req, order);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    order.order_status = 'processing';
    order._changedBy = order.is_guest ? 'guest' : order.user_id;
    order._statusChangeNote = 'Order confirmed by user via COD verification modal';
    await order.save();
    socketService.emitOrderUpdated(order, 'status_change');
    await suggestRitualBoxAdjustments(order);

    // Save address if registered customer and it doesn't exist yet
    if (!order.is_guest && userDoc) {
      const delivery_info = order.delivery_info;
      const addressExists = userDoc.addresses.some(addr => 
        addr.recipient_name === delivery_info.recipient_name &&
        addr.phone === delivery_info.mobile &&
        addr.city === delivery_info.city &&
        addr.detail_address === delivery_info.address
      );

      if (!addressExists) {
        const newAddress = {
          recipient_name: delivery_info.recipient_name,
          phone: delivery_info.mobile,
          city: delivery_info.city,
          detail_address: delivery_info.address,
          label: null,
          is_default: userDoc.addresses.length === 0
        };
        userDoc.addresses.push(newAddress);
        await userDoc.save();
      }
    }

    res.json({
      message: 'Order confirmed successfully',
      data: order
    });
  } catch (error) {
    console.error('Error confirming order:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm order' });
  }
}

// Cancel Pending Order (PUT /api/orders/:id/cancel)
async function cancelPendingOrder(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (!['pending', 'processing'].includes(order.order_status)) {
      return res.status(400).json({ error: `Order is in ${order.order_status} status and cannot be canceled.` });
    }

    const { authorized } = await authorizeOrderAccess(req, order);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    order.order_status = 'canceled';
    order.canceled_at = new Date();
    order._changedBy = order.is_guest ? 'guest' : order.user_id;
    order._statusChangeNote = 'Order canceled by customer';
    await order.save();
    socketService.emitOrderUpdated(order, 'status_change');

    res.json({
      message: 'Order canceled successfully',
      data: order
    });
  } catch (error) {
    console.error('Error canceling order:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel order' });
  }
}

// Fail Pending QR Order Payment (PUT /api/orders/:id/fail-payment)
async function failPayment(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const { authorized } = await authorizeOrderAccess(req, order);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    // Already failed (e.g. the QR page reported it twice): nothing to change.
    if (order.order_status === 'pending' && order.payment_status === 'failed') {
      return res.json({ message: 'Order payment status is already failed', data: order });
    }

    if (!canTransition(order, 'failPayment')) {
      return invalidOrderStateResponse(res, order, 'failPayment');
    }

    const updated = await applyCustomerTransition(order, 'failPayment', { payment_status: 'failed' });
    if (!updated) {
      const current = await Order.findById(order._id);
      if (current && current.order_status === 'pending' && current.payment_status === 'failed') {
        return res.json({ message: 'Order payment status is already failed', data: current });
      }
      return invalidOrderStateResponse(res, current || order, 'failPayment');
    }
    socketService.emitOrderUpdated(updated, 'status_change');

    res.json({
      message: 'Order payment status updated to failed',
      data: updated
    });
  } catch (error) {
    console.error('Error failing payment:', error);
    res.status(500).json({ error: error.message || 'Failed to update payment status' });
  }
}

// Orders placed before stock was reserved at checkout take it off when they are paid
// (same as the pending -> processing step in the Order save hook).
async function subtractUnreservedStock(order) {
  if (order.stock_reserved) return;
  for (const item of order.items) {
    await Product.updateOne(
      { _id: item.product_id, 'variants.sku': item.variant_id },
      { $inc: { 'variants.$.stock': -item.quantity } }
    );
  }
}

// Confirm QR/Card Payment (PUT /api/orders/:id/confirm-payment)
async function confirmPayment(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const { authorized } = await authorizeOrderAccess(req, order);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    // Repeated confirm (double click, QR page and desktop both confirming): return the order as is.
    if (order.payment_status === 'paid') {
      return res.json({ message: 'Payment already confirmed', data: order });
    }

    if (!canTransition(order, 'confirmPayment')) {
      return invalidOrderStateResponse(res, order, 'confirmPayment');
    }

    const updated = await applyCustomerTransition(
      order,
      'confirmPayment',
      { payment_status: 'paid', order_status: 'processing' },
      'Payment confirmed by user via mobile QR scan'
    );
    if (!updated) {
      // Another request moved the order first; only that one runs the side effects below.
      const current = await Order.findById(order._id);
      if (current && current.payment_status === 'paid') {
        return res.json({ message: 'Payment already confirmed', data: current });
      }
      return invalidOrderStateResponse(res, current || order, 'confirmPayment');
    }

    await subtractUnreservedStock(updated);
    socketService.emitOrderUpdated(updated, 'status_change');

    // A paid card order with Subscribe & Save lines starts the customer's Ritual Box.
    if (updated.payment?.method === 'card') {
      try {
        await subscriptionService.createSubscriptionsFromOrder(updated);
      } catch (subErr) {
        console.error('Error creating subscriptions from order:', subErr);
      }
    }
    await suggestRitualBoxAdjustments(updated);

    res.json({
      message: 'Payment confirmed successfully',
      data: updated
    });
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm payment' });
  }
}

// Get Order Status (GET /api/orders/:id/status)
async function getOrderStatus(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Auto cancel pending payment order after 24h
    const createdTime = new Date(order.created_at || order.createdAt).getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (order.order_status === 'pending' && order.payment?.method !== 'cod' && (Date.now() - createdTime) >= twentyFourHours) {
      order.order_status = 'canceled';
      order._changedBy = 'system';
      order._statusChangeNote = 'Order automatically canceled: Payment pending for more than 24 hours';
      await order.save();

      // Trigger ORDER_CANCELED notification if registered customer
      if (order.user_id) {
        try {
          const notificationService = require('../services/notification.service');
          await notificationService.createNotification({
            recipient_id: order.user_id,
            sender: null,
            type: 'ORDER_CANCELED',
            post_id: order.order_id
          });
        } catch (notifError) {
          console.error('Error creating order auto-cancel notification:', notifError);
        }
      }
    }

    const { authorized } = await authorizeOrderAccess(req, order);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const refundRequest = await getLatestRefundRequest(order.order_id);

    // Ritual Boxes started by this order and the points it earns (signed-in customers).
    let subscriptions = [];
    let points = null;
    try {
      [subscriptions, points] = await Promise.all([
        subscriptionService.getOrderSubscriptions(order.order_id),
        pointsService.getOrderPoints(order)
      ]);
    } catch (extraErr) {
      console.error('Error loading order subscriptions/points:', extraErr);
    }

    res.json({
      order_id: order.order_id,
      order_status: order.order_status,
      payment_status: order.payment_status,
      payment: order.payment,
      pricing: order.pricing,
      items: order.items,
      subscription_id: order.subscription_id,
      subscription_cycle: order.subscription_cycle,
      subscriptions,
      points,
      coupon: order.coupon,
      delivery_info: order.delivery_info,
      shipping: order.shipping,
      session_id: order.session_id,
      user_id: order.user_id,
      created_at: order.created_at,
      delivered_at: order.delivered_at,
      canceled_at: order.canceled_at,
      updated_at: order.updated_at,
      // Shown to the customer while a failed delivery waits on another attempt.
      delivery_failed_reason: order.order_status === 'delivery_failed'
        ? [...(order.status_history || [])].reverse().find(h => h.status === 'delivery_failed')?.note || null
        : null,
      refund_request: formatRefundRequestForClient(refundRequest)
    });
  } catch (error) {
    console.error('Error fetching order status:', error);
    res.status(500).json({ error: 'Failed to retrieve order status' });
  }
}

// Receive Order (PUT /api/orders/:id/receive)
async function receiveOrder(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.order_status !== 'shipping') {
      return res.status(400).json({
        error: `Order must be in shipping status to confirm receipt. Current status: ${order.order_status}.`
      });
    }

    const { authorized } = await authorizeOrderAccess(req, order);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    order.order_status = 'delivered';
    order.delivered_at = new Date();
    order._changedBy = 'user';
    order._statusChangeNote = 'Order received by user';
    await order.save();
    socketService.emitOrderUpdated(order, 'status_change');

    // Purchase points: pending now, posted once the refund window passes.
    try {
      await pointsService.awardPurchasePoints(order);
    } catch (pointsErr) {
      console.error('Error awarding purchase points:', pointsErr);
    }

    try {
      const loyaltyService = require('../services/loyalty.service');
      await loyaltyService.handleOrderDelivered(order);
    } catch (referralErr) {
      console.error('Error processing referral order reward:', referralErr);
    }

    const refundRequest = await getLatestRefundRequest(order.order_id);

    res.json({
      message: 'Order status updated to delivered',
      data: {
        ...order.toObject(),
        refund_request: formatRefundRequestForClient(refundRequest)
      }
    });
  } catch (error) {
    console.error('Error receiving order:', error);
    res.status(500).json({ error: error.message || 'Failed to update order status' });
  }
}

// Request Refund (POST /api/orders/:id/refund)
async function requestRefund(req, res) {
  try {
    const { id } = req.params;
    const {
      reason,
      other_reason,
      description,
      items,
      refund_item,
      evidence,
      session_id,
      refund_payment
    } = req.body;

    const selectedItems = refund_item || items;
    if (!selectedItems || !selectedItems.length) {
      return res.status(400).json({ error: 'Please select at least one item to return.' });
    }

    if (!reason || !REFUND_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'A valid refund reason is required.' });
    }

    if (reason === 'Other' && !String(other_reason || '').trim()) {
      return res.status(400).json({ error: 'Please specify your refund reason.' });
    }

    const evidenceValidation = validateEvidenceUrls(evidence);
    if (!evidenceValidation.ok) {
      return res.status(400).json({ error: evidenceValidation.error });
    }
    const normalizedEvidence = evidenceValidation.evidence;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Access control
    let isAuthorized = false;
    let userId = null;
    let sessionId = null;

    if (order.user_id) {
      if (req.user && req.user.user_id) {
        const userDoc = await User.findById(req.user.user_id);
        if (userDoc && order.user_id === userDoc.user_id) {
          isAuthorized = true;
          userId = userDoc.user_id;
        }
      }
    } else if (session_id && order.session_id === session_id) {
      isAuthorized = true;
      sessionId = session_id;
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to request refund for this order.' });
    }

    if (order.order_status !== 'delivered' && order.order_status !== 'refund_rejected') {
      return res.status(400).json({ error: 'Refund/return can only be requested for delivered orders.' });
    }

    // Refunds are allowed only within the window after delivery (same period purchase points stay pending).
    // Older orders may lack delivered_at — fall back to when 'delivered' was logged.
    const windowDays = pointsService.REFUND_WINDOW_DAYS;
    const deliveredAt = order.delivered_at
      || [...(order.status_history || [])].reverse().find(h => h.status === 'delivered')?.changed_at;
    if (deliveredAt && Date.now() - new Date(deliveredAt).getTime() > windowDays * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: `Refunds can only be requested within ${windowDays} days of delivery.` });
    }

    const existingPending = await RefundRequest.findOne({
      order_id: order.order_id,
      status: 'pending'
    });

    if (existingPending) {
      return res.status(400).json({ error: 'A refund request is already pending review for this order.' });
    }

    for (const selected of selectedItems) {
      const orderItem = order.items.find(
        (item) =>
          item.product_id === selected.product_id && item.variant_id === selected.variant_id
      );

      if (!orderItem) {
        return res.status(400).json({ error: 'One or more selected items were not found in this order.' });
      }

      if (selected.quantity !== undefined && selected.quantity !== null) {
        const qty = parseInt(selected.quantity, 10);
        if (isNaN(qty) || qty <= 0) {
          return res.status(400).json({ error: `Refund quantity for ${orderItem.product_name} must be a positive number.` });
        }
        if (qty > orderItem.quantity) {
          return res.status(400).json({ error: `Refund quantity for ${orderItem.product_name} cannot exceed purchased quantity (${orderItem.quantity}).` });
        }
      }
    }

    const refundItems = selectedItems.map((selected) => {
      const orderItem = order.items.find(
        (item) =>
          item.product_id === selected.product_id && item.variant_id === selected.variant_id
      );

      const quantity = selected.quantity !== undefined && selected.quantity !== null
        ? parseInt(selected.quantity, 10)
        : orderItem.quantity;

      return {
        product_id: orderItem.product_id,
        variant_id: orderItem.variant_id,
        product_name: orderItem.product_name,
        variant_name: orderItem.variant_name,
        image: orderItem.image,
        unit_price: orderItem.unit_price,
        quantity,
        subtotal: orderItem.unit_price * quantity
      };
    });

    let refundPayment = order.payment;
    if (order.payment.method === 'cod' || order.payment.method === 'qr') {
      if (refund_payment && refund_payment.method) {
        refundPayment = {
          method: refund_payment.method,
          card_info: {
            brand: refund_payment.card_info?.brand || null,
            last4: refund_payment.card_info?.last4 || null,
            cardholder_name: refund_payment.card_info?.cardholder_name || null
          }
        };
      } else {
        return res.status(400).json({ error: 'Please select a payment card or account to process the refund.' });
      }
    }

    const refundRequest = new RefundRequest({
      order_id: order.order_id,
      user_id: userId,
      session_id: sessionId,
      reason,
      other_reason: reason === 'Other' ? String(other_reason).trim() : null,
      payment: refundPayment,
      description: description ? String(description).trim() : null,
      evidence: normalizedEvidence,
      refund_item: refundItems
    });

    await refundRequest.save();

    order.order_status = 'pending_refund';
    order._changedBy = userId || sessionId || 'customer';
    order._statusChangeNote = 'Refund request submitted by customer';
    await order.save();
    socketService.emitOrderUpdated(order, 'refund_request');

    // Trigger REFUND_REQUESTED notification if registered customer
    if (order.user_id) {
      try {
        const notificationService = require('../services/notification.service');
        await notificationService.createNotification({
          recipient_id: order.user_id,
          sender: null,
          type: 'REFUND_REQUESTED',
          post_id: order.order_id
        });
      } catch (notifError) {
        console.error('Error creating refund request notification:', notifError);
      }
    }

    res.json({
      message: 'Refund request submitted successfully.',
      data: {
        ...order.toObject(),
        refund_request: formatRefundRequestForClient(refundRequest.toObject())
      }
    });
  } catch (error) {
    console.error('Error requesting refund:', error);
    res.status(500).json({ error: error.message || 'Failed to submit refund request.' });
  }
}

// Delete Pending Order (DELETE /api/orders/:id)
async function deleteOrder(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const { authorized } = await authorizeOrderAccess(req, order);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    if (order.order_status !== 'pending') {
      return res.status(400).json({ error: 'Only pending orders can be deleted/discarded.' });
    }

    // Conditional delete so a concurrent discard can't put the stock back twice.
    const deleted = await Order.findOneAndDelete({ _id: order._id, order_status: 'pending' });
    if (deleted?.stock_reserved) {
      await inventoryService.releaseItems(deleted.items);
    }

    res.json({
      message: 'Order deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ error: error.message || 'Failed to delete order' });
  }
}

// Retry Payment (PUT /api/orders/:id/retry-payment)
async function retryPayment(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const { authorized } = await authorizeOrderAccess(req, order);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    if (!canTransition(order, 'retryPayment')) {
      return invalidOrderStateResponse(res, order, 'retryPayment');
    }

    const updated = await applyCustomerTransition(order, 'retryPayment', { payment_status: 'pending' });
    if (!updated) {
      const current = await Order.findById(order._id);
      return invalidOrderStateResponse(res, current || order, 'retryPayment');
    }

    res.json({
      message: 'Order payment status reset to pending for retry',
      data: updated
    });
  } catch (error) {
    console.error('Error retrying payment:', error);
    res.status(500).json({ error: error.message || 'Failed to retry payment' });
  }
}

// Change Payment Method on a Pending Order (PUT /api/orders/:id/change-payment-method)
async function changePaymentMethod(req, res) {
  try {
    const { id } = req.params;
    const { payment } = req.body;

    if (!payment || !payment.method) {
      return res.status(400).json({ error: 'payment.method is required.' });
    }

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const { authorized, userDoc } = await authorizeOrderAccess(req, order);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    if (!canTransition(order, 'changePaymentMethod')) {
      return invalidOrderStateResponse(res, order, 'changePaymentMethod');
    }

    // Verify/persist the new payment method against the User profile (mirrors createOrder's validation)
    if (userDoc && (payment.method === 'card' || payment.method === 'bank_transfer')) {
      const brand = payment.card_info && payment.card_info.brand;
      const last4 = payment.card_info && payment.card_info.last4;

      if (!brand || !last4) {
        return res.status(400).json({ error: 'Card brand and last4 digits are required for card payments.' });
      }

      const cardExists = userDoc.payment_methods.some(p => {
        const endsWithLast4 = p.card_number.endsWith(last4);

        let brandMatches = false;
        const type = p.card_type; // 'NAPAS', 'credit', 'debit'
        const brandUpper = brand.toUpperCase();
        if (brandUpper === 'NAPAS' && type === 'NAPAS') brandMatches = true;
        else if (brandUpper !== 'NAPAS' && (type === 'credit' || type === 'debit')) brandMatches = true;

        return endsWithLast4 && brandMatches;
      });

      if (!cardExists) {
        if (payment.full_card_info) {
          userDoc.payment_methods.push(payment.full_card_info);
          await userDoc.save();
        } else {
          return res.status(400).json({ error: 'Payment card must match one of your saved payment methods.' });
        }
      }
    }

    if (payment.full_card_info) {
      delete payment.full_card_info;
    }

    const updated = await applyCustomerTransition(order, 'changePaymentMethod', {
      payment,
      payment_status: 'pending'
    });
    if (!updated) {
      const current = await Order.findById(order._id);
      return invalidOrderStateResponse(res, current || order, 'changePaymentMethod');
    }

    res.json({
      message: 'Payment method updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('Error changing payment method:', error);
    res.status(500).json({ error: error.message || 'Failed to change payment method' });
  }
}

module.exports = {
  createOrder,
  getOrderById,
  getOrderHistory,
  confirmOrder,
  cancelPendingOrder,
  failPayment,
  confirmPayment,
  getOrderStatus,
  receiveOrder,
  requestRefund,
  deleteOrder,
  retryPayment,
  changePaymentMethod
};
