/**
 * 枢心界面：接入智枢 → 选角色 → 微信扫码 → 主页。ClawX 原界面（聊天、智能体、服务商设置等）不显示。
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import type { ShuxinOverview } from '@shared/shuxin/types';
import { TitleBar } from '@/components/layout/TitleBar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { hostEvents } from '@/lib/host-events';
import { useResolvedTheme } from '@/lib/use-resolved-theme';
import { useSettingsStore } from '@/stores/settings';
import { onShuxinStatus, shuxinApi } from './api';
import { CharactersPage } from './CharactersPage';
import { ConnectPage } from './ConnectPage';
import { ShuxinContext, useShuxin } from './context';
import { HomePage } from './HomePage';
import { WeChatPage } from './WeChatPage';

/** 首页按进度决定显示哪一步：没接入 → 接入；没选角色 → 选角色；没绑微信 → 扫码；都好了 → 主页。 */
function Start() {
  const { overview } = useShuxin();
  if (!overview.connected) return <ConnectPage />;
  if (!overview.selection) return <CharactersPage firstRun />;
  if (overview.link === 'not_bound') return <WeChatPage firstRun />;
  return <HomePage />;
}

function RequireConnected({ children }: { children: React.ReactNode }) {
  const { overview } = useShuxin();
  return overview.connected ? <>{children}</> : <Navigate to="/" replace />;
}

export function ShuxinApp() {
  const navigate = useNavigate();
  const resolvedTheme = useResolvedTheme();
  const initSettings = useSettingsStore((state) => state.init);
  const [overview, setOverview] = useState<ShuxinOverview | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(
    () => shuxinApi.overview().then(
      (next) => {
        setOverview(next);
        setLoadError('');
      },
      (error: unknown) => setLoadError(String(error instanceof Error ? error.message : error)),
    ),
    [],
  );

  useEffect(() => {
    void initSettings();
    shuxinApi.overview().then(setOverview, (error: unknown) => {
      setLoadError(String(error instanceof Error ? error.message : error));
    });
    return onShuxinStatus(setOverview);
  }, [initSettings]);

  useEffect(() => {
    const unsubscribe = hostEvents.onNavigate((path) => navigate(path));
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    document.title = '枢心';
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <TitleBar />
        <main className="flex-1 overflow-y-auto">
          {!overview ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {loadError ? `启动出错：${loadError}` : '正在启动…'}
            </div>
          ) : (
            <ShuxinContext.Provider value={{ overview, setOverview, refresh }}>
              <div className="mx-auto w-full max-w-3xl px-6 py-8">
                <Routes>
                  <Route path="/" element={<Start />} />
                  <Route path="/characters" element={<RequireConnected><CharactersPage /></RequireConnected>} />
                  <Route path="/wechat" element={<RequireConnected><WeChatPage /></RequireConnected>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </ShuxinContext.Provider>
          )}
        </main>
      </div>
      <Toaster position="bottom-center" richColors closeButton theme={resolvedTheme} />
    </TooltipProvider>
  );
}
