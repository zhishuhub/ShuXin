/**
 * 枢心：读取酒馆（SillyTavern）角色卡，转换成枢心用的人设。
 *
 * 角色卡有两种文件形态：
 * - PNG 头像，图里的 tEXt 块存着 base64 编码的 JSON（v3 关键字 ccv3，v2/v1 关键字 chara）；
 * - 直接是 JSON 文件。
 * JSON 有三代格式：v1 字段平铺在顶层；v2（spec = chara_card_v2）和 v3（spec = chara_card_v3）字段放在 data 里。
 *
 * 卡的内容原样使用，只换掉酒馆的占位符、截短过长的字段。内容安全交给模型和站点处理，这里不做过滤。
 */

export interface CharacterLoreEntry {
  keys: string[];
  content: string;
}

export interface CharacterCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  alternateGreetings: string[];
  exampleDialogues: string;
  creator: string;
  creatorNotes: string;
  tags: string[];
  lore: CharacterLoreEntry[];
}

export type CardImportFailure = 'unsupported_file' | 'no_card_data' | 'invalid_card';

export type CardImportResult =
  | { ok: true; card: CharacterCard; avatarPng?: Buffer }
  | { ok: false; reason: CardImportFailure };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 人设每轮对话都要带上，卡里的字段可能上万字，按这些上限截断，免得每句话都多花钱。 */
const LIMITS = {
  name: 40,
  description: 2400,
  personality: 800,
  scenario: 800,
  greeting: 600,
  examples: 1500,
  loreEntries: 20,
  loreEntry: 500,
  loreTotal: 3000,
} as const;

export function isPng(bytes: Buffer): boolean {
  return bytes.length > PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/**
 * 从 PNG 里取出角色卡 JSON 文本。同一张图里 v3 和 v2 都有时用 v3。
 * 只认 tEXt 和不压缩的 iTXt；压缩的 iTXt 酒馆不会写，遇到就跳过。
 */
export function extractPngCardText(bytes: Buffer): string | null {
  if (!isPng(bytes)) return null;
  const found: Record<string, string> = {};
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'tEXt') {
      const zero = data.indexOf(0);
      if (zero > 0) {
        const keyword = data.toString('latin1', 0, zero).toLowerCase();
        found[keyword] = data.toString('latin1', zero + 1);
      }
    } else if (type === 'iTXt') {
      const zero = data.indexOf(0);
      if (zero > 0 && data[zero + 1] === 0) {
        const keyword = data.toString('latin1', 0, zero).toLowerCase();
        // 关键字\0 压缩标志 压缩方法 语言\0 翻译关键字\0 正文
        const langEnd = data.indexOf(0, zero + 3);
        const translatedEnd = langEnd >= 0 ? data.indexOf(0, langEnd + 1) : -1;
        if (translatedEnd >= 0) found[keyword] = data.toString('utf8', translatedEnd + 1);
      }
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  const encoded = found.ccv3 ?? found.chara;
  if (!encoded) return null;
  const trimmed = encoded.trim();
  // 酒馆写的是 base64；也见过直接写 JSON 的
  if (trimmed.startsWith('{')) return trimmed;
  return Buffer.from(trimmed, 'base64').toString('utf8');
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asText).filter(Boolean);
}

/** 把 v1 / v2 / v3 的 JSON 统一成 CharacterCard；连名字都没有的不算角色卡。 */
export function toCharacterCard(json: unknown): CharacterCard | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const data =
    root.data && typeof root.data === 'object' && (root.spec === 'chara_card_v2' || root.spec === 'chara_card_v3')
      ? (root.data as Record<string, unknown>)
      : root;
  const name = asText(data.name);
  if (!name) return null;

  const book =
    data.character_book && typeof data.character_book === 'object'
      ? (data.character_book as Record<string, unknown>)
      : null;
  const lore: CharacterLoreEntry[] = [];
  if (book && Array.isArray(book.entries)) {
    for (const entry of book.entries) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      if (item.enabled === false) continue;
      const content = asText(item.content);
      if (!content) continue;
      lore.push({ keys: asTextList(item.keys), content });
    }
  }

  return {
    name,
    description: asText(data.description),
    personality: asText(data.personality),
    scenario: asText(data.scenario),
    firstMessage: asText(data.first_mes),
    alternateGreetings: asTextList(data.alternate_greetings),
    exampleDialogues: asText(data.mes_example),
    creator: asText(data.creator),
    creatorNotes: asText(data.creator_notes),
    tags: asTextList(data.tags),
    lore,
  };
}

const HTML_ENTITIES: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

/**
 * 酒馆的「美化」卡会把开场白写成带样式的 HTML，微信里只能发纯文字：去掉样式和标签，块级标签换成换行。
 */
export function htmlToText(text: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(text)) return text;
  return text
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|blockquote)>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      const lower = code.toLowerCase();
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
      return HTML_ENTITIES[lower] ?? entity;
    })
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
}

/**
 * 换掉酒馆的占位符：{{char}} / <BOT> 换成角色名，{{user}} / <USER> 换成「你」（不知道对方名字时），
 * 其余 {{...}} 宏（随机词之类）在微信里用不上，去掉。
 */
export function replaceCardMacros(text: string, charName: string, userName = '你'): string {
  return text
    .replace(/\{\{\s*char\s*\}\}|<bot>/gi, charName)
    .replace(/\{\{\s*user\s*\}\}|<user>/gi, userName)
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/** 读一张角色卡文件（PNG 或 JSON）。 */
export function readCharacterCard(bytes: Buffer, fileName: string): CardImportResult {
  let jsonText: string | null;
  let avatarPng: Buffer | undefined;
  if (isPng(bytes)) {
    jsonText = extractPngCardText(bytes);
    if (!jsonText) return { ok: false, reason: 'no_card_data' };
    avatarPng = bytes;
  } else if (
    fileName.toLowerCase().endsWith('.json') ||
    bytes.subarray(0, 64).toString('utf8').trimStart().startsWith('{')
  ) {
    jsonText = bytes.toString('utf8').replace(/^\uFEFF/, '');
  } else {
    return { ok: false, reason: 'unsupported_file' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, reason: 'invalid_card' };
  }
  const card = toCharacterCard(parsed);
  if (!card) return { ok: false, reason: 'invalid_card' };
  return avatarPng ? { ok: true, card, avatarPng } : { ok: true, card };
}

/** 挑一句开场白：有正式开场白用它，没有就用备选里的第一句。 */
export function pickGreeting(card: CharacterCard): string {
  return card.firstMessage || card.alternateGreetings[0] || '';
}

/**
 * 生成写进 OpenClaw 人设文件（SOUL.md）的内容：一段说明在微信里怎么聊，加上卡的原文。
 * 英文卡也保留原文，让模型自己理解，再要求跟着对方的语言聊。
 */
export function renderPersonaMarkdown(card: CharacterCard, userName = '你'): string {
  const name = clip(card.name, LIMITS.name);
  // <USER> / <BOT> 长得像 HTML 标签，先换掉再去标签
  const text = (value: string, max: number) =>
    clip(
      replaceCardMacros(htmlToText(value.replace(/<bot>/gi, name).replace(/<user>/gi, userName)), name, userName),
      max,
    );
  const sections: string[] = [];

  sections.push(`# 你是${name}`);
  sections.push(
    [
      `你在微信里和对方聊天，你的身份是「${name}」。下面是这个角色的设定，聊天时按它来说话、做事。`,
      '设定里如果有剧本式的动作描写（比如用星号包起来的动作）或者大段旁白，聊天时不要照搬，改成平时发微信的样子：短句、口语，一次说一两句。',
      '对方用什么语言就用什么语言回；对方说中文时用中文，哪怕下面的设定是英文。',
    ].join('\n'),
  );

  const description = text(card.description, LIMITS.description);
  if (description) sections.push(`## 人物设定\n\n${description}`);
  const personality = text(card.personality, LIMITS.personality);
  if (personality) sections.push(`## 性格\n\n${personality}`);
  const scenario = text(card.scenario, LIMITS.scenario);
  if (scenario) sections.push(`## 你们的相处背景\n\n${scenario}`);

  const lore: string[] = [];
  let loreLength = 0;
  for (const entry of card.lore.slice(0, LIMITS.loreEntries)) {
    const content = text(entry.content, LIMITS.loreEntry);
    if (!content) continue;
    const line = entry.keys.length ? `- ${entry.keys.slice(0, 4).join(' / ')}：${content}` : `- ${content}`;
    if (loreLength + line.length > LIMITS.loreTotal) break;
    lore.push(line);
    loreLength += line.length;
  }
  if (lore.length) sections.push(`## 背景资料\n\n聊到相关话题时参考：\n\n${lore.join('\n')}`);

  const examples = text(card.exampleDialogues.replace(/<START>/gi, '\n---\n'), LIMITS.examples);
  if (examples) sections.push(`## 说话方式示例\n\n只学语气和用词，不要原样重复：\n\n${examples}`);

  const greeting = text(pickGreeting(card), LIMITS.greeting);
  if (greeting) {
    sections.push(`## 开场白参考\n\n第一次和对方说话时，参考下面这段的意思，改写成一两句微信消息：\n\n${greeting}`);
  }

  if (card.creator) sections.push(`<!-- 角色卡作者：${clip(card.creator, 60)} -->`);

  return `${sections.join('\n\n')}\n`;
}
