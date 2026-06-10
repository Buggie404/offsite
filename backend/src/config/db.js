const { MongoClient } = require('mongodb');

let client = null;
let db = null;
let collections = null;

async function connectDB() {
  if (client) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in .env file');
  }

  try {
    client = new MongoClient(uri);
    await client.connect();
    
    // Select the database defined in connection URI or default
    db = client.db();
    
    collections = {
      userCollection: db.collection('users'),
      productCollection: db.collection('products'),
      orderCollection: db.collection('orders'),
      cartCollection: db.collection('carts'),
      couponCollection: db.collection('coupons'),
      reviewCollection: db.collection('reviews'),
      recipeCollection: db.collection('recipes'),
      blogCollection: db.collection('blogs'),
      communityPostCollection: db.collection('community_posts'),
      giftShellCollection: db.collection('gift_shells')
    };

    console.log(`Successfully connected to MongoDB database: ${db.databaseName}`);
    return db;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error.message);
    client = null;
    db = null;
    collections = null;
    throw error;
  }
}

async function getCollections() {
  if (!collections) {
    await connectDB();
  }
  return collections;
}

module.exports = {
  connectDB,
  getCollections
};
