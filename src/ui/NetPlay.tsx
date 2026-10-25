// Сетевая игра: вход, создание комнаты / вход по коду, лобби, партия.
import { useEffect, useState, type ReactNode } from 'react'
import { assetUrl } from '../assets'
import { CHARACTERS } from '../game/data/characters.ts'
import { ensureUser, netConfigured } from '../net/firebase.ts'
import { createRoom, joinRoom, leaveRoom, startGame, updateMember, updateRoom, type BotSeat, type Member, type Room } from '../net/room.ts'
import { useNetGame } from '../net/useNetGame.ts'
import Game from './Game'
import { HeroButton, HeroPickSheet, MissionList } from './Setup'
import { inTelegram, shareInvite, tgStartRoom, tgUser } from '../telegram'

const LS_ROOM = 'ma-net-room'
const LS_NAME = 'ma-net-name'
const LS_HERO = 'ma-net-hero'
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      // не запомнится — не страшно
    }
  },
}
const deckOf = (hero: string) => CHARACTERS.find((c) => c.key === hero)?.deck ?? ''
const BOT_LEVELS = [
  { v: 1, label: 'лёгкий' },
  { v: 2, label: 'обычный' },
  { v: 3, label: 'сильный' },
]

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="page" style={{ backgroundImage: `url(${assetUrl('assets/ui/bg-menu.png')})` }}>
      <div className="overlay setup">{children}</div>
    </div>
  )
}

export default function NetPlay({ onBack }: { onBack: () => void }) {
  const [uid, setUid] = useState<string | null>(null)
  const [error, setError] = useState('')
  // приглашение в другую комнату важнее запомненной
  const [code, setCode] = useState<string | null>(() => {
    const invited = tgStartRoom()
    const saved = ls.get(LS_ROOM)
    return invited && invited !== saved ? null : saved
  })

  useEffect(() => {
    if (!netConfigured()) return
    ensureUser().then(
      (u) => setUid(u.uid),
      (e: Error) => setError(`Не удалось войти: ${e.message}`),
    )
  }, [])

  if (!netConfigured())
    return (
      <Page>
        <button className="btn small" onClick={onBack}>
          ← Меню
        </button>
        <h1>Игра по сети</h1>
        <p>Сетевая игра ещё не настроена: нужны ключи проекта Firebase в файле .env.local (см. инструкцию в NOTES.md).</p>
      </Page>
    )
  if (error)
    return (
      <Page>
        <button className="btn small" onClick={onBack}>
          ← Меню
        </button>
        <p className="error">{error}</p>
      </Page>
    )
  if (!uid)
    return (
      <Page>
        <p className="loading">Подключение…</p>
      </Page>
    )
  if (!code)
    return (
      <Entry uid={uid} onBack={onBack} onEnter={(c) => {
        ls.set(LS_ROOM, c)
        setCode(c)
      }} />
    )
  return (
    <NetRoom code={code} uid={uid} onBack={onBack} onLeave={() => {
      ls.set(LS_ROOM, null)
      setCode(null)
    }} />
  )
}

// ---------- Вход: имя, персонаж, создать / войти ----------

function Entry({ uid, onBack, onEnter }: { uid: string; onBack: () => void; onEnter: (code: string) => void }) {
  const [name, setName] = useState(() => ls.get(LS_NAME) ?? tgUser()?.name ?? 'Выживший')
  const [hero, setHero] = useState(() => ls.get(LS_HERO) ?? 'firefighter')
  // пришли по ссылке-приглашению — код уже вписан
  const [join, setJoin] = useState(() => tgStartRoom() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)

  const go = async (fn: () => Promise<string>) => {
    setBusy(true)
    setError('')
    ls.set(LS_NAME, name)
    ls.set(LS_HERO, hero)
    try {
      onEnter(await fn())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const clean = join.trim().toUpperCase()

  return (
    <Page>
      <button className="btn small" onClick={onBack}>
        ← Меню
      </button>
      <h1>Игра по сети</h1>
      <h2>Вы</h2>
      <div className="seat">
        <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} aria-label="Ваше имя" />
        <HeroButton hero={hero} onClick={() => setPicking(true)} />
      </div>

      <h2>Новая комната</h2>
      <button className="btn primary wide" disabled={busy || !name.trim()} onClick={() => go(() => createRoom(uid, name.trim(), hero))}>
        Создать комнату (вы — хост)
      </button>

      <h2>Войти по коду</h2>
      <div className="seat">
        <input value={join} maxLength={5} placeholder="Код из 5 знаков" onChange={(e) => setJoin(e.target.value)} aria-label="Код комнаты"
          style={{ textTransform: 'uppercase', letterSpacing: '0.2em' }} />
        <button className="btn primary" disabled={busy || clean.length !== 5 || !name.trim()}
          onClick={() => go(async () => {
            await joinRoom(clean, uid, name.trim(), hero)
            return clean
          })}>
          Войти
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Хост держит партию у себя: пока идёт игра, у хоста приложение должно быть открыто. Боты тоже ходят с устройства хоста.</p>

      {picking && (
        <HeroPickSheet title="Ваш персонаж" current={hero} takenBy={() => undefined}
          onPick={(h) => {
            setHero(h)
            setPicking(false)
          }}
          onClose={() => setPicking(false)} />
      )}
    </Page>
  )
}

// ---------- Комната: лобби или партия ----------

function NetRoom({ code, uid, onBack, onLeave }: { code: string; uid: string; onBack: () => void; onLeave: () => void }) {
  const net = useNetGame(code, uid, onLeave)

  if (net.room === undefined)
    return (
      <Page>
        <p className="loading">Загрузка комнаты {code}…</p>
      </Page>
    )
  if (net.room === null)
    return (
      <Page>
        <p className="error">Комнаты {code} больше нет.</p>
        <button className="btn" onClick={onLeave}>
          Назад
        </button>
      </Page>
    )
  if (net.room.status === 'lobby') return <Lobby room={net.room} members={net.members} uid={uid} onBack={onBack} onLeave={onLeave} />
  if (!net.state)
    return (
      <Page>
        <p className="loading">Загрузка партии…</p>
      </Page>
    )
  return (
    <Game store={net} onMenu={onBack}
      net={{
        code,
        isHost: net.isHost,
        isMine: (seat) => net.state?.players[seat]?.uid === uid,
        remoteError: net.remoteError,
        clearRemoteError: net.clearRemoteError,
      }} />
  )
}

function Lobby({ room, members, uid, onBack, onLeave }: { room: Room; members: Member[]; uid: string; onBack: () => void; onLeave: () => void }) {
  const isHost = room.host === uid
  const [picking, setPicking] = useState<{ kind: 'me' } | { kind: 'bot'; id: string } | null>(null)
  const [error, setError] = useState('')
  const me = members.find((m) => m.uid === uid)

  // кто занял колоду (кроме того, кто сейчас выбирает)
  const takenBy = (deck: string, except: string) => {
    const m = members.find((x) => x.uid !== except && deckOf(x.hero) === deck)
    if (m) return m.name
    const b = room.bots.find((x) => `bot-${x.id}` !== except && deckOf(x.hero) === deck)
    return b?.name
  }
  const total = members.length + room.bots.length
  const decks = [...members.map((m) => deckOf(m.hero)), ...room.bots.map((b) => deckOf(b.hero))]
  const clash = new Set(decks).size !== decks.length

  const addBot = () => {
    const free = CHARACTERS.find((c) => !decks.includes(c.deck))
    if (!free || total >= 4) return
    const bot: BotSeat = { id: Math.random().toString(36).slice(2, 8), name: `Бот ${room.bots.length + 1}`, hero: free.key, level: 2 }
    updateRoom(room.code, { bots: [...room.bots, bot] }).catch((e: Error) => setError(e.message))
  }
  const setBot = (id: string, patch: Partial<BotSeat>) =>
    updateRoom(room.code, { bots: room.bots.map((b) => (b.id === id ? { ...b, ...patch } : b)) }).catch((e: Error) => setError(e.message))

  const [shared, setShared] = useState('')
  const share = () => setShared(shareInvite(room.code))

  return (
    <Page>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn small" onClick={onBack}>
          ← Меню
        </button>
        <button className="btn small" onClick={() => leaveRoom(room.code, uid).finally(onLeave)}>
          Выйти из комнаты
        </button>
      </div>
      <h1>
        Комната <span className="bigcode">{room.code}</span>
      </h1>
      <p className="muted">
        Скажите друзьям этот код: «Игра по сети» → «Войти по коду».{' '}
        <button className="btn small" onClick={share}>
          {inTelegram() ? 'Пригласить друзей' : 'Скопировать приглашение'}
        </button>
        {shared && <span className="muted"> {shared}</span>}
      </p>

      <h2>Выжившие ({total}/4)</h2>
      {members.map((m) => (
        <div key={m.uid} className="seat">
          <b>
            {room.host === m.uid ? '👑 ' : ''}
            {m.name}
            {m.uid === uid ? ' (вы)' : ''}
          </b>
          <HeroButton hero={m.hero} onClick={() => m.uid === uid && setPicking({ kind: 'me' })} />
        </div>
      ))}
      {room.bots.map((b) => (
        <div key={b.id} className="seat">
          <b>🤖 {b.name}</b>
          {isHost && (
            <>
              <select value={b.level} onChange={(e) => setBot(b.id, { level: Number(e.target.value) })} aria-label="Уровень бота">
                {BOT_LEVELS.map((l) => (
                  <option key={l.v} value={l.v}>
                    {l.label}
                  </option>
                ))}
              </select>
              <button className="btn small" onClick={() => updateRoom(room.code, { bots: room.bots.filter((x) => x.id !== b.id) })} aria-label="Убрать бота">
                ✕
              </button>
            </>
          )}
          <HeroButton hero={b.hero} onClick={() => isHost && setPicking({ kind: 'bot', id: b.id })} />
        </div>
      ))}
      {isHost && total < 4 && (
        <button className="btn" onClick={addBot}>
          + Добавить бота
        </button>
      )}

      <h2>Миссия</h2>
      <MissionList value={room.missionId} disabled={!isHost} onChange={(id) => updateRoom(room.code, { missionId: id })} />
      <label className="check">
        <input type="checkbox" checked={room.hardcore} disabled={!isHost} onChange={(e) => updateRoom(room.code, { hardcore: e.target.checked })} />
        Хардкор: поражение, если погибнет хотя бы один
      </label>

      {clash && <p className="error">Два выживших с одной колодой — кому-то нужно выбрать другого персонажа.</p>}
      {error && <p className="error">{error}</p>}
      {isHost ? (
        <button className="btn primary wide" disabled={clash || total === 0}
          onClick={() => startGame(room, members).catch((e: Error) => setError(e.message))}>
          Начать партию
        </button>
      ) : (
        <p className="muted">Ждём, пока хост начнёт партию…</p>
      )}

      {picking && (
        <HeroPickSheet
          title={picking.kind === 'me' ? 'Ваш персонаж' : 'Персонаж бота'}
          current={picking.kind === 'me' ? me?.hero ?? '' : room.bots.find((b) => b.id === picking.id)?.hero ?? ''}
          takenBy={(deck) => takenBy(deck, picking.kind === 'me' ? uid : `bot-${picking.id}`)}
          onPick={(h) => {
            if (picking.kind === 'me') updateMember(room.code, uid, { hero: h }).catch((e: Error) => setError(e.message))
            else setBot(picking.id, { hero: h })
            setPicking(null)
          }}
          onClose={() => setPicking(null)} />
      )}
    </Page>
  )
}
