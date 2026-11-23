/**
 * 枢心角色库：应用自带的现成角色（resources/shuxin/characters）加上用户导入的酒馆角色卡，
 * 以及「当前用的是哪个角色」。不依赖 Electron，目录都由调用方传入，方便测试。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCharacterCard, type CharacterCard, type CardImportFailure } from './character-card';

import type { CompanionGender, CompanionSelection } from '../../shared/shuxin/types';

export type { CompanionGender, CompanionSelection };

export interface CharacterEntry {
  id: string;
  source: 'preset' | 'imported';
  name: string;
  tagline: string;
  gender: CompanionGender;
  /** 角色卡原文件（PNG 或 JSON）的绝对路径。 */
  file: string;
  creator: string;
}

export interface CompanionState {
  selection: CompanionSelection | null;
  /** 这个选择写进 OpenClaw 的时间；为空说明还没写成功，启动时要再写一次。 */
  appliedAt: string;
}

interface PresetIndex {
  characters?: Array<{ id?: string; file?: string; gender?: string; tagline?: string }>;
}

interface ImportedMeta {
  id: string;
  name: string;
  tagline: string;
  gender: CompanionGender;
  file: string;
  creator: string;
  importedAt: string;
}

function asGender(value: unknown): CompanionGender {
  return value === 'male' ? 'male' : 'female';
}

/** 读应用自带的现成角色；单张卡读不出来就跳过，不影响其它卡。 */
export function loadPresetCharacters(presetDir: string): CharacterEntry[] {
  let index: PresetIndex;
  try {
    index = JSON.parse(readFileSync(join(presetDir, 'index.json'), 'utf8')) as PresetIndex;
  } catch {
    return [];
  }
  const entries: CharacterEntry[] = [];
  for (const item of index.characters ?? []) {
    if (!item.id || !item.file) continue;
    const file = join(presetDir, item.file);
    let result;
    try {
      result = readCharacterCard(readFileSync(file), item.file);
    } catch {
      continue;
    }
    if (!result.ok) continue;
    entries.push({
      id: `preset-${item.id}`,
      source: 'preset',
      name: result.card.name,
      tagline: item.tagline ?? '',
      gender: asGender(item.gender),
      file,
      creator: result.card.creator,
    });
  }
  return entries;
}

export function loadImportedCharacters(libraryDir: string): CharacterEntry[] {
  if (!existsSync(libraryDir)) return [];
  const entries: CharacterEntry[] = [];
  for (const dirent of readdirSync(libraryDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    try {
      const meta = JSON.parse(readFileSync(join(libraryDir, dirent.name, 'meta.json'), 'utf8')) as ImportedMeta;
      const file = join(libraryDir, dirent.name, meta.file);
      if (!existsSync(file)) continue;
      entries.push({
        id: meta.id,
        source: 'imported',
        name: meta.name,
        tagline: meta.tagline,
        gender: asGender(meta.gender),
        file,
        creator: meta.creator ?? '',
      });
    } catch {
      // 目录不完整就当没有
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/**
 * 从角色卡文字里猜角色性别：数一数「她 / 他」和 she / he 出现的次数，猜不出时按女性。
 * 导入时用户还能改。
 */
export function guessGender(card: CharacterCard): CompanionGender {
  const text = [card.description, card.personality, card.scenario, card.firstMessage].join('\n');
  const count = (pattern: RegExp) => (text.match(pattern) ?? []).length;
  const female = count(/她/g) + count(/\b(she|her|hers|herself)\b/gi);
  const male = count(/他(?!们)/g) + count(/\b(he|him|his|himself)\b/gi);
  return male > female ? 'male' : 'female';
}

/** 一句话简介：取卡作者写的简介或人物设定的第一句，最多 30 个字。 */
export function summarizeCard(card: CharacterCard): string {
  const source = card.creatorNotes || card.personality || card.description;
  const first = source.replace(/<[^>]+>/g, '').split(/[\n。！？.!?]/).map((line) => line.trim()).find(Boolean) ?? '';
  return first.length > 30 ? `${first.slice(0, 30)}…` : first;
}

export type ImportResult =
  | { ok: true; entry: CharacterEntry }
  | { ok: false; reason: CardImportFailure };

/** 导入一张角色卡：原文件原样存进角色库，同一个文件重复导入覆盖原来那份。 */
export function importCharacter(
  libraryDir: string,
  bytes: Buffer,
  fileName: string,
  gender?: CompanionGender,
): ImportResult {
  const result = readCharacterCard(bytes, fileName);
  if (!result.ok) return result;
  const id = `imported-${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}`;
  const dir = join(libraryDir, id);
  mkdirSync(dir, { recursive: true });
  const file = result.avatarPng ? 'card.png' : 'card.json';
  writeFileSync(join(dir, file), bytes);
  const meta: ImportedMeta = {
    id,
    name: result.card.name,
    tagline: summarizeCard(result.card),
    gender: gender ?? guessGender(result.card),
    file,
    creator: result.card.creator,
    importedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  return {
    ok: true,
    entry: { id, source: 'imported', name: meta.name, tagline: meta.tagline, gender: meta.gender, file: join(dir, file), creator: meta.creator },
  };
}

/** 改导入角色的性别（猜错时用）。现成角色不能改。 */
export function updateImportedGender(libraryDir: string, id: string, gender: CompanionGender): boolean {
  const metaPath = join(libraryDir, id, 'meta.json');
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ImportedMeta;
    meta.gender = gender;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function removeImportedCharacter(libraryDir: string, id: string): void {
  if (!/^imported-[0-9a-f]{10}$/.test(id)) return;
  rmSync(join(libraryDir, id), { recursive: true, force: true });
}

/** 读角色卡全文，给人设生成用。 */
export function readCharacter(entry: CharacterEntry): { card: CharacterCard; avatarPng?: Buffer } | null {
  try {
    const result = readCharacterCard(readFileSync(entry.file), entry.file);
    return result.ok ? { card: result.card, avatarPng: result.avatarPng } : null;
  } catch {
    return null;
  }
}

export function loadCompanionState(stateFile: string): CompanionState {
  try {
    const data = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<CompanionState>;
    const selection = data.selection && typeof data.selection === 'object'
      ? {
        characterId: typeof data.selection.characterId === 'string' ? data.selection.characterId : null,
        gender: asGender(data.selection.gender),
      }
      : null;
    return { selection, appliedAt: typeof data.appliedAt === 'string' ? data.appliedAt : '' };
  } catch {
    return { selection: null, appliedAt: '' };
  }
}

export function saveCompanionState(stateFile: string, state: CompanionState): void {
  mkdirSync(join(stateFile, '..'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

/** 记忆归档用的键：每个角色一份，不选角色时按性别各一份。 */
export function memoryKey(selection: CompanionSelection): string {
  return selection.characterId ?? `free-${selection.gender}`;
}
