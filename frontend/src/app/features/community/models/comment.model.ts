export interface CommentAuthor {
  username: string;
  avatar_url: string;
  is_post_author: boolean;
}

export interface Comment {
  _id: string;

  comment_id: string;
  post_id: string;
  parent_id: string | null;
  user_id: string;

  author: CommentAuthor;

  content: string;

  reply_to_username: string | null;

  like_count: number;
  reply_count: number;

  created_at: string;
  updated_at: string;
}