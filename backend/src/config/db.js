const dns = require('dns');
const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');

// Node.js on Windows can fail mongodb+srv SRV lookups via the default resolver.
// Prefer public DNS servers so Atlas SRV records resolve reliably.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

let client = null;
let db = null;
let collections = null;

function getMongoUri() {
  return process.env.MONGODB_URI;
}

async function connectDB() {
  if (client) return db;

  const uri = getMongoUri();
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in .env file');
  }

  const mongooseOptions = {
    serverSelectionTimeoutMS: 15000,
  };

  try {
    await mongoose.connect(uri, mongooseOptions);
    console.log('Successfully connected to MongoDB via Mongoose');

    client = new MongoClient(uri);
    await client.connect();

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
