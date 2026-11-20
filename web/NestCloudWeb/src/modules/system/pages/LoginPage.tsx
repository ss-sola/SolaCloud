import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../../app/state/authStore';

function resolveLoginSuccessPath(pathname: unknown): string {
  if (typeof pathname === 'string' && pathname.startsWith('/system')) {
    return pathname;
  }
  return '/system';
}

export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <section className="login-gate">
      <div className="login-panel">
        <div className="login-brand">SYSTEM</div>
        <h1 className="login-title">后台配置管理台</h1>
        <form
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            setLoading(true);
            try {
              await login(accountName, password);
              navigate(resolveLoginSuccessPath(location.state?.from), { replace: true });
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : '登录失败');
            } finally {
              setLoading(false);
            }
          }}
        >
          <label className="toolbar-field toolbar-field-wide">
            <span>账号名</span>
            <input
              className="form-control"
              type="text"
              maxLength={64}
              autoComplete="username"
              required
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
            />
          </label>
          <label className="toolbar-field toolbar-field-wide">
            <span>密码</span>
            <input
              className="form-control"
              type="password"
              maxLength={64}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? (
            <div className="alert alert-danger mb-0" role="alert">
              {error}
            </div>
          ) : null}
          <button type="submit" className="btn btn-success w-100" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </section>
  );
}
