// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  extractPngCardText,
  readCharacterCard,
  replaceCardMacros,
  renderPersonaMarkdown,
  toCharacterCard,
} from '@electron/shuxin/character-card';

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  // 读卡时不校验 CRC，测试里写 0
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

function pngWithText(entries: Record<string, string>): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk('IHDR', Buffer.alloc(13));
  const texts = Object.entries(entries).map(([keyword, value]) =>
    chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')])),
  );
  return Buffer.concat([signature, ihdr, ...texts, chunk('IEND', Buffer.alloc(0))]);
}

const v2Card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '林夏',
    description: '{{char}}是一名插画师，住在杭州。她会叫{{user}}“笨蛋”。',
    personality: '温柔，偶尔毒舌',
    scenario: '{{user}}和{{char}}在一次画展认识。',
    first_mes: '*她抬头看了你一眼* 你也喜欢这幅画吗？',
    alternate_greetings: ['又见面啦'],
    mes_example: '<START>\n{{user}}: 在干嘛\n{{char}}: 画画呀',
    creator: 'someone',
    tags: ['romance', 'slice of life'],
    character_book: {
      entries: [
        { keys: ['猫'], content: '{{char}}养了一只橘猫叫团子。', enabled: true },
        { keys: ['旧事'], content: '这条被作者关掉了', enabled: false },
      ],
    },
  },
};

function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

describe('reading SillyTavern character cards', () => {
  it('reads a v2 card embedded in a PNG avatar and keeps the image', () => {
    const png = pngWithText({ chara: base64Json(v2Card) });
    const result = readCharacterCard(png, 'linxia.png');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.name).toBe('林夏');
    expect(result.card.alternateGreetings).toEqual(['又见面啦']);
    expect(result.card.lore).toEqual([{ keys: ['猫'], content: '{{char}}养了一只橘猫叫团子。' }]);
    expect(result.avatarPng?.equals(png)).toBe(true);
  });

  it('prefers the v3 data when a PNG carries both v3 and v2', () => {
    const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data: { ...v2Card.data, name: '林夏 v3' } };
    const png = pngWithText({ chara: base64Json(v2Card), ccv3: base64Json(v3) });
    expect(JSON.parse(extractPngCardText(png) ?? '{}').data.name).toBe('林夏 v3');
  });

  it('reads a v1 JSON card with fields at the top level', () => {
    const json = Buffer.from(JSON.stringify({ name: 'Aki', description: 'A barista.', first_mes: 'Hi!' }));
    const result = readCharacterCard(json, 'aki.json');
    expect(result.ok && result.card.firstMessage).toBe('Hi!');
  });

  it('tells apart a plain picture, a broken card and an unsupported file', () => {
    expect(readCharacterCard(pngWithText({ Software: 'paint' }), 'photo.png')).toEqual({
      ok: false,
      reason: 'no_card_data',
    });
    expect(readCharacterCard(Buffer.from('{"name":'), 'x.json')).toEqual({ ok: false, reason: 'invalid_card' });
    expect(readCharacterCard(Buffer.from('hello'), 'notes.txt')).toEqual({ ok: false, reason: 'unsupported_file' });
  });

  it('refuses JSON that has no character name', () => {
    expect(toCharacterCard({ spec: 'chara_card_v2', data: { description: 'no name' } })).toBeNull();
  });
});

describe('turning a card into a persona', () => {
  it('replaces SillyTavern placeholders and keeps the rest of the text as written', () => {
    const text = '{{char}} loves tea. Never break character. She smiles at <USER>.';
    expect(replaceCardMacros(text, 'Aki')).toBe('Aki loves tea. Never break character. She smiles at 你.');
    expect(replaceCardMacros('{{random::a::b}}好', '林夏')).toBe('好');
  });

  it('writes the persona in chat style', () => {
    const card = toCharacterCard(v2Card);
    expect(card).not.toBeNull();
    const persona = renderPersonaMarkdown(card!);
    expect(persona).toContain('# 你是林夏');
    expect(persona).toContain('林夏是一名插画师，住在杭州。她会叫你“笨蛋”。');
    expect(persona).toContain('- 猫：林夏养了一只橘猫叫团子。');
    expect(persona).not.toContain('这条被作者关掉了');
    expect(persona).not.toContain('<START>');
    expect(persona).toContain('改写成一两句微信消息');
    expect(persona).toContain('<!-- 角色卡作者：someone -->');
  });

  it('turns the styled HTML greetings of "beautified" cards into plain chat text', () => {
    const card = toCharacterCard({
      name: '唐团团',
      first_mes: '<style>.x{color:red}</style><div style="border-radius:14px">🥐 团团面包屋</div><p>"来啦&nbsp;六点半先生！"</p><br>{{user}}进门了',
    });
    const persona = renderPersonaMarkdown(card!);
    expect(persona).toContain('🥐 团团面包屋\n"来啦 六点半先生！"');
    expect(persona).toContain('你进门了');
    expect(persona).not.toMatch(/<div|<style|color:red/);
  });

  it('caps the background notes so cards with many entries stay short', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ keys: [`k${i}`], content: 'x'.repeat(400) }));
    const persona = renderPersonaMarkdown(toCharacterCard({ name: 'Lore', character_book: { entries } })!);
    const loreSection = persona.slice(persona.indexOf('## 背景资料'));
    expect((loreSection.match(/^- k/gm) ?? []).length).toBeLessThan(10);
  });

  it('keeps very long cards short enough to send every turn', () => {
    const card = toCharacterCard({ name: 'Long', description: 'x'.repeat(20000) });
    const persona = renderPersonaMarkdown(card!);
    expect(persona.length).toBeLessThan(4000);
    expect(persona).toContain('…');
  });
});
