// Перечень разумных ходов для бота. Не все из них обязательно допустимы — проверяет движок (tryReduce).
import { cardDef, charDef, dist, keyOf, neighbors, tileAt, tileDef } from '../game/core.ts'
import { missionActionsFor } from '../game/engine.ts'
import { HAND_LIMIT } from '../game/rules.ts'
import { requirements, type Requirement } from '../game/targets.ts'
import type { Action, Eff, GameState, Params, PlayerState, Range } from '../game/types.ts'

const MAX_VARIANTS = 8

/** Кто сейчас принимает решение */
export function decider(s: GameState): number | null {
  if (s.phase === 'won' || s.phase === 'lost') return null
  if (s.phase === 'setup') {
    const p = s.players.find((x) => !x.mulliganDone)
    return p ? p.seat : null
  }
  if (s.pendings.length) return s.pendings[0].seat
  return s.turn.lent ? s.turn.lent.seat : s.turn.seat
}

const pickSome = <T>(list: T[], n: number) => {
  if (list.length <= n) return list
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

const unmet = (r: Requirement, p: Params) =>
  (r.kind === 'mode' && p.mode === undefined) ||
  (r.kind === 'monsters' && p.targets === undefined) ||
  (r.kind === 'player' && p.players === undefined) ||
  (r.kind === 'tile' && !p.tile) ||
  (r.kind === 'tiles' && !p.tiles) ||
  (r.kind === 'weapon' && !p.weapon) ||
  (r.kind === 'card' && !p.card) ||
  (r.kind === 'colors' && (p.colors?.length ?? 0) < r.n)

/** Варианты параметров для эффекта (ограниченное число) */
export function paramVariants(s: GameState, p: PlayerState, effs: Eff[], range: Range | undefined, base: Params = {}): Params[] {
  let out: Params[] = []
  const grow = (v: Params, depth: number) => {
    if (out.length >= MAX_VARIANTS * 3 || depth > 6) return
    const r = requirements(s, p, effs, range, v).find((x) => unmet(x, v))
    if (!r) return void out.push(v)
    const next: Params[] = []
    switch (r.kind) {
      case 'mode':
        r.labels.forEach((_, i) => next.push({ ...v, mode: i }))
        break
      case 'monsters':
        if (!r.cands.length) return
        pickSome(r.cands, 4).forEach((id) => next.push({ ...v, targets: [id] }))
        if (r.max > 1 && r.cands.length > 1) next.push({ ...v, targets: r.cands.slice(0, r.max) })
        break
      case 'player':
        r.cands.forEach((seat) => {
          const q = s.players[seat]
          const figs = q.figures.map((f, i) => (f.alive ? i : -1)).filter((i) => i >= 0)
          if (r.figure && figs.length > 1) figs.forEach((f) => next.push({ ...v, players: [seat], figure: f }))
          else next.push({ ...v, players: [seat] })
        })
        break
      case 'tile':
        pickSome(r.cands, 5).forEach((xy) => next.push({ ...v, tile: xy }))
        break
      case 'tiles':
        if (r.cands.length) next.push({ ...v, tiles: pickSome(r.cands, r.n) })
        break
      case 'weapon':
        r.cands.forEach((id) => next.push({ ...v, weapon: id }))
        break
      case 'card':
        pickSome(r.cands, 4).forEach((id) => next.push({ ...v, card: id, inner: {} }))
        break
      case 'colors':
        ;(['red', 'green', 'blue'] as const).forEach((c) => s.finds[c].length && next.push({ ...v, colors: [...(v.colors ?? []), c] }))
        break
    }
    for (const n of next) grow(n, depth + 1)
  }
  grow(base, 0)
  out = pickSome(out, MAX_VARIANTS)
  return out
}

/** Все кандидаты для решающего игрока */
export function legalActions(s: GameState): Action[] {
  const seat = decider(s)
  if (seat === null) return []
  const p = s.players[seat]
  if (s.phase === 'setup') return [{ type: 'mulligan', seat, cards: [] }]

  const pd = s.pendings[0]
  if (pd) {
    const out: Action[] = []
    pd.options?.forEach((_, i) => out.push({ type: 'choose', seat, option: i }))
    const pool = pd.kind === 'discard' ? p.hand : pd.cards ?? []
    if (pool.length) {
      const need = pd.kind === 'discard'
        ? pd.data?.limit ? Math.max(0, p.hand.length - HAND_LIMIT) : Math.min(pd.pick ?? 0, p.hand.length)
        : Math.min(pd.pick ?? 1, pool.length)
      if (need === 1) pool.forEach((id) => out.push({ type: 'choose', seat, cards: [id] }))
      else for (let i = 0; i < 4; i++) out.push({ type: 'choose', seat, cards: pickSome(pool, need) })
    }
    return out
  }

  const out: Action[] = []
  const t = tileAt(s, p.pos)!
  const deliverables = [...p.hand, ...p.equip.map((e) => e.id)].filter((id) => cardDef(id).group === 'find')
  for (const card of deliverables) out.push({ type: 'deliver', seat, card })
  const pile = s.dropped.find((d) => d.x === p.pos.x && d.y === p.pos.y)
  if (pile && !s.turn.tradeUsed) out.push({ type: 'pickUp', seat, cards: [...pile.cards] })

  if (s.turn.lent) out.push({ type: 'pass', seat })
  const canMove = !(s.turn.noMove && seat === s.turn.seat)
  // Действия кончились: остаются только бесплатные шаги (если можно ходить) и конец хода
  if (!s.turn.lent && s.turn.actions === 0) {
    if (p.equip.some((e) => cardDef(e.id).gear?.passive?.jacket) && !s.turn.jacketUsed) out.push({ type: 'jacket', seat })
    if (s.turn.freeMoves > 0 && canMove) for (const n of neighbors(s, p.pos)) out.push({ type: 'move', seat, to: { x: n.x, y: n.y } })
    out.push({ type: 'endTurn', seat })
    return out
  }

  if (canMove) for (const n of neighbors(s, p.pos)) out.push({ type: 'move', seat, to: { x: n.x, y: n.y } })
  out.push({ type: 'draw', seat })
  const colors = t.revealed ? tileDef(t).colors : []
  if (colors.length && !s.turn.searched.includes(`${t.x},${t.y}`)) for (const color of colors) out.push({ type: 'search', seat, color })

  const ab = charDef(p).ability
  if (ab.action && !p.exhausted && p.figures.some((f) => f.alive && !f.companion))
    for (const params of paramVariants(s, p, ab.action, ab.range)) out.push({ type: 'ability', seat, params })

  for (const card of p.hand) {
    const d = cardDef(card)
    if (d.type === 'gear') out.push({ type: 'play', seat, card })
    else if (d.effect?.length) for (const params of paramVariants(s, p, d.effect, d.range)) out.push({ type: 'play', seat, card, params })
  }
  for (const e of p.equip) {
    const g = cardDef(e.id).gear!
    if (g.action && (e.ammo > 0 || (g.ammo === undefined && g.fuel === undefined)))
      for (const params of paramVariants(s, p, g.action, cardDef(e.id).range, { weapon: e.id })) out.push({ type: 'useGear', seat, equip: e.id, params })
    if (g.onDiscard) for (const params of paramVariants(s, p, g.onDiscard, cardDef(e.id).range)) out.push({ type: 'discardGear', seat, equip: e.id, params })
    if (g.fuel !== undefined && e.ammo < g.fuel) {
      const fuel = p.equip.find((x) => cardDef(x.id).find === 'fuel')
      if (fuel) out.push({ type: 'refuel', seat, equip: e.id, fuel: fuel.id })
    }
  }
  for (const m of missionActionsFor(s, seat)) {
    if (m.kind === 'destroyTile') for (const n of neighbors(s, p.pos)) out.push({ type: 'mission', seat, kind: m.kind, to: { x: n.x, y: n.y } })
    else out.push({ type: 'mission', seat, kind: m.kind })
  }
  const sp = tileDef(t).special
  if (sp === 'tunnel' || sp === 'airport') {
    const targets = s.tiles.filter((x) => x.revealed && dist(x, t) > 1 && (sp === 'airport' || tileDef(x).special === 'tunnel'))
    for (const x of pickSome(targets, 4)) out.push({ type: 'tileAction', seat, to: { x: x.x, y: x.y } })
  }
  return out
}

/** Короткий ключ действия для дерева поиска */
export const actionKey = (a: Action) => JSON.stringify(a)

export const isAttack = (a: Action) => (a.type === 'useGear' || a.type === 'play' || a.type === 'ability') && !!a.params?.targets?.length

export const cardKeyOf = (a: Action) => ('card' in a && typeof a.card === 'string' ? keyOf(a.card) : '')
