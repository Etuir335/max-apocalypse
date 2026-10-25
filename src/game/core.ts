// Базовые помощники движка: случайность, карты по id, поле, дальность, журнал.
import { CHARACTERS } from './data/characters.ts'
import { FIND_CARDS } from './data/finds.ts'
import { MONSTERS } from './data/monsters.ts'
import { SURVIVOR_CARDS } from './data/survivor.ts'
import { TILES } from './data/tiles.ts'
import type { CardDef, GameState, MonsterDef, PlayerState, Range, TileDef, TileInst, XY } from './types.ts'

export class GameError extends Error {}
export const fail = (msg: string): never => {
  throw new GameError(msg)
}
export const check = (cond: unknown, msg: string) => {
  if (!cond) fail(msg)
}

// ---------- Случайность (детерминированная, состояние в state.rng) ----------

export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export const randInt = (s: GameState, n: number) => Math.floor(rand(s) * n)
export const roll2d6 = (s: GameState) => 2 + randInt(s, 6) + randInt(s, 6)
export function shuffle<T>(s: GameState, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1)
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

// ---------- Карты: id экземпляра = "ключ:картинка:номер" ----------

const cardMap = new Map<string, CardDef>([...SURVIVOR_CARDS, ...FIND_CARDS].map((c) => [c.key, c]))
const monsterMap = new Map<string, MonsterDef>(MONSTERS.map((m) => [m.key, m]))
const tileMap = new Map<string, TileDef>(TILES.map((t) => [t.key, t]))

export const keyOf = (id: string) => id.split(':')[0]
export const imageOf = (id: string) => Number(id.split(':')[1])
export const makeId = (s: GameState, key: string, image: number) => `${key}:${image}:${++s.serial}`

export function cardDef(id: string): CardDef {
  return cardMap.get(keyOf(id)) ?? fail(`Неизвестная карта ${id}`)
}
export function monsterDef(id: string): MonsterDef {
  return monsterMap.get(keyOf(id)) ?? fail(`Неизвестный монстр ${id}`)
}
export function tileDef(t: TileInst | string): TileDef {
  const key = typeof t === 'string' ? t : t.key
  return tileMap.get(key) ?? fail(`Неизвестный тайл ${key}`)
}
export const charDef = (p: PlayerState) => CHARACTERS.find((c) => c.key === p.hero) ?? fail(`Нет персонажа ${p.hero}`)
export const isCard = (id: string) => cardMap.has(keyOf(id))
export const allCardDefs = () => [...cardMap.values()]

// ---------- Журнал ----------

export function log(s: GameState, msg: string) {
  s.log.push(msg)
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40)
}

// ---------- Поле ----------

export const same = (a: XY, b: XY) => a.x === b.x && a.y === b.y
export const dist = (a: XY, b: XY) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
export const tileAt = (s: GameState, p: XY) => s.tiles.find((t) => t.x === p.x && t.y === p.y)
export const DIRS: XY[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]
export const neighbors = (s: GameState, p: XY) =>
  DIRS.map((d) => tileAt(s, { x: p.x + d.x, y: p.y + d.y })).filter((t): t is TileInst => !!t)

/** Короткая — свой тайл; средняя — свой и ортогональные соседи; дальняя — 1–2 шага (с диагональю), но не свой. */
export function inRange(from: XY, to: XY, range: Range): boolean {
  const d = dist(from, to)
  if (range === 'short') return d === 0
  if (range === 'medium') return d <= 1
  return d >= 1 && d <= 2
}
export const tilesInRange = (s: GameState, from: XY, range: Range) => s.tiles.filter((t) => inRange(from, t, range))

export const findTile = (s: GameState, key: string) => s.tiles.find((t) => t.key === key)
export const markersOnBoard = (s: GameState) => s.tiles.reduce((n, t) => n + t.markers, 0)
export const MAX_MARKERS = 30
export const MAX_MARKERS_PER_TILE = 3

// ---------- Игроки ----------

export const living = (s: GameState) => s.players.filter((p) => p.alive)
export const playersAt = (s: GameState, pos: XY) => s.players.filter((p) => p.alive && same(p.pos, pos))
export const mainFigure = (p: PlayerState) => p.figures.find((f) => f.alive && !f.companion) ?? p.figures.find((f) => f.alive)
export const companion = (p: PlayerState) => p.figures.find((f) => f.companion)
export const companionAlive = (p: PlayerState) => !!companion(p)?.alive

/** Владелец монстра по id экземпляра */
export function monsterOwner(s: GameState, id: string): { p: PlayerState; idx: number } | null {
  for (const p of s.players) {
    const idx = p.monsters.findIndex((m) => m.id === id)
    if (idx >= 0) return { p, idx }
  }
  return null
}

export const equipDef = (id: string) => cardDef(id).gear ?? fail('Это не снаряжение')
export const hasPassive = (p: PlayerState, flag: keyof NonNullable<NonNullable<CardDef['gear']>['passive']>) =>
  p.equip.filter((e) => !!cardDef(e.id).gear?.passive?.[flag])

export function slotsUsed(p: PlayerState) {
  return p.equip.reduce((n, e) => n + (cardDef(e.id).gear?.slots ?? 0), 0)
}
export function slotsTotal(p: PlayerState) {
  const base = p.figures.reduce((n, f) => n + (f.alive ? f.slots : 0), 0)
  return base + p.equip.reduce((n, e) => n + (cardDef(e.id).gear?.passive?.extraSlots ?? 0), 0)
}

export function stealthOf(p: PlayerState): number {
  const ch = charDef(p)
  let best = Infinity
  ch.figures.forEach((fd, i) => {
    if (!p.figures[i].alive) return
    best = Math.min(best, p.exhausted ? fd.stealthTired : fd.stealth)
  })
  return best + p.equip.reduce((n, e) => n + (cardDef(e.id).gear?.passive?.stealthBonus ?? 0), 0)
}
