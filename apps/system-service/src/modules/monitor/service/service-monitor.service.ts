import { Injectable } from '@nestjs/common';
import { statfs } from 'fs/promises';
import * as os from 'os';
import { MONITOR_DISK_PATH } from '../monitor.constants';
import { DiskMonitorRecord, ServiceMonitorRecord } from '../monitor.types';

@Injectable()
export class ServiceMonitorService {
  async getServiceMetrics(): Promise<ServiceMonitorRecord> {
    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    return {
      collectedAt: new Date().toISOString(),
      cpu: {
        model: os.cpus()[0]?.model ?? 'unknown',
        coreCount: os.cpus().length,
        loadAverage: os.loadavg(),
        uptimeSeconds: os.uptime(),
      },
      memory: {
        totalBytes: totalMemory,
        freeBytes: freeMemory,
        usedBytes: usedMemory,
        usedPercent: this.toPercent(usedMemory, totalMemory),
        processRssBytes: memoryUsage.rss,
        processHeapTotalBytes: memoryUsage.heapTotal,
        processHeapUsedBytes: memoryUsage.heapUsed,
      },
      disk: await this.getDiskMetrics(),
      server: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        nodeVersion: process.version,
        pid: process.pid,
      },
    };
  }

  private async getDiskMetrics(): Promise<DiskMonitorRecord> {
    try {
      const stats = await statfs(MONITOR_DISK_PATH);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const usedBytes = totalBytes - freeBytes;
      return {
        path: MONITOR_DISK_PATH,
        available: true,
        totalBytes,
        freeBytes,
        usedBytes,
        usedPercent: this.toPercent(usedBytes, totalBytes),
      };
    } catch (error) {
      return {
        path: MONITOR_DISK_PATH,
        available: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private toPercent(value: number, total: number): number {
    if (!total) {
      return 0;
    }
    return Number(((value / total) * 100).toFixed(2));
  }
}
