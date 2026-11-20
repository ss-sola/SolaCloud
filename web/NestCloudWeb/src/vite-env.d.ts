/// <reference types="vite/client" />

import type * as Bootstrap from 'bootstrap';

declare global {
  interface Window {
    bootstrap: typeof Bootstrap;
  }
}

export {};
