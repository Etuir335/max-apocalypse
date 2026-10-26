// Сколько ходов боты стоят на месте: node scripts/bot-idle.ts [миссия] [мс] [seed]
import { reduce, tryReduce } from '../src/game/engine.ts'
import { decider } from '../src/ai/legal.ts'
import { policyStep } from '../src/ai/evaluate.ts'
import { think } from '../src/ai/mcts.ts'
import { tileAt, tileDef } from '../src/game/core.ts'
import type { Action, GameState } from '../src/game/types.ts'

const [mission = 'm0', ms = '150', seed = '1001'] = process.argv.slice(2)
let s: GameState = reduce(null, { type: 'create', seed: Number(seed), missionId: mission, players: [
  { uid: 'a', name: 'Бот1', hero: 'firefighter' }, { uid: 'b', name: 'Бот2', hero: 'gunslinger' }] })
while (s.phase === 'setup' && decider(s) !== null) s = reduce(s, { type: 'mulligan', seat: decider(s)!, cards: [] })
s = reduce(s, { type: 'begin', seat: 0, first: 0 })
let turns = 0, stay = 0, idle = 0, n = 0
let cur = { seat: -1, pos: '', mons: 0, acts: [] as string[], tile: '' }
const idleWhat: Record<string, number> = {}
const close = () => {
  if (cur.seat < 0) return
  turns++
  const p = s.players[cur.seat]
  if (`${p.pos.x},${p.pos.y}` === cur.pos) {
    stay++
    if (!cur.mons && !cur.acts.includes('search')) {
      idle++
      const k = `${cur.tile}: ${[...new Set(cur.acts)].join('+')}`
      idleWhat[k] = (idleWhat[k] ?? 0) + 1
    }
  }
}
while (s.phase === 'play' && n++ < 1500) {
  const seat = s.turn.seat
  if (seat !== cur.seat || s.turn.actions === 4 && cur.acts.includes('endTurn')) {
    close()
    const p = s.players[seat]
    const t = tileAt(s, p.pos)
    cur = { seat, pos: `${p.pos.x},${p.pos.y}`, mons: p.monsters.length, acts: [], tile: t ? tileDef(t).name : '?' }
  }
  const r = think(s, 2, Number(ms))
  const a: Action | undefined = r?.action
  if (a) cur.acts.push(a.type)
  const res = a ? tryReduce(s, a) : null
  s = res && !res.error && res.state ? res.state : policyStep(s)!
  if (!s) break
}
console.log(JSON.stringify({ turns, stay, idle, res: s.phase, idleWhat }))
