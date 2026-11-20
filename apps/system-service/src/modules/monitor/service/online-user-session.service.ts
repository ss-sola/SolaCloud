import { getConfig, ProjectException, RedisSessionStore, ConfigKeys } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { AUTH_SESSION_KEY_PREFIX, AUTH_SESSION_TTL_MS } from '../../account/account.constants';

@Injectable()
export class OnlineUserSessionService {
  private store?: RedisSessionStore;

  async destroyBySessionId(sessionId: string): Promise<void> {
    const store = this.getStore();
    try {
      await new Promise<void>((resolve, reject) => {
        store.destroy(sessionId, (error) => {
          if (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          resolve();
        });
      });
    } catch (error) {
      throw new ProjectException(
        `踢人下线失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getStore(): RedisSessionStore {
    if (this.store) {
      return this.store;
    }

    const redisUrl = getConfig<string>(ConfigKeys.SessionRedisUrl, undefined, false);
    if (!redisUrl) {
      throw new ProjectException('当前会话存储不支持踢人下线，请配置 Redis session');
    }

    this.store = new RedisSessionStore({
      redisUrl,
      keyPrefix: getConfig<string>(ConfigKeys.SessionKeyPrefix, AUTH_SESSION_KEY_PREFIX, false),
      ttlMs: getConfig<number>(ConfigKeys.SessionTtlMs, AUTH_SESSION_TTL_MS, false),
    });
    return this.store;
  }
}
