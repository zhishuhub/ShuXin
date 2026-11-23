/**
 * 枢心看到的微信连接状态，托盘颜色和主页提示都按它来：
 * - not_bound：还没扫码绑定；
 * - online：在线，能收发消息；
 * - connecting：正在连接（后台服务刚启动、网络刚恢复），一般不用管；
 * - needs_rescan：微信登录失效（腾讯插件报 token 失效 -14），要重新扫码；
 * - offline：后台服务没在运行。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompanionLinkState } from '../../shared/shuxin/types';

export type { CompanionLinkState };

export interface WeChatRuntimeAccount {
  accountId?: string;
  configured?: boolean;
  connected?: boolean;
  running?: boolean;
  linked?: boolean;
  lastError?: string;
}

export interface BoundWeChatAccount {
  accountId: string;
  /** 扫码绑定的微信号在插件里的编号，主动问候发给它。 */
  userId: string;
}

/** 腾讯插件遇到 token 失效（errcode -14）会暂停这个账号一小时并报错，重新扫码才能恢复。 */
const STALE_TOKEN_PATTERN = /errcode\s*[:=]?\s*-14|\(-14\)|session paused|stale token|token (?:is )?(?:invalid|expired)|invalid token|unauthori[sz]ed/i;

export function isStaleTokenError(message: string | undefined): boolean {
  return !!message && STALE_TOKEN_PATTERN.test(message);
}

/** 读本机已绑定的微信账号（腾讯插件的账号文件）。 */
export function readBoundWeChatAccounts(openclawDir: string): BoundWeChatAccount[] {
  const stateDir = join(openclawDir, 'openclaw-weixin');
  let ids: unknown;
  try {
    ids = JSON.parse(readFileSync(join(stateDir, 'accounts.json'), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(ids)) return [];
  const accounts: BoundWeChatAccount[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const file = join(stateDir, 'accounts', `${id}.json`);
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { token?: string; userId?: string };
      if (!data.token) continue;
      accounts.push({ accountId: id, userId: data.userId ?? '' });
    } catch {
      // 文件损坏当作没绑定
    }
  }
  return accounts;
}

/**
 * 综合判断。runtime 为空表示没拿到后台服务的渠道状态（服务没运行或查询超时）。
 * 绑定了多个账号时（重新扫码后旧账号还在），只要有一个在线就算在线。
 */
export function classifyWeChat(input: {
  bound: BoundWeChatAccount[];
  runtime: WeChatRuntimeAccount[] | null;
  gatewayRunning: boolean;
}): CompanionLinkState {
  if (input.bound.length === 0) return 'not_bound';
  if (!input.gatewayRunning) return 'offline';
  const accounts = input.runtime ?? [];
  if (accounts.some((account) => account.connected === true || account.linked === true)) return 'online';
  if (accounts.length > 0 && accounts.every((account) => isStaleTokenError(account.lastError))) return 'needs_rescan';
  return 'connecting';
}
