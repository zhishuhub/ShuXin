/** 枢心界面和主进程共用的类型。 */

export type CompanionGender = 'female' | 'male';

/**
 * 当前选择。characterId 为空表示不选角色，由对方第一次聊天时自己定人设；
 * gender 决定用女友还是男友技能。
 */
export interface CompanionSelection {
  characterId: string | null;
  gender: CompanionGender;
}

export type CompanionLinkState = 'not_bound' | 'online' | 'connecting' | 'needs_rescan' | 'offline';

export interface CharacterView {
  id: string;
  source: 'preset' | 'imported';
  name: string;
  tagline: string;
  gender: CompanionGender;
  creator: string;
  /** 头像缩略图（data URL）；JSON 卡没有头像时为空。 */
  avatar: string;
}

export interface ShuxinOverview {
  connected: boolean;
  userName: string;
  siteOrigin: string;
  balance: string;
  message: string;
  selection: CompanionSelection | null;
  character: CharacterView | null;
  link: CompanionLinkState;
  version: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export type CardImportFailure = 'unsupported_file' | 'no_card_data' | 'invalid_card';

export type ImportCardResponse =
  | { ok: true; character: CharacterView }
  | { ok: false; reason: CardImportFailure | string };
