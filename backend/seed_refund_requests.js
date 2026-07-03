const dns = require('dns');
const mongoose = require('mongoose');
require('dotenv').config();

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const RefundRequest = require('./src/models/RefundRequest');

const SAMPLE_REFUND_REQUESTS = [
  {
    refund_request_id: 'RR500001',
    order_id: 'OFS-2026-00017',
    user_id: 'USR00002',
    session_id: null,
    reason: 'Damaged item',
    other_reason: null,
    payment: {
      method: 'card',
      card_info: { brand: 'Visa', last4: '4242' }
    },
    description: 'The matcha tin arrived dented and the seal was broken.',
    evidence: [
      'https://res.cloudinary.com/demo/image/upload/v1/refunds/ofs-2026-00017-damage-1.jpg',
      'https://res.cloudinary.com/demo/video/upload/v1/refunds/ofs-2026-00017-unbox.mp4'
    ],
    refund_item: [
      {
        product_id: 'PRD00012',
        variant_id: 'VAR00034',
        product_name: 'Ceremonial Matcha — 30g',
        variant_name: 'Origin: Uji, Kyoto',
        image: {
          url: 'https://res.cloudinary.com/demo/image/upload/v1/products/matcha-30g.jpg',
          public_id: 'products/matcha-30g'
        },
        unit_price: 38,
        quantity: 1,
        subtotal: 38
      }
    ],
    status: 'pending',
    status_history: [
      {
        status: 'pending',
        changed_at: new Date('2026-07-01T09:15:00.000Z'),
        changed_by: 'USR00002',
        note: 'Refund request submitted by customer'
      }
    ],
    admin_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: new Date('2026-07-01T09:15:00.000Z'),
    updated_at: new Date('2026-07-01T09:15:00.000Z')
  },
  {
    refund_request_id: 'RR500002',
    order_id: 'OFS-2026-00008',
    user_id: null,
    session_id: 'SS00004',
    reason: 'Other',
    other_reason: 'Package was opened and one item was missing.',
    payment: {
      method: 'cod',
      card_info: { brand: null, last4: null }
    },
    description: 'Driver left the parcel at the wrong door. One bag was missing when we opened it.',
    evidence: [
      'https://res.cloudinary.com/demo/image/upload/v1/refunds/ofs-2026-00008-package.jpg'
    ],
    refund_item: [
      {
        product_id: 'PRD00003',
        variant_id: 'VAR00008',
        product_name: 'Offsite House Blend — 250g',
        variant_name: 'Whole bean',
        image: {
          url: 'https://res.cloudinary.com/demo/image/upload/v1/products/house-blend-250g.jpg',
          public_id: 'products/house-blend-250g'
        },
        unit_price: 22,
        quantity: 1,
        subtotal: 22
      }
    ],
    status: 'approved',
    status_history: [
      {
        status: 'pending',
        changed_at: new Date('2026-06-28T14:20:00.000Z'),
        changed_by: 'SS00004',
        note: 'Refund request submitted by customer'
      },
      {
        status: 'approved',
        changed_at: new Date('2026-06-29T10:02:00.000Z'),
        changed_by: 'USR00001',
        note: 'Refund approved by admin'
      }
    ],
    admin_reason: null,
    reviewed_by: 'USR00001',
    reviewed_at: new Date('2026-06-29T10:02:00.000Z'),
    created_at: new Date('2026-06-28T14:20:00.000Z'),
    updated_at: new Date('2026-06-29T10:02:00.000Z')
  },
  {
    refund_request_id: 'RR500003',
    order_id: 'OFS-2026-00011',
    user_id: 'USR00005',
    session_id: null,
    reason: 'Wrong item',
    other_reason: null,
    payment: {
      method: 'qr',
      card_info: { brand: null, last4: null }
    },
    description: null,
    evidence: [
      'https://res.cloudinary.com/demo/image/upload/v1/refunds/ofs-2026-00011-wrong-item.jpg'
    ],
    refund_item: [
      {
        product_id: 'PRD00007',
        variant_id: 'VAR00015',
        product_name: 'Cold Brew Bottle — 500ml',
        variant_name: 'Original',
        image: {
          url: 'https://res.cloudinary.com/demo/image/upload/v1/products/cold-brew-500.jpg',
          public_id: 'products/cold-brew-500'
        },
        unit_price: 18,
        quantity: 1,
        subtotal: 18
      }
    ],
    status: 'rejected',
    status_history: [
      {
        status: 'pending',
        changed_at: new Date('2026-06-25T16:40:00.000Z'),
        changed_by: 'USR00005',
        note: 'Refund request submitted by customer'
      },
      {
        status: 'rejected',
        changed_at: new Date('2026-06-26T11:30:00.000Z'),
        changed_by: 'USR00001',
        note: 'Refund rejected by admin'
      }
    ],
    admin_reason: 'Evidence does not show a wrong item. The product label matches the order.',
    reviewed_by: 'USR00001',
    reviewed_at: new Date('2026-06-26T11:30:00.000Z'),
    created_at: new Date('2026-06-25T16:40:00.000Z'),
    updated_at: new Date('2026-06-26T11:30:00.000Z')
  }
];

async function seedRefundRequests() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Error: MONGODB_URI is not defined in backend/.env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log('Connected to MongoDB.');

    await RefundRequest.deleteMany({
      refund_request_id: { $in: SAMPLE_REFUND_REQUESTS.map((item) => item.refund_request_id) }
    });

    await RefundRequest.insertMany(SAMPLE_REFUND_REQUESTS);

    console.log(`Seeded ${SAMPLE_REFUND_REQUESTS.length} documents into RefundRequests.`);
    console.log('Sample refund_request_id values: RR500001, RR500002, RR500003');
  } catch (error) {
    console.error('Failed to seed RefundRequests:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

seedRefundRequests();
