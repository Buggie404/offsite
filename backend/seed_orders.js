const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./src/models/User');
const Product = require('./src/models/Product');
const Order = require('./src/models/Order');

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Error: MONGODB_URI is not defined in the environment variables.');
    process.exit(1);
  }

  try {
    console.log('Connecting to database...');
    await mongoose.connect(uri);
    console.log('Connected to MongoDB.');

    // 1. Fetch customers
    let customers = await User.find({ role: 'customer' });
    if (customers.length === 0) {
      console.log('No customers found. Please run seed_carts.js first to populate users.');
      process.exit(1);
    }
    console.log(`Found ${customers.length} customer users.`);

    // 2. Fetch products
    const products = await Product.find({ is_active: true });
    if (products.length === 0) {
      console.log('No active products found.');
      process.exit(1);
    }
    console.log(`Found ${products.length} active products.`);

    // 3. Clear existing orders
    console.log('Clearing existing orders...');
    const deleteResult = await Order.deleteMany({});
    console.log(`Cleared ${deleteResult.deletedCount} existing orders.`);

    // 4. Create mock orders
    const ordersToSeed = [];

    // Helper to pick random products
    const getRandomItems = (count) => {
      const items = [];
      for (let i = 0; i < count; i++) {
        const product = products[Math.floor(Math.random() * products.length)];
        const variant = product.variants && product.variants.length > 0
          ? product.variants[Math.floor(Math.random() * product.variants.length)]
          : { sku: 'default', label: 'Default', price: 10 };

        const unit_price = variant.price || 15;
        const quantity = Math.floor(Math.random() * 2) + 1;
        const subtotal = unit_price * quantity;

        items.push({
          product_id: product._id.toString(),
          variant_id: variant.sku,
          product_name: product.name,
          variant_name: variant.label || 'Standard',
          image: {
            url: product.images && product.images[0] ? product.images[0].url : 'https://example.com/image.jpg',
            public_id: product.images && product.images[0] ? product.images[0].public_id : 'sample_id'
          },
          unit_price,
          quantity,
          subtotal,
          is_reviewed: false,
          review_id: null
        });
      }
      return items;
    };

    // Update customer profiles to have matching addresses and payment methods in DB before creating orders
    console.log('Updating customer profiles with matching addresses and payment methods for validation...');
    
    // Customer 0
    customers[0].addresses = [{
      recipient_name: customers[0].profile_name,
      phone: customers[0].phone || '0901234567',
      city: 'Ho Chi Minh City',
      detail_address: '123 Le Loi Street, Ward 1, District 1',
      is_default: true
    }];
    await customers[0].save();

    // Customer 1
    if (customers.length > 1) {
      customers[1].addresses = [{
        recipient_name: customers[1].profile_name,
        phone: customers[1].phone || '0907654321',
        city: 'Hanoi',
        detail_address: '456 Tran Hung Dao Street',
        is_default: true
      }];
      customers[1].payment_methods = [{
        card_type: 'credit',
        card_number: '4111222233334242',
        cardholder_name: customers[1].profile_name.toUpperCase(),
        expire_date: '12/28',
        cvc: '123',
        is_default: true
      }];
      await customers[1].save();
    }

    // Customer 2
    if (customers.length > 2) {
      customers[2].addresses = [{
        recipient_name: customers[2].profile_name,
        phone: customers[2].phone || '0912345678',
        city: 'Da Nang',
        detail_address: '789 Nguyen Chi Thanh',
        is_default: true
      }];
      customers[2].payment_methods = [{
        card_type: 'credit',
        card_number: '5555444433339999',
        cardholder_name: customers[2].profile_name.toUpperCase(),
        expire_date: '05/29',
        cvc: '999',
        is_default: true
      }];
      await customers[2].save();
    }

    // Customer 1 Order: COD payment method
    // Should default to order_status = 'processing'
    const items1 = getRandomItems(2);
    const subtotal1 = items1.reduce((sum, item) => sum + item.subtotal, 0);
    const order1 = new Order({
      order_id: null,
      user_id: customers[0].user_id,
      is_guest: false,
      items: items1,
      delivery_info: {
        recipient_name: customers[0].profile_name,
        mobile: customers[0].phone || '0901234567',
        email: customers[0].email || 'customer1@offsite.vn',
        city: 'Ho Chi Minh City',
        address: '123 Le Loi Street, Ward 1, District 1',
        note: 'Deliver during office hours.'
      },
      shipping: {
        method: 'standard',
        cost: 0,
        carrier: 'GHN'
      },
      payment: {
        method: 'cod'
      },
      pricing: {
        subtotal: subtotal1,
        shipping_cost: 0,
        discount_amount: 0,
        total: subtotal1,
        currency: 'USD'
      },
      payment_status: 'pending'
    });
    ordersToSeed.push(order1);

    // Customer 2 Order: Card payment method, payment_status = 'paid'
    // Should auto-transition to order_status = 'processing'
    if (customers.length > 1) {
      const items2 = getRandomItems(1);
      const subtotal2 = items2.reduce((sum, item) => sum + item.subtotal, 0);
      const order2 = new Order({
        order_id: null,
        user_id: customers[1].user_id,
        is_guest: false,
        items: items2,
        delivery_info: {
          recipient_name: customers[1].profile_name,
          mobile: customers[1].phone || '0907654321',
          email: customers[1].email || 'customer2@offsite.vn',
          city: 'Hanoi',
          address: '456 Tran Hung Dao Street',
          note: 'Call before arriving.'
        },
        shipping: {
          method: 'express',
          cost: 15,
          carrier: 'GHN'
        },
        payment: {
          method: 'card',
          card_info: {
            brand: 'Visa',
            last4: '4242'
          }
        },
        pricing: {
          subtotal: subtotal2,
          shipping_cost: 15,
          discount_amount: 0,
          total: subtotal2 + 15,
          currency: 'USD'
        },
        payment_status: 'paid'
      });
      ordersToSeed.push(order2);
    }

    // Customer 3 Order: Card payment method, payment_status = 'failed'
    // Should auto-transition to order_status = 'pending'
    if (customers.length > 2) {
      const items3 = getRandomItems(1);
      const subtotal3 = items3.reduce((sum, item) => sum + item.subtotal, 0);
      const order3 = new Order({
        order_id: null,
        user_id: customers[2].user_id,
        is_guest: false,
        items: items3,
        delivery_info: {
          recipient_name: customers[2].profile_name,
          mobile: customers[2].phone || '0912345678',
          email: customers[2].email || 'customer3@offsite.vn',
          city: 'Da Nang',
          address: '789 Nguyen Chi Thanh',
          note: ''
        },
        shipping: {
          method: 'standard',
          cost: 0,
          carrier: 'GHN'
        },
        payment: {
          method: 'card',
          card_info: {
            brand: 'Mastercard',
            last4: '9999'
          }
        },
        pricing: {
          subtotal: subtotal3,
          shipping_cost: 0,
          discount_amount: 5,
          total: Math.max(0, subtotal3 - 5),
          currency: 'USD'
        },
        payment_status: 'failed'
      });
      ordersToSeed.push(order3);
    }

    // Guest Order: standard shipping, QR payment
    // Should default to order_status = 'pending'
    const itemsGuest = getRandomItems(1);
    const subtotalGuest = itemsGuest.reduce((sum, item) => sum + item.subtotal, 0);
    const orderGuest = new Order({
      order_id: null,
      is_guest: true,
      session_id: 'SS00001',
      items: itemsGuest,
      delivery_info: {
        recipient_name: 'Guest User',
        mobile: '0988888888',
        email: 'guest@example.com',
        city: 'Can Tho',
        address: '12 Hoa Binh Avenue',
        note: 'Leave at front desk.'
      },
      shipping: {
        method: 'standard',
        cost: 0,
        carrier: 'GHN'
      },
      payment: {
        method: 'qr'
      },
      pricing: {
        subtotal: subtotalGuest,
        shipping_cost: 0,
        discount_amount: 0,
        total: subtotalGuest,
        currency: 'USD'
      },
      payment_status: 'pending'
    });
    ordersToSeed.push(orderGuest);

    // Guest Order 2: Shipping, order_status = 'shipping'
    const itemsGuestShip = getRandomItems(1);
    const subtotalGuestShip = itemsGuestShip.reduce((sum, item) => sum + item.subtotal, 0);
    const orderGuestShip = new Order({
      order_id: null,
      is_guest: true,
      session_id: 'SS00002',
      items: itemsGuestShip,
      delivery_info: {
        recipient_name: 'Guest Shipping',
        mobile: '0988888889',
        email: 'guest.ship@example.com',
        city: 'Ho Chi Minh City',
        address: '789 Guest St',
        note: 'Guest shipping order'
      },
      shipping: {
        method: 'standard',
        cost: 0,
        tracking_number: 'GHNGUESTSH123',
        carrier: 'GHN'
      },
      payment: {
        method: 'qr'
      },
      pricing: {
        subtotal: subtotalGuestShip,
        shipping_cost: 0,
        discount_amount: 0,
        total: subtotalGuestShip,
        currency: 'USD'
      },
      payment_status: 'paid',
      order_status: 'shipping',
      status_history: [
        {
          status: 'processing',
          changed_at: new Date(Date.now() - 24 * 3600 * 1000),
          changed_by: 'system',
          note: 'Order created'
        },
        {
          status: 'shipping',
          changed_at: new Date(Date.now() - 6 * 3600 * 1000),
          changed_by: 'system',
          note: 'Order shipped via GHN'
        }
      ]
    });
    ordersToSeed.push(orderGuestShip);

    // Guest Order 3: Delivered, order_status = 'delivered'
    const itemsGuestDeliv = getRandomItems(2);
    const subtotalGuestDeliv = itemsGuestDeliv.reduce((sum, item) => sum + item.subtotal, 0);
    const orderGuestDeliv = new Order({
      order_id: null,
      is_guest: true,
      session_id: 'SS00003',
      items: itemsGuestDeliv,
      delivery_info: {
        recipient_name: 'Guest Delivered',
        mobile: '0988888890',
        email: 'guest.deliv@example.com',
        city: 'Hanoi',
        address: '123 Guest Rd',
        note: 'Guest delivered order'
      },
      shipping: {
        method: 'standard',
        cost: 0,
        tracking_number: 'GHNGUESTDL987',
        carrier: 'GHN'
      },
      payment: {
        method: 'card',
        card_info: {
          brand: 'Visa',
          last4: '1111'
        }
      },
      pricing: {
        subtotal: subtotalGuestDeliv,
        shipping_cost: 0,
        discount_amount: 0,
        total: subtotalGuestDeliv,
        currency: 'USD'
      },
      payment_status: 'paid',
      order_status: 'delivered',
      delivered_at: new Date(Date.now() - 2 * 3600 * 1000),
      status_history: [
        {
          status: 'processing',
          changed_at: new Date(Date.now() - 48 * 3600 * 1000),
          changed_by: 'system',
          note: 'Order created'
        },
        {
          status: 'shipping',
          changed_at: new Date(Date.now() - 24 * 3600 * 1000),
          changed_by: 'system',
          note: 'Order shipped via GHN'
        },
        {
          status: 'delivered',
          changed_at: new Date(Date.now() - 2 * 3600 * 1000),
          changed_by: 'system',
          note: 'Delivered successfully'
        }
      ]
    });
    ordersToSeed.push(orderGuestDeliv);

    // Guest Order 4: Refund, order_status = 'refund'
    const itemsGuestRefund = getRandomItems(1);
    const subtotalGuestRefund = itemsGuestRefund.reduce((sum, item) => sum + item.subtotal, 0);
    const orderGuestRefund = new Order({
      order_id: null,
      is_guest: true,
      session_id: 'SS00004',
      items: itemsGuestRefund,
      delivery_info: {
        recipient_name: 'Guest Refund',
        mobile: '0988888891',
        email: 'guest.refund@example.com',
        city: 'Da Nang',
        address: '456 Guest Ave',
        note: ''
      },
      shipping: {
        method: 'standard',
        cost: 0,
        tracking_number: 'GHNGUESTRF555',
        carrier: 'GHN'
      },
      payment: {
        method: 'card',
        card_info: {
          brand: 'Mastercard',
          last4: '2222'
        }
      },
      pricing: {
        subtotal: subtotalGuestRefund,
        shipping_cost: 0,
        discount_amount: 0,
        total: subtotalGuestRefund,
        currency: 'USD'
      },
      payment_status: 'refunded',
      order_status: 'refund',
      status_history: [
        {
          status: 'processing',
          changed_at: new Date(Date.now() - 72 * 3600 * 1000),
          changed_by: 'system',
          note: 'Order created'
        },
        {
          status: 'shipping',
          changed_at: new Date(Date.now() - 48 * 3600 * 1000),
          changed_by: 'system',
          note: 'Order shipped via GHN'
        },
        {
          status: 'delivered',
          changed_at: new Date(Date.now() - 36 * 3600 * 1000),
          changed_by: 'system',
          note: 'Delivered successfully'
        },
        {
          status: 'refund',
          changed_at: new Date(Date.now() - 12 * 3600 * 1000),
          changed_by: 'system',
          note: 'Refund processed'
        }
      ],
      refund_request: {
        type: 'return_refund',
        reason: 'Damaged item',
        items: [
          {
            product_id: itemsGuestRefund[0].product_id,
            variant_id: itemsGuestRefund[0].variant_id,
            quantity: itemsGuestRefund[0].quantity,
            reason: 'Product was broken when opening package'
          }
        ],
        requested_at: new Date(Date.now() - 24 * 3600 * 1000),
        requested_by: 'guest.refund@example.com',
        status: 'approved',
        reviewed_by: 'USR00001',
        reviewed_at: new Date(Date.now() - 12 * 3600 * 1000),
        admin_note: 'Approved. Full refund sent.'
      }
    });
    ordersToSeed.push(orderGuestRefund);

    // 5. Processing Order: COD, order_status = 'processing'
    if (customers.length > 0) {
      const itemsProc = getRandomItems(2);
      const subtotalProc = itemsProc.reduce((sum, item) => sum + item.subtotal, 0);
      const orderProc = new Order({
        order_id: null,
        user_id: customers[0].user_id,
        is_guest: false,
        items: itemsProc,
        delivery_info: {
          recipient_name: customers[0].profile_name,
          mobile: customers[0].phone || '0901234567',
          email: customers[0].email || 'customer1@offsite.vn',
          city: 'Ho Chi Minh City',
          address: '123 Le Loi Street, Ward 1, District 1',
          note: 'Processing order seed.'
        },
        shipping: {
          method: 'standard',
          cost: 0,
          carrier: 'GHN'
        },
        payment: {
          method: 'cod'
        },
        pricing: {
          subtotal: subtotalProc,
          shipping_cost: 0,
          discount_amount: 0,
          total: subtotalProc,
          currency: 'USD'
        },
        payment_status: 'pending',
        order_status: 'processing',
        status_history: [
          {
            status: 'processing',
            changed_at: new Date(Date.now() - 12 * 3600 * 1000), // 12 hours ago
            changed_by: 'system',
            note: 'Order created'
          }
        ]
      });
      ordersToSeed.push(orderProc);
    }

    // 6. Shipping Order: Card paid, order_status = 'shipping'
    if (customers.length > 0) {
      const itemsShip = getRandomItems(1);
      const subtotalShip = itemsShip.reduce((sum, item) => sum + item.subtotal, 0);
      const orderShip = new Order({
        order_id: null,
        user_id: customers[0].user_id,
        is_guest: false,
        items: itemsShip,
        delivery_info: {
          recipient_name: customers[0].profile_name,
          mobile: customers[0].phone || '0901234567',
          email: customers[0].email || 'customer1@offsite.vn',
          city: 'Ho Chi Minh City',
          address: '123 Le Loi Street, Ward 1, District 1',
          note: 'Ship to my office.'
        },
        shipping: {
          method: 'express',
          cost: 15,
          tracking_number: 'GHN123456789',
          carrier: 'GHN'
        },
        payment: {
          method: 'card',
          card_info: {
            brand: 'Visa',
            last4: '4242'
          }
        },
        pricing: {
          subtotal: subtotalShip,
          shipping_cost: 15,
          discount_amount: 0,
          total: subtotalShip + 15,
          currency: 'USD'
        },
        payment_status: 'paid',
        order_status: 'shipping',
        status_history: [
          {
            status: 'processing',
            changed_at: new Date(Date.now() - 24 * 3600 * 1000),
            changed_by: 'system',
            note: 'Order created'
          },
          {
            status: 'shipping',
            changed_at: new Date(Date.now() - 6 * 3600 * 1000),
            changed_by: 'system',
            note: 'Order shipped via GHN'
          }
        ]
      });
      ordersToSeed.push(orderShip);
    }

    // 7. Delivered Order: Card paid, order_status = 'delivered', delivered_at set
    if (customers.length > 1) {
      const itemsDeliv = getRandomItems(2);
      const subtotalDeliv = itemsDeliv.reduce((sum, item) => sum + item.subtotal, 0);
      const orderDeliv = new Order({
        order_id: null,
        user_id: customers[1].user_id,
        is_guest: false,
        items: itemsDeliv,
        delivery_info: {
          recipient_name: customers[1].profile_name,
          mobile: customers[1].phone || '0907654321',
          email: customers[1].email || 'customer2@offsite.vn',
          city: 'Hanoi',
          address: '456 Tran Hung Dao Street',
          note: ''
        },
        shipping: {
          method: 'standard',
          cost: 0,
          tracking_number: 'GHN987654321',
          carrier: 'GHN'
        },
        payment: {
          method: 'card',
          card_info: {
            brand: 'Visa',
            last4: '4242'
          }
        },
        pricing: {
          subtotal: subtotalDeliv,
          shipping_cost: 0,
          discount_amount: 10,
          total: Math.max(0, subtotalDeliv - 10),
          currency: 'USD'
        },
        payment_status: 'paid',
        order_status: 'delivered',
        delivered_at: new Date(Date.now() - 2 * 3600 * 1000),
        status_history: [
          {
            status: 'processing',
            changed_at: new Date(Date.now() - 48 * 3600 * 1000),
            changed_by: 'system',
            note: 'Order created'
          },
          {
            status: 'shipping',
            changed_at: new Date(Date.now() - 24 * 3600 * 1000),
            changed_by: 'system',
            note: 'Order shipped via GHN'
          },
          {
            status: 'delivered',
            changed_at: new Date(Date.now() - 2 * 3600 * 1000),
            changed_by: 'system',
            note: 'Delivered successfully'
          }
        ]
      });
      ordersToSeed.push(orderDeliv);
    }

    // 8. Refund Order: Card paid, order_status = 'refund', payment_status = 'refunded', refund_request populated
    if (customers.length > 2) {
      const itemsRefund = getRandomItems(1);
      const subtotalRefund = itemsRefund.reduce((sum, item) => sum + item.subtotal, 0);
      const orderRefund = new Order({
        order_id: null,
        user_id: customers[2].user_id,
        is_guest: false,
        items: itemsRefund,
        delivery_info: {
          recipient_name: customers[2].profile_name,
          mobile: customers[2].phone || '0912345678',
          email: customers[2].email || 'customer3@offsite.vn',
          city: 'Da Nang',
          address: '789 Nguyen Chi Thanh',
          note: ''
        },
        shipping: {
          method: 'standard',
          cost: 0,
          tracking_number: 'GHN555666777',
          carrier: 'GHN'
        },
        payment: {
          method: 'card',
          card_info: {
            brand: 'Mastercard',
            last4: '9999'
          }
        },
        pricing: {
          subtotal: subtotalRefund,
          shipping_cost: 0,
          discount_amount: 0,
          total: subtotalRefund,
          currency: 'USD'
        },
        payment_status: 'refunded',
        order_status: 'refund',
        status_history: [
          {
            status: 'processing',
            changed_at: new Date(Date.now() - 72 * 3600 * 1000),
            changed_by: 'system',
            note: 'Order created'
          },
          {
            status: 'shipping',
            changed_at: new Date(Date.now() - 48 * 3600 * 1000),
            changed_by: 'system',
            note: 'Order shipped via GHN'
          },
          {
            status: 'delivered',
            changed_at: new Date(Date.now() - 36 * 3600 * 1000),
            changed_by: 'system',
            note: 'Delivered successfully'
          },
          {
            status: 'refund',
            changed_at: new Date(Date.now() - 12 * 3600 * 1000),
            changed_by: 'system',
            note: 'Refund processed'
          }
        ],
        refund_request: {
          type: 'return_refund',
          reason: 'Damaged item',
          items: [
            {
              product_id: itemsRefund[0].product_id,
              variant_id: itemsRefund[0].variant_id,
              quantity: itemsRefund[0].quantity,
              reason: 'Product was broken when opening package'
            }
          ],
          requested_at: new Date(Date.now() - 24 * 3600 * 1000),
          requested_by: customers[2].user_id,
          status: 'approved',
          reviewed_by: 'USR00001',
          reviewed_at: new Date(Date.now() - 12 * 3600 * 1000),
          admin_note: 'Approved. Full refund sent.'
        }
      });
      ordersToSeed.push(orderRefund);
    }


    // Save them to DB one by one so that the pre-save hooks execute sequentially
    // (This guarantees correct increment of sequential order_id)
    console.log('Inserting orders...');
    for (const order of ordersToSeed) {
      await order.save();
    }
    console.log('Successfully seeded orders!');

    // Retrieve and log seeded orders to inspect hooks results
    const seededOrders = await Order.find({});
    for (const ord of seededOrders) {
      console.log(`\n--- Order: ${ord.order_id} ---`);
      console.log(`Owner: ${ord.is_guest ? `Guest (${ord.session_id})` : `User (${ord.user_id})`}`);
      console.log(`Payment: ${ord.payment.method} | Status: ${ord.payment_status}`);
      console.log(`Order Status: ${ord.order_status}`);
      console.log(`Status History:`, JSON.stringify(ord.status_history, null, 2));
    }

  } catch (error) {
    console.error('Error seeding orders:', error);
  } finally {
    console.log('Disconnecting from database...');
    await mongoose.disconnect();
    console.log('Database disconnected.');
  }
}

seed();
