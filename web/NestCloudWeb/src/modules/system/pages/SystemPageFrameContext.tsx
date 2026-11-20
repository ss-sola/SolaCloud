import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

export interface SystemPageFrameState {
  title: string;
  description: string;
  serviceLabel: string;
  capabilityLabel: string;
  descriptionLabel: string;
}

interface SystemPageFrameContextValue {
  frameState: SystemPageFrameState;
  setFrameState: Dispatch<SetStateAction<SystemPageFrameState>>;
}

const SystemPageFrameContext = createContext<SystemPageFrameContextValue | null>(null);

interface Props {
  initialState: SystemPageFrameState;
  children: ReactNode;
}

export function SystemPageFrameProvider({ initialState, children }: Props) {
  const [frameState, setFrameState] = useState(initialState);

  useEffect(() => {
    setFrameState(initialState);
  }, [initialState]);

  const value = useMemo(() => ({ frameState, setFrameState }), [frameState]);

  return (
    <SystemPageFrameContext.Provider value={value}>{children}</SystemPageFrameContext.Provider>
  );
}

export function useSystemPageFrame() {
  const context = useContext(SystemPageFrameContext);
  if (!context) {
    throw new Error('useSystemPageFrame must be used within SystemPageFrameProvider');
  }
  return context;
}
