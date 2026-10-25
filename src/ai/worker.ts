// Фоновый поток для бота: думает, не подвешивая интерфейс.
import { think, type Level } from './mcts.ts'
import type { Action, GameState } from '../game/types.ts'

interface Req {
  id: number
  state: GameState
  level: Level
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage: (m: unknown) => void }

ctx.onmessage = (e) => {
  const { id, state, level } = e.data
  let action: Action | null = null
  try {
    action = think(state, level)?.action ?? null
  } catch {
    action = null
  }
  ctx.postMessage({ id, action })
}
