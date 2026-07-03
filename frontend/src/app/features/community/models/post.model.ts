export interface Post {
  _id: string;
  post_id: string;
  user_id: string;

  author: PostAuthor;

  post_type: 'regular' | 'recipe';

  content: string;

  media: PostMedia[];

  recipe_id: string | null;

  like_count: number;
  comment_count: number;
  share_count: number;
  save_count: number;

  created_at: string;
  updatedAt: string;
}

export interface PostAuthor {
  username: string;
  avatar_url: string | null;
}

export interface PostMedia {
  url: string;
  public_id: string;
  type: 'image' | 'video';
}