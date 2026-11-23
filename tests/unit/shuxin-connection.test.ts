// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearConnection,
  compareVersions,
  findConnectCode,
  isConnectionRevoked,
  loadConnection,
  redeemConnectCode,
  saveConnection,
  siteOrigin,
  type ZhishuConnection,
} from '@electron/shuxin/connection';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const connection: ZhishuConnection = {
  base_url: 'https://lingshu.example.com/v1/',
  api_key: 'sk-test',
  user_name: 'demo',
  models: ['chat'],
  connected_at: '2026-11-23T00:00:00.000Z',
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('connecting with a Zhishu connect code', () => {
  it('finds the code inside pasted text', () => {
    expect(findConnectCode('接入码：app-abcd-efgh-jkmn 请在 10 分钟内使用')).toBe('APP-ABCD-EFGH-JKMN');
    expect(findConnectCode('APP-0000-1111-OOOO')).toBe('');
  });

  it('sends the app id and code, and keeps what the site returns', async () => {
    let sent: unknown;
    const fake = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse(200, { success: true, data: { base_url: 'https://zhishuhub.com/v1', api_key: 'sk-1', user_name: 'amy' } });
    }) as typeof fetch;
    const result = await redeemConnectCode('APP-ABCD-EFGH-JKMN', fake);
    expect(sent).toEqual({ app_id: 'shuxen26', code: 'APP-ABCD-EFGH-JKMN' });
    expect(result.ok && result.connection.user_name).toBe('amy');
  });

  it('shows the site message, a rate-limit hint, or a network hint when it fails', async () => {
    const refused = (async () => jsonResponse(400, { success: false, message: '接入码已过期' })) as unknown as typeof fetch;
    expect(await redeemConnectCode('APP-ABCD-EFGH-JKMN', refused)).toEqual({ ok: false, message: '接入码已过期' });
    const limited = (async () => jsonResponse(429, {})) as unknown as typeof fetch;
    expect(await redeemConnectCode('APP-ABCD-EFGH-JKMN', limited)).toEqual({ ok: false, message: '操作太频繁，请过几秒再试' });
    const offline = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await redeemConnectCode('APP-ABCD-EFGH-JKMN', offline)).toEqual({ ok: false, message: '网络异常，请检查网络后重试' });
    expect((await redeemConnectCode('hello', offline)).ok).toBe(false);
  });

  it('treats a 401 as revoked, except when only the quota ran out or the network is down', async () => {
    const revoked = (async () => jsonResponse(401, { error: { code: 'invalid_api_key' } })) as unknown as typeof fetch;
    const quota = (async () => jsonResponse(401, { error: { code: 'app_quota_exhausted' } })) as unknown as typeof fetch;
    const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await isConnectionRevoked(connection, revoked)).toBe(true);
    expect(await isConnectionRevoked(connection, quota)).toBe(false);
    expect(await isConnectionRevoked(connection, offline)).toBe(false);
  });

  it('saves, loads and clears the connection file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shuxin-conn-'));
    dirs.push(dir);
    expect(loadConnection(dir)).toBeNull();
    saveConnection(dir, connection);
    expect(loadConnection(dir)?.api_key).toBe('sk-test');
    clearConnection(dir);
    expect(loadConnection(dir)).toBeNull();
  });

  it('sends sub-site users to their own site and compares versions by number', () => {
    expect(siteOrigin(connection)).toBe('https://lingshu.example.com');
    expect(siteOrigin(null)).toBe('https://zhishuhub.com');
    expect(compareVersions('0.7.0-zs.2', '0.7.0-zs.1')).toBeGreaterThan(0);
    expect(compareVersions('v0.7.0-zs.1', '0.7.0-zs.1')).toBe(0);
    expect(compareVersions('0.6.9', '0.7.0-zs.1')).toBeLessThan(0);
  });
});
