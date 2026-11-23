// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  renderAgentsBlock,
  renderFreePersona,
  skillForGender,
  switchMemory,
  upsertAgentsBlock,
  writeCompanionFiles,
} from '@electron/shuxin/companion-workspace';
import { greetingSpecs, syncGreetingJobs } from '@electron/shuxin/greetings';
import {
  classifyWeChat,
  isStaleTokenError,
  readBoundWeChatAccounts,
} from '@electron/shuxin/wechat-status';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shuxin-companion-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('persona files in the OpenClaw workspace', () => {
  it('replaces its own AGENTS.md section instead of adding another one', () => {
    const once = upsertAgentsBlock('# AGENTS\n\nkeep me\n', renderAgentsBlock('girlfriend'));
    const twice = upsertAgentsBlock(once, renderAgentsBlock('boyfriend'));
    expect(twice.match(/shuxin:begin/g)).toHaveLength(1);
    expect(twice).toContain('keep me');
    expect(twice).toContain('boyfriend');
    expect(twice).not.toContain('~/girlfriend/');
  });

  it('waits for OpenClaw to create AGENTS.md, and removes the first-run bootstrap', () => {
    const workspace = tempDir();
    writeFileSync(join(workspace, 'BOOTSTRAP.md'), 'who am I?');
    const files = { persona: '# 你是林夏\n', name: '林夏', skill: 'girlfriend' as const };
    expect(writeCompanionFiles(workspace, files)).toBe(false);
    expect(existsSync(join(workspace, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(workspace, 'BOOTSTRAP.md'))).toBe(false);
    expect(readFileSync(join(workspace, 'IDENTITY.md'), 'utf8')).toContain('**Name:** 林夏');

    writeFileSync(join(workspace, 'AGENTS.md'), '# OpenClaw default\n');
    expect(writeCompanionFiles(workspace, files)).toBe(true);
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toContain('# OpenClaw default');
    expect(readFileSync(join(workspace, 'SOUL.md'), 'utf8')).toBe('# 你是林夏\n');
  });

  it('lets the user define a free character in the first chat', () => {
    expect(renderFreePersona('male')).toContain('~/boyfriend/bond.md');
    expect(skillForGender('female')).toBe('girlfriend');
  });
});

describe('switching memory between characters', () => {
  it('archives the old notebook, carries over the user profile, and restores it when switching back', () => {
    const home = tempDir();
    const archive = join(tempDir(), 'memory');
    const a = { key: 'preset-tangtuantuan', skill: 'girlfriend' as const };
    const b = { key: 'preset-shenyan', skill: 'boyfriend' as const };

    switchMemory(home, archive, null, a);
    writeFileSync(join(home, 'girlfriend', 'profile.md'), 'name: 小王');
    writeFileSync(join(home, 'girlfriend', 'bond.md'), '叫他六点半先生');

    switchMemory(home, archive, a, b);
    expect(existsSync(join(home, 'girlfriend'))).toBe(false);
    expect(readFileSync(join(home, 'boyfriend', 'profile.md'), 'utf8')).toBe('name: 小王');
    expect(existsSync(join(home, 'boyfriend', 'bond.md'))).toBe(false);

    switchMemory(home, archive, b, a);
    expect(readFileSync(join(home, 'girlfriend', 'bond.md'), 'utf8')).toBe('叫他六点半先生');
  });

  it('keeps a notebook that belongs to no known character instead of deleting it', () => {
    const home = tempDir();
    const archive = join(tempDir(), 'memory');
    mkdirSync(join(home, 'girlfriend'));
    writeFileSync(join(home, 'girlfriend', 'history.md'), 'old');
    switchMemory(home, archive, null, { key: 'free-female', skill: 'girlfriend' });
    expect(existsSync(join(home, 'girlfriend', 'history.md'))).toBe(false);
    const kept = readFileSync(join(archive, readdirName(archive, 'unassigned-'), 'girlfriend', 'history.md'), 'utf8');
    expect(kept).toBe('old');
  });
});

function readdirName(dir: string, prefix: string): string {
  return readdirSync(dir).find((name) => name.startsWith(prefix)) ?? '';
}

describe('WeChat link state', () => {
  it('reads bound accounts from the plugin state files', () => {
    const openclaw = tempDir();
    const state = join(openclaw, 'openclaw-weixin');
    mkdirSync(join(state, 'accounts'), { recursive: true });
    writeFileSync(join(state, 'accounts.json'), JSON.stringify(['bot-a', 'bot-b']));
    writeFileSync(join(state, 'accounts', 'bot-a.json'), JSON.stringify({ token: 't', userId: 'u1' }));
    expect(readBoundWeChatAccounts(openclaw)).toEqual([{ accountId: 'bot-a', userId: 'u1' }]);
    expect(readBoundWeChatAccounts(tempDir())).toEqual([]);
  });

  it('asks for a new scan only when every account reports an invalid token', () => {
    const bound = [{ accountId: 'bot-a', userId: 'u1' }];
    expect(classifyWeChat({ bound: [], runtime: null, gatewayRunning: true })).toBe('not_bound');
    expect(classifyWeChat({ bound, runtime: null, gatewayRunning: false })).toBe('offline');
    expect(classifyWeChat({ bound, runtime: [{ connected: true }], gatewayRunning: true })).toBe('online');
    expect(classifyWeChat({ bound, runtime: [{ lastError: 'getUpdates errcode -14' }], gatewayRunning: true })).toBe('needs_rescan');
    expect(classifyWeChat({
      bound,
      runtime: [{ lastError: 'session paused for accountId=a' }, { connected: true }],
      gatewayRunning: true,
    })).toBe('online');
    expect(classifyWeChat({ bound, runtime: [{ lastError: 'fetch failed' }], gatewayRunning: true })).toBe('connecting');
    expect(isStaleTokenError(undefined)).toBe(false);
  });
});

describe('daily greetings', () => {
  it('replaces earlier ShuXin jobs with a morning and an evening greeting to the bound WeChat user', async () => {
    const calls: Array<[string, unknown]> = [];
    const gateway = {
      rpc: async <T,>(method: string, params?: unknown): Promise<T> => {
        calls.push([method, params]);
        if (method === 'cron.list') return { jobs: [{ id: 'old', name: '枢心·早安' }, { id: 'mine', name: '我的任务' }] } as T;
        return {} as T;
      },
    };
    await syncGreetingJobs(gateway, { agentId: 'main', accountId: 'bot-a', userId: 'u1' }, 'girlfriend', 'Asia/Shanghai');
    expect(calls.filter(([method]) => method === 'cron.remove')).toEqual([['cron.remove', { id: 'old' }]]);
    const added = calls.filter(([method]) => method === 'cron.add').map(([, params]) => params as Record<string, unknown>);
    expect(added).toHaveLength(2);
    expect(added[0].delivery).toEqual({ mode: 'announce', channel: 'openclaw-weixin', to: 'u1', accountId: 'bot-a' });
    expect(added[0].schedule).toEqual({ kind: 'cron', expr: '30 8 * * *', tz: 'Asia/Shanghai' });
  });

  it('only removes old jobs when WeChat is not bound yet', async () => {
    const methods: string[] = [];
    const gateway = { rpc: async <T,>(method: string): Promise<T> => { methods.push(method); return [] as T; } };
    await syncGreetingJobs(gateway, null, 'boyfriend', 'Asia/Shanghai');
    expect(methods).toEqual(['cron.list']);
    expect(greetingSpecs('boyfriend')[0].message).toContain('~/boyfriend/');
  });
});
