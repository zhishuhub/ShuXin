/**
 * 接入后唯一的服务商：智枢的 OpenAI 兼容接口，模型固定 chat。
 * 走 ClawX 自己保存服务商的同一条路（账号存储 → 同步进 OpenClaw → 设为默认），
 * 地址或密钥变了（重新接入）就更新，没变就不动。
 */
import type { GatewayManager } from '../gateway/manager';
import { getProviderService } from '../services/providers/provider-service';
import { providerAccountToConfig } from '../services/providers/provider-store';
import {
  syncDefaultProviderToRuntime,
  syncSavedProviderToRuntime,
} from '../services/providers/provider-runtime-sync';
import type { ProviderAccount } from '../shared/providers/types';
import { normalizedBaseUrl, type ZhishuConnection } from './connection';
import { SHUXIN_CHAT_MODEL, SHUXIN_PROVIDER_ACCOUNT_ID } from './managed';

export function buildProviderAccount(connection: ZhishuConnection, now: string, createdAt = now): ProviderAccount {
  return {
    id: SHUXIN_PROVIDER_ACCOUNT_ID,
    vendorId: 'custom',
    label: '智枢',
    authMode: 'api_key',
    baseUrl: normalizedBaseUrl(connection),
    apiProtocol: 'openai-completions',
    model: SHUXIN_CHAT_MODEL,
    enabled: true,
    isDefault: true,
    createdAt,
    updatedAt: now,
  };
}

export async function ensureZhishuProvider(connection: ZhishuConnection, gatewayManager?: GatewayManager): Promise<void> {
  const service = getProviderService();
  const now = new Date().toISOString();
  const existing = await service.getAccount(SHUXIN_PROVIDER_ACCOUNT_ID);
  const desired = buildProviderAccount(connection, now, existing?.createdAt ?? now);
  const savedKey = existing ? await service.getAccountApiKey(SHUXIN_PROVIDER_ACCOUNT_ID) : null;
  const unchanged = existing
    && existing.baseUrl === desired.baseUrl
    && existing.model === desired.model
    && existing.apiProtocol === desired.apiProtocol
    && savedKey === connection.api_key;

  if (!unchanged) {
    const account = existing
      ? await service.updateAccount(SHUXIN_PROVIDER_ACCOUNT_ID, desired, connection.api_key)
      : await service.createAccount(desired, connection.api_key);
    await syncSavedProviderToRuntime(providerAccountToConfig(account), connection.api_key, gatewayManager);
  }
  if ((await service.getDefaultAccountId()) !== SHUXIN_PROVIDER_ACCOUNT_ID || !unchanged) {
    await service.setDefaultAccount(SHUXIN_PROVIDER_ACCOUNT_ID);
    await syncDefaultProviderToRuntime(SHUXIN_PROVIDER_ACCOUNT_ID, gatewayManager);
  }
}
