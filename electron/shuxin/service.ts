/**
 * 枢心主进程总调度：接入状态、角色选择、写进 OpenClaw、微信连接状态巡检、托盘和通知。
 * 界面通过扩展注册的 host API（模块名 shuxin）调用这里，状态变化通过 ext:shuxin-status 事件推给界面。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, clipboard, nativeImage, Notification, shell, type BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import { mutateOpenClawConfig, readOpenClawConfigSnapshot } from '../gateway/config-delivery';
import { logger } from '../utils/logger';
import { getResourcesDir, resolveOpenClawStateDir } from '../utils/paths';
import { resolveOpenClawAgentWorkspaceDir } from '../utils/openclaw-agent-roster';
import type { CharacterView, ShuxinOverview } from '../../shared/shuxin/types';
import { renderPersonaMarkdown } from './character-card';
import {
  importCharacter,
  loadCompanionState,
  loadImportedCharacters,
  loadPresetCharacters,
  memoryKey,
  readCharacter,
  removeImportedCharacter,
  saveCompanionState,
  updateImportedGender,
  type CharacterEntry,
  type CompanionGender,
  type CompanionSelection,
} from './characters';
import {
  renderFreePersona,
  skillForGender,
  switchMemory,
  writeCompanionFiles,
  type CompanionSkill,
} from './companion-workspace';
import {
  clearConnection,
  compareVersions,
  fetchBalance,
  fetchLatestVersion,
  findConnectCode,
  isConnectionRevoked,
  loadConnection,
  redeemConnectCode,
  saveConnection,
  siteOrigin,
} from './connection';
import { syncGreetingJobs } from './greetings';
import { SHUXIN_AGENT_ID } from './managed';
import { ensureZhishuProvider } from './provider';
import {
  classifyWeChat,
  readBoundWeChatAccounts,
  type CompanionLinkState,
  type WeChatRuntimeAccount,
} from './wechat-status';

export type { CharacterView, ShuxinOverview };

type StatusListener = (overview: ShuxinOverview) => void;

const STATUS_INTERVAL_MS = 60_000;
const BALANCE_TTL_MS = 60_000;
const VERSION_TTL_MS = 6 * 60 * 60_000;

export class ShuxinService {
  private readonly userDataDir = app.getPath('userData');
  private readonly shuxinDir = join(this.userDataDir, 'shuxin');
  private readonly libraryDir = join(this.shuxinDir, 'characters');
  private readonly stateFile = join(this.shuxinDir, 'state.json');
  private readonly memoryArchive = join(this.shuxinDir, 'memory');
  private readonly presetDir = join(getResourcesDir(), 'shuxin', 'characters');

  private link: CompanionLinkState = 'not_bound';
  private message = '';
  private balance = { value: '', at: 0 };
  private latest = { value: '', at: 0 };
  private thumbnails = new Map<string, string>();
  private listeners = new Set<StatusListener>();
  private timer: NodeJS.Timeout | null = null;
  private applying: Promise<void> | null = null;
  private filesRetry: NodeJS.Timeout | null = null;
  private filesRetries = 0;

  constructor(
    private readonly gatewayManager: GatewayManager,
    private readonly getMainWindow: () => BrowserWindow | null,
  ) {}

  start(): void {
    this.gatewayManager.on('status', (status: { state: string }) => {
      if (status.state === 'running') void this.onGatewayRunning();
      void this.refreshLink();
    });
    this.timer = setInterval(() => void this.refreshLink(), STATUS_INTERVAL_MS);
    void this.verifyConnection();
    void this.refreshLink();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.filesRetry) clearTimeout(this.filesRetry);
    this.timer = null;
    this.filesRetry = null;
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── 接入 ─────────────────────────────────────────────

  async connect(code: string): Promise<ShuxinOverview> {
    const result = await redeemConnectCode(code);
    if (!result.ok) {
      this.message = result.message;
      return this.overview();
    }
    saveConnection(this.userDataDir, result.connection);
    this.message = '';
    this.balance = { value: '', at: 0 };
    await ensureZhishuProvider(result.connection, this.gatewayManager).catch((error) => {
      logger.warn('[shuxin] Failed to apply Zhishu provider:', error);
    });
    return this.emit();
  }

  /** 剪贴板里有接入码就返回，接入页打开时自动填上。 */
  clipboardCode(): string {
    return findConnectCode(clipboard.readText());
  }

  async disconnect(): Promise<ShuxinOverview> {
    clearConnection(this.userDataDir);
    this.message = '';
    return this.emit();
  }

  /** 启动时确认接入还有效：网站上停止授权后回到接入页。 */
  private async verifyConnection(): Promise<void> {
    const connection = loadConnection(this.userDataDir);
    if (!connection) return;
    if (await isConnectionRevoked(connection)) {
      clearConnection(this.userDataDir);
      this.message = '接入已失效，请回到网站重新点「一键接入」';
      await this.emit();
    }
  }

  // ── 角色 ─────────────────────────────────────────────

  private entries(): CharacterEntry[] {
    return [...loadPresetCharacters(this.presetDir), ...loadImportedCharacters(this.libraryDir)];
  }

  private thumbnail(entry: CharacterEntry): string {
    const cached = this.thumbnails.get(entry.file);
    if (cached !== undefined) return cached;
    let avatar = '';
    const character = readCharacter(entry);
    if (character?.avatarPng) {
      const image = nativeImage.createFromBuffer(character.avatarPng);
      if (!image.isEmpty()) avatar = image.resize({ width: 192, quality: 'good' }).toDataURL();
    }
    this.thumbnails.set(entry.file, avatar);
    return avatar;
  }

  private view(entry: CharacterEntry): CharacterView {
    return {
      id: entry.id,
      source: entry.source,
      name: entry.name,
      tagline: entry.tagline,
      gender: entry.gender,
      creator: entry.creator,
      avatar: this.thumbnail(entry),
    };
  }

  listCharacters(): CharacterView[] {
    return this.entries().map((entry) => this.view(entry));
  }

  importCard(payload: { fileName: string; dataBase64: string; gender?: CompanionGender }):
    { ok: true; character: CharacterView } | { ok: false; reason: string } {
    const bytes = Buffer.from(payload.dataBase64, 'base64');
    const result = importCharacter(this.libraryDir, bytes, payload.fileName, payload.gender);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.thumbnails.delete(result.entry.file);
    return { ok: true, character: this.view(result.entry) };
  }

  async setCharacterGender(id: string, gender: CompanionGender): Promise<ShuxinOverview> {
    updateImportedGender(this.libraryDir, id, gender);
    const state = loadCompanionState(this.stateFile);
    if (state.selection?.characterId === id) await this.select({ characterId: id, gender });
    return this.overview();
  }

  removeCharacter(id: string): boolean {
    const state = loadCompanionState(this.stateFile);
    if (state.selection?.characterId === id) return false;
    removeImportedCharacter(this.libraryDir, id);
    return true;
  }

  /** 选角色并写进 OpenClaw。同一时间只跑一次，后来的排在后面。 */
  async select(selection: CompanionSelection): Promise<ShuxinOverview> {
    const run = async () => {
      const entry = selection.characterId ? this.entries().find((item) => item.id === selection.characterId) : null;
      if (selection.characterId && !entry) throw new Error('角色不存在');
      const next: CompanionSelection = { characterId: entry?.id ?? null, gender: entry?.gender ?? selection.gender };
      const previous = loadCompanionState(this.stateFile).selection;
      switchMemory(
        homedir(),
        this.memoryArchive,
        previous ? { key: memoryKey(previous), skill: skillForGender(previous.gender) } : null,
        { key: memoryKey(next), skill: skillForGender(next.gender) },
      );
      saveCompanionState(this.stateFile, { selection: next, appliedAt: '' });
      const changed = !previous || memoryKey(previous) !== memoryKey(next) || previous.gender !== next.gender;
      await this.applySelection(next, changed);
    };
    const pending = (this.applying ?? Promise.resolve()).then(run, run);
    this.applying = pending.catch(() => undefined);
    await pending;
    return this.emit();
  }

  private persona(selection: CompanionSelection): { persona: string; name: string | null } {
    if (!selection.characterId) return { persona: renderFreePersona(selection.gender), name: null };
    const entry = this.entries().find((item) => item.id === selection.characterId);
    const character = entry ? readCharacter(entry) : null;
    if (!character) return { persona: renderFreePersona(selection.gender), name: null };
    return { persona: renderPersonaMarkdown(character.card), name: character.card.name };
  }

  private async companionWorkspace(): Promise<string> {
    const snapshot = await readOpenClawConfigSnapshot();
    const agents = (snapshot.config as { agents?: unknown }).agents;
    return resolveOpenClawAgentWorkspaceDir(agents, SHUXIN_AGENT_ID, { homeDir: homedir() });
  }

  /**
   * 把选择写进 OpenClaw：人设文件、只开对应的恋人技能、问候任务；换了角色还要清掉微信里的旧对话，
   * 免得新角色接着旧角色的话说。后台服务没起来时只写文件，起来后再补其余几步。
   */
  private async applySelection(selection: CompanionSelection, changedCharacter: boolean): Promise<void> {
    const skill = skillForGender(selection.gender);
    const { persona, name } = this.persona(selection);
    const workspace = await this.companionWorkspace();
    const filesComplete = writeCompanionFiles(workspace, { persona, name, skill });
    await this.enableOnlySkill(skill);

    if (this.gatewayManager.getStatus().state !== 'running') return;
    if (changedCharacter) await this.resetWeChatSessions();
    await this.syncGreetings(skill);
    if (filesComplete) {
      this.filesRetries = 0;
      saveCompanionState(this.stateFile, { selection, appliedAt: new Date().toISOString() });
    } else {
      this.retryFilesLater(selection);
    }
  }

  /**
   * 后台服务第一次启动时，OpenClaw 会稍晚一点才生成默认的 AGENTS.md。
   * 没生成之前写不了枢心那一段，每 5 秒再试一次，最多 2 分钟。
   */
  private retryFilesLater(selection: CompanionSelection): void {
    if (this.filesRetry || this.filesRetries >= 24) return;
    this.filesRetries += 1;
    this.filesRetry = setTimeout(() => {
      this.filesRetry = null;
      void (async () => {
        const skill = skillForGender(selection.gender);
        const { persona, name } = this.persona(selection);
        if (writeCompanionFiles(await this.companionWorkspace(), { persona, name, skill })) {
          this.filesRetries = 0;
          saveCompanionState(this.stateFile, { selection, appliedAt: new Date().toISOString() });
        } else {
          this.retryFilesLater(selection);
        }
      })().catch((error) => logger.warn('[shuxin] Failed to write companion files:', error));
    }, 5_000);
  }

  private async enableOnlySkill(skill: CompanionSkill): Promise<void> {
    const other: CompanionSkill = skill === 'girlfriend' ? 'boyfriend' : 'girlfriend';
    await mutateOpenClawConfig((config) => {
      const root = config as { skills?: { entries?: Record<string, { enabled?: boolean }> } };
      root.skills ??= {};
      root.skills.entries ??= {};
      root.skills.entries[skill] = { ...(root.skills.entries[skill] ?? {}), enabled: true };
      root.skills.entries[other] = { ...(root.skills.entries[other] ?? {}), enabled: false };
    });
  }

  private async resetWeChatSessions(): Promise<void> {
    try {
      const result = await this.gatewayManager.rpc<unknown>('sessions.list', { agentId: SHUXIN_AGENT_ID });
      const rows = Array.isArray(result)
        ? result
        : (result as { sessions?: unknown[] } | null)?.sessions ?? [];
      for (const row of rows) {
        const key = typeof row === 'string' ? row : (row as { key?: unknown })?.key;
        if (typeof key === 'string' && key.startsWith(`agent:${SHUXIN_AGENT_ID}:`) && key.includes(':openclaw-weixin:')) {
          await this.gatewayManager.rpc('sessions.delete', { key, deleteTranscript: false });
        }
      }
    } catch (error) {
      logger.warn('[shuxin] Failed to reset WeChat sessions after switching character:', error);
    }
  }

  private async syncGreetings(skill: CompanionSkill): Promise<void> {
    const account = readBoundWeChatAccounts(resolveOpenClawStateDir()).at(-1);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    try {
      await syncGreetingJobs(
        this.gatewayManager,
        account ? { agentId: SHUXIN_AGENT_ID, accountId: account.accountId, userId: account.userId } : null,
        skill,
        timeZone,
      );
    } catch (error) {
      logger.warn('[shuxin] Failed to sync greeting jobs:', error);
    }
  }

  /** 后台服务每次起来：补上服务商、人设文件和问候任务（第一次启动时 OpenClaw 这时才生成默认文件）。 */
  private async onGatewayRunning(): Promise<void> {
    const connection = loadConnection(this.userDataDir);
    if (connection) {
      await ensureZhishuProvider(connection, this.gatewayManager).catch((error) => {
        logger.warn('[shuxin] Failed to apply Zhishu provider:', error);
      });
    }
    const state = loadCompanionState(this.stateFile);
    if (state.selection) {
      await (this.applying ?? Promise.resolve());
      await this.applySelection(state.selection, false).catch((error) => {
        logger.warn('[shuxin] Failed to apply companion after gateway start:', error);
      });
    }
  }

  /** 微信扫码成功后由界面调用：建问候任务、刷新状态。 */
  async afterWeChatLogin(): Promise<ShuxinOverview> {
    const state = loadCompanionState(this.stateFile);
    if (state.selection && this.gatewayManager.getStatus().state === 'running') {
      await this.syncGreetings(skillForGender(state.selection.gender));
    }
    await this.refreshLink();
    return this.overview();
  }

  // ── 微信状态 ─────────────────────────────────────────

  async refreshLink(): Promise<void> {
    const bound = readBoundWeChatAccounts(resolveOpenClawStateDir());
    const gatewayRunning = this.gatewayManager.getStatus().state === 'running';
    let runtime: WeChatRuntimeAccount[] | null = null;
    if (gatewayRunning && bound.length > 0) {
      try {
        const status = await this.gatewayManager.rpc<{ channelAccounts?: Record<string, WeChatRuntimeAccount[]> }>(
          'channels.status',
          { probe: false },
          15_000,
        );
        runtime = status?.channelAccounts?.['openclaw-weixin'] ?? [];
      } catch {
        runtime = null;
      }
    }
    const next = classifyWeChat({ bound, runtime, gatewayRunning });
    const previous = this.link;
    this.link = next;
    if (next !== previous) {
      if (next === 'needs_rescan') this.notifyRescan();
      await this.emit();
    }
  }

  private notifyRescan(): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: '枢心：微信需要重新扫码',
      body: '微信登录失效了，点这里打开枢心，用微信扫一下新的二维码就能恢复。聊天记忆都还在。',
    });
    notification.on('click', () => this.showWindow('/wechat'));
    notification.show();
  }

  showWindow(route?: string): void {
    const window = this.getMainWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (route) window.webContents.send('navigate', route);
  }

  // ── 总览 ─────────────────────────────────────────────

  async overview(): Promise<ShuxinOverview> {
    const connection = loadConnection(this.userDataDir);
    const now = Date.now();
    if (connection && now - this.balance.at > BALANCE_TTL_MS) {
      this.balance = { value: await fetchBalance(connection), at: now };
    }
    if (now - this.latest.at > VERSION_TTL_MS) {
      this.latest = { value: await fetchLatestVersion(connection), at: now };
    }
    const state = loadCompanionState(this.stateFile);
    const entry = state.selection?.characterId
      ? this.entries().find((item) => item.id === state.selection?.characterId) ?? null
      : null;
    const version = app.getVersion();
    return {
      connected: connection !== null,
      userName: connection?.user_name ?? '',
      siteOrigin: siteOrigin(connection),
      balance: connection ? this.balance.value : '',
      message: this.message,
      selection: state.selection,
      character: entry ? this.view(entry) : null,
      link: this.link,
      version,
      latestVersion: this.latest.value,
      updateAvailable: !!this.latest.value && compareVersions(this.latest.value, version) > 0,
    };
  }

  private async emit(): Promise<ShuxinOverview> {
    const overview = await this.overview();
    for (const listener of this.listeners) listener(overview);
    this.getMainWindow()?.webContents.send('ext:shuxin-status', overview);
    return overview;
  }

  openSite(path = ''): void {
    const connection = loadConnection(this.userDataDir);
    void shell.openExternal(`${siteOrigin(connection)}${path}`);
  }
}
