const menuIconManifest: Record<string, string> = {
  'system-management': '/assert/svg/system/system-management.svg',
  'system-resource-group': '/assert/svg/resource/system-resource-group.svg',
  'dictionary-namespace': '/assert/svg/resource/dictionary-namespace.svg',
  dictionary: '/assert/svg/resource/dictionary.svg',
  'menu-route': '/assert/svg/resource/menu-route.svg',
  notification: '/assert/svg/resource/notification.svg',
  attachment: '/assert/svg/resource/attachment.svg',
  'system-access-group': '/assert/svg/access/system-access-group.svg',
  permission: '/assert/svg/access/permission.svg',
  role: '/assert/svg/access/role.svg',
  account: '/assert/svg/access/account.svg',
  'system-observe-group': '/assert/svg/observe/system-observe-group.svg',
  'login-log': '/assert/svg/observe/login-log.svg',
  'operation-log': '/assert/svg/observe/operation-log.svg',
  'system-monitor-group': '/assert/svg/monitor/system-monitor-group.svg',
  'online-user-monitor': '/assert/svg/monitor/online-user-monitor.svg',
  'service-monitor': '/assert/svg/monitor/service-monitor.svg',
};

export const menuIconKeys = Object.keys(menuIconManifest);

export function resolveMenuIconUrl(icon?: string | null): string | undefined {
  const normalizedIcon = String(icon ?? '').trim();
  if (!normalizedIcon) {
    return undefined;
  }

  return menuIconManifest[normalizedIcon] ?? undefined;
}
