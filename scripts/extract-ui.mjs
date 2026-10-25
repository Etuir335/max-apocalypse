// Картинки интерфейса из мода TTS: планшет игрока, планшет находок, жетоны, фигурки персонажей.
// Запуск из D:\max-apocalypse\:  node scripts/extract-ui.mjs
// Скачанные исходники кэшируются в .cache/ui. Результат — public/assets/ui/.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const ROOT = process.cwd()
const CACHE = path.join(ROOT, '.cache', 'ui')
const OUT = path.join(ROOT, 'public', 'assets', 'ui')
const clean = (u) => String(u || '').trim().replace(/^\{[^}]*\}/, '')

// Что брать: адрес картинки (хвост) → имя файла и ширина
const WANT = [
  ['A70B48DF100AB89A7893D6F2482CBEA30907B1AE', 'board-player.webp', 2000],
  ['3E52780FAC83BC9294DB149FBDFCBE76C596A2F7', 'board-finds.webp', 1200],
  ['C46800781F174270897B26A1EB721F8908CE320E', 'token-marker.webp', 160],
  ['942CE371E37061FB6E84CE9FD2465788BBEF2708', 'token-star.webp', 100],
  ['2B87FC3457B467D0E7D2799127A2F46D5A6A76E9', 'token-poison.webp', 100],
]
// Фигурки по порядку в Perons.json → ключ персонажа
const FIGURES = ['surgeon', 'firefighter', 'veteranF', 'veteran', 'surgeonM', 'mechanicF', 'mechanicM', 'firefighterF', 'hunterM', 'hunterF', 'gunslinger', 'gunslingerF']

async function get(url) {
  const file = path.join(CACHE, createHash('md5').update(url).digest('hex').slice(0, 12) + '.img')
  try {
    return await fs.readFile(file)
  } catch {}
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.mkdir(CACHE, { recursive: true })
  await fs.writeFile(file, buf)
  return buf
}

function collect(obj, out) {
  if (!obj || typeof obj !== 'object') return
  if (obj.CustomImage) out.push({ name: obj.Name, url: clean(obj.CustomImage.ImageURL) })
  for (const c of obj.ContainedObjects || []) collect(c, out)
  if (obj.States) for (const s of Object.values(obj.States)) collect(s, out)
}

const found = []
for (const f of ['Scene.json', 'Perons.json']) {
  const raw = await fs.readFile(path.join(ROOT, 'data', f), 'utf8')
  const root = JSON.parse(raw.replace(/^\uFEFF/, ''))
  for (const o of root.ObjectStates ?? [root]) collect(o, found)
}

await fs.mkdir(path.join(OUT, 'fig'), { recursive: true })
for (const [tail, name, width] of WANT) {
  const it = found.find((x) => x.url.includes(tail))
  if (!it) {
    console.log(`Не найдено: ${name}`)
    continue
  }
  await sharp(await get(it.url)).resize({ width, withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(OUT, name))
  console.log(`OK ${name}`)
}
const figs = [...new Map(found.filter((x) => x.name === 'Figurine_Custom').map((x) => [x.url, x])).values()]
for (let i = 0; i < figs.length && i < FIGURES.length; i++) {
  await sharp(await get(figs[i].url)).webp({ quality: 85 }).toFile(path.join(OUT, 'fig', `${FIGURES[i]}.webp`))
}
console.log(`Фигурок: ${Math.min(figs.length, FIGURES.length)}`)
