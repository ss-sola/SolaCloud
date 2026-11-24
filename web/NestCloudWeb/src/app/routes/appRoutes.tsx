/**
 * 前端集中路由表。
 * 每条路由包含唯一 name、绝对 path、渲染组件和 meta 元数据。
 * 菜单管理通过 routeName 字段与此处的 name 关联，
 * 前端运行时通过 name 查询本表获取真实 path 和组件，不依赖菜单存储的 path。
 */
import { lazy, type ComponentType } from 'react';

// ── system 域页面（按路由懒加载）
const AccountPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/AccountPage')).AccountPage,
}));
const DictionaryNamespacePage = lazy(async () => ({
  default: (await import('../../modules/system/pages/DictionaryNamespacePage'))
    .DictionaryNamespacePage,
}));
const DictionaryPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/DictionaryPage')).DictionaryPage,
}));
const LoginLogPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/LoginLogPage')).LoginLogPage,
}));
const MenuRoutePage = lazy(async () => ({
  default: (await import('../../modules/system/pages/MenuRoutePage')).MenuRoutePage,
}));
const NotificationPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/NotificationPage')).NotificationPage,
}));
const OnlineUserMonitorPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/OnlineUserMonitorPage')).OnlineUserMonitorPage,
}));
const OperationLogPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/OperationLogPage')).OperationLogPage,
}));
const TraceLogPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/TraceLogPage')).TraceLogPage,
}));
const ApiCallGraphPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/ApiCallGraphPage')).ApiCallGraphPage,
}));
const PermissionPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/PermissionPage')).PermissionPage,
}));
const RolePage = lazy(async () => ({
  default: (await import('../../modules/system/pages/RolePage')).RolePage,
}));
const ServiceMonitorPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/ServiceMonitorPage')).ServiceMonitorPage,
}));
const AttachmentPage = lazy(async () => ({
  default: (await import('../../modules/system/pages/AttachmentPage')).AttachmentPage,
}));

// ── rag 域页面（按路由懒加载）
const RagChatPage = lazy(async () => ({
  default: (await import('../../modules/rag/pages/RagChatPage')).RagChatPage,
}));
const RagKnowledgePage = lazy(async () => ({
  default: (await import('../../modules/rag/pages/RagKnowledgePage')).RagKnowledgePage,
}));

export type RouteRoot = 'system' | 'rag';

export interface AppRouteMeta {
  /** 页面标题，用于 topbar 展示 */
  title: string;
  /** 页面描述，作为共享页面框架的初始说明 */
  description: string;
  /** 是否需要登录才能访问，前端路由守卫依据此字段判断 */
  requiresAuth: boolean;
  /** 访问此路由额外需要的权限码，空数组表示无额外要求 */
  permissions: string[];
  /** 菜单所属产品域 */
  routeRoot?: RouteRoot;
  /** 隐藏顶部 topbar header */
  hideHeader?: boolean;
  /** 隐藏 info-strip 信息条 */
  hideInfoStrip?: boolean;
  /** 将页面伸展至视口剩余空间，并在窄屏收起侧栏 */
  viewportWorkspace?: boolean;
}

export interface AppRoute {
  /** 全局唯一路由名称，菜单通过 routeName 字段与此关联 */
  name: string;
  /** 绝对路由路径 */
  path: string;
  /** 页面组件 */
  component: ComponentType;
  meta: AppRouteMeta;
}

const appRoutes: AppRoute[] = [
  // ── system 域
  {
    name: 'dictionary-namespace',
    path: '/system/dictionary-namespace',
    component: DictionaryNamespacePage,
    meta: {
      title: '命名空间管理',
      description: '维护中性的字典命名空间，不承载具体业务分组。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'dictionary',
    path: '/system/dictionary',
    component: DictionaryPage,
    meta: {
      title: '字典管理',
      description: '管理字典、字典项、导入与运行态预览。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'menu-route',
    path: '/system/menu-route',
    component: MenuRoutePage,
    meta: {
      title: '菜单管理',
      description: '管理当前管理台正在使用的菜单编码、层级、排序与路由配置。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'notification',
    path: '/system/notification',
    component: NotificationPage,
    meta: {
      title: '通知公告',
      description: '管理公告发布、站内信发送和运行态消息预览。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'permission',
    path: '/system/permission',
    component: PermissionPage,
    meta: {
      title: '权限码管理',
      description: '管理权限码、分组、状态与说明信息。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'role',
    path: '/system/role',
    component: RolePage,
    meta: {
      title: '角色管理',
      description: '管理角色、权限绑定与按角色运行态预览。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'account',
    path: '/system/account',
    component: AccountPage,
    meta: {
      title: '管理账号',
      description: '管理后台账号、头像、角色绑定和密码重置。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'login-log',
    path: '/system/login-log',
    component: LoginLogPage,
    meta: {
      title: '登录日志',
      description: '查询登录成功、失败、锁定、登出和密码重置等安全事件。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'operation-log',
    path: '/system/operation-log',
    component: OperationLogPage,
    meta: {
      title: '操作日志',
      description: '查询基础资源中心的变更留痕。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'trace-log',
    path: '/system/trace-log',
    component: TraceLogPage,
    meta: {
      title: '集中日志查询',
      description: '按 traceId 查看网关和服务实例日志。',
      requiresAuth: true,
      permissions: ['system:trace-log:query'],
      routeRoot: 'system',
    },
  },
  {
    name: 'api-call-graph',
    path: '/system/api-call-graph',
    component: ApiCallGraphPage,
    meta: {
      title: '接口调用图',
      description: '浏览项目接口，查看方法调用关系和请求执行明细。',
      viewportWorkspace: true,
      requiresAuth: true,
      permissions: ['system:call-graph:debug'],
      routeRoot: 'system',
    },
  },
  {
    name: 'online-user-monitor',
    path: '/system/online-user-monitor',
    component: OnlineUserMonitorPage,
    meta: {
      title: '在线用户监控',
      description: '查看当前实例在线会话、登录时间和最近活跃情况。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'service-monitor',
    path: '/system/service-monitor',
    component: ServiceMonitorPage,
    meta: {
      title: '服务监控',
      description: '查看 CPU、内存、磁盘和服务器信息。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },
  {
    name: 'attachment',
    path: '/system/attachment',
    component: AttachmentPage,
    meta: {
      title: '附件管理',
      description: '管理系统附件，支持上传、预览和删除。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'system',
    },
  },

  // ── rag 域
  {
    name: 'rag-chat',
    path: '/rag/chat',
    component: RagChatPage,
    meta: {
      title: 'AI 助手',
      description: '与 AI 助手对话，查询知识库内容。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'rag',
    },
  },
  {
    name: 'rag-knowledge',
    path: '/rag/knowledge',
    component: RagKnowledgePage,
    meta: {
      title: '知识库管理',
      description: '管理知识库和文档向量化。',
      requiresAuth: true,
      permissions: [],
      routeRoot: 'rag',
    },
  },
];

const routeByNameMap = new Map(appRoutes.map((r) => [r.name, r]));
const routeByPathMap = new Map(appRoutes.map((r) => [r.path, r]));

export function getRouteByName(name: string): AppRoute | null {
  return routeByNameMap.get(name) ?? null;
}

export function getRouteByPath(path: string): AppRoute | null {
  return routeByPathMap.get(path) ?? null;
}

/** 返回所有路由（只读） */
export function getAllRoutes(): readonly AppRoute[] {
  return appRoutes;
}
