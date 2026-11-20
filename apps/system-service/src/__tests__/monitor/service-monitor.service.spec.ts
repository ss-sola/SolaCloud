import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceMonitorService } from '@/modules/monitor/service/service-monitor.service';

describe('ServiceMonitorService', () => {
  it('should collect service metrics with stable structure', async () => {
    const service = new ServiceMonitorService();

    const metrics = await service.getServiceMetrics();

    expect(metrics.collectedAt).toBeTruthy();
    expect(metrics.cpu.coreCount).toBeGreaterThanOrEqual(0);
    expect(metrics.cpu.loadAverage).toHaveLength(3);
    expect(metrics.memory.totalBytes).toBeGreaterThanOrEqual(0);
    expect(metrics.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.disk.path).toBeTruthy();
    expect(typeof metrics.disk.available).toBe('boolean');
    expect(metrics.server.nodeVersion).toBe(process.version);
    expect(metrics.server.pid).toBe(process.pid);
  });
});
