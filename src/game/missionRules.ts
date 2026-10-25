// Правила миссий: поле, маркеры целей, боссы, сдача предметов, особые действия, победа.
import { MONSTERS } from './data/monsters.ts'
import { missionById } from './data/missions.ts'
import { TILES } from './data/tiles.ts'
import { FIND_CARDS } from './data/finds.ts'
import {
  DIRS,
  cardDef,
  check,
  dist,
  findTile,
  keyOf,
  living,
  log,
  makeId,
  neighbors,
  randInt,
  same,
  shuffle,
  tileAt,
  tileDef,
} from './core.ts'
import {
  attractMarkers,
  equip,
  gainFind,
  lose,
  revealTile,
  stealthCheck,
  takeMonster,
  unequip,
  win,
  enterTile,
  checkHand,
} from './rules.ts'
import type { GameState, MonsterDef, PlayerState, TileInst, XY } from './types.ts'

const mission = (s: GameState) => missionById(s.missionId)
const num = (s: GameState) => mission(s).num

// ---------- Поле ----------

/** Выбор тайлов по списку с рубашки миссии и раскладка сеткой. */
export function buildBoard(s: GameState) {
  const m = mission(s)
  const pool = new Map<string, string[]>()
  for (const t of TILES) if (t.key !== 'van') pool.set(t.name, [...(pool.get(t.name) ?? []), t.key])
  const keys: string[] = []
  for (const [name, count] of m.tiles) {
    const list = shuffle(s, [...(pool.get(name) ?? [])])
    keys.push(...list.slice(0, count))
  }
  shuffle(s, keys)
  const n = keys.length + (m.num === 6 ? 1 : 0)
  // Форма поля каждый раз своя: случайная ширина, неполный ряд сверху или снизу, его тайлы — в случайных местах
  const w = Math.ceil(Math.sqrt(n)) + (n > 6 ? randInt(s, 2) : 0)
  const h = Math.ceil(n / w)
  const rest = n - w * (h - 1)
  const partialTop = randInt(s, 2) === 1
  const partialY = partialTop ? 0 : h - 1
  const restXs = shuffle(s, Array.from({ length: w }, (_, i) => i)).slice(0, rest)
  const cells: XY[] = []
  for (let y = 0; y < h; y++) {
    if (y === partialY) restXs.forEach((x) => cells.push({ x, y }))
    else for (let x = 0; x < w; x++) cells.push({ x, y })
  }
  // ряд, где точно есть все клетки (для фургона и стартового тайла на краях)
  const fullRows = Array.from({ length: h }, (_, y) => y).filter((y) => y !== partialY || rest === w)
  const mid = fullRows[randInt(s, fullRows.length)]

  if (m.num === 6) {
    // Фургон в центре
    const c = { x: Math.floor((w - 1) / 2), y: fullRows[Math.floor(fullRows.length / 2)] }
    const vanIdx = cells.findIndex((x) => same(x, c))
    cells.splice(vanIdx, 1)
    s.tiles = keys.map((k, i) => tile(k, cells[i]))
    s.tiles.push({ ...tile('van', c), revealed: true })
    return
  }
  s.tiles = keys.map((k, i) => tile(k, cells[i]))
  const swapTo = (key: string, xy: XY) => {
    const a = s.tiles.find((t) => t.key === key)
    const b = tileAt(s, xy)
    if (!a || !b || a === b) return
    ;[a.x, a.y, b.x, b.y] = [b.x, b.y, a.x, a.y]
  }
  let van: XY
  if (m.num === 0 || m.num === 10) {
    // Торговый центр / база — с одного края, фургон — с другого
    van = { x: -1, y: mid }
    if (m.num === 0) swapTo('mall', { x: w - 1, y: mid })
    if (m.num === 10) swapTo('base', { x: w - 1, y: mid })
  } else {
    const free: XY[] = []
    for (const t of s.tiles)
      for (const d of DIRS) {
        const xy = { x: t.x + d.x, y: t.y + d.y }
        if (!tileAt(s, xy) && !free.some((f) => same(f, xy))) free.push(xy)
      }
    van = free[randInt(s, free.length)]
  }
  s.tiles.push({ ...tile('van', van), revealed: true })
  if (m.num === 0) findTile(s, 'mall')!.revealed = true
  if ([8, 10, 11].includes(m.num)) findTile(s, 'base')!.revealed = true
}

const tile = (key: string, xy: XY): TileInst => ({ key, x: xy.x, y: xy.y, revealed: false, markers: 0 })

/** Стартовый тайл игроков */
export function startTile(s: GameState): TileInst {
  const n = num(s)
  if (n === 0) return findTile(s, 'mall')!
  if (n === 11) return findTile(s, 'base')!
  return findTile(s, 'van')!
}

/** Маркеры целей: count тайлов на расстоянии ≥ minFrom от from и ≥ between друг от друга (ослабляем, если не выходит). */
function placeObjectives(s: GameState, count: number, from: XY, minFrom: number, between: number, markers = 0) {
  const cands = s.tiles.filter((t) => t.key !== 'van' && t.key !== 'base')
  for (let relax = 0; relax <= 10; relax++) {
    const chosen: TileInst[] = []
    for (const t of shuffle(s, [...cands])) {
      if (dist(t, from) < minFrom - relax) continue
      if (chosen.some((c) => dist(c, t) < between - relax)) continue
      chosen.push(t)
      if (chosen.length === count) break
    }
    if (chosen.length === count) {
      chosen.forEach((t, i) => {
        t.objective = i + 1
        t.markers = markers
      })
      return
    }
  }
}

export function setupObjectives(s: GameState) {
  const n = num(s)
  const van = findTile(s, 'van')!
  const base = findTile(s, 'base')
  if (n === 5) placeObjectives(s, 1, van, 5, 0)
  if (n === 7) placeObjectives(s, 1, van, 1, 0)
  if (n === 8) placeObjectives(s, 1, base!, 5, 0)
  if (n === 9) placeObjectives(s, 2, van, 2, 3, 3)
  if (n === 10) placeObjectives(s, 3, van, 2, 2)
  if (n === 11) placeObjectives(s, 3, base!, 3, 3, 3)
  if (n === 12) placeObjectives(s, 3, van, 3, 3)
}

// ---------- Боссы ----------

export function placeBosses(s: GameState) {
  const m = mission(s)
  const bosses = shuffle(s, MONSTERS.filter((x) => x.boss && x.set === m.set).map((x) => makeId(s, x.key, x.images[0])))
  const b = m.boss
  if (b.kind === 'aside') s.bossAside = [bosses[0]]
  else if (b.kind === 'bottom') {
    const tail = s.monsterDeck.splice(Math.max(0, s.monsterDeck.length - b.under))
    s.monsterDeck.push(...shuffle(s, [...tail, bosses[0]]))
  } else if (b.kind === 'shuffle') {
    s.monsterDeck.push(...bosses.slice(0, b.count))
    shuffle(s, s.monsterDeck)
    if (b.bottomExtra && bosses[b.count]) s.monsterDeck.push(bosses[b.count])
  } else if (b.kind === 'bottomHalf') {
    const half = Math.floor(s.monsterDeck.length / 2)
    const bottom = s.monsterDeck.splice(half)
    s.monsterDeck.push(...shuffle(s, [...bottom, bosses[0]]))
  }
}

function releaseBoss(s: GameState, p: PlayerState) {
  const id = s.bossAside.shift()
  if (!id) return
  log(s, 'Появляется БОСС!')
  takeMonster(s, p, { card: id })
}

/** Новая карта находки для миссии (не из колод). */
function makeFind(s: GameState, key: string) {
  const d = FIND_CARDS.find((c) => c.key === key)!
  return makeId(s, key, d.images[0])
}

export function giveScientist(s: GameState, p: PlayerState) {
  const id = makeFind(s, 'scientist')
  try {
    equip(s, p, id)
  } catch {
    p.hand.push(id)
    checkHand(s, p)
  }
}

/** Особая подготовка в начале партии (после стартовых монстров). */
export function onBegin(s: GameState) {
  const n = num(s)
  const first = s.players[s.turn.seat]
  if (n === 3 || n === 9) giveScientist(s, first)
  if (n === 10) {
    const alive = living(s)
    for (let i = 0; i < 4; i++) {
      const p = alive[i % alive.length]
      const id = makeFind(s, 'fuel')
      try {
        equip(s, p, id)
      } catch {
        p.hand.push(id)
      }
    }
  }
}

// ---------- События ----------

export function onReveal(s: GameState, t: TileInst, by: PlayerState | null) {
  const n = num(s)
  if (n === 7 && t.objective && by) {
    t.objective = undefined
    releaseBoss(s, by)
  }
}

export function onEnter(s: GameState, p: PlayerState, t: TileInst) {
  const n = num(s)
  const F = s.mission.flags
  if (n === 1 && t.key === 'police' && !F.bossOut) {
    F.bossOut = true
    releaseBoss(s, p)
  }
  if (n === 5 && t.objective && !F.bookFound) {
    F.bookFound = true
    t.objective = undefined
    const id = makeFind(s, 'book')
    p.hand.push(id)
    log(s, `${p.name} находит Пыльную книгу`)
    checkHand(s, p)
    releaseBoss(s, p)
  }
  if (n === 8 && t.objective && !F.reached) {
    F.reached = true
    releaseBoss(s, p)
    if (stealthCheck(s, p, 0)) {
      F.scientistHere = true
      log(s, 'Учёный жив! Заберите его действием')
    } else if (p.hand.some((id) => keyOf(id) === 'book')) {
      F.data = true
      t.objective = undefined
      log(s, 'Учёный успел передать данные (есть Пыльная книга)')
    } else lose(s, 'учёный погиб, а книги нет — данные потеряны')
  }
  if (n === 10 && t.objective) {
    const k = t.objective
    t.objective = undefined
    const give = (key: string, cnt: number) => {
      for (let i = 0; i < cnt; i++) {
        const id = makeFind(s, key)
        if (key === 'fuel') gainFind(s, p, id)
        else p.hand.push(id)
      }
    }
    log(s, `${p.name} достигает маркера №${k}`)
    if (k === 1) {
      give('parts', 3)
      give('meds', 2)
    }
    if (k === 2) {
      releaseBoss(s, p)
      give('blanket', 3)
    }
    if (k === 3) {
      give('fuel', 2)
      give('meds', 1)
    }
    checkHand(s, p)
  }
}

export function onSpawnRoll(s: GameState, roll: number) {
  if (num(s) !== 6 || roll !== 7) return
  const outer = s.tiles.filter((t) => t.key !== 'van' && neighbors(s, t).length < 4)
  const hidden = outer.filter((t) => !t.revealed)
  if (hidden.length) {
    const t = hidden[randInt(s, hidden.length)]
    log(s, 'Радиация: открывается внешний тайл')
    return revealTile(s, t, null, false)
  }
  const empty = outer.filter((t) => !s.players.some((p) => p.alive && same(p.pos, t)))
  if (!empty.length) return
  const t = empty[randInt(s, empty.length)]
  s.tiles.splice(s.tiles.indexOf(t), 1)
  log(s, `Радиация: тайл «${tileDef(t).name}» исчезает`)
}

export function onRound(s: GameState) {
  const F = s.mission.flags
  if (num(s) === 5 && F.defused && s.round > (F.deadline as number)) lose(s, 'бомба взорвалась — не успели к фургону')
}

/** true — карта монстра ушла на карту миссии (образцы). */
export function onMonsterKilled(s: GameState, d: MonsterDef, id: string): boolean {
  if (num(s) !== 2 || !d.sample) return false
  const have = s.mission.samples[d.sample] ?? 0
  if (have >= 2) return false
  s.mission.samples[d.sample] = have + 1
  s.removed.push(id)
  log(s, `Образец «${d.sample}»: ${have + 1}/2`)
  return true
}

// ---------- Сдача предметов (свободное действие) ----------

const NEED: Record<number, Record<string, number>> = {
  3: { meds: 2, antidote: 3 },
  4: { fuel: 3, blanket: 2, newspaper: 2, food: 5 },
  10: { fuel: 6, blanket: 3, meds: 2, parts: 2 },
}

/** Где сдавать: ключи тайлов */
function depotKeys(s: GameState, kind: string): string[] {
  const n = num(s)
  if (n === 3) return ['hospital']
  if (n === 4) return ['shelter1', 'shelter2']
  if (n === 10) return ['base']
  return kind === 'fuel' ? ['van'] : []
}

export function deliver(s: GameState, p: PlayerState, card: string) {
  const d = cardDef(card)
  const kind = d.find ?? ''
  const here = tileAt(s, p.pos)!
  check(depotKeys(s, kind).includes(here.key), 'Здесь это сдать нельзя')
  const need = NEED[num(s)]?.[kind] ?? (kind === 'fuel' ? mission(s).fuel : 0)
  const have = kind === 'fuel' && !NEED[num(s)]?.fuel ? s.mission.fuel : s.mission.delivered[kind] ?? 0
  check(need > 0 && have < need, 'Этого уже достаточно или это не нужно для миссии')
  if (kind === 'fuel') {
    check(p.equip.some((e) => e.id === card), 'Сдавать можно только экипированное топливо')
    unequip(s, p, card, false)
  } else {
    const i = p.hand.indexOf(card)
    check(i >= 0, 'Этой карты нет в руке')
    p.hand.splice(i, 1)
  }
  s.removed.push(card)
  const add = kind === 'food' ? d.value ?? 1 : 1
  if (kind === 'fuel') s.mission.fuel++
  if (NEED[num(s)]?.[kind] !== undefined) s.mission.delivered[kind] = (s.mission.delivered[kind] ?? 0) + add
  log(s, `${p.name} сдаёт «${d.name}»`)
}

// ---------- Действия миссии ----------

export interface MissionActionDef {
  kind: string
  name: string
  cost: number
}

export function missionActions(s: GameState, p: PlayerState): MissionActionDef[] {
  const n = num(s)
  const F = s.mission.flags
  const t = tileAt(s, p.pos)!
  const out: MissionActionDef[] = []
  if (n === 1 && t.key === 'police' && !F.rescued) out.push({ kind: 'rescue', name: 'Спасти учёного', cost: 2 })
  if (n === 5 && t.key === 'plant' && !F.defused && p.hand.some((id) => keyOf(id) === 'book'))
    out.push({ kind: 'defuse', name: 'Обезвредить бомбу', cost: 2 })
  if (n === 6 && t.key === 'van' && s.mission.repairs < 3 && p.hand.some((id) => keyOf(id) === 'parts'))
    out.push({ kind: 'repair', name: 'Починить фургон', cost: 1 })
  if (n === 8 && t.objective && F.scientistHere && !F.scientistTaken) out.push({ kind: 'takeScientist', name: 'Забрать учёного', cost: 1 })
  if (n === 9 && t.objective) out.push({ kind: 'transmitter', name: 'Уничтожить передатчик', cost: 1 })
  if (n === 12 && t.objective) out.push({ kind: 'destroyTile', name: 'Уничтожить тайл', cost: 1 })
  return out
}

export function missionAction(s: GameState, p: PlayerState, kind: string, to?: XY) {
  const F = s.mission.flags
  const t = tileAt(s, p.pos)!
  if (kind === 'rescue') {
    F.rescued = true
    log(s, `${p.name} спасает учёного`)
    return giveScientist(s, p)
  }
  if (kind === 'defuse') {
    F.defused = true
    F.deadline = s.round + 3
    return log(s, 'Бомба обезврежена! 3 раунда, чтобы добраться до фургона')
  }
  if (kind === 'repair') {
    const id = p.hand.find((x) => keyOf(x) === 'parts')!
    p.hand.splice(p.hand.indexOf(id), 1)
    s.removed.push(id)
    s.mission.repairs++
    return log(s, `Фургон починен: ${s.mission.repairs}/3`)
  }
  if (kind === 'takeScientist') {
    F.scientistTaken = true
    t.objective = undefined
    return giveScientist(s, p)
  }
  if (kind === 'transmitter') {
    t.objective = undefined
    s.mission.flags.transmitters = ((F.transmitters as number) ?? 0) + 1
    log(s, `Передатчик уничтожен: ${F.transmitters}/2`)
    return attractMarkers(s, p, t)
  }
  if (kind === 'destroyTile') {
    const dest = to ? tileAt(s, to) : neighbors(s, t)[0]
    check(dest && dist(dest, t) === 1, 'Выберите соседний тайл, куда отойти')
    enterTile(s, p, dest!)
    s.tiles.splice(s.tiles.indexOf(t), 1)
    s.mission.cleared.push(s.mission.cleared.length + 1)
    log(s, `Тайл «${tileDef(t).name}» уничтожен (${s.mission.cleared.length}/3)`)
    if (s.players.some((q) => q.alive && same(q.pos, t))) lose(s, 'игрок остался на уничтоженном тайле')
    return
  }
  check(false, 'Неизвестное действие миссии')
}

// ---------- Победа ----------

const allAt = (s: GameState, keys: string[]) => living(s).every((p) => keys.includes(tileAt(s, p.pos)?.key ?? ''))
const noMonsters = (s: GameState) => living(s).every((p) => !p.monsters.length)
const scientistHolder = (s: GameState) => living(s).find((p) => p.equip.some((e) => keyOf(e.id) === 'scientist'))

export function checkWin(s: GameState) {
  const n = num(s)
  const m = mission(s)
  const F = s.mission.flags
  const D = s.mission.delivered
  const fuelOk = s.mission.fuel >= m.fuel
  const atVan = allAt(s, ['van'])
  const sc = scientistHolder(s)
  // Миссия 11: цель зачищена, когда на её тайле не осталось жетонов
  if (n === 11) for (const t of s.tiles) if (t.objective && t.markers === 0) {
    s.mission.cleared.push(t.objective)
    t.objective = undefined
    log(s, `Цель зачищена: ${s.mission.cleared.length}/3`)
  }
  let ok = false
  if (n === 0) ok = fuelOk && atVan
  if (n === 1) ok = fuelOk && atVan && !!sc
  if (n === 2) ok = fuelOk && atVan && ['Бродяга', 'Плевун', 'Пёс', 'Солдат'].every((k) => (s.mission.samples[k] ?? 0) >= 2)
  if (n === 3) ok = (D.meds ?? 0) >= 2 && (D.antidote ?? 0) >= 3 && !!sc && tileAt(s, sc.pos)?.key === 'hospital'
  if (n === 4)
    ok = (D.fuel ?? 0) >= 3 && (D.blanket ?? 0) >= 2 && (D.newspaper ?? 0) >= 2 && (D.food ?? 0) >= 5 &&
      allAt(s, ['shelter1', 'shelter2']) && noMonsters(s)
  if (n === 5) ok = !!F.defused && fuelOk && atVan
  if (n === 6) ok = s.mission.repairs >= 3 && fuelOk && atVan
  if (n === 7) ok = s.tiles.every((t) => t.revealed) && fuelOk && atVan
  if (n === 8) ok = (!!F.data || !!sc) && allAt(s, ['base'])
  if (n === 9) ok = ((F.transmitters as number) ?? 0) >= 2 && !!sc && tileAt(s, sc.pos)?.key === 'crash'
  if (n === 10) ok = (D.fuel ?? 0) >= 6 && (D.blanket ?? 0) >= 3 && (D.meds ?? 0) >= 2 && (D.parts ?? 0) >= 2 && allAt(s, ['base'])
  if (n === 11) ok = s.mission.cleared.length >= 3 && allAt(s, ['base']) && noMonsters(s)
  if (n === 12) ok = s.mission.cleared.length >= 3 && fuelOk && atVan
  if (ok) win(s, `Миссия «${m.name}» выполнена`)
}

/** Прогресс миссии для экрана: что уже сделано. */
export function missionProgress(s: GameState): string[] {
  const n = num(s)
  const m = mission(s)
  const out: string[] = []
  const need = NEED[n]
  if (m.fuel && !need?.fuel) out.push(`Топливо в фургоне: ${s.mission.fuel}/${m.fuel}`)
  const RU: Record<string, string> = { fuel: 'Топливо', meds: 'Медикаменты', antidote: 'Противоядие', blanket: 'Одеяла', newspaper: 'Газеты',
    food: 'Еда (сумма)', parts: 'Запчасти' }
  if (need) for (const [k, v] of Object.entries(need)) out.push(`Сдано — ${RU[k] ?? k}: ${s.mission.delivered[k] ?? 0}/${v}`)
  if (n === 2) for (const k of ['Бродяга', 'Плевун', 'Пёс', 'Солдат']) out.push(`Образцы ${k}: ${s.mission.samples[k] ?? 0}/2`)
  if (n === 6) out.push(`Ремонт: ${s.mission.repairs}/3`)
  if (n === 9) out.push(`Передатчики: ${s.mission.flags.transmitters ?? 0}/2`)
  if (n === 11 || n === 12) out.push(`Цели: ${s.mission.cleared.length}/3`)
  if (n === 5 && s.mission.flags.defused) out.push(`Бомба обезврежена, успеть до конца раунда ${s.mission.flags.deadline}`)
  return out
}
