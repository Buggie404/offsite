require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const mongoose = require('mongoose');

async function testRoutes() {
  const PORT = 5099;
  let server;

  try {
    console.log('Starting test server...');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(PORT, resolve));
    console.log(`Server listening on http://localhost:${PORT}`);

    // Wait a moment for mongoose to connect (since app.js triggers it asynchronously)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('--- Testing GET /api/posts ---');
    const postsRes = await fetch(`http://localhost:${PORT}/api/posts?limit=2`);
    const postsData = await postsRes.json();
    console.log('Status:', postsRes.status);
    console.log('Data returned:', !!postsData.data, 'total:', postsData.total);
    if (postsData.data && postsData.data.length > 0) {
      console.log('First post ID:', postsData.data[0].post_id);
    }

    console.log('--- Testing GET /api/comments/post/POST600001 ---');
    const commentsRes = await fetch(`http://localhost:${PORT}/api/comments/post/POST600001?limit=2`);
    const commentsData = await commentsRes.json();
    console.log('Status:', commentsRes.status);
    console.log('Data returned:', !!commentsData.data, 'total:', commentsData.total);
    if (commentsData.data && commentsData.data.length > 0) {
      console.log('First comment ID:', commentsData.data[0].comment_id);
    }

  } catch (err) {
    console.error('Integration test failed:', err);
  } finally {
    if (server) {
      server.close();
      console.log('Server stopped.');
    }
    await mongoose.disconnect();
    console.log('Mongoose disconnected.');
    process.exit(0);
  }
}

testRoutes();
