// One row in a Following / Followers list (GET /api/follows/...)
export interface FollowUser {
  user_id: string;
  username: string;
  avatar_url: string | null;
  membership_tier: 'Seed' | 'Leaf' | 'Bloom' | 'Zen';
  followers_count: number;
  followed_at: string;
  /** Whether the current viewer follows this user (false for guests) */
  is_following: boolean;
  is_self: boolean;
}

export interface FollowListResponse {
  data: FollowUser[];
  total: number;
  page: number;
  limit: number;
}

export interface FollowStatus {
  following: boolean;
}
