import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminRole } from '../../../shared/models/admin-role.model';

export type ReportTargetType = 'post' | 'comment' | 'account';
export type PenaltyAction = 'warn' | 'suspend_3d' | 'suspend_7d';
export type ModerationActionType = 'hide' | 'restore' | PenaltyAction | 'dismiss';

export interface QueueItem {
  key: string;
  target_type: ReportTargetType;
  target_id: string;
  content: string;
  thumbnail: string | null;
  /** null for accounts */
  content_status: 'visible' | 'hidden' | null;
  owner_id: string;
  owner_name: string;
  owner_avatar: string | null;
  owner_status: 'active' | 'locked';
  owner_warnings: number;
  owner_restricted_until: string | null;
  last_violation: { level: number; created_at: string } | null;
  top_reason: string;
  /** Lowest level the main report reason calls for */
  reason_level: number;
  /** Level suggested from earlier violations and the main report reason */
  recommended_action: PenaltyAction;
  /** Staff already judged this post: its points do not come back on restore */
  points_forfeited?: boolean;
  posted_at: string | null;
  post_id: string | null;
  pending_reports: number;
  reporter_count: number;
  reasons: Record<string, number>;
  notes: string[];
  first_reported_at: string;
  last_reported_at: string;
}

export interface HandledItem {
  action_id: string;
  target_type: ReportTargetType;
  target_id: string;
  owner_id: string | null;
  owner_name: string | null;
  action: 'hide' | 'restore' | PenaltyAction | 'lift' | 'lock' | 'unlock' | 'dismiss';
  also_hidden: boolean;
  restricted_until: string | null;
  message: string | null;
  reports_closed: number;
  admin_name: string | null;
  admin_role: AdminRole;
  created_at: string;
  content_hidden: boolean;
  owner_locked: boolean;
  owner_restricted: boolean;
}

export interface ModerationRequest {
  target_type: ReportTargetType;
  target_id: string;
  action: ModerationActionType;
  message: string;
  notify_reporters: boolean;
}

@Injectable({ providedIn: 'root' })
export class AdminModerationService {
  private http = inject(HttpClient);
  private readonly api = '/api/admin/community';

  queue(type: ReportTargetType | '' = ''): Observable<{ data: QueueItem[]; total: number }> {
    return this.http.get<{ data: QueueItem[]; total: number }>(`${this.api}/queue`, { params: type ? { type } : {} });
  }

  handled(type: ReportTargetType | '' = '', page = 1): Observable<{ data: HandledItem[]; total: number; page: number; limit: number }> {
    const params: Record<string, string> = { page: String(page) };
    if (type) params['type'] = type;
    return this.http.get<{ data: HandledItem[]; total: number; page: number; limit: number }>(`${this.api}/handled`, { params });
  }

  /**
   * Staff "Report account": apply the chosen penalty now (no pending report for review).
   * The message is what the customer receives with the COMMUNITY_MODERATION notification.
   */
  penalizeAccount(userId: string, reason: string, note: string, penalty: PenaltyAction) {
    const reasons: Record<string, string> = { spam: 'spam', inappropriate: 'inappropriate content', off_topic: 'off-topic content', misleading: 'misleading content', other: 'a community rule violation' };
    const penalties: Record<PenaltyAction, string> = { warn: 'a warning', suspend_3d: 'a 3-day Community restriction', suspend_7d: 'a 7-day Community restriction' };
    const message = [`Your account received ${penalties[penalty]} for ${reasons[reason] || reasons['other']}.`, note].filter(Boolean).join(' ');
    return this.moderate({ target_type: 'account', target_id: userId, action: penalty, message, notify_reporters: false });
  }

  moderate(body: ModerationRequest): Observable<{ data: { action_id: string; action: string; reports_closed: number } }> {
    return this.http.post<{ data: { action_id: string; action: string; reports_closed: number } }>(`${this.api}/moderate`, body);
  }
}
