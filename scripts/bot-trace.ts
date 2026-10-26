// Разбор одной партии ботов: что делали по раундам. node scripts/bot-trace.ts [миссия] [мс] [seed]
import { reduce, tryReduce } from '../src/game/engine.ts'
import { decider } from '../src/ai/legal.ts'
import { policyStep } from '../src/ai/evaluate.ts'
import { think } from '../src/ai/mcts.ts'
import { tileAt, tileDef } from '../src/game/core.ts'
import type { GameState } from '../src/game/types.ts'

const [mission = 'm1', ms = '200', seed = '1001'] = process.argv.slice(2)
let s: GameState = reduce(null, { type: 'create', seed: Number(seed), missionId: mission, players: [
  { uid: 'a', name: 'Бот1', hero: 'firefighter' }, { uid: 'b', name: 'Бот2', hero: 'gunslinger' }] })
while (s.phase === 'setup' && decider(s) !== null) s = reduce(s, { type: 'mulligan', seat: decider(s)!, cards: [] })
s = reduce(s, { type: 'begin', seat: 0, first: 0 })
const counts: Record<string, number> = {}
const total: Record<string, number> = {}
let round = 0
let n = 0
while (s.phase === 'play' && n++ < 1500) {
  if (s.round !== round) {
    round = s.round
    if (process.env.QUIET) { for (const k in counts) delete counts[k]; continue }
    console.log(`R${round} ` + s.players.map((p) => `${p.name}@${tileAt(s, p.pos) ? tileDef(tileAt(s, p.pos)!).name : '?'} hp${p.figures.reduce((a, f) => a + f.hp, 0)} голод${p.hunger} мон${p.monsters.length} кол${p.deck.length}`).join(' | ') +
      ` | ${JSON.stringify(counts)}`)
    for (const k in counts) delete counts[k]
  }
  const r = think(s, 2, Number(ms))
  const a = r?.action
  const res = a ? tryReduce(s, a) : null
  if (a) counts[a.type] = (counts[a.type] ?? 0) + 1
  if (a) total[a.type] = (total[a.type] ?? 0) + 1
  s = res && !res.error && res.state ? res.state : policyStep(s)!
  if (!s) break
}
console.log(s.phase, s.result, 'раундов', s.round, JSON.stringify(total))
