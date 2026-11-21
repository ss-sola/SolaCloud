export const SYSTEM_PERMISSION_CODES = {
  dictionaryManage: 'system:dictionary:manage',
  menuRouteManage: 'system:menu-route:manage',
  notificationManage: 'system:notification:manage',
  permissionManage: 'system:permission:manage',
  roleManage: 'system:role:manage',
  accountManage: 'system:account:manage',
  onlineUserMonitorQuery: 'system:monitor:online-user:query',
  onlineUserMonitorKick: 'system:monitor:online-user:kick',
  serviceMonitorQuery: 'system:monitor:service:query',
  loginLogQuery: 'system:login-log:query',
  operationLogQuery: 'system:operation-log:query',
  traceLogQuery: 'system:trace-log:query',
} as const;
