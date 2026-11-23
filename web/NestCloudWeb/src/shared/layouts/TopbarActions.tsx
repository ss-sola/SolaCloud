import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../app/state/authStore';
import type { CurrentAccount } from '../api/systemApi';
import { useTheme } from '../hooks/useTheme';
import { useToastStore } from '../state/toastStore';
import { ErrorUtil } from '../utils/ErrorUtil';

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-switch"
      role="switch"
      aria-label="深色主题"
      aria-checked={dark}
      title={dark ? '切换为浅绿主题' : '切换为深色主题'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <span className="theme-switch-track" aria-hidden="true">
        <svg className="theme-sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
        </svg>
        <svg className="theme-moon" viewBox="0 0 24 24">
          <path d="M20.5 13.5a8.8 8.8 0 0 1-11-11 9 9 0 1 0 11 11Z" />
        </svg>
      </span>
    </button>
  );
}

function AccountMenu({ account }: { account: CurrentAccount }) {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = account.displayName || account.accountName;

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [open]);

  async function signOut() {
    setPending(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      useToastStore.getState().addToast('danger', ErrorUtil.getMessage(error, '登出失败，请重试'));
      setPending(false);
    }
  }

  return (
    <div
      className="account-menu"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="account-menu-trigger"
        aria-label={`${name}的账号菜单`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        {account.avatarUrl ? (
          <img className="account-avatar account-avatar-sm" src={account.avatarUrl} alt="" />
        ) : (
          <span className="avatar-fallback avatar-fallback-sm" aria-hidden="true">
            {name.slice(0, 1)}
          </span>
        )}
        <span className="topbar-user-name">{name}</span>
      </button>
      <div id={panelId} className="account-menu-panel" hidden={!open}>
        <button type="button" disabled={pending} onClick={signOut}>
          {pending ? '正在登出…' : '登出'}
        </button>
      </div>
    </div>
  );
}

export function TopbarActions() {
  const account = useAuthStore((state) => state.account);
  const navigate = useNavigate();
  return (
    <div className="topbar-right">
      <ThemeSwitch />
      {account ? (
        <AccountMenu account={account} />
      ) : (
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => navigate('/login')}
        >
          登录
        </button>
      )}
    </div>
  );
}
