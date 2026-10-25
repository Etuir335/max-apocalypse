// Нарезка карт из JSON Tabletop Simulator.
// Запуск из D:\max-apocalypse\:  node scripts/extract-assets.mjs
// Нужно: Node.js 18+ и пакет sharp (npm i sharp)

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const SPRITES = path.join(DATA, '_sprites');
const OUT = path.join(ROOT, 'public', 'assets', 'cards');
const FILES = ['Perons.json', 'Scene.json', 'Main objects.json'];
const CARD_WIDTH = 500; // ширина карты в пикселях после уменьшения

// Спрайт-листы: ключ = ссылка + сетка
const sheets = new Map();
let missing = 0;

const cleanUrl = (u) => String(u || '').trim().replace(/^\{[^}]*\}/, '');
const slug = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
    .toLowerCase();

function addCard(id, decks, info, label, file) {
  const key = String(Math.floor(id / 100));
  const spec = decks[key];
  if (!spec || !spec.FaceURL) { missing++; return; }
  const url = cleanUrl(spec.FaceURL);
  const numW = spec.NumWidth || 10;
  const numH = spec.NumHeight || 7;
  const sheetKey = `${url}|${numW}x${numH}`;
  let sheet = sheets.get(sheetKey);
  if (!sheet) {
    sheet = { url, numW, numH, label, file, cards: new Map() };
    sheets.set(sheetKey, sheet);
  }
  if (info) sheet.cards.set(id, info);
  else if (!sheet.cards.has(id)) sheet.cards.set(id, { name: '', description: '', guid: '' });
}

function walk(obj, inherited, ctx) {
  if (!obj || typeof obj !== 'object') return;
  const decks = { ...inherited };
  if (obj.CustomDeck) Object.assign(decks, obj.CustomDeck);
  const name = obj.Name || '';
  const label = name.startsWith('Deck') ? (obj.Nickname || obj.GUID || ctx.label) : ctx.label;

  if (typeof obj.CardID === 'number' && name.startsWith('Card')) {
    addCard(obj.CardID, decks, {
      name: obj.Nickname || '',
      description: obj.Description || '',
      guid: obj.GUID || '',
    }, label || obj.Nickname || 'single', ctx.file);
  }
  if (Array.isArray(obj.DeckIDs)) {
    for (const id of obj.DeckIDs) addCard(id, decks, null, label, ctx.file);
  }
  for (const child of obj.ContainedObjects || []) walk(child, decks, { ...ctx, label });
  if (obj.States) for (const s of Object.values(obj.States)) walk(s, decks, { ...ctx, label });
}

async function loadSheet(url) {
  const name = createHash('md5').update(url).digest('hex').slice(0, 12);
  const file = path.join(SPRITES, `${name}.img`);
  try { return await fs.readFile(file); } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(file, buf);
  return buf;
}

async function main() {
  await fs.mkdir(SPRITES, { recursive: true });
  await fs.mkdir(OUT, { recursive: true });

  for (const f of FILES) {
    let raw;
    try { raw = await fs.readFile(path.join(DATA, f), 'utf8'); }
    catch { console.log(`Нет файла: data/${f}`); continue; }
    const root = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const list = root.ObjectStates ?? (Array.isArray(root) ? root : [root]);
    for (const o of list) walk(o, {}, { file: f, label: '' });
  }

  console.log(`Найдено спрайт-листов: ${sheets.size}`);
  const index = [];
  let n = 0, total = 0;

  for (const sheet of sheets.values()) {
    n++;
    const folder = `${String(n).padStart(2, '0')}_${slug(sheet.label) || 'deck'}`;
    try {
      const buf = await loadSheet(sheet.url);
      const { width, height } = await sharp(buf).metadata();
      const tileW = Math.floor(width / sheet.numW);
      const tileH = Math.floor(height / sheet.numH);
      await fs.mkdir(path.join(OUT, folder), { recursive: true });

      let count = 0;
      for (const [id, info] of sheet.cards) {
        const i = id % 100;
        const col = i % sheet.numW;
        const row = Math.floor(i / sheet.numW);
        if (row >= sheet.numH) continue;
        await sharp(buf)
          .extract({ left: col * tileW, top: row * tileH, width: tileW, height: tileH })
          .resize({ width: CARD_WIDTH, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(path.join(OUT, folder, `${id}.webp`));
        index.push({
          id: `${folder}/${id}`,
          deck: folder,
          deckName: sheet.label,
          cardId: id,
          name: info.name,
          description: info.description,
          guid: info.guid,
          image: `assets/cards/${folder}/${id}.webp`,
          source: sheet.file,
        });
        count++;
      }
      total += count;
      console.log(`OK   ${folder}  (${sheet.label || 'без названия'})  ${count} карт`);
    } catch (e) {
      console.log(`ОШИБКА  ${folder}: ${e.message}`);
    }
  }

  await fs.writeFile(path.join(OUT, 'cards.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log(`Готово: ${total} карт. Список: public/assets/cards/cards.json`);
  if (missing) console.log(`Пропущено карт без данных колоды: ${missing}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
