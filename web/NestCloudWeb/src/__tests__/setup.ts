import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// 全仓并行采集覆盖率时，首屏路由的懒加载可能超过默认的一秒。
configure({ asyncUtilTimeout: 5_000 });

class ModalMock {
  constructor(_element?: Element) {}

  show() {}

  hide() {}

  static getOrCreateInstance(element?: Element) {
    return new ModalMock(element);
  }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.bootstrap = {
    Modal: ModalMock,
  } as typeof window.bootstrap;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
