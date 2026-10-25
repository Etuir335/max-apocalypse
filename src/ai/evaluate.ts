// Оценка позиции для бота (0 — поражение, 1 — победа) и быстрая стратегия для прокрутки партии вперёд.
import { cardDef, dist, living, markersOnBoard, monsterDef, stealthOf, tileAt, tileDef } from '../game/core.ts'
import { missionById } from '../game/data/missions.ts'
import { tryReduce } from '../game/engine.ts'
import type { Action, GameState, PlayerState, XY } from '../game/types.ts'
import { decider, isAttack, legalActions } from './legal.ts'

// ---------- Прогресс миссии ----------

const carried = (s: GameState, kind: string) =>
  living(s).reduce(
    (n, p) => n + [...p.hand, ...p.equip.map((e) => e.id)].filter((id) => cardDef(id).find === kind)
      .reduce((a, id) => a + (kind === 'food' ? cardDef(id).value ?? 1 : 1), 0),
    0,
  )
const item = (have: number, carry: number, need: number) => (need <= 0 ? 1 : Math.min(1, (have + 0.6 * carry) / need))
const span = (s: GameState) => {
  const xs = s.tiles.map((t) => t.x)
  const ys = s.tiles.map((t) => t.y)
  return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) + 1
}
/** Насколько все живые близки к одному из тайлов (1 — все на месте) */
function prox(s: GameState, targets: XY[]): number {
  const alive = living(s)
  if (!targets.length || !alive.length) return 0
  const m = span(s)
  return alive.reduce((n, p) => n + (1 - Math.min(...targets.map((t) => dist(p.pos, t))) / m), 0) / alive.length
}
const tilesBy = (s: GameState, keys: string[]) => s.tiles.filter((t) => keys.includes(t.key))
const objectives = (s: GameState) => s.tiles.filter((t) => t.objective)
const revealed = (s: GameState) => s.tiles.filter((t) => t.revealed).length / s.tiles.length
const holder = (s: GameState, key: string) => living(s).find((p) => p.equip.some((e) => e.id.startsWith(key + ':')))

export function missionScore(s: GameState): number {
  const m = missionById(s.missionId)
  const D = s.mission.delivered
  const F = s.mission.flags
  const f = item(s.mission.fuel, carried(s, 'fuel'), m.fuel)
  const van = tilesBy(s, ['van'])
  const base = tilesBy(s, ['base'])
  const r = revealed(s)
  switch (m.num) {
    case 0:
      return 0.6 * f + 0.25 * f * prox(s, van) + 0.15 * r
    case 1: {
      const sc = holder(s, 'scientist')
      return 0.25 * (F.rescued ? 1 : 0.4 * prox(s, tilesBy(s, ['police']).filter((t) => t.revealed))) + 0.4 * f +
        0.2 * (sc ? f * prox(s, van) : 0) + 0.15 * r
    }
    case 2: {
      const samples = ['Бродяга', 'Плевун', 'Пёс', 'Солдат'].reduce((n, k) => n + Math.min(2, s.mission.samples[k] ?? 0), 0) / 8
      return 0.5 * samples + 0.3 * f + 0.1 * f * samples * prox(s, van) + 0.1 * r
    }
    case 3: {
      const sc = holder(s, 'scientist')
      const hosp = tilesBy(s, ['hospital']).filter((t) => t.revealed)
      return 0.3 * item(D.meds ?? 0, carried(s, 'meds'), 2) + 0.3 * item(D.antidote ?? 0, carried(s, 'antidote'), 3) +
        0.3 * (sc && hosp.length ? prox(s, hosp) : 0) + 0.1 * r
    }
    case 4: {
      const items = (item(D.fuel ?? 0, carried(s, 'fuel'), 3) + item(D.blanket ?? 0, carried(s, 'blanket'), 2) +
        item(D.newspaper ?? 0, carried(s, 'newspaper'), 2) + item(D.food ?? 0, carried(s, 'food'), 5)) / 4
      const shelters = tilesBy(s, ['shelter1', 'shelter2']).filter((t) => t.revealed)
      return 0.6 * items + 0.25 * items * prox(s, shelters) + 0.15 * r
    }
    case 5:
      return 0.2 * (F.bookFound ? 1 : 0.5 * prox(s, objectives(s))) + 0.3 * (F.defused ? 1 : 0) + 0.3 * f +
        0.2 * (F.defused ? prox(s, van) : 0)
    case 6:
      return 0.45 * item(s.mission.repairs, carried(s, 'parts'), 3) + 0.35 * f + 0.2 * f * prox(s, van)
    case 7:
      return 0.5 * r + 0.35 * f + 0.15 * f * r * prox(s, van)
    case 8: {
      const got = !!F.data || !!holder(s, 'scientist')
      return 0.3 * (F.reached ? 1 : 0.5 * prox(s, objectives(s))) + 0.3 * (got ? 1 : 0) + 0.4 * (got ? prox(s, base) : 0)
    }
    case 9: {
      const tr = Math.min(2, (F.transmitters as number) ?? 0) / 2
      const crash = tilesBy(s, ['crash']).filter((t) => t.revealed)
      return 0.5 * tr + 0.2 * (tr < 1 ? prox(s, objectives(s)) : 1) * (1 - tr) + 0.3 * tr * (holder(s, 'scientist') ? prox(s, crash) : 0)
    }
    case 10: {
      const items = (item(D.fuel ?? 0, carried(s, 'fuel'), 6) + item(D.blanket ?? 0, carried(s, 'blanket'), 3) +
        item(D.meds ?? 0, carried(s, 'meds'), 2) + item(D.parts ?? 0, carried(s, 'parts'), 2)) / 4
      return 0.6 * items + 0.1 * (1 - objectives(s).length / 3) + 0.3 * items * prox(s, base)
    }
    case 11: {
      const cl = s.mission.cleared.length / 3
      return 0.6 * cl + 0.2 * (cl < 1 ? prox(s, objectives(s)) : prox(s, base)) + 0.2 * cl * (living(s).every((p) => !p.monsters.length) ? 1 : 0)
    }
    case 12: {
      const cl = s.mission.cleared.length / 3
      return 0.5 * cl + 0.3 * f + 0.2 * (cl < 1 ? prox(s, objectives(s)) : f * prox(s, van))
    }
  }
  return f
}

// ---------- Оценка позиции ----------

/** Сколько здоровья у монстров перед игроком — чем больше, тем дольше их убивать */
function monsterBulk(p: PlayerState) {
  return p.monsters.reduce((n, m) => n + (monsterDef(m.id).hp - m.wounds), 0)
}

/** Урон, который игрок получит в конце своего хода от монстров перед ним (с бронёй, оглушением, учёными). */
export function incomingDamage(s: GameState, p: PlayerState): number {
  const scientists = s.players.reduce((n, q) => n + q.monsters.filter((m) => monsterDef(m.id).passive === 'alienBoost').length, 0)
  const armor = p.equip.reduce((n, e) => n + (cardDef(e.id).gear?.passive?.reduceDamage ?? 0), 0)
  let total = 0
  for (const m of p.monsters) {
    if (m.stunnedBy !== null) continue
    const d = monsterDef(m.id)
    const dmg = d.dmg + (d.set === 'A' ? scientists : 0)
    total += Math.max(0, dmg - armor)
  }
  // монстры соседей, бьющие по площади
  for (const q of living(s)) {
    if (q === p) continue
    for (const m of q.monsters) {
      const d = monsterDef(m.id)
      if (m.stunnedBy !== null || !d.attackAll || !d.range) continue
      const reach = { short: 0, medium: 1, long: 2 }[d.range]
      if (dist(p.pos, q.pos) <= reach) total += Math.max(0, d.dmg - armor) * 0.5 // бьют только в ход соседа
    }
  }
  return total + p.poison
}

/** 1 — в безопасности, 0 — следующий удар убьёт */
function safety(s: GameState, p: PlayerState) {
  const hp = p.figures.reduce((n, f) => n + (f.alive ? f.hp : 0), 0)
  const inc = incomingDamage(s, p)
  if (inc <= 0) return 1
  if (inc >= hp) return 0
  return 1 - (inc / hp) ** 0.7
}

export function evaluate(s: GameState): number {
  if (s.phase === 'won') return 1
  if (s.phase === 'lost') return 0
  const all = s.players
  const alive = living(s)
  if (!alive.length) return 0
  const hp = all.reduce((n, p) => n + (p.alive ? p.figures.reduce((a, f) => a + f.hp, 0) / p.figures.reduce((a, f) => a + f.maxHp, 0) : 0), 0) / all.length
  // Голод убивает медленно, но наверняка: штраф растёт к истощению; еда в руке — запас
  const hunger = alive.reduce((n, p) => {
    if (p.exhausted) return n - 0.6 - 0.3 * p.starve
    const eff = Math.max(1, p.hunger - 0.6 * foodInHand(p))
    return n + 1 - ((eff - 1) / 5) ** 2
  }, 0) / alive.length
  const safe = alive.reduce((n, p) => n + safety(s, p), 0) / all.length
  const bulk = 1 / (1 + alive.reduce((n, p) => n + monsterBulk(p), 0) / 20)
  const deck = alive.reduce((n, p) => n + Math.min(1, p.deck.length / 14) ** 2, 0) / alive.length
  const markers = 1 - markersOnBoard(s) / 30
  const armed = alive.reduce((n, p) => n + Math.min(1, p.equip.filter((e) => cardDef(e.id).gear?.action && (e.ammo > 0 || (cardDef(e.id).gear?.ammo === undefined && cardDef(e.id).gear?.fuel === undefined))).length / 2), 0) / alive.length
  // Выживание важнее прогресса: мёртвый отряд миссию не выполнит
  const score = 0.3 * missionScore(s) + 0.17 * (alive.length / all.length) + 0.11 * hp + 0.13 * safe + 0.07 * bulk +
    0.13 * hunger + 0.02 * markers + 0.05 * deck + 0.02 * armed
  return Math.max(0.001, Math.min(0.999, score))
}

/** Сколько еды (сумма значений) лежит у игрока в руке */
export const foodInHand = (p: PlayerState) => p.hand.reduce((a, id) => a + (cardDef(id).find === 'food' ? cardDef(id).value ?? 1 : 0), 0)


// ---------- Быстрая стратегия (для прокрутки вперёд) ----------

/** Куда идти: к цели, если она «готова», иначе к ближайшему закрытому тайлу */
function moveTarget(s: GameState, p: PlayerState): XY | null {
  const goalReady = missionScore(s) > 0.55
  const goalKeys: Record<number, string[]> = { 3: ['hospital'], 4: ['shelter1', 'shelter2'], 8: ['base'], 9: ['crash'], 10: ['base'], 11: ['base'] }
  const num = missionById(s.missionId).num
  if (goalReady) {
    const keys = goalKeys[num] ?? ['van']
    const t = s.tiles.filter((x) => keys.includes(x.key) && x.revealed)
    if (t.length) return t.sort((a, b) => dist(a, p.pos) - dist(b, p.pos))[0]
  }
  const obj = objectives(s)
  if (obj.length && [5, 8, 9, 10, 11, 12].includes(num)) return obj.sort((a, b) => dist(a, p.pos) - dist(b, p.pos))[0]
  const hidden = s.tiles.filter((t) => !t.revealed)
  if (hidden.length) return hidden.sort((a, b) => dist(a, p.pos) - dist(b, p.pos))[0]
  return null
}

/** Вероятность выбросить на 2d6 не больше k */
export function sneakProb(k: number) {
  let ok = 0
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b <= k) ok++
  return ok / 36
}

/** Карты и способности, которые сами тянут монстров к игроку */
const PULLS_MONSTERS = new Set(['ff_flare', 'gs_lasso'])

function weight(s: GameState, a: Action): number {
  const seat = 'seat' in a ? a.seat : 0
  const p = s.players[seat]
  const danger = p.monsters.length > 0
  switch (a.type) {
    case 'choose': {
      const pd = s.pendings[0]
      if (pd?.kind === 'fuel') return pd.options?.[a.option ?? 0]?.startsWith('Сбросить') && pd.options.length > 2 ? 1 : 10 - (a.option ?? 0)
      if (pd?.kind === 'sneak') {
        const t = tileAt(s, p.pos)
        const prob = sneakProb(stealthOf(p) - (t?.markers ?? 0))
        return a.option === 0 ? 1 + 20 * prob : 0.5
      }
      if (pd?.kind === 'ladder') return a.option === 0 ? 8 : 1
      if (pd?.kind === 'forest') return a.option === 0 ? 8 : 0.5
      if (pd?.kind === 'gearOrDamage') {
        const hp = p.figures.reduce((n, f) => n + (f.alive ? f.hp : 0), 0)
        const takeDamage = a.option === (pd.options?.length ?? 1) - 1
        return takeDamage ? (Number(pd.data?.amount ?? 0) < hp / 3 ? 6 : 0.5) : 2
      }
      return 1
    }
    case 'mulligan':
      return 1
    case 'deliver':
      return 60
    case 'mission':
      return 45
    case 'pickUp':
      return 25
    case 'endTurn':
      return 1
    case 'pass':
      return 0.5
    case 'jacket':
      return 0.3
    case 'search': {
      const hungry = p.hunger >= 3 || p.exhausted
      return (danger ? 5 : 12) * (hungry && a.color === 'green' ? 2 : 1)
    }
    case 'draw':
      // колода выжившего — это жизнь: кончится — персонаж погибнет
      if (p.deck.length < 8) return 0.05
      return danger ? 0.3 : p.hand.length < 2 ? 3 : 0.4
    case 'move': {
      const t = moveTarget(s, p)
      let w = !t ? 2 : dist(a.to, t) < dist(p.pos, t) ? 9 : 1.5
      const dest = tileAt(s, a.to)
      if (dest) {
        const d = tileDef(dest)
        // улицы и поля тянут монстров, лагерь бандитов бьёт — обходим, если это не цель
        const bad = dest.revealed && ((d.enter ?? []).some((e) => e.k === 'drawMonster' || e.k === 'gearOrDamage') || (d.end ?? []).some((e) => e.k === 'drawMonster'))
        if (bad) w *= 0.25
        if (dest.markers > 0 && !p.monsters.length) w *= 0.3 + sneakProb(stealthOf(p) - dest.markers)
        if (dest.markers > 0 && p.monsters.length) w *= 0.6
      }
      return w
    }
    case 'tileAction':
      return 1
    case 'refuel':
      return 6
    default:
      break
  }
  if (a.type === 'play' && PULLS_MONSTERS.has(cardDef(a.card).key)) return 0.2
  if (a.type === 'ability' && charAbilityPulls(p)) return 0.3
  if (isAttack(a)) return danger ? 35 : 18
  if (a.type === 'play') {
    const d = cardDef(a.card)
    if (danger && d.effect?.some((e) => e.k === 'stunAll' || e.k === 'damageAll')) return 28
    if (d.find === 'food' || d.effect?.some((e) => e.k === 'hunger' && e.amount < 0))
      return p.exhausted ? 45 : p.hunger >= 4 ? 30 : p.hunger >= 2 ? 12 : 0.5
    if (d.find === 'meds' || d.effect?.some((e) => e.k === 'heal'))
      return p.figures.some((f) => f.alive && f.hp < f.maxHp * 0.6) ? 16 : 0.5
    if (d.find === 'antidote') return p.poison ? 15 : 0.3
    if (d.type === 'gear') return 7
    return 3
  }
  if (a.type === 'useGear' || a.type === 'ability') return 3
  if (a.type === 'discardGear') return p.monsters.length ? 5 : 0.3
  return 1
}

/** Способность, которая сама берёт монстра (Пожарный (Ж) «Привлечение внимания») */
function charAbilityPulls(p: PlayerState) {
  return p.hero === 'firefighterF'
}

/** Один ход быстрой стратегии; null — ходить некому или нечем. */
export function policyStep(s: GameState): GameState | null {
  const cands = legalActions(s)
  while (cands.length) {
    const ws = cands.map((a) => weight(s, a))
    let r = Math.random() * ws.reduce((x, y) => x + y, 0)
    let i = 0
    while (i < ws.length - 1 && r > ws[i]) r -= ws[i++]
    const res = tryReduce(s, cands[i])
    if (!res.error && res.state) return res.state
    cands.splice(i, 1)
  }
  // запасной ход: взять карту / закончить ход
  const seat = decider(s)
  if (seat === null) return null
  for (const a of [{ type: 'draw', seat }, { type: 'endTurn', seat }, { type: 'pass', seat }] as Action[]) {
    const res = tryReduce(s, a)
    if (!res.error && res.state) return res.state
  }
  return null
}
