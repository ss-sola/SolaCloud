import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import {
  REQUIRED_PERMISSION_CODES_KEY,
  REQUIRED_PERMISSION_MATCH_MODE_KEY,
} from '@/modules/account/auth/require-permissions.decorator';
import { AccountSessionRequest } from '@nest-cloud/sdk';
import { SYSTEM_PERMISSION_CODES } from '@/modules/account/auth/system-permission.constants';
import { MonitorController } from '@/modules/monitor/controller/monitor.controller';
import { OnlineUserService } from '@/modules/monitor/service/online-user.service';
import { ServiceMonitorService } from '@/modules/monitor/service/service-monitor.service';

function createController() {
  const onlineUserService = {
    getOverview: vi.fn(() => ({
      service: 'system-service',
      onlineUserCount: 1,
      capabilities: ['online-user-query', 'online-user-kick'],
    })),
    listItems: vi.fn(() => ({
      list: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    })),
    kickOffline: vi.fn(() =>
      Promise.resolve({ sessionId: 'target-session', kicked: true as const }),
    ),
  } as unknown as OnlineUserService;
  const serviceMonitorService = {
    getServiceMetrics: vi.fn(() =>
      Promise.resolve({
        collectedAt: '2026-05-31T08:00:00.000Z',
        cpu: {
          model: 'test-cpu',
          coreCount: 1,
          loadAverage: [0, 0, 0],
          uptimeSeconds: 1,
        },
        memory: {
          totalBytes: 1,
          freeBytes: 1,
          usedBytes: 0,
          usedPercent: 0,
          processRssBytes: 1,
          processHeapTotalBytes: 1,
          processHeapUsedBytes: 1,
        },
        disk: { path: '.', available: false },
        server: {
          hostname: 'localhost',
          platform: 'test',
          arch: 'x64',
          release: 'test',
          nodeVersion: process.version,
          pid: process.pid,
        },
      }),
    ),
  } as unknown as ServiceMonitorService;
  return {
    controller: new MonitorController(onlineUserService, serviceMonitorService),
    onlineUserService,
  };
}

describe('MonitorController', () => {
  it('should wrap monitor service responses', async () => {
    const { controller } = createController();

    expect(controller.getOverview().data.onlineUserCount).toBe(1);
    expect(controller.listOnlineUsers({ pageNum: 1, pageSize: 10 }).data.total).toBe(0);
    expect((await controller.getServiceMetrics()).data.cpu.model).toBe('test-cpu');
  });

  it('should delegate kick offline with current session id', async () => {
    const { controller, onlineUserService } = createController();

    const response = await controller.kickOnlineUser({ sessionId: 'target-session' }, {
      sessionID: 'operator-session',
    } as AccountSessionRequest);

    expect(response.data).toEqual({
      sessionId: 'target-session',
      kicked: true,
    });
    expect(onlineUserService.kickOffline).toHaveBeenCalledWith({
      sessionId: 'target-session',
      operatorSessionId: 'operator-session',
    });
  });

  it('should declare monitor permissions', () => {
    const overviewCodes = Reflect.getMetadata(
      REQUIRED_PERMISSION_CODES_KEY,
      MonitorController.prototype.getOverview,
    );
    const overviewMode = Reflect.getMetadata(
      REQUIRED_PERMISSION_MATCH_MODE_KEY,
      MonitorController.prototype.getOverview,
    );
    const serviceCodes = Reflect.getMetadata(
      REQUIRED_PERMISSION_CODES_KEY,
      MonitorController.prototype.getServiceMetrics,
    );
    const onlineUserCodes = Reflect.getMetadata(
      REQUIRED_PERMISSION_CODES_KEY,
      MonitorController.prototype.listOnlineUsers,
    );
    const kickCodes = Reflect.getMetadata(
      REQUIRED_PERMISSION_CODES_KEY,
      MonitorController.prototype.kickOnlineUser,
    );

    expect(overviewMode).toBe('any');
    expect(overviewCodes).toEqual([
      SYSTEM_PERMISSION_CODES.onlineUserMonitorQuery,
      SYSTEM_PERMISSION_CODES.serviceMonitorQuery,
    ]);
    expect(serviceCodes).toEqual([SYSTEM_PERMISSION_CODES.serviceMonitorQuery]);
    expect(onlineUserCodes).toEqual([SYSTEM_PERMISSION_CODES.onlineUserMonitorQuery]);
    expect(kickCodes).toEqual([SYSTEM_PERMISSION_CODES.onlineUserMonitorKick]);
  });
});
