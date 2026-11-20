import { create } from 'zustand';

export type ToastType = 'success' | 'danger' | 'warning';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastState {
  items: ToastItem[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: number) => void;
}

let nextId = 1;

/** 默认自动消失时长（毫秒） */
const DEFAULT_DURATION = 3000;

export const useToastStore = create<ToastState>((set) => ({
  items: [],

  addToast: (type, message, duration = DEFAULT_DURATION) => {
    const id = nextId++;
    set((state) => ({ items: [...state.items, { id, type, message }] }));

    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({ items: state.items.filter((t) => t.id !== id) }));
      }, duration);
    }
  },

  removeToast: (id) => {
    set((state) => ({ items: state.items.filter((t) => t.id !== id) }));
  },
}));
