import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../app/state/authStore';
import { getRouteByPath } from '../../app/routes/appRoutes';

/**
 * 路由守卫组件。
 * 根据路由表 meta.requiresAuth 判断当前路径是否需要登录；
 * 不依赖 App.tsx 的嵌套结构，统一由此组件处理。
 */
export function RequireAuth() {
  const loading = useAuthStore((state) => state.loading);
  const account = useAuthStore((state) => state.account);
  const location = useLocation();

  if (loading) {
    return <div className="page-loading">正在加载登录态...</div>;
  }

  const route = getRouteByPath(location.pathname);
  // 路由表声明 requiresAuth: false 的放行；其余一律要求登录
  const requiresAuth = route ? route.meta.requiresAuth : true;
  if (requiresAuth && !account) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
