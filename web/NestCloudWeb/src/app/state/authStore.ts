import { create } from 'zustand';
import { SystemApi, type CurrentAccount, type RuntimeMenuRoute } from '../../shared/api/systemApi';

interface AuthState {
  loading: boolean;
  account: CurrentAccount | null;
  menuTree: RuntimeMenuRoute[];
  roleCodes: string[];
  loadCurrentAccount: () => Promise<void>;
  login: (accountName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function normalizeAccount(
  account:
    | CurrentAccount
    | { id: number; accountName: string; displayName?: string; avatarUrl?: string },
): CurrentAccount {
  return {
    accountId: 'accountId' in account ? account.accountId : account.id,
    accountName: account.accountName,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  loading: true,
  account: null,
  menuTree: [],
  roleCodes: [],
  async loadCurrentAccount() {
    set({ loading: true });
    try {
      const account = await SystemApi.currentAccount();
      if (!account) {
        set({ account: null, menuTree: [], roleCodes: [] });
        return;
      }

      set({ account });
      const runtime = await SystemApi.runtimePermissions();
      if (runtime) {
        set({
          account: normalizeAccount(runtime.account),
          menuTree: runtime.menuTree,
          roleCodes: runtime.roleCodes,
        });
      }
    } catch {
      set({ account: null, menuTree: [], roleCodes: [] });
    } finally {
      set({ loading: false });
    }
  },
  async login(accountName, password) {
    const account = await SystemApi.login({ accountName, password });
    set({ account });
    const runtime = await SystemApi.runtimePermissions();
    if (runtime) {
      set({
        account: normalizeAccount(runtime.account),
        menuTree: runtime.menuTree,
        roleCodes: runtime.roleCodes,
      });
    }
  },
  async logout() {
    await SystemApi.logout();
    set({ account: null, menuTree: [], roleCodes: [] });
  },
}));
