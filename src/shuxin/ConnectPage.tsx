/** 第一步：用智枢网站的接入码接入。打开页面和切回窗口时自动读剪贴板里的接入码。 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { shuxinApi } from './api';
import { useShuxin } from './context';

export function ConnectPage() {
  const { overview, setOverview } = useShuxin();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(overview.message);

  useEffect(() => {
    const fill = () => {
      void shuxinApi.clipboardCode().then((found) => {
        if (found) setCode((current) => current || found);
      }).catch(() => undefined);
    };
    fill();
    window.addEventListener('focus', fill);
    return () => window.removeEventListener('focus', fill);
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const next = await shuxinApi.connect(code);
      setMessage(next.message);
      setOverview(next);
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 pt-6">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-normal tracking-tight">欢迎来到枢心</h1>
        <p className="text-muted-foreground">
          枢心会让一个记得你、会关心你的 TA 住进你的微信。先连接你的智枢账号，聊天用的是智枢的对话模型，按用量扣额度。
        </p>
      </div>

      <ol className="space-y-3 text-sm">
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-xs dark:bg-white/10">1</span>
          <span>
            打开智枢网站，进入应用广场里的「枢心」，点「一键接入」。
            <button type="button" className="ml-1 text-primary underline-offset-4 hover:underline" onClick={() => void shuxinApi.openSite()}>
              打开智枢网站
            </button>
          </span>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-xs dark:bg-white/10">2</span>
          <span>复制网站给的接入码，回到这里，会自动填好；没填上就手动粘贴。</span>
        </li>
      </ol>

      <div className="space-y-3">
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="APP-XXXX-XXXX-XXXX"
          className="h-12 font-mono text-base"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && code.trim() && !busy) void submit();
          }}
        />
        {message && <p className="text-sm text-red-700 dark:text-red-400">{message}</p>}
        <Button className="h-11 w-full" disabled={!code.trim() || busy} onClick={() => void submit()}>
          {busy ? '正在接入…' : '接入'}
        </Button>
      </div>
    </div>
  );
}
