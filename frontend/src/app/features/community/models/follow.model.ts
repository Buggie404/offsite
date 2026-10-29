// FollowUser / FollowListResponse live in community.service (shape of GET /api/follows/:userId/:type)
export interface FollowStatus {
  following: boolean;
}
