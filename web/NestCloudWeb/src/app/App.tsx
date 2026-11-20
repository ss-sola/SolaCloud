import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './state/authStore';
import { AppShellLayout } from '../shared/layouts/AppShellLayout';
import { RequireAuth } from '../shared/layouts/RequireAuth';
import { LoginPage } from '../modules/system/pages/LoginPage';
import { ToastContainer } from '../shared/components/ToastContainer';

function AuthBootstrap() {
  const loadCurrentAccount = useAuthStore((state) => state.loadCurrentAccount);

  useEffect(() => {
    void loadCurrentAccount();
  }, [loadCurrentAccount]);

  return null;
}

export function App() {
  return (
    <>
      <AuthBootstrap />
      <ToastContainer />
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/*
         * RequireAuth 统一包裹所有 AppShell 路由。
         * 是否实际拦截由路由表 meta.requiresAuth 决定，
         * 不再依赖嵌套层级区分公开/受保护路由。
         */}
        <Route element={<RequireAuth />}>
          <Route element={<AppShellLayout />}>
            <Route index element={<></>} />
            <Route path="system/*" element={<></>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}
