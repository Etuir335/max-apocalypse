// Сетевая партия: тот же интерфейс GameStore, что и у локальной.
// Хост применяет действия движком и пишет состояние; остальные проверяют действие у себя и отправляют в очередь.
import { useCallback, useEffect, useRef, useState } from 'react'
import { tryReduce } from '../game/engine.ts'
import type { Action, GameState } from '../game/types.ts'
import type { GameStore } from '../ui/store.ts'
import {
  parseState,
  rejectAction,
  removeAction,
  sendAction,
  watchActions,
  watchMembers,
  watchRoom,
  writeState,
  type Member,
  type QueuedAction,
  type Room,
} from './room.ts'

export interface NetGame extends GameStore {
  /** undefined — ещё загружается, null — комнаты нет */
  room: Room | null | undefined
  members: Member[]
  isHost: boolean
  uid: string
  /** ошибка, присланная хостом на наше действие */
  remoteError: string
  clearRemoteError: () => void
}

/** Может ли этот участник действовать за место seat (свой персонаж; хост — ещё и за ботов) */
export function canActFor(s: GameState, uid: string, isHost: boolean, seat: number) {
  const p = s.players[seat]
  if (!p) return false
  return p.uid === uid || (isHost && !!p.bot)
}

const seatOf = (a: Action) => ('seat' in a ? a.seat : -1)

export function useNetGame(code: string, uid: string, onLeave: () => void): NetGame {
  const [room, setRoom] = useState<Room | null | undefined>(undefined)
  const [members, setMembers] = useState<Member[]>([])
  const [state, setState] = useState<GameState | null>(null)
  const [remoteError, setRemoteError] = useState('')
  const stateRef = useRef<{ s: GameState | null; v: number }>({ s: null, v: 0 })
  const isHost = !!room && room.host === uid

  // Комната и участники
  useEffect(() => {
    const offRoom = watchRoom(code, (r) => {
      setRoom(r)
      if (!r) return
      // старые снимки (меньшая версия) не затирают свежее состояние хоста
      if (r.v >= stateRef.current.v) {
        const s = parseState(r)
        stateRef.current = { s, v: r.v }
        setState(s)
      }
    })
    const offMembers = watchMembers(code, setMembers)
    return () => {
      offRoom()
      offMembers()
    }
  }, [code])

  // Хост: разбирает очередь действий по порядку (пока в ней что-то есть)
  const busy = useRef(false)
  const done = useRef(new Set<string>())
  const latest = useRef<QueuedAction[]>([])
  useEffect(() => {
    if (!isHost) return
    const drain = async () => {
      if (busy.current) return
      busy.current = true
      try {
        let q: QueuedAction | undefined
        while ((q = latest.current.find((x) => !x.error && !done.current.has(x.id)))) {
          done.current.add(q.id)
          const cur = stateRef.current.s
          const seat = seatOf(q.action)
          if (!cur || (q.action.type !== 'begin' && !canActFor(cur, q.uid, false, seat))) {
            await rejectAction(code, q.id, 'Это не ваш персонаж')
            continue
          }
          const r = tryReduce(cur, q.action)
          if (r.error || !r.state) {
            await rejectAction(code, q.id, r.error ?? 'Действие отклонено')
            continue
          }
          const v = stateRef.current.v + 1
          stateRef.current = { s: r.state, v }
          setState(r.state)
          await writeState(code, r.state, v)
          await removeAction(code, q.id)
        }
      } finally {
        busy.current = false
      }
    }
    return watchActions(code, (list) => {
      latest.current = list
      drain()
    })
  }, [code, isHost])

  // Не-хост: ловит отказы хоста на свои действия
  useEffect(() => {
    if (isHost) return
    return watchActions(code, (list) => {
      for (const q of list)
        if (q.uid === uid && q.error) {
          setRemoteError(q.error)
          removeAction(code, q.id).catch(() => {})
        }
    })
  }, [code, isHost, uid])

  const dispatch = useCallback(
    (a: Action): string | undefined => {
      const cur = stateRef.current.s
      if (!cur) return 'Партия ещё не началась'
      if (a.type === 'begin') {
        if (!isHost) return 'Начинает хост'
      } else if (!canActFor(cur, uid, isHost, seatOf(a))) return 'Это не ваш персонаж'
      const r = tryReduce(cur, a)
      if (r.error || !r.state) return r.error ?? 'Действие отклонено'
      if (isHost) {
        const v = stateRef.current.v + 1
        stateRef.current = { s: r.state, v }
        setState(r.state)
        writeState(code, r.state, v).catch((e: Error) => setRemoteError(`Не удалось сохранить ход: ${e.message}`))
      } else {
        sendAction(code, uid, a).catch((e: Error) => setRemoteError(`Не удалось отправить ход: ${e.message}`))
      }
      return undefined
    },
    [code, isHost, uid],
  )

  return {
    state,
    dispatch,
    reset: onLeave,
    room,
    members,
    isHost,
    uid,
    remoteError,
    clearRemoteError: () => setRemoteError(''),
  }
}
