import { Product } from '../../features/home/models/product.model';

export interface MockProductReview {
  author: string;
  date: string;
  rating: number;
  comment: string;
}

export interface ProductReviewMetric {
  ratingAvg: number;
  reviewCount: number;
  source: 'real' | 'mock';
}

const MOCK_REVIEWERS = [
  'Maya P.',
  'Julian R.',
  'Elena G.',
  'Omar F.',
  'Anita R.',
  'James L.',
  'Sarah K.',
  'Marcus V.',
  'Nina T.',
  'Leo H.',
  'Priya S.',
  'Kenji W.',
  'Mina L.',
  'Theo B.'
];

const MOCK_REVIEW_COPY: Record<string, string[]> = {
  matcha: [
    'Bright color, smooth texture, and no harsh bitterness. It whisked into a creamy bowl really easily.',
    'The umami is gentle and rounded. I like it best as an iced latte with oat milk.',
    'Very fresh aroma when opened. The finish stays clean even when prepared strong.',
    'Great everyday matcha. Smooth enough for usucha and still flavorful in milk.',
    'Beautiful green shade and a soft vegetal note. It feels much higher quality than grocery matcha.'
  ],
  coffee: [
    'The cup is balanced and sweet with a clean finish. It was excellent as a morning pour over.',
    'I got a lot of chocolate and fruit notes from this bag. Very consistent across brews.',
    'Fresh roast, clear aroma, and easy to dial in. It tastes great through a V60.',
    'This has become my daily coffee. Smooth body, lively acidity, and no muddy aftertaste.',
    'Really nice roast profile. It stays sweet even when brewed a little stronger.'
  ],
  tools: [
    'Solid build and easy to clean. It has made my morning brewing setup feel much smoother.',
    'Feels sturdy in hand and looks great on the counter. The size is practical for daily use.',
    'Simple, useful, and reliable. I have been reaching for it every day.',
    'The finish is nicer than expected. It pairs well with the rest of my brewing tools.'
  ],
  drinkware: [
    'Lovely shape and comfortable to hold. It makes even a simple drink feel more intentional.',
    'The glaze is beautiful in person. It feels handmade without being too delicate.',
    'Nice weight, easy to clean, and it keeps drinks enjoyable for slow sipping.',
    'A very pretty piece for the table. The size is exactly what I needed.'
  ],
  sets_bundles: [
    'The bundle feels thoughtfully curated and saved me from buying each piece separately.',
    'Everything arrived together and the set made gifting very easy.',
    'A polished bundle with useful pieces. Great value for trying a full setup.',
    'The products work well together and the packaging looked premium.'
  ]
};

const FEATURED_MOCK_RATINGS = [1, 2, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5];

export function getMockProductReviewCount(product: Product): number {
  const slug = product.slug || '';
  if (product.is_new_arrival) return 0;
  if (slug === 'house-matcha' || slug === 'la-golondrina') return 14;
  if (product.is_best_seller) return 4;
  if (product.category === 'matcha' || product.category === 'coffee') return 3;
  return 2;
}

export function buildMockProductReviews(product: Product): MockProductReview[] {
  const category = product.category || 'tools';
  const copy = MOCK_REVIEW_COPY[category] || MOCK_REVIEW_COPY['tools'];
  const count = getMockProductReviewCount(product);
  const ratings = getMockProductRatings(product, count);

  return Array.from({ length: count }, (_, index) => ({
    author: MOCK_REVIEWERS[index % MOCK_REVIEWERS.length],
    date: formatMockReviewDate(new Date(2026, 2 + (index % 5), 8 + index * 3).toISOString()),
    rating: ratings[index] ?? 5,
    comment: index % 5 === 2 ? '' : copy[index % copy.length]
  }));
}

export function getMockProductReviewMetric(product: Product): ProductReviewMetric | null {
  const reviews = buildMockProductReviews(product);
  if (!reviews.length) return null;

  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return {
    ratingAvg: Math.round((total / reviews.length) * 10) / 10,
    reviewCount: reviews.length,
    source: 'mock'
  };
}

export function getDisplayProductReviewMetric(product: Product): ProductReviewMetric | null {
  const realCount = product.review_count ?? 0;
  const realRating = product.rating_avg;

  if (realCount > 0 && typeof realRating === 'number') {
    return {
      ratingAvg: realRating,
      reviewCount: realCount,
      source: 'real'
    };
  }

  return getMockProductReviewMetric(product);
}

function formatMockReviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function getMockProductRatings(product: Product, count: number): number[] {
  if (count <= 0) return [];

  const slug = product.slug || '';
  if (slug === 'house-matcha' || slug === 'la-golondrina') {
    return FEATURED_MOCK_RATINGS.slice(0, count);
  }

  const pattern = getProductPattern(product);
  const ratingByPattern: Record<number, number[]> = {
    0: [5, 5, 5, 5],
    1: [4, 4, 4, 4],
    2: [5, 5, 4, 4],
    3: [5, 4, 5, 4],
    4: [5, 5, 5, 4]
  };

  const ratings = ratingByPattern[pattern];
  return Array.from({ length: count }, (_, index) => ratings[index % ratings.length]);
}

function getProductPattern(product: Product): number {
  const key = `${product.slug || product.product_id || product.name}`;
  return Array.from(key).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
}
