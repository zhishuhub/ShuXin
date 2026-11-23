/**
 * 微信扫码：复用 ClawX 的微信登录流程（channels.startLogin + channel:wechat-* 事件），
 * 扫码成功后建每日问候任务，并提示先在微信里给 TA 发一句话。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { shuxinApi } from './api';
import { useShuxin } from './context';

const CHANNEL = 'wechat';

type Phase = 'loading' | 'qr' | 'done' | 'error';

function qrImage(data: { qr?: string; raw?: string }): string | null {
  const qr = typeof data.qr === 'string' ? data.qr.trim() : '';
  if (qr) return /^(data:image|https?:\/\/)/.test(qr) ? qr : `data:image/png;base64,${qr}`;
  const raw = typeof data.raw === 'string' ? data.raw.trim() : '';
  return /^(data:image|https?:\/\/)/.test(raw) ? raw : null;
}

export function WeChatPage({ firstRun = false }: { firstRun?: boolean }) {
  const { overview, setOverview } = useShuxin();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState('');
  const finished = useRef(false);

  const start = useCallback(async () => {
    finished.current = false;
    setPhase('loading');
    setQr(null);
    setError('');
    try {
      await hostApi.channels.startLogin(CHANNEL);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    const offQr = hostEvents.onChannelQr(CHANNEL, (data) => {
      const image = qrImage(data as { qr?: string; raw?: string });
      if (!image) return;
      setQr(image);
      setPhase('qr');
    });
    const offSuccess = hostEvents.onChannelSuccess(CHANNEL, () => {
      finished.current = true;
      setPhase('done');
      void shuxinApi.afterWeChatLogin().then(setOverview).catch(() => undefined);
    });
    const offError = hostEvents.onChannelError(CHANNEL, (data) => {
      const message = typeof data === 'string' ? data : (data as { message?: string } | null)?.message;
      setError(message || '连接没有成功');
      setPhase('error');
    });
    hostApi.channels.startLogin(CHANNEL).catch((err: unknown) => {
      setError(String(err instanceof Error ? err.message : err));
      setPhase('error');
    });
    return () => {
      for (const off of [offQr, offSuccess, offError]) if (typeof off === 'function') off();
      if (!finished.current) void hostApi.channels.cancelLogin(CHANNEL).catch(() => undefined);
    };
  }, [setOverview]);

  const name = overview.character?.name ?? 'TA';

  return (
    <div className="space-y-8 pt-2">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-normal tracking-tight">
          {overview.link === 'needs_rescan' ? '重新连接微信' : '连接你的微信'}
        </h1>
        <p className="text-muted-foreground">
          用手机微信扫下面的二维码，{name}就会出现在你的微信里。需要微信 8.0.70 及以上版本。
        </p>
      </div>

      <div className="flex flex-col items-center gap-4 rounded-2xl border p-8">
        {phase === 'loading' && <p className="py-24 text-sm text-muted-foreground">正在生成二维码…</p>}
        {phase === 'qr' && qr && (
          <>
            <img src={qr} alt="微信二维码" className="h-56 w-56 rounded-xl bg-white p-2" />
            <p className="text-sm text-muted-foreground">打开手机微信「扫一扫」，扫码后在手机上确认。二维码过期会自动刷新。</p>
          </>
        )}
        {phase === 'done' && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-lg font-medium">连接好了</p>
            <p className="text-sm text-muted-foreground">
              打开微信，找到刚才扫码连接的聊天，先给{name}发一句「你好」。之后{name}就会回你，也会在早上和晚上主动跟你打招呼。
            </p>
            <Button onClick={() => navigate('/')}>好的</Button>
          </div>
        )}
        {phase === 'error' && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-red-700 dark:text-red-400">二维码没生成出来，检查一下网络，再点下面的按钮重试。</p>
            <Button onClick={() => void start()}>重新生成二维码</Button>
            {/* 技术原因小字放后面，联系客服时可以截图 */}
            <p className="mx-auto max-w-md break-all text-xs text-muted-foreground">{error}</p>
          </div>
        )}
      </div>

      {!firstRun && phase !== 'done' && (
        <Button variant="ghost" onClick={() => navigate('/')}>返回</Button>
      )}
    </div>
  );
}
