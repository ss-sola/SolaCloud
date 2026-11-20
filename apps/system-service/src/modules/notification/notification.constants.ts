export const ANNOUNCEMENT_CONTROLLER_ROUTE = 'system/announcements';
export const STATION_MESSAGE_CONTROLLER_ROUTE = 'system/station-messages';

export const NOTIFICATION_CAPABILITIES = [
  'announcement-publish',
  'message-send',
  'broadcast-send',
  'runtime-read',
  'read-state',
  'read-all',
] as const;
