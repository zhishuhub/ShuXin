/** 主页：当前角色、微信连接状态、账号余额、开机自启、版本与署名。 */
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { CompanionLinkState } from '@shared/shuxin/types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { shuxinApi } from './api';
import { Avatar } from './CharactersPage';
import { useShuxin } from './context';

const LINK_VIEW: Record<CompanionLinkState, { label: string; tone: string; tip: string }> = {
  online: {
    label: '微信在线',
    tone: 'bg-green-500',
    tip: '在微信里找 TA 聊天就行。电脑开着、枢心在运行时 TA 才能回消息；关掉这个窗口不影响，枢心会留在右下角。',
  },
  connecting: {
    label: '正在连接微信…',
    tone: 'bg-amber-500',
    tip: '刚开机或网络刚恢复时会这样，一般一两分钟就好，不用管。',
  },
  needs_rescan: {
    label: '微信需要重新扫码',
    tone: 'bg-red-500',
    tip: '微信那边的登录失效了，重新扫一下码就能恢复。聊天记忆都还在。',
  },
  offline: {
    label: '后台服务没有运行',
    tone: 'bg-red-500',
    tip: '枢心正在尝试重新启动后台服务。一直这样的话，从右下角退出枢心再打开。',
  },
  not_bound: {
    label: '还没连接微信',
    tone: 'bg-amber-500',
    tip: '扫一下码，TA 就会出现在你的微信里。',
  },
};

export function HomePage() {
  const { overview, setOverview } = useShuxin();
  const navigate = useNavigate();
  const launchAtStartup = useSettingsStore((state) => state.launchAtStartup);
  const setLaunchAtStartup = useSettingsStore((state) => state.setLaunchAtStartup);
  const link = LINK_VIEW[overview.link];
  const role = overview.selection?.gender === 'male' ? '男朋友' : '女朋友';
  const name = overview.character?.name ?? `你的${role}`;

  const reconnectAccount = async () => {
    setOverview(await shuxinApi.disconnect());
    toast.success('已退出智枢账号，请重新接入');
  };

  return (
    <div className="space-y-6">
      <section className="flex items-center gap-5 rounded-2xl border p-6">
        <Avatar character={overview.character} size="lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="truncate font-serif text-3xl font-normal tracking-tight">{name}</h1>
          {!overview.character && (
            <p className="text-sm text-muted-foreground">名字和性格会在你们第一次聊天时一起定下来</p>
          )}
          <div className="flex items-center gap-2 text-sm">
            <span className={cn('h-2.5 w-2.5 rounded-full', link.tone)} />
            <span>{link.label}</span>
          </div>
        </div>
      </section>

      <p className="text-sm text-muted-foreground">{link.tip}</p>

      <div className="flex flex-wrap gap-3">
        {(overview.link === 'needs_rescan' || overview.link === 'not_bound') && (
          <Button onClick={() => navigate('/wechat')}>扫码连接微信</Button>
        )}
        <Button variant="outline" onClick={() => navigate('/characters')}>换个角色</Button>
        {overview.link !== 'needs_rescan' && overview.link !== 'not_bound' && (
          <Button variant="outline" onClick={() => navigate('/wechat')}>重新连接微信</Button>
        )}
      </div>

      <section className="space-y-4 rounded-2xl border p-6 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">智枢账号</span>
          <span>{overview.userName || '已接入'}</span>
        </div>
        {overview.balance && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">剩余额度</span>
            <span>{overview.balance}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">开机自动启动</span>
          <Switch checked={launchAtStartup} onCheckedChange={setLaunchAtStartup} />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => void shuxinApi.openSite()}>打开智枢网站</Button>
          <Button variant="ghost" size="sm" onClick={() => void reconnectAccount()}>换个智枢账号</Button>
        </div>
      </section>

      <footer className="space-y-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>枢心 {overview.version}</span>
          {overview.updateAvailable && (
            <button type="button" className="text-primary hover:underline" onClick={() => void shuxinApi.openSite()}>
              有新版本 {overview.latestVersion}，去网站下载
            </button>
          )}
        </div>
        <p>
          枢心基于开源项目 ClawX（github.com/ValueCell-ai/ClawX）修改，源码见 github.com/zhishuhub/ShuXin。
          恋人技能来自 ClawHub（ivangdavila），现成角色由 Foreverse Team 创作（CC BY 4.0）。
        </p>
      </footer>
    </div>
  );
}
