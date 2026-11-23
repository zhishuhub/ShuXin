/**
 * 枢心托盘：图标提示文字和菜单第一行显示微信连接状态，右键可以打开主界面、重新连接微信、换角色、退出。
 * 关闭窗口只是缩到托盘，后台服务和微信连接继续运行。
 */
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { CompanionLinkState } from './wechat-status';
import type { ShuxinService } from './service';

const LINK_LABELS: Record<CompanionLinkState, string> = {
  not_bound: '还没连接微信',
  online: '微信在线',
  connecting: '正在连接微信…',
  needs_rescan: '微信需要重新扫码',
  offline: '后台服务没有运行',
};

/** 托盘图标按状态换颜色；对应图标文件不存在时用应用图标。 */
const LINK_ICONS: Record<CompanionLinkState, string> = {
  not_bound: 'tray-warning.png',
  online: 'tray-online.png',
  connecting: 'tray-warning.png',
  needs_rescan: 'tray-error.png',
  offline: 'tray-error.png',
};

function iconsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources', 'icons') : join(__dirname, '../../resources/icons');
}

function loadIcon(file: string): Electron.NativeImage {
  const dir = iconsDir();
  let icon = nativeImage.createFromPath(join(dir, file));
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(dir, process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
  }
  if (process.platform !== 'win32') icon = icon.resize({ width: 18, height: 18 });
  return icon;
}

let tray: Tray | null = null;

export function createShuxinTray(
  mainWindow: BrowserWindow,
  service: ShuxinService,
  quit: () => void,
): Tray {
  tray = new Tray(loadIcon(LINK_ICONS.not_bound));

  const render = (link: CompanionLinkState, characterName: string) => {
    if (!tray || tray.isDestroyed()) return;
    tray.setImage(loadIcon(LINK_ICONS[link]));
    const who = characterName ? `「${characterName}」` : '';
    tray.setToolTip(`枢心 · ${who}${LINK_LABELS[link]}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: LINK_LABELS[link], enabled: false },
      { type: 'separator' },
      { label: '打开枢心', click: () => service.showWindow('/') },
      { label: '重新连接微信', click: () => service.showWindow('/wechat') },
      { label: '换个角色', click: () => service.showWindow('/characters') },
      { type: 'separator' },
      { label: '退出枢心', click: quit },
    ]));
  };

  render('not_bound', '');
  service.onStatus((overview) => render(overview.link, overview.character?.name ?? ''));
  void service.overview().then((overview) => render(overview.link, overview.character?.name ?? ''));

  tray.on('click', () => {
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      service.showWindow();
    }
  });
  return tray;
}

export function destroyShuxinTray(): void {
  tray?.destroy();
  tray = null;
}
