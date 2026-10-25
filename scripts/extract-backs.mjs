// Нарезка обратных сторон карт (рубашек) из JSON Tabletop Simulator.
// Запуск из D:\max-apocalypse\:  node scripts/extract-backs.mjs
// Читает уже скачанные листы из data/_sprites (не изменяя data/), новые качает в .cache/sprites.
// Результат: public/assets/cards/<папка>/<cardId>_back.webp (уникальные рубашки)
//            public/assets/cards/<папка>/_back.webp (общая рубашка колоды)
//            public/assets/cards/backs.json  { "<cardId>": "assets/cards/..." }

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const OLD_SPRITES = path.join(DATA, '_sprites');
const CACHE = path.join(ROOT, '.cache', 'sprites');
const OUT = path.join(ROOT, 'public', 'assets', 'cards');
const FILES = ['Perons.json', 'Scene.json', 'Main objects.json'];
const CARD_WIDTH = 500;

const cleanUrl = (u) => String(u || '').trim().replace(/^\{[^}]*\}/, '');

const cards = JSON.parse(await fs.readFile(path.join(OUT, 'cards.json'), 'utf8'));
const specOf = new Map(); // cardId -> CustomDeck spec

function walk(obj, inherited) {
  if (!obj || typeof obj !== 'object') return;
  const decks = { ...inherited };
  if (obj.CustomDeck) Object.assign(decks, obj.CustomDeck);
  const add = (id) => {
    const spec = decks[String(Math.floor(id / 100))];
    if (spec && spec.BackURL && !specOf.has(id)) specOf.set(id, spec);
  };
  if (typeof obj.CardID === 'number' && (obj.Name || '').startsWith('Card')) add(obj.CardID);
  if (Array.isArray(obj.DeckIDs)) obj.DeckIDs.forEach(add);
  for (const child of obj.ContainedObjects || []) walk(child, decks);
  if (obj.States) for (const s of Object.values(obj.States)) walk(s, decks);
}

async function loadSheet(url) {
  const name = createHash('md5').update(url).digest('hex').slice(0, 12) + '.img';
  for (const dir of [OLD_SPRITES, CACHE]) {
    try { return await fs.readFile(path.join(dir, name)); } catch {}
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(path.join(CACHE, name), buf);
  return buf;
}

async function main() {
  for (const f of FILES) {
    let raw;
    try { raw = await fs.readFile(path.join(DATA, f), 'utf8'); } catch { continue; }
    const root = JSON.parse(raw.replace(/^\uFEFF/, ''));
    for (const o of root.ObjectStates ?? (Array.isArray(root) ? root : [root])) walk(o, {});
  }

  const backs = {};
  const sharedDone = new Set();
  let unique = 0, shared = 0, errors = 0;

  for (const card of cards) {
    const spec = specOf.get(card.cardId);
    if (!spec) continue;
    const url = cleanUrl(spec.BackURL);
    try {
      const buf = await loadSheet(url);
      if (spec.UniqueBack) {
        const numW = spec.NumWidth || 10, numH = spec.NumHeight || 7;
        const { width, height } = await sharp(buf).metadata();
        const tileW = Math.floor(width / numW), tileH = Math.floor(height / numH);
        const i = card.cardId % 100;
        const file = `${card.cardId}_back.webp`;
        await sharp(buf)
          .extract({ left: (i % numW) * tileW, top: Math.floor(i / numW) * tileH, width: tileW, height: tileH })
          .resize({ width: CARD_WIDTH, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(path.join(OUT, card.deck, file));
        backs[card.cardId] = `assets/cards/${card.deck}/${file}`;
        unique++;
      } else {
        const file = '_back.webp';
        const key = `${card.deck}|${url}`;
        if (!sharedDone.has(key)) {
          await sharp(buf).resize({ width: CARD_WIDTH, withoutEnlargement: true }).webp({ quality: 82 })
            .toFile(path.join(OUT, card.deck, file));
          sharedDone.add(key);
          shared++;
        }
        backs[card.cardId] = `assets/cards/${card.deck}/${file}`;
      }
    } catch (e) {
      errors++;
      console.log(`ОШИБКА ${card.id}: ${e.message}`);
    }
  }

  await fs.writeFile(path.join(OUT, 'backs.json'), JSON.stringify(backs, null, 2), 'utf8');
  console.log(`Готово: уникальных рубашек ${unique}, общих ${shared}, ошибок ${errors}. Список: public/assets/cards/backs.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
