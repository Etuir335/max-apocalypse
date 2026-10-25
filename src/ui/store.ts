// Локальная партия «за одним телефоном». В фазе 4 рядом появится сетевая (Firebase) с тем же интерфейсом.
import { useCallback, useState } from 'react'
import { tryReduce } from '../game/engine.ts'
import type { Action, GameState } from '../game/types.ts'

export interface GameStore {
  state: GameState | null
  /** Возвращает текст ошибки, если действие отклонено */
  dispatch: (a: Action) => string | undefined
  reset: () => void
}

const KEY = 'ma-local-game'

function load(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as GameState) : null
  } catch {
    return null
  }
}

function save(s: GameState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    // хранилище может быть недоступно — партия просто не сохранится
  }
}

export const hasSavedGame = () => !!load()

export function useLocalGame(): GameStore {
  const [state, setState] = useState<GameState | null>(load)
  const dispatch = useCallback(
    (a: Action) => {
      const r = tryReduce(state, a)
      if (r.error) return r.error
      setState(r.state)
      save(r.state)
      return undefined
    },
    [state],
  )
  const reset = useCallback(() => {
    setState(null)
    save(null)
  }, [])
  return { state, dispatch, reset }
}
