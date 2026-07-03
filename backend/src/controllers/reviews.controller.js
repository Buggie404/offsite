const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');

async function createReview(req, res) {
  try {
    const { order_id, product_id, variant_id, rating, content, is_anonymous, session_id, email, mobile } = req.body;
    const userId = req.user ? req.user.user_id : null;

    if (!order_id || !product_id || !variant_id || !rating) {
      return res.status(400).json({ error: 'Missing required fields: order_id, product_id, variant_id, rating.' });
    }

    const ratingNum = Number(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be a number between 1 and 5.' });
    }

    // 1. Fetch order to verify ownership & purchase
    const orderDoc = await Order.findOne({ order_id });
    if (!orderDoc) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    let reviewerName = is_anonymous ? 'Anonymous' : (orderDoc.delivery_info?.recipient_name || 'Guest');
    let avatarUrl = null;

    if (userId) {
      // Authenticated flow
      const userDoc = await User.findById(userId);
      if (!userDoc) {
        return res.status(404).json({ error: 'User not found.' });
      }

      // If order belongs to another registered user, block it
      if (orderDoc.user_id && orderDoc.user_id !== userDoc.user_id) {
        return res.status(403).json({ error: 'Access denied. You do not have permission to review this order.' });
      }

      reviewerName = is_anonymous ? 'Anonymous' : userDoc.profile_name;
      avatarUrl = userDoc.avatar_url || null;

      // Link guest order to this authenticated user
      if (!orderDoc.user_id) {
        orderDoc.user_id = userDoc.user_id;
        orderDoc.is_guest = false;
        orderDoc.session_id = null;
      }
    } else {
      // Guest flow: must verify session_id & contact info
      if (!orderDoc.is_guest && orderDoc.user_id) {
        return res.status(403).json({ error: 'Access denied. This order belongs to a registered user. Please sign in to review.' });
      }

      if (!session_id || orderDoc.session_id !== session_id) {
        return res.status(403).json({ error: 'Access denied. Invalid session ID.' });
      }

      const emailMatch = email && orderDoc.delivery_info?.email && email.trim().toLowerCase() === orderDoc.delivery_info.email.trim().toLowerCase();
      const mobileMatch = mobile && orderDoc.delivery_info?.mobile && mobile.trim() === orderDoc.delivery_info.mobile.trim();

      if (!emailMatch && !mobileMatch) {
        return res.status(403).json({ error: 'Verification details (email or phone) do not match this order.' });
      }
    }

    // 2. Find matching item in order
    console.log('--- DEBUG createReview Product/Variant Match ---');
    console.log('Payload values:', { product_id, variant_id });
    console.log('Payload types:', { product_id: typeof product_id, variant_id: typeof variant_id });
    console.log('Order items in DB:');
    for (const item of orderDoc.items) {
      console.log(`  Item: product_id=${item.product_id} (${typeof item.product_id}), variant_id=${item.variant_id} (${typeof item.variant_id})`);
      console.log(`  Match product_id: ${item.product_id === product_id}, Match variant_id: ${item.variant_id === variant_id}`);
    }

    const orderItem = orderDoc.items.find(item => 
      item.product_id?.toString() === product_id?.toString() && 
      item.variant_id?.toString() === variant_id?.toString()
    );
    if (!orderItem) {
      return res.status(400).json({ error: 'Product/variant not found in this order.' });
    }

    // 3. Check if already reviewed (in DB or on the item)
    if (orderItem.is_reviewed) {
      return res.status(400).json({ error: 'This item has already been reviewed in this order.' });
    }

    const existingReview = await Review.findOne({ order_id, product_id, variant_id });
    if (existingReview) {
      orderItem.is_reviewed = true;
      orderItem.review_id = existingReview.review_id;
      await orderDoc.save();
      return res.status(400).json({ error: 'This item has already been reviewed in this order.' });
    }

    // 4. Fetch product to build product_snapshot & update metrics
    const productDoc = await Product.findById(product_id);
    if (!productDoc) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const variantDoc = productDoc.variants.find(v => v.sku === variant_id);

    // 5. Create Review
    const newReview = new Review({
      user_id: userId || null, // null for guest reviews
      order_id,
      product_id,
      variant_id,
      rating: ratingNum,
      content: content || '',
      is_anonymous: !!is_anonymous,
      product_snapshot: {
        name: productDoc.name,
        variant_label: variantDoc?.label || 'Default',
        image_url: variantDoc?.images?.[0]?.url || productDoc.images?.[0]?.url || ''
      },
      user_snapshot: {
        name: reviewerName,
        avatar_url: avatarUrl
      }
    });

    await newReview.save();

    // 6. Update order item review state
    orderItem.is_reviewed = true;
    orderItem.review_id = newReview.review_id;
    
    await orderDoc.save();

    // 7. Update Product reviews metrics (avg rating & review count)
    const allProductReviews = await Review.find({ product_id });
    const count = allProductReviews.length;
    const totalRating = allProductReviews.reduce((sum, r) => sum + r.rating, 0);
    const avg = count > 0 ? (totalRating / count) : null;

    productDoc.review_count = count;
    productDoc.rating_avg = avg !== null ? Math.round(avg * 10) / 10 : null;
    await productDoc.save();

    res.status(201).json({
      message: 'Review submitted successfully',
      data: newReview
    });

  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({ error: error.message || 'Failed to submit review.' });
  }
}

module.exports = {
  createReview
};
