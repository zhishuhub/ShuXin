/**
 * 智枢一键接入：用户在网站「我的应用」点「一键接入」拿到接入码，应用把接入码和应用编号发给接入接口，
 * 换回 base_url、api_key。接入信息只存在用户数据目录的 zhishu-connection.json。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SHUXIN_APP_KEY, SHUXIN_CODE_PATTERN, SHUXIN_CONNECT_URL } from './managed';

export type ZhishuConnection = {
  base_url: string;
  api_key: string;
  user_name: string;
  models: string[];
  connected_at: string;
};

export type ConnectResult =
  | { ok: true; connection: ZhishuConnection }
  | { ok: false; message: string };

const FILE_NAME = 'zhishu-connection.json';

export function connectionPath(userDataDir: string): string {
  return join(userDataDir, FILE_NAME);
}

export function loadConnection(userDataDir: string): ZhishuConnection | null {
  try {
    const data = JSON.parse(readFileSync(connectionPath(userDataDir), 'utf8')) as Partial<ZhishuConnection>;
    if (!data.base_url || !data.api_key) return null;
    return {
      base_url: data.base_url,
      api_key: data.api_key,
      user_name: data.user_name ?? '',
      models: Array.isArray(data.models) ? data.models : [],
      connected_at: data.connected_at ?? '',
    };
  } catch {
    return null;
  }
}

export function saveConnection(userDataDir: string, connection: ZhishuConnection): void {
  const file = connectionPath(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(connection, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export function clearConnection(userDataDir: string): void {
  rmSync(connectionPath(userDataDir), { force: true });
}

export function normalizedBaseUrl(connection: ZhishuConnection): string {
  return connection.base_url.trim().replace(/\/+$/, '');
}

/** 用户所在网站的地址：检查更新、去网站下载都用它，子站用户不引到主站。 */
export function siteOrigin(connection: ZhishuConnection | null): string {
  const match = /^(https?:\/\/[^/]+)/.exec(connection?.base_url || SHUXIN_CONNECT_URL);
  return match ? match[1] : 'https://zhishuhub.com';
}

/** 从一段文字（比如剪贴板）里找接入码，找不到返回空。 */
export function findConnectCode(text: string): string {
  const match = SHUXIN_CODE_PATTERN.exec(String(text ?? '').toUpperCase());
  return match ? match[0] : '';
}

/** 用接入码换调用地址和密钥。失败时把网站返回的提示原样给用户看。 */
export async function redeemConnectCode(rawCode: string, fetchImpl: typeof fetch = fetch): Promise<ConnectResult> {
  const code = findConnectCode(rawCode);
  if (!code) return { ok: false, message: '没有识别到接入码，请回到网站重新点「一键接入」' };
  let response: Response;
  try {
    response = await fetchImpl(SHUXIN_CONNECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: SHUXIN_APP_KEY, code }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, message: '网络异常，请检查网络后重试' };
  }
  if (response.status === 429) return { ok: false, message: '操作太频繁，请过几秒再试' };
  const result = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    data?: Partial<ZhishuConnection>;
  };
  if (!result.success || !result.data?.base_url || !result.data.api_key) {
    return { ok: false, message: result.message || '接入失败，请稍后再试' };
  }
  return {
    ok: true,
    connection: {
      base_url: result.data.base_url,
      api_key: result.data.api_key,
      user_name: result.data.user_name ?? '',
      models: Array.isArray(result.data.models) ? result.data.models : [],
      connected_at: new Date().toISOString(),
    },
  };
}

/** 用保存的密钥拉一次模型列表：401（额度上限用完除外）说明接入已在网站停止授权。网络不通时不算失效。 */
export async function isConnectionRevoked(
  connection: ZhishuConnection,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl(`${normalizedBaseUrl(connection)}/models`, {
      headers: { Authorization: `Bearer ${connection.api_key}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return false;
  }
  if (response.status !== 401) return false;
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code !== 'app_quota_exhausted';
}

/** 账户剩余额度（按网站的显示方式，如「¥12.35」）；查不到返回空，界面就不显示。 */
export async function fetchBalance(connection: ZhishuConnection, fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const response = await fetchImpl(`${siteOrigin(connection)}/api/apps/connect/balance`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.api_key}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return '';
    const result = (await response.json()) as { success?: boolean; data?: { display?: unknown } };
    return result.success && typeof result.data?.display === 'string' ? result.data.display.slice(0, 40) : '';
  } catch {
    return '';
  }
}

/** 网站上本应用的最新版本号（公开接口），取不到返回空。 */
export async function fetchLatestVersion(
  connection: ZhishuConnection | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  try {
    const response = await fetchImpl(`${siteOrigin(connection)}/api/apps/${SHUXIN_APP_KEY}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as { success?: boolean; data?: { version?: string } };
    return result.success ? String(result.data?.version ?? '') : '';
  } catch {
    return '';
  }
}

/** 版本比较：只比较数字段，a 比 b 新返回正数。 */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.replace(/^v/i, '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
