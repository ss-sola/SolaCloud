export const MONITOR_CONTROLLER_ROUTE = 'system/monitors';

export const MONITOR_CAPABILITIES = [
  'online-user-query',
  'online-user-kick',
  'service-metrics',
] as const;

export const MONITOR_DISK_PATH = process.cwd();
