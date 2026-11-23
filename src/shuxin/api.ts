/**
 * 枢心界面调用主进程：走 ClawX 同一条 host:invoke 通道，模块名 shuxin（由 electron/extensions/builtin/shuxin.ts 注册）。
 */
import type {
  CharacterView,
  CompanionGender,
  CompanionSelection,
  ImportCardResponse,
  ShuxinOverview,
} from '@shared/shuxin/types';

async function call<T>(action: string, payload?: unknown): Promise<T> {
  const bridge = window.clawx?.hostInvoke;
  if (!bridge) throw new Error('Host invoke bridge is unavailable');
  const response = await bridge<T>({
    id: crypto.randomUUID(),
    module: 'shuxin',
    action,
    ...(payload === undefined ? {} : { payload }),
  });
  if (!response.ok) throw new Error(response.error?.message || `枢心请求失败：${action}`);
  return response.data;
}

export const shuxinApi = {
  overview: () => call<ShuxinOverview>('overview'),
  connect: (code: string) => call<ShuxinOverview>('connect', { code }),
  clipboardCode: () => call<string>('clipboardCode'),
  disconnect: () => call<ShuxinOverview>('disconnect'),
  characters: () => call<CharacterView[]>('characters'),
  importCard: (fileName: string, dataBase64: string) =>
    call<ImportCardResponse>('importCard', { fileName, dataBase64 }),
  setCharacterGender: (id: string, gender: CompanionGender) =>
    call<ShuxinOverview>('setCharacterGender', { id, gender }),
  removeCharacter: (id: string) => call<boolean>('removeCharacter', { id }),
  select: (selection: CompanionSelection) => call<ShuxinOverview>('select', selection),
  afterWeChatLogin: () => call<ShuxinOverview>('afterWeChatLogin'),
  openSite: (path = '') => call<boolean>('openSite', { path }),
};

/** 主进程推来的最新状态（接入、角色、微信连接变化时）。 */
export function onShuxinStatus(handler: (overview: ShuxinOverview) => void): () => void {
  const listener = (...args: unknown[]) => {
    const overview = args.find((arg) => arg && typeof arg === 'object' && 'link' in (arg as object));
    if (overview) handler(overview as ShuxinOverview);
  };
  const off = window.electron?.ipcRenderer.on('ext:shuxin-status', listener);
  return () => {
    if (typeof off === 'function') off();
    else window.electron?.ipcRenderer.off('ext:shuxin-status', listener);
  };
}

/** 读本地文件成 base64，导入角色卡用。 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
