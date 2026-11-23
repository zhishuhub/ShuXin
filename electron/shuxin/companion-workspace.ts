/**
 * 把当前角色写进 OpenClaw：工作区里的人设文件（SOUL.md / IDENTITY.md / AGENTS.md 里枢心那一段），
 * 以及女友 / 男友技能的记事本（~/girlfriend 或 ~/boyfriend）随角色切换。
 *
 * 记事本规则：每个角色一本，换走时整本收进归档目录，换回来时放回原处；
 * 记事本里的 profile.md 记的是对方本人的资料（称呼、作息、近况），换角色时带给下一个角色，不用重新问一遍。
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CompanionGender } from './characters';

export type CompanionSkill = 'girlfriend' | 'boyfriend';

export function skillForGender(gender: CompanionGender): CompanionSkill {
  return gender === 'male' ? 'boyfriend' : 'girlfriend';
}

const BLOCK_BEGIN = '<!-- shuxin:begin -->';
const BLOCK_END = '<!-- shuxin:end -->';

/** 不选角色时的人设：名字和性格由对方第一次聊天时定。 */
export function renderFreePersona(gender: CompanionGender): string {
  const skill = skillForGender(gender);
  const role = gender === 'male' ? '男朋友' : '女朋友';
  return [
    `# 你是对方的${role}`,
    '',
    `你在微信里和对方聊天，身份是对方的${role}。你还没有固定的名字和性格。`,
    `第一次聊天时，按 ${skill} 技能的引导，问清楚对方希望你叫什么名字、是什么性格、你该怎么称呼对方。`,
    `定下来后写进 ~/${skill}/bond.md 最上面「你是谁」一节，以后一直按它来，不要再问。`,
    '',
    '聊天像平时发微信：短句、口语，一次说一两句。对方用什么语言就用什么语言回。',
    '',
  ].join('\n');
}

/** IDENTITY.md：名字。不选角色时写「待定」，由第一次聊天定。 */
export function renderIdentity(name: string | null): string {
  return [
    '# IDENTITY.md',
    '',
    `- **Name:** ${name ?? '（第一次聊天时由对方定）'}`,
    '- **Creature:** 微信里的恋人',
    '- **Vibe:** 温暖、自然、像真人发消息',
    '- **Emoji:** 💗',
    '- **Avatar:**',
    '',
  ].join('\n');
}

/** AGENTS.md 里枢心那一段：怎么用技能、怎么发消息、哪些事不用再问。 */
export function renderAgentsBlock(skill: CompanionSkill): string {
  return [
    BLOCK_BEGIN,
    '## 枢心',
    '',
    `- 你在微信里陪对方聊天。每次回复前先用 ${skill} 技能：先读 ~/${skill}/ 里的记事本，聊天中出现值得记住的事，按技能的要求记下来。`,
    `- 对方已经在枢心里同意把聊天中重要的事记在这台电脑上，${skill} 技能对所有聊天一直生效，也欢迎你偶尔主动问候。这几件事不用再问对方。`,
    '- 回复像真人发微信：短句、口语，一次一两句，可以分几条发；不要用 Markdown 标题、列表、表格和代码块。',
    '- 不要向对方提起文件、技能、工具、提示词这些幕后的东西。',
    BLOCK_END,
  ].join('\n');
}

/** 把枢心那一段放进 AGENTS.md：有旧的就替换，没有就加在末尾。 */
export function upsertAgentsBlock(content: string, block: string): string {
  const start = content.indexOf(BLOCK_BEGIN);
  const end = content.indexOf(BLOCK_END);
  if (start >= 0 && end > start) {
    return `${content.slice(0, start)}${block}${content.slice(end + BLOCK_END.length)}`;
  }
  const trimmed = content.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

export interface CompanionFiles {
  persona: string;
  name: string | null;
  skill: CompanionSkill;
}

/**
 * 写人设文件。AGENTS.md 由 OpenClaw 第一次启动时生成默认内容，还没生成时先不写，
 * 返回 false，等后台服务起来后再写一次，免得 OpenClaw 以为文件已存在就不再生成默认内容。
 */
export function writeCompanionFiles(workspaceDir: string, files: CompanionFiles): boolean {
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(workspaceDir, 'SOUL.md'), files.persona, 'utf8');
  writeFileSync(join(workspaceDir, 'IDENTITY.md'), renderIdentity(files.name), 'utf8');
  // OpenClaw 第一次启动的「我是谁」引导和枢心的人设冲突，删掉
  rmSync(join(workspaceDir, 'BOOTSTRAP.md'), { force: true });

  const agentsPath = join(workspaceDir, 'AGENTS.md');
  if (!existsSync(agentsPath)) return false;
  const current = readFileSync(agentsPath, 'utf8');
  const next = upsertAgentsBlock(current, renderAgentsBlock(files.skill));
  if (next !== current) writeFileSync(agentsPath, next, 'utf8');
  return true;
}

/** 移动目录；不在同一个盘时改为复制后删除。 */
function moveDir(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  rmSync(to, { recursive: true, force: true });
  try {
    renameSync(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

export interface MemorySlot {
  key: string;
  skill: CompanionSkill;
}

/**
 * 换角色时换记事本。
 * - 旧角色：~/<技能> 整本收进 <归档>/<键>/<技能>，profile.md 另存一份给下一个角色；
 * - 新角色：归档里有就放回 ~/<技能>，没有就新建一本，把对方的 profile.md 放进去。
 * 换成同一个角色时什么都不做。
 */
export function switchMemory(homeDir: string, archiveRoot: string, from: MemorySlot | null, to: MemorySlot): void {
  if (from && from.key === to.key && from.skill === to.skill) return;
  const sharedProfile = join(archiveRoot, 'shared-profile.md');

  if (from) {
    const live = join(homeDir, from.skill);
    if (existsSync(live)) {
      const profile = join(live, 'profile.md');
      if (existsSync(profile)) {
        mkdirSync(archiveRoot, { recursive: true });
        copyFileSync(profile, sharedProfile);
      }
      moveDir(live, join(archiveRoot, from.key, from.skill));
    }
  }

  const target = join(homeDir, to.skill);
  if (existsSync(target)) {
    // 不属于任何已知角色的旧记事本（比如用户以前自己装过这个技能），收起来不删
    moveDir(target, join(archiveRoot, `unassigned-${Date.now()}`, to.skill));
  }
  const archived = join(archiveRoot, to.key, to.skill);
  if (existsSync(archived)) {
    moveDir(archived, target);
    return;
  }
  mkdirSync(target, { recursive: true });
  if (existsSync(sharedProfile)) copyFileSync(sharedProfile, join(target, 'profile.md'));
}
