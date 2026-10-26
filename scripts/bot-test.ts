// Проверка ботов без браузера: партии, где все места — боты.
// Запуск: node scripts/bot-test.ts [миссия] [партий] [мс на ход]
import { reduce, tryReduce } from '../src/game/engine.ts'
import { decider, legalActions } from '../src/ai/legal.ts'
import { policyStep } from '../src/ai/evaluate.ts'
import { think } from '../src/ai/mcts.ts'
import type { GameState } from '../src/game/types.ts'

const mission = process.argv[2] ?? 'm0'
const games = Number(process.argv[3] ?? 3)
const ms = Number(process.argv[4] ?? 80)

type Mode = 'random' | 'policy' | 'mcts'

function play(mode: Mode, seed: number): { s: GameState; decisions: number; iters: number } {
  let s = reduce(null, { type: 'create', seed, missionId: mission, players: [
    { uid: 'a', name: 'Бот1', hero: 'firefighter' },
    { uid: 'b', name: 'Бот2', hero: 'gunslinger' },
  ] })
  while (s.phase === 'setup' && decider(s) !== null) s = reduce(s, { type: 'mulligan', seat: decider(s)!, cards: [] })
  s = reduce(s, { type: 'begin', seat: 0, first: 0 })
  let decisions = 0
  let iters = 0
  while (s.phase === 'play' && decisions < 1500) {
    decisions++
    let next: GameState | null = null
    if (mode === 'policy') next = policyStep(s)
    else if (mode === 'random') {
      const acts = legalActions(s).sort(() => Math.random() - 0.5)
      for (const a of acts) {
        const r = tryReduce(s, a)
        if (!r.error) {
          next = r.state
          break
        }
      }
      if (!next) next = policyStep(s)
    } else {
      const r = think(s, 2, ms)
      if (r) {
        iters += r.iterations
        const res = tryReduce(s, r.action)
        next = res.error ? policyStep(s) : res.state
      }
    }
    if (!next) break
    s = next
  }
  return { s, decisions, iters }
}

const modes = (process.argv[5]?.split(',') ?? ['random', 'policy', 'mcts']) as Mode[]
for (const mode of modes) {
  let won = 0
  let rounds = 0
  let iters = 0
  let dec = 0
  const t0 = Date.now()
  const reasons: string[] = []
  let revealedSum = 0
  let starved = 0
  for (let g = 0; g < games; g++) {
    const r = play(mode, 1000 + Number(process.argv[6] ?? 0) + g)
    if (r.s.phase === 'won') won++
    else reasons.push(r.s.result || r.s.phase)
    if (r.s.phase === 'play')
      console.log(`  [${mode}] не доиграно: решений ${r.decisions}, ждём ${JSON.stringify(r.s.pendings[0] ?? r.s.turn)}\n  ${r.s.log.slice(-4).join(' | ')}`)
    rounds += r.s.round
    revealedSum += r.s.tiles.filter((x) => x.revealed).length / r.s.tiles.length
    starved += r.s.players.filter((p) => p.exhausted || p.hunger >= 5).length
    iters += r.iters
    dec += r.decisions
  }
  console.log(`${mode.padEnd(6)} побед ${won}/${games}, раундов в среднем ${(rounds / games).toFixed(1)}, ` +
    `решений ${dec}${mode === 'mcts' ? `, розыгрышей на решение ${(iters / Math.max(1, dec)).toFixed(0)}` : ''}, ` +
    `открыто ${Math.round((100 * revealedSum) / games)}%, голодных к концу ${starved}, ` +
    `${((Date.now() - t0) / 1000).toFixed(0)} с. Поражения: ${[...new Set(reasons)].join('; ')}`)
}
