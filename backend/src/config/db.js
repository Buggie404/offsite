const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');

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
    // Connect Mongoose
    await mongoose.connect(uri);
    console.log('Successfully connected to MongoDB via Mongoose');

    client = new MongoClient(uri);
    await client.connect();

    // Select the database defined in connection URI or default
    db = client.db();

    collections = {
      userCollection: db.collection('Users'),
      productCollection: db.collection('Products'),
      orderCollection: db.collection('Orders'),
      cartCollection: db.collection('Carts'),
      couponCollection: db.collection('Vouchers'),
      reviewCollection: db.collection('Reviews'),
      recipeCollection: db.collection('recipes'),
      blogCollection: db.collection('Blogs'),
      postCollection: db.collection('Posts'),
      commentCollection: db.collection('Comments'),
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
