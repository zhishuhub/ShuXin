// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  guessGender,
  importCharacter,
  loadCompanionState,
  loadImportedCharacters,
  loadPresetCharacters,
  memoryKey,
  removeImportedCharacter,
  saveCompanionState,
  updateImportedGender,
} from '@electron/shuxin/characters';
import { toCharacterCard } from '@electron/shuxin/character-card';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shuxin-chars-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('preset characters shipped with the app', () => {
  it('reads every bundled card with its name, gender and tagline', () => {
    const presets = loadPresetCharacters(resolve(__dirname, '../../resources/shuxin/characters'));
    expect(presets.map((item) => item.name)).toEqual([
      '唐团团', '宋知夏', '苏念栀', 'Rosalind Vane', '霍聿深', '沈砚', 'Caleb Moore',
    ]);
    expect(presets.every((item) => item.tagline && item.creator.includes('Foreverse'))).toBe(true);
    expect(presets.find((item) => item.name === '沈砚')?.gender).toBe('male');
  });
});

describe('imported character cards', () => {
  const json = (data: Record<string, unknown>) => Buffer.from(JSON.stringify({ spec: 'chara_card_v2', data }));

  it('stores the original file, guesses gender, and lets the user fix it', () => {
    const library = tempDir();
    const result = importCharacter(library, json({ name: '阿哲', description: '他是一名消防员，他很少说话。' }), 'azhe.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.gender).toBe('male');
    expect(existsSync(result.entry.file)).toBe(true);

    expect(updateImportedGender(library, result.entry.id, 'female')).toBe(true);
    expect(loadImportedCharacters(library)[0].gender).toBe('female');

    removeImportedCharacter(library, result.entry.id);
    expect(loadImportedCharacters(library)).toEqual([]);
  });

  it('importing the same file twice keeps one copy', () => {
    const library = tempDir();
    const bytes = json({ name: '小满', description: '她在花店打工。' });
    importCharacter(library, bytes, 'a.json');
    importCharacter(library, bytes, 'b.json');
    expect(loadImportedCharacters(library)).toHaveLength(1);
  });

  it('reports why a file cannot be imported', () => {
    expect(importCharacter(tempDir(), Buffer.from('not a card'), 'x.txt')).toEqual({ ok: false, reason: 'unsupported_file' });
  });

  it('guesses female when the text does not say', () => {
    expect(guessGender(toCharacterCard({ name: 'X', description: 'A barista.' })!)).toBe('female');
    expect(guessGender(toCharacterCard({ name: 'X', description: 'He fixes cars. His hands are rough.' })!)).toBe('male');
  });
});

describe('which character is in use', () => {
  it('remembers the selection and whether it was written into OpenClaw', () => {
    const file = join(tempDir(), 'nested', 'state.json');
    expect(loadCompanionState(file)).toEqual({ selection: null, appliedAt: '' });
    saveCompanionState(file, { selection: { characterId: null, gender: 'male' }, appliedAt: '' });
    expect(loadCompanionState(file).selection).toEqual({ characterId: null, gender: 'male' });
  });

  it('keeps one memory per character, and one per gender when no character is chosen', () => {
    expect(memoryKey({ characterId: 'preset-shenyan', gender: 'male' })).toBe('preset-shenyan');
    expect(memoryKey({ characterId: null, gender: 'female' })).toBe('free-female');
  });
});
