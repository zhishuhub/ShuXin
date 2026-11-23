/** 枢心界面共享的状态：主进程给的总览，以及刷新方法。 */
import { createContext, useContext } from 'react';
import type { ShuxinOverview } from '@shared/shuxin/types';

export interface ShuxinContextValue {
  overview: ShuxinOverview;
  setOverview: (overview: ShuxinOverview) => void;
  refresh: () => Promise<void>;
}

export const ShuxinContext = createContext<ShuxinContextValue | null>(null);

export function useShuxin(): ShuxinContextValue {
  const value = useContext(ShuxinContext);
  if (!value) throw new Error('useShuxin must be used inside ShuxinApp');
  return value;
}
