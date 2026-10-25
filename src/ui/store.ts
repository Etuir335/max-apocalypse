// Локальная партия «за одним телефоном». В фазе 4 рядом появится сетевая (Firebase) с тем же интерфейсом.
import { useCallback, useRef, useState } from 'react'
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
    // не записалось (нет места и т. п.) — убираем старое сохранение, чтобы после перезагрузки
    // не вернуться в давно прошедшую партию
    try {
      localStorage.removeItem(KEY)
      if (s) localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      // хранилище недоступно — партия просто не сохранится
    }
  }
}

export const hasSavedGame = () => !!load()

export function useLocalGame(): GameStore {
  const [state, setState] = useState<GameState | null>(load)
  // текущая партия; действия всегда применяются к ней, а не к снимку из прошлой отрисовки
  // (иначе два быстрых действия подряд — бот и клик — откатывали партию назад)
  const cur = useRef(state)
  const dispatch = useCallback((a: Action) => {
    const r = tryReduce(cur.current, a)
    if (r.error) return r.error
    cur.current = r.state
    setState(r.state)
    save(r.state)
    return undefined
  }, [])
  const reset = useCallback(() => {
    cur.current = null
    setState(null)
    save(null)
  }, [])
  return { state, dispatch, reset }
}
