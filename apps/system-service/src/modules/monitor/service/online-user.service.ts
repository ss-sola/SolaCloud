import { getConfig, ProjectException, ConfigKeys } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { SYSTEM_SERVICE_NAME } from '../../../system-service.constants';
import { PageResult } from '../../../utils/pagination.types';
import { PaginationUtil } from '../../../utils/pagination.util';
import { AUTH_SESSION_TTL_MS } from '../../account/account.constants';
import { MONITOR_CAPABILITIES } from '../monitor.constants';
import {
  MonitorOverviewRecord,
  OnlineUserKickInput,
  OnlineUserKickResult,
  OnlineUserRecord,
  OnlineUserUpsertInput,
} from '../monitor.types';
import { OnlineUserQueryForm } from '../form/online-user-query.form';
import { OnlineUserSessionService } from './online-user-session.service';

@Injectable()
export class OnlineUserService {
  private readonly onlineUsers = new Map<string, OnlineUserRecord>();

  constructor(private readonly onlineUserSessionService: OnlineUserSessionService) {}

  getOverview(): MonitorOverviewRecord {
    this.pruneExpired();
    return {
      service: SYSTEM_SERVICE_NAME,
      onlineUserCount: this.onlineUsers.size,
      capabilities: [...MONITOR_CAPABILITIES],
    };
  }

  upsert(input: OnlineUserUpsertInput): void {
    if (!input.sessionId) {
      return;
    }

    const now = new Date();
    const current = this.onlineUsers.get(input.sessionId);
    const loginAt = input.sessionLoginAt ?? current?.loginAt ?? now.toISOString();
    this.onlineUsers.set(input.sessionId, {
      sessionId: input.sessionId,
      accountId: input.accountId,
      accountName: input.accountName,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? undefined,
      ip: input.ip,
      userAgent: this.normalizeUserAgent(input.userAgent),
      loginAt,
      lastActiveAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.getSessionTtlMs()).toISOString(),
    });
  }

  removeBySessionId(sessionId?: string): void {
    if (!sessionId) {
      return;
    }
    this.onlineUsers.delete(sessionId);
  }

  listItems(query: OnlineUserQueryForm): PageResult<OnlineUserRecord> {
    this.pruneExpired();
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const keyword = query.keyword?.trim().toLowerCase();
    const matchedItems = [...this.onlineUsers.values()]
      .filter((item) => this.matchesKeyword(item, keyword))
      .sort((left, right) => right.lastActiveAt.localeCompare(left.lastActiveAt, 'zh-CN'));
    return PaginationUtil.buildPageResult(
      PaginationUtil.paginateArray(matchedItems, pageQuery),
      matchedItems.length,
      pageQuery,
    );
  }

  async kickOffline(input: OnlineUserKickInput): Promise<OnlineUserKickResult> {
    this.pruneExpired();
    if (input.sessionId === input.operatorSessionId) {
      throw new ProjectException('不能踢出当前登录会话', 400);
    }

    if (!this.onlineUsers.has(input.sessionId)) {
      throw new ProjectException('在线用户会话不存在或已过期', 404);
    }

    await this.onlineUserSessionService.destroyBySessionId(input.sessionId);
    this.removeBySessionId(input.sessionId);
    return { sessionId: input.sessionId, kicked: true };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [sessionId, item] of this.onlineUsers.entries()) {
      if (new Date(item.expiresAt).getTime() <= now) {
        this.onlineUsers.delete(sessionId);
      }
    }
  }

  private matchesKeyword(item: OnlineUserRecord, keyword: string | undefined): boolean {
    if (!keyword) {
      return true;
    }
    return [item.accountName, item.displayName, item.ip, item.userAgent].some((value) =>
      value?.toLowerCase().includes(keyword),
    );
  }

  private normalizeUserAgent(userAgent?: string | string[]): string | undefined {
    return Array.isArray(userAgent) ? userAgent.join(' ') : userAgent;
  }

  private getSessionTtlMs(): number {
    return getConfig<number>(ConfigKeys.SessionTtlMs, AUTH_SESSION_TTL_MS, false);
  }
}
