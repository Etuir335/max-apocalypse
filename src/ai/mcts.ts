// Бот: поиск по дереву Монте-Карло (MCTS/UCT) с детерминизацией скрытой информации (ISMCTS-lite).
// Перед каждым розыгрышем перемешиваем то, чего игрок за столом не знает: колоды монстров, находок, выживших
// и какие тайлы лежат рубашкой вверх. Движок не трогаем — только reduce/tryReduce.
import { tryReduce } from '../game/engine.ts'
import type { Action, GameState } from '../game/types.ts'
import { evaluate, policyStep } from './evaluate.ts'
import { actionKey, decider, legalActions } from './legal.ts'

export type Level = 1 | 2 | 3
export const LEVELS: Record<Level, { name: string; timeMs: number; horizon: 'turn' | 'round' }> = {
  1: { name: 'Лёгкий', timeMs: 200, horizon: 'turn' },
  2: { name: 'Обычный', timeMs: 700, horizon: 'turn' },
  // прокрутка до конца раунда проверена — хуже: втрое меньше розыгрышей за то же время
  3: { name: 'Сильный', timeMs: 1800, horizon: 'turn' },
}

interface Node {
  a: Action | null
  n: number
  w: number
  kids: Map<string, Node>
}
const node = (a: Action | null): Node => ({ a, n: 0, w: 0, kids: new Map() })

const shuffle = <T>(list: T[]) => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/** Копия состояния, где всё скрытое перемешано заново */
export function determinize(s: GameState): GameState {
  const d = structuredClone(s)
  d.rng = Math.floor(Math.random() * 2 ** 31)
  shuffle(d.monsterDeck)
  shuffle(d.finds.red)
  shuffle(d.finds.green)
  shuffle(d.finds.blue)
  for (const p of d.players) shuffle(p.deck)
  const hidden = d.tiles.filter((t) => !t.revealed)
  const keys = shuffle(hidden.map((t) => t.key))
  hidden.forEach((t, i) => (t.key = keys[i]))
  return d
}

const C = 0.7
const ucb = (parent: Node, k: Node) => (k.n === 0 ? Infinity : k.w / k.n + C * Math.sqrt(Math.log(parent.n + 1) / k.n))

function rollout(s: GameState, rootSeat: number, horizon: 'turn' | 'round'): GameState {
  let cur = s
  let left = cur.turn.seat !== rootSeat
  for (let i = 0; i < 160; i++) {
    if (cur.phase === 'won' || cur.phase === 'lost') break
    if (cur.turn.seat !== rootSeat) {
      if (horizon === 'turn') break
      left = true
    } else if (left && horizon === 'round') break
    const next = policyStep(cur)
    if (!next) break
    cur = next
  }
  return cur
}

export interface ThinkResult {
  action: Action
  iterations: number
  value: number
}

/** Подумать и вернуть лучший ход для того, кто сейчас решает. */
export function think(s: GameState, level: Level = 2, timeOverride?: number): ThinkResult | null {
  const seat = decider(s)
  if (seat === null) return null
  const { horizon } = LEVELS[level]
  const timeMs = timeOverride ?? LEVELS[level].timeMs
  if (s.phase === 'setup') return { action: { type: 'mulligan', seat, cards: [] }, iterations: 0, value: 0 }

  // Корневые ходы — только допустимые в настоящем состоянии
  const seen = new Set<string>()
  const roots: Action[] = []
  for (const a of legalActions(s)) {
    const k = actionKey(a)
    if (seen.has(k) || tryReduce(s, a).error) continue
    seen.add(k)
    roots.push(a)
  }
  if (!roots.length) return null
  if (roots.length === 1) return { action: roots[0], iterations: 0, value: 0 }

  const root = node(null)
  for (const a of roots) root.kids.set(actionKey(a), node(a))
  const rootSeat = s.turn.seat
  const t0 = Date.now()
  let iter = 0

  while (Date.now() - t0 < timeMs || iter < roots.length) {
    iter++
    let cur = determinize(s)
    const path: Node[] = [root]
    let nd = root
    // Спуск по дереву, пока идёт тот же ход
    for (let depth = 0; depth < 12; depth++) {
      if (cur.phase === 'won' || cur.phase === 'lost') break
      if (depth > 0 && cur.turn.seat !== rootSeat) break
      if (depth > 0) {
        // расширение: добавляем новые ходы постепенно (progressive widening)
        const limit = 2 + Math.floor(Math.sqrt(nd.n))
        if (nd.kids.size < limit) {
          const acts = legalActions(cur).filter((a) => !nd.kids.has(actionKey(a)))
          let added = false
          while (acts.length) {
            const a = acts.splice(Math.floor(Math.random() * acts.length), 1)[0]
            const res = tryReduce(cur, a)
            if (res.error || !res.state) continue
            const kid = node(a)
            nd.kids.set(actionKey(a), kid)
            path.push(kid)
            nd = kid
            cur = res.state
            added = true
            break
          }
          if (added) break
        }
      }
      // выбор по UCB среди уже известных ходов
      const kids = [...nd.kids.values()].sort((x, y) => ucb(nd, y) - ucb(nd, x))
      let moved = false
      for (const k of kids) {
        const res = tryReduce(cur, k.a!)
        if (res.error || !res.state) continue
        path.push(k)
        nd = k
        cur = res.state
        moved = true
        break
      }
      if (!moved || nd.n === 0) break
    }
    const end = rollout(cur, rootSeat, horizon)
    const v = evaluate(end)
    for (const n of path) {
      n.n++
      n.w += v
    }
    if (iter > 20000) break
  }

  const best = [...root.kids.values()].sort((a, b) => b.n - a.n || b.w / Math.max(1, b.n) - a.w / Math.max(1, a.n))[0]
  return { action: best.a!, iterations: iter, value: best.n ? best.w / best.n : 0 }
}
