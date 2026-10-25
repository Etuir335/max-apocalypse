// Проверка движка без браузера: боты играют случайными ходами во всех миссиях.
// Запуск: node scripts/sim.ts [партий на миссию]
import { reduce, GameError } from '../src/game/engine.ts'
import { CHARACTERS } from '../src/game/data/characters.ts'
import { MISSIONS } from '../src/game/data/missions.ts'
import { neighbors } from '../src/game/core.ts'
import { missionActionsFor } from '../src/game/engine.ts'
import type { Action, GameState } from '../src/game/types.ts'

const GAMES = Number(process.argv[2] ?? 20)
let seed = 12345
const rnd = (n: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return (seed >>> 8) % n
}
const pick = <T>(a: T[]) => a[rnd(a.length)]

function allIds(s: GameState): string[] {
  const ids: string[] = [...s.monsterDeck, ...s.monsterDiscard, ...s.bossAside, ...s.findDiscard, ...s.removed,
    ...s.finds.red, ...s.finds.green, ...s.finds.blue, ...s.dropped.flatMap((d) => d.cards)]
  for (const p of s.players) ids.push(...p.deck, ...p.hand, ...p.discard, ...p.equip.flatMap((e) => [e.id, ...e.attached]), ...p.monsters.map((m) => m.id))
  for (const pd of s.pendings) {
    if (pd.kind === 'keepFinds') ids.push(...(pd.cards ?? []))
    if (pd.kind === 'fuel') ids.push(pd.data!.card as string)
  }
  return ids
}

function checkInvariants(s: GameState) {
  const ids = allIds(s)
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Карта задвоена: ${id}`)
    seen.add(id)
  }
  for (const p of s.players) for (const f of p.figures) if (f.hp < 0 || f.hp > f.maxHp) throw new Error(`Здоровье вне границ ${f.name} ${f.hp}`)
}

function candidates(s: GameState): Action[] {
  if (s.phase === 'setup') return [{ type: 'begin', seat: 0, first: rnd(s.players.length) }]
  const pd = s.pendings[0]
  if (pd) {
    const seat = pd.seat
    const out: Action[] = []
    if (pd.options) for (let i = 0; i < pd.options.length; i++) out.push({ type: 'choose', seat, option: i })
    if (pd.cards) {
      const hand = s.players[seat].hand
      const pool = pd.kind === 'discard' ? hand : pd.cards
      const n = pd.kind === 'discard' && pd.data?.limit ? Math.max(0, hand.length - 10) : Math.min(pd.pick ?? 1, pool.length)
      const shuffled = [...pool].sort(() => rnd(3) - 1)
      out.push({ type: 'choose', seat, cards: shuffled.slice(0, n) })
    }
    return out
  }
  const seat = s.turn.lent ? s.turn.lent.seat : s.turn.seat
  const p = s.players[seat]
  if (s.turn.stage === 'actions' && s.turn.actions === 0 && !s.turn.lent && s.turn.freeMoves === 0) {
    const del = [...p.hand, ...p.equip.map((e) => e.id)].map((card) => ({ type: 'deliver', seat, card }) as Action)
    return [...del, { type: 'endTurn', seat }]
  }
  const out: Action[] = []
  for (const t of neighbors(s, p.pos)) out.push({ type: 'move', seat, to: { x: t.x, y: t.y } })
  out.push({ type: 'draw', seat }, { type: 'search', seat }, { type: 'ability', seat })
  if (s.turn.lent) out.push({ type: 'pass', seat })
  const targets = s.players.flatMap((q) => q.monsters.map((m) => m.id))
  const tile = pick(s.tiles)
  const params = () => ({ targets: rnd(2) ? [pick(targets)].filter(Boolean) : undefined, players: [rnd(s.players.length)],
    tile: { x: tile.x, y: tile.y }, mode: rnd(2), weapon: pick(p.equip)?.id, card: pick([...p.discard, ...s.findDiscard]) })
  for (const card of p.hand) out.push({ type: 'play', seat, card, params: params() })
  for (const e of p.equip) out.push({ type: 'useGear', seat, equip: e.id, params: params() })
  for (const m of missionActionsFor(s, seat)) out.push({ type: 'mission', seat, kind: m.kind })
  for (const card of [...p.hand, ...p.equip.map((e) => e.id)]) out.push({ type: 'deliver', seat, card })
  if (p.hand.length >= 2) out.push({ type: 'freeDiscard', seat, cards: p.hand.slice(0, 2) })
  if (rnd(10) === 0 && p.equip.length) out.push({ type: 'discardGear', seat, equip: pick(p.equip).id })
  return out
}

const stats: Record<string, { won: number; lost: number; timeout: number; turns: number }> = {}
const reasons: Record<string, number> = {}
const errorsSeen: Record<string, number> = {}
let crashes = 0

for (const m of MISSIONS) {
  stats[m.id] = { won: 0, lost: 0, timeout: 0, turns: 0 }
  for (let g = 0; g < GAMES; g++) {
    const n = 1 + rnd(4)
    const decks = new Set<string>()
    const players = []
    while (players.length < n) {
      const c = pick(CHARACTERS)
      if (decks.has(c.deck)) continue
      decks.add(c.deck)
      players.push({ uid: `u${players.length}`, name: `Игрок${players.length + 1}`, hero: c.key })
    }
    let s = reduce(null, { type: 'create', seed: rnd(1e9), missionId: m.id, players })
    let steps = 0
    try {
      while (s.phase !== 'won' && s.phase !== 'lost' && steps < 3000) {
        const cands = candidates(s)
        let done = false
        for (let tries = 0; tries < 30 && !done; tries++) {
          const a = pick(cands)
          try {
            s = reduce(s, a)
            done = true
          } catch (e) {
            if (!(e instanceof GameError)) throw e
            errorsSeen[e.message] = (errorsSeen[e.message] ?? 0) + 1
          }
        }
        if (!done && s.pendings.length) {
          const msgs = cands.map((a) => {
            try {
              reduce(s, a)
              return 'ok'
            } catch (e) {
              return (e as Error).message
            }
          })
          throw new Error(`Застряли на выборе ${JSON.stringify(s.pendings[0])}: ${msgs.join(' / ')}`)
        }
        if (!done) {
          const seat = s.pendings[0]?.seat ?? (s.turn.lent ? s.turn.lent.seat : s.turn.seat)
          s = reduce(s, s.turn.lent ? { type: 'pass', seat } : s.turn.actions > 0 ? { type: 'draw', seat } : { type: 'endTurn', seat })
        }
        checkInvariants(s)
        steps++
      }
    } catch (e) {
      crashes++
      console.log(`СБОЙ ${m.id}: ${(e as Error).stack?.split('\n').slice(0, 4).join(' | ')}`)
      continue
    }
    const st = stats[m.id]
    if (s.phase === 'won') st.won++
    else if (s.phase === 'lost') {
      st.lost++
      reasons[s.result] = (reasons[s.result] ?? 0) + 1
    } else st.timeout++
    st.turns += s.round
  }
}

console.log('Миссия: победы / поражения / не закончили, средн. раундов')
for (const [id, st] of Object.entries(stats))
  console.log(`${id}: ${st.won} / ${st.lost} / ${st.timeout}, ${(st.turns / GAMES).toFixed(1)}`)
console.log('Причины поражений:', JSON.stringify(reasons))
console.log('Сбоев:', crashes)
const topErr = Object.entries(errorsSeen).sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log('Частые отказы движка (норма для случайного бота):')
for (const [msg, n] of topErr) console.log(`  ${n} × ${msg}`)
