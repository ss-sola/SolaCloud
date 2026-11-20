import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorApi } from '../api/monitorApi';
import { formatDateTime } from '../utils/formatters';

interface MetricRow {
  label: string;
  value: string;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatBytes(value?: number | null) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatDuration(seconds?: number | null) {
  const value = Number(seconds ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 秒';
  }

  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${days} 天 ${hours} 小时 ${minutes} 分钟`;
}

function MetricCard({ title, rows }: { title: string; rows: MetricRow[] }) {
  return (
    <div className="monitor-metric-card">
      <h3 className="monitor-metric-title">{title}</h3>
      <dl className="monitor-metric-list">
        {rows.map((row) => (
          <div className="monitor-metric-row" key={`${title}-${row.label}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ServiceMonitorPage() {
  const queryClient = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: ['monitor-overview'],
    queryFn: () => MonitorApi.getOverview(),
  });

  const metricsQuery = useQuery({
    queryKey: ['service-monitor-metrics'],
    queryFn: () => MonitorApi.getServiceMetrics(),
  });

  const refreshPage = useCallback(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['monitor-overview'] }),
      queryClient.refetchQueries({ queryKey: ['service-monitor-metrics'] }),
    ]);
  }, [queryClient]);

  const metrics = metricsQuery.data;
  const isBusy = overviewQuery.isFetching || metricsQuery.isFetching;

  const pageErrorMessage = useMemo(() => {
    const firstError = [overviewQuery.error, metricsQuery.error].find(Boolean);
    return firstError ? getErrorMessage(firstError, '服务监控加载失败') : null;
  }, [metricsQuery.error, overviewQuery.error]);

  return (
    <div className="page-card">
      <div className="d-flex flex-column gap-3">
        <div className="d-flex flex-column gap-1">
          <h2 className="m-0">服务监控</h2>
          <p className="text-secondary mb-0">查看 CPU、内存、磁盘和服务器信息。</p>
        </div>

        {pageErrorMessage ? (
          <div className="alert alert-danger mb-0">{pageErrorMessage}</div>
        ) : null}

        {!metrics && isBusy ? <div className="text-secondary">服务监控数据加载中...</div> : null}

        {metrics ? (
          <div className="monitor-metric-grid">
            <MetricCard
              title="CPU"
              rows={[
                { label: '型号', value: metrics.cpu.model || '-' },
                { label: '核心数', value: String(metrics.cpu.coreCount) },
                {
                  label: '负载',
                  value: metrics.cpu.loadAverage.map((item) => item.toFixed(2)).join(' / ') || '-',
                },
                { label: '运行时长', value: formatDuration(metrics.cpu.uptimeSeconds) },
              ]}
            />
            <MetricCard
              title="内存"
              rows={[
                { label: '总量', value: formatBytes(metrics.memory.totalBytes) },
                {
                  label: '已用',
                  value: `${formatBytes(metrics.memory.usedBytes)} (${metrics.memory.usedPercent}%)`,
                },
                { label: '空闲', value: formatBytes(metrics.memory.freeBytes) },
                { label: '进程 RSS', value: formatBytes(metrics.memory.processRssBytes) },
                {
                  label: '堆内存',
                  value: `${formatBytes(metrics.memory.processHeapUsedBytes)} / ${formatBytes(
                    metrics.memory.processHeapTotalBytes,
                  )}`,
                },
              ]}
            />
            <MetricCard
              title="磁盘空间"
              rows={
                metrics.disk.available
                  ? [
                      { label: '路径', value: metrics.disk.path },
                      { label: '总量', value: formatBytes(metrics.disk.totalBytes) },
                      {
                        label: '已用',
                        value: `${formatBytes(metrics.disk.usedBytes)} (${metrics.disk.usedPercent ?? 0}%)`,
                      },
                      { label: '空闲', value: formatBytes(metrics.disk.freeBytes) },
                    ]
                  : [
                      { label: '路径', value: metrics.disk.path },
                      { label: '状态', value: '不可用' },
                      { label: '错误', value: metrics.disk.errorMessage || '-' },
                    ]
              }
            />
            <MetricCard
              title="服务器信息"
              rows={[
                { label: '主机名', value: metrics.server.hostname },
                { label: '平台', value: `${metrics.server.platform} ${metrics.server.release}` },
                { label: '架构', value: metrics.server.arch },
                { label: 'Node', value: metrics.server.nodeVersion },
                { label: 'PID', value: String(metrics.server.pid) },
                { label: '采集时间', value: formatDateTime(metrics.collectedAt) },
              ]}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
