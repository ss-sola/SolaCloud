/// <reference types="vite/client" />

import type * as Bootstrap from 'bootstrap';

declare global {
  interface ImportMetaEnv {
    readonly VITE_GATEWAY_ORIGIN?: string;
  }

  interface Window {
    bootstrap: typeof Bootstrap;
  }
}

export {};
