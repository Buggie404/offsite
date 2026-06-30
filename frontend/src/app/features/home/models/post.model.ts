// ─────────────────────────────────────────────────────────────
//  home/models/post.model.ts
//  Matches the MongoDB Post document structure (for homepage use)
// ─────────────────────────────────────────────────────────────

export interface PostMedia {
  url:       string;
  public_id: string;
  type:      'image' | 'video';
}

export interface PostAuthor {
  username:   string;
  avatar_url: string | null;
}

export interface Post {
  _id:           string;
  post_id:       string;
  user_id:       string;
  author:        PostAuthor;
  post_type:     string;
  content:       string;
  media:         PostMedia[];
  recipe_id:     string | null;
  like_count:    number;
  comment_count: number;
  share_count:   number;
  save_count:    number;
  created_at:    string;
  updatedAt:     string;
}

export interface PostsResponse {
  data:  Post[];
  total: number;
  page:  number;
  limit: number;
}
