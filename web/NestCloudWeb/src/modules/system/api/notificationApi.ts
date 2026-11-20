import { ApiClient } from '../../../shared/api/apiClient';
import type { BaseEntityRecord, OverviewResponse, PageQuery, PageResult } from '../types/common';

export interface NotificationOverviewResponse extends OverviewResponse {
  announcementCount: number;
  messageCount: number;
}

export interface AnnouncementItem extends Partial<BaseEntityRecord> {
  id: number;
  title: string;
  content: string;
  isPublished: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  publishedAt?: string | null;
  revokedAt?: string | null;
  publisherAccountId?: number;
}

export interface AnnouncementQuery extends PageQuery {
  keyword?: string;
  isPublished?: string | boolean;
}

export interface AnnouncementSaveInput {
  title: string;
  content: string;
  isPublished?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface StationMessageItem extends Partial<BaseEntityRecord> {
  id: number;
  title: string;
  content: string;
  receiverAccountId: number;
  senderAccountId?: number;
  isRead: boolean;
  readAt?: string | null;
}

export interface StationMessageQuery extends PageQuery {
  receiverAccountId?: string | number;
  isRead?: string | boolean;
}

export interface StationMessageSendInput {
  title: string;
  content: string;
  receiverAccountIds?: number[];
  isBroadcast?: boolean;
}

export interface StationMessageMarkAllResult {
  updatedCount: number;
  items: StationMessageItem[];
}

export const NotificationApi = {
  getOverview() {
    return ApiClient.get<NotificationOverviewResponse>('/api/system/announcements/overview');
  },
  listAnnouncements(query: AnnouncementQuery) {
    return ApiClient.get<PageResult<AnnouncementItem>>('/api/system/announcements', query);
  },
  getAnnouncement(id: number) {
    return ApiClient.get<AnnouncementItem>('/api/system/announcements/item', { id });
  },
  listRuntimeAnnouncements() {
    return ApiClient.get<AnnouncementItem[]>('/api/system/announcements/runtime');
  },
  createAnnouncement(input: AnnouncementSaveInput) {
    return ApiClient.post<AnnouncementItem>('/api/system/announcements', input);
  },
  updateAnnouncement(id: number, input: AnnouncementSaveInput) {
    return ApiClient.put<AnnouncementItem>('/api/system/announcements/item', input, { id });
  },
  deleteAnnouncement(id: number) {
    return ApiClient.delete<void>('/api/system/announcements/item', { id });
  },
  listMessages(query: StationMessageQuery) {
    return ApiClient.get<PageResult<StationMessageItem>>('/api/system/station-messages', query);
  },
  listRuntimeMessages(query?: Pick<StationMessageQuery, 'isRead'>) {
    return ApiClient.get<StationMessageItem[]>(
      '/api/system/station-messages/runtime/current',
      query,
    );
  },
  getUnreadCount() {
    return ApiClient.get<number>('/api/system/station-messages/unread-count');
  },
  sendMessages(input: StationMessageSendInput) {
    return ApiClient.post<StationMessageItem[]>('/api/system/station-messages/send', input);
  },
  markMessageRead(id: number) {
    return ApiClient.put<StationMessageItem>('/api/system/station-messages/read', undefined, {
      id,
    });
  },
  markAllRead() {
    return ApiClient.put<StationMessageMarkAllResult>('/api/system/station-messages/read-all');
  },
};
