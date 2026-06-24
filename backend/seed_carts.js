const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const User = require('./src/models/User');
const Product = require('./src/models/Product');
const Cart = require('./src/models/Cart');

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Error: MONGODB_URI is not defined in the environment variables.');
    process.exit(1);
  }

  try {
    console.log('Connecting to database...');
    await mongoose.connect(uri);
    console.log('Connected to MongoDB via Mongoose.');

    // 1. Ensure at least some customer users exist in the database
    let customers = await User.find({ role: 'customer' });
    if (customers.length === 0) {
      console.log('No customer users found in the database. Seeding dummy customer users...');
      const hashedPassword = await bcrypt.hash('P@ssword123', 10);
      const dummyUsers = [
        {
          user_id: 'USR00002',
          email: 'customer1@offsite.vn',
          phone: '0901234567',
          password_hash: hashedPassword,
          profile_name: 'Nguyen Van A',
          community_name: 'nguyenvana_community',
          role: 'customer',
          status: 'active'
        },
        {
          user_id: 'USR00003',
          email: 'customer2@offsite.vn',
          phone: '0907654321',
          password_hash: hashedPassword,
          profile_name: 'Tran Thi B',
          community_name: 'tranthib_community',
          role: 'customer',
          status: 'active'
        },
        {
          user_id: 'USR00004',
          email: 'customer3@offsite.vn',
          phone: '0912345678',
          password_hash: hashedPassword,
          profile_name: 'Le Van C',
          community_name: 'levanc_community',
          role: 'customer',
          status: 'active'
        }
      ];
      customers = await User.insertMany(dummyUsers);
      console.log(`Successfully seeded ${customers.length} customer users.`);
    } else {
      console.log(`Found ${customers.length} customer users in database.`);
    }

    // 2. Fetch active products with variants
    const products = await Product.find({ is_active: true });
    if (products.length === 0) {
      throw new Error('No active products found in the database. Cannot seed carts without products.');
    }
    console.log(`Found ${products.length} active products in database.`);

    // 3. Clear existing carts
    console.log('Clearing existing carts...');
    const deleteResult = await Cart.deleteMany({});
    console.log(`Cleared ${deleteResult.deletedCount} existing carts from Carts collection.`);

    // Drop the old lowercase 'carts' collection if it exists
    try {
      const db = mongoose.connection.db;
      const collections = await db.listCollections({ name: 'carts' }).toArray();
      if (collections.length > 0) {
        console.log("Dropping old lowercase 'carts' collection...");
        await db.collection('carts').drop();
        console.log("Dropped old 'carts' collection.");
      }
    } catch (e) {
      console.log('Note: could not drop old carts collection (might not exist):', e.message);
    }

    // 4. Generate mock carts
    const cartsToSeed = [];
    let cartSeq = 0;
    const getCartId = () => `CRT${String(cartSeq++).padStart(5, '0')}`;

    // Helper to generate random cart items
    const generateRandomItems = (numItems) => {
      const items = [];
      const seenKeys = new Set();

      while (items.length < numItems) {
        // Pick a random product
        const product = products[Math.floor(Math.random() * products.length)];
        if (!product.variants || product.variants.length === 0) {
          continue; // Skip products without variants
        }

        // Pick a random variant
        const variant = product.variants[Math.floor(Math.random() * product.variants.length)];
        const key = `${product._id}::${variant.sku}`;

        // Ensure composite uniqueness (product_id, variant_id)
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          
          // Generate a date within the last 7 days
          const daysAgo = Math.floor(Math.random() * 7);
          const addedAt = new Date();
          addedAt.setDate(addedAt.getDate() - daysAgo);

          items.push({
            product_id: product._id.toString(), // references Product ObjectId
            variant_id: variant.sku,           // matches variants SKU
            quantity: Math.floor(Math.random() * 4) + 1, // 1 to 4
            price_at_add: variant.price,
            is_selected: Math.random() < 0.5, // 50% select chance
            added_at: addedAt
          });
        }
      }
      return items;
    };

    // A. Seed carts for logged-in users (one cart per customer)
    console.log('Generating logged-in user carts...');
    for (const customer of customers) {
      const numItems = Math.floor(Math.random() * 3) + 1; // 1 to 3 items
      const cart = new Cart({
        cart_id: getCartId(),
        user_id: customer.user_id,
        session_id: null,
        items: generateRandomItems(numItems),
        expires_at: null // Persists forever
      });
      cartsToSeed.push(cart);
    }

    // B. Seed guest carts (3 carts)
    console.log('Generating guest carts...');
    for (let i = 1; i <= 3; i++) {
      const numItems = Math.floor(Math.random() * 3) + 1; // 1 to 3 items
      const session_id = `SS${String(i).padStart(5, '0')}`;
      
      // Guest carts expire in 30 days
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const cart = new Cart({
        cart_id: getCartId(),
        user_id: null,
        session_id: session_id,
        items: generateRandomItems(numItems),
        expires_at: expiresAt
      });
      cartsToSeed.push(cart);
    }

    // 5. Insert to DB
    console.log(`Inserting ${cartsToSeed.length} carts to MongoDB...`);
    const insertedCarts = await Cart.insertMany(cartsToSeed);
    console.log(`Successfully seeded ${insertedCarts.length} carts!`);

    // Output summary
    for (const cart of insertedCarts) {
      const owner = cart.user_id ? `User: ${cart.user_id}` : `Guest: ${cart.session_id}`;
      const expiry = cart.expires_at ? `TTL: ${cart.expires_at.toISOString()}` : 'No Expiry';
      console.log(`- ${cart.cart_id} | ${owner} | Items: ${cart.items.length} | ${expiry}`);
    }

  } catch (error) {
    console.error('Error during seeding process:', error);
  } finally {
    console.log('Disconnecting database...');
    await mongoose.disconnect();
    console.log('Database disconnected.');
  }
}

seed();
