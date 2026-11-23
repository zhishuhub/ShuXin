#!/usr/bin/env node
/**
 * 枢心托盘图标：在应用图标右下角加一个状态圆点（绿 = 在线，黄 = 连接中 / 未绑定，红 = 要处理）。
 * 先跑 `pnpm icons` 生成 icon.png，再跑本脚本。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ICONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icons');
const SIZE = 64;
const DOT = 26;

const variants = {
  'tray-online.png': '#22C55E',
  'tray-warning.png': '#F59E0B',
  'tray-error.png': '#EF4444',
};

const base = await sharp(path.join(ICONS_DIR, 'icon.png')).resize(SIZE, SIZE).png().toBuffer();

for (const [file, color] of Object.entries(variants)) {
  const r = DOT / 2;
  const dot = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DOT}" height="${DOT}"><circle cx="${r}" cy="${r}" r="${r - 2}" fill="${color}" stroke="#FFFFFF" stroke-width="4"/></svg>`,
  );
  await sharp(base)
    .composite([{ input: dot, left: SIZE - DOT, top: SIZE - DOT }])
    .png()
    .toFile(path.join(ICONS_DIR, file));
  console.log(`created ${file}`);
}
