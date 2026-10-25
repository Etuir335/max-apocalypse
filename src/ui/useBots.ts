// Ходы ботов: когда решать должен бот — просим фоновый поток подумать и применяем ход с небольшой паузой.
import { useEffect, useRef, useState } from 'react'
import { decider } from '../ai/legal.ts'
import { think, type Level } from '../ai/mcts.ts'
import type { Action, GameState } from '../game/types.ts'

const MIN_DELAY = 650 // чтобы люди успевали следить за ходами бота

export function botToMove(s: GameState | null): number | null {
  if (!s || s.phase === 'won' || s.phase === 'lost') return null
  const seat = decider(s)
  return seat !== null && s.players[seat]?.bot ? seat : null
}

/** Запасные ходы, если бот не смог ничего придумать */
function fallbacks(s: GameState, seat: number): Action[] {
  if (s.phase === 'setup') return [{ type: 'mulligan', seat, cards: [] }]
  const pd = s.pendings[0]
  if (pd) {
    const out: Action[] = (pd.options ?? []).map((_, i) => ({ type: 'choose', seat, option: i }) as Action)
    const pool = pd.kind === 'discard' ? s.players[seat].hand : pd.cards ?? []
    const n = Math.max(1, pd.pick ?? 1)
    if (pool.length) out.push({ type: 'choose', seat, cards: pool.slice(0, n) })
    return out
  }
  return [{ type: 'draw', seat }, { type: 'endTurn', seat }, { type: 'pass', seat }]
}

export function useBots(s: GameState | null, dispatch: (a: Action) => string | undefined, enabled = true) {
  const worker = useRef<Worker | null>(null)
  const counter = useRef(0)
  const [thinking, setThinking] = useState<number | null>(null)

  useEffect(() => {
    try {
      worker.current = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' })
    } catch {
      worker.current = null
    }
    return () => worker.current?.terminate()
  }, [])

  useEffect(() => {
    const seat = enabled ? botToMove(s) : null
    if (seat === null || !s) {
      setThinking(null)
      return
    }
    // в подготовке бот только «оставляет руку»
    if (s.phase === 'setup') {
      const t = setTimeout(() => dispatch({ type: 'mulligan', seat, cards: [] }), 300)
      return () => clearTimeout(t)
    }
    let cancelled = false
    const id = ++counter.current
    const started = Date.now()
    const level = (s.players[seat].bot ?? 2) as Level
    setThinking(seat)

    const apply = (action: Action | null) => {
      if (cancelled) return
      const wait = Math.max(0, MIN_DELAY - (Date.now() - started))
      setTimeout(() => {
        if (cancelled) return
        if (action && !dispatch(action)) return
        for (const a of fallbacks(s, seat)) if (!dispatch(a)) return
      }, wait)
    }

    const w = worker.current
    if (w) {
      w.onmessage = (e: MessageEvent<{ id: number; action: Action | null }>) => {
        if (e.data.id === id) apply(e.data.action)
      }
      w.onerror = () => apply(null)
      w.postMessage({ id, state: s, level })
    } else {
      // без фоновых потоков — думаем коротко в основном потоке
      const t = setTimeout(() => apply(think(s, level, 150)?.action ?? null), 50)
      return () => {
        cancelled = true
        clearTimeout(t)
      }
    }
    return () => {
      cancelled = true
    }
  }, [s, dispatch, enabled])

  return thinking
}
