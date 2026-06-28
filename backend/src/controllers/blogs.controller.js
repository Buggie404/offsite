const Blog = require('../models/Blog');

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 30000; // 30 seconds cache

function getCacheKey(filter, sortOptions, page, limit) {
  return JSON.stringify({ filter, sortOptions, page, limit });
}

function getFromCache(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  // Limit cache size
  if (cache.size > 100) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { data, timestamp: Date.now() });
}

// Clear cache on write operations (call this when blogs are created/updated/deleted)
function clearBlogCache() {
  cache.clear();
}

async function getAllBlogs(req, res) {
  try {
    const filter = {};
    const sortOptions = {};
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const skip = (page - 1) * limit;

    // Filter by Category
    if (req.query.category && req.query.category !== 'ALL') {
      filter.category = req.query.category.trim();
    }

    // Filter by Tag
    if (req.query.tag) {
      filter.tags = req.query.tag.trim();
    }

    // Filter by Search Query
    if (req.query.search && req.query.search.trim()) {
      const searchTrimmed = req.query.search.trim();
      const isExactMatch = searchTrimmed.startsWith('"') && searchTrimmed.endsWith('"');
      
      if (isExactMatch) {
        const exactQuery = searchTrimmed.slice(1, -1);
        filter.$or = [
          { title: { $regex: `^${exactQuery}$`, $options: 'i' } },
          { excerpt: { $regex: `^${exactQuery}$`, $options: 'i' } }
        ];
      } else {
        filter.$or = [
          { title: { $regex: searchTrimmed, $options: 'i' } },
          { excerpt: { $regex: searchTrimmed, $options: 'i' } }
        ];
      }
    }

    // Sorting
    if (req.query.sort === 'OLDEST') {
      sortOptions.published_at = 1;
    } else if (req.query.sort === 'SHORTEST_READ') {
      sortOptions.read_time_minutes = 1;
    } else if (req.query.sort === 'LONGEST_READ') {
      sortOptions.read_time_minutes = -1;
    } else {
      sortOptions.published_at = -1;
    }

    // Check cache
    const cacheKey = getCacheKey(filter, sortOptions, page, limit);
    const cached = getFromCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Execute query with pagination
    const [blogs, total] = await Promise.all([
      Blog.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      Blog.countDocuments(filter)
    ]);

    const response = {
      data: blogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + blogs.length < total
      }
    };

    // Store in cache
    setCache(cacheKey, response);

    res.json(response);
  } catch (error) {
    console.error('Error fetching blogs:', error);
    res.status(500).json({ error: 'Failed to retrieve blogs' });
  }
}

async function getBlogBySlug(req, res) {
  try {
    const { slug } = req.params;
    
    // Check cache for single blog too
    const cacheKey = `blog:${slug}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }

    const blog = await Blog.findOne({ slug }).lean();
    if (!blog) {
      return res.status(404).json({ error: 'Blog not found' });
    }

    // Cache the result
    cache.set(cacheKey, { data: blog, timestamp: Date.now() });

    res.json(blog);
  } catch (error) {
    console.error('Error fetching blog:', error);
    res.status(500).json({ error: 'Failed to retrieve blog' });
  }
}

module.exports = {
  getAllBlogs,
  getBlogBySlug,
  clearBlogCache
};
