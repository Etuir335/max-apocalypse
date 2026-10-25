// Настройка партии: миссия, игроки и персонажи.
import { useState } from 'react'
import { assetUrl } from '../assets'
import { CHARACTERS } from '../game/data/characters.ts'
import { MISSIONS } from '../game/data/missions.ts'
import type { Action } from '../game/types.ts'
import { Sheet, useZoom } from './common'
import { useImages } from './images'

interface Seat {
  name: string
  hero: string
  /** уровень бота 1–3; 0 — человек */
  bot: number
}

const CONTROL = [
  { v: 0, label: '👤 Человек' },
  { v: 1, label: '🤖 Бот: лёгкий' },
  { v: 2, label: '🤖 Бот: обычный' },
  { v: 3, label: '🤖 Бот: сильный' },
]

const SET_NAMES = { Z: 'Зомби', A: 'Пришельцы', R: 'Роботы', M: 'Мутанты' }

export default function Setup({ onBack, onCreate }: { onBack: () => void; onCreate: (a: Action) => string | undefined }) {
  const [missionId, setMissionId] = useState('m0')
  const [seats, setSeats] = useState<Seat[]>([
    { name: 'Игрок 1', hero: 'firefighter', bot: 0 },
    { name: 'Игрок 2', hero: 'surgeon', bot: 0 },
  ])
  const [hardcore, setHardcore] = useState(false)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState<number | null>(null)
  const mission = MISSIONS.find((m) => m.id === missionId)!

  const deckOf = (hero: string) => CHARACTERS.find((c) => c.key === hero)!.deck
  const update = (i: number, patch: Partial<Seat>) => setSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  const addSeat = () => {
    const free = CHARACTERS.find((c) => !seats.some((s) => deckOf(s.hero) === c.deck))
    if (free && seats.length < 4) setSeats([...seats, { name: `Бот ${seats.length + 1}`, hero: free.key, bot: 2 }])
  }

  const start = () => {
    const err = onCreate({
      type: 'create',
      seed: Math.floor(Math.random() * 2 ** 31),
      missionId,
      hardcore,
      players: seats.map((s, i) => ({ uid: `local-${i}`, name: s.name.trim() || `Игрок ${i + 1}`, hero: s.hero, ...(s.bot ? { bot: s.bot } : {}) })),
    })
    if (err) setError(err)
  }

  return (
    <div className="page" style={{ backgroundImage: `url(${assetUrl('assets/ui/bg-menu.png')})` }}>
      <div className="overlay setup">
        <button className="btn small" onClick={onBack}>
          ← Меню
        </button>
        <h1>Новая игра</h1>

        <h2>Миссия</h2>
        <div className="mission-list">
          {MISSIONS.map((m) => (
            <button key={m.id} className={`mission ${m.id === missionId ? 'active' : ''}`} onClick={() => setMissionId(m.id)}>
              <b>
                {m.num}. {m.name}
              </b>
              <span>
                {m.difficulty} · {SET_NAMES[m.set]}
              </span>
            </button>
          ))}
        </div>
        <p className="mission-text">{mission.text}</p>

        <h2>Выжившие ({seats.length}/4)</h2>
        {seats.map((s, i) => (
          <div key={i} className="seat">
            <input value={s.name} maxLength={16} onChange={(e) => update(i, { name: e.target.value })} aria-label="Имя игрока" />
            <select value={s.bot} onChange={(e) => update(i, { bot: Number(e.target.value) })} aria-label="Кто играет">
              {CONTROL.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.label}
                </option>
              ))}
            </select>
            {seats.length > 1 && (
              <button className="btn small" onClick={() => setSeats(seats.filter((_, j) => j !== i))} aria-label="Убрать игрока">
                ✕
              </button>
            )}
            <HeroButton hero={s.hero} onClick={() => setPicking(i)} />
          </div>
        ))}
        {seats.length < 4 && (
          <button className="btn" onClick={addSeat}>
            + Добавить игрока
          </button>
        )}

        <p className="muted small">
          Боты — ваши союзники: они ищут топливо, сражаются и выполняют цель миссии вместе с вами. Чем сильнее бот, тем дольше он думает над
          каждым действием (примерно 0,2 / 0,7 / 1,8 секунды).
        </p>

        <label className="check">
          <input type="checkbox" checked={hardcore} onChange={(e) => setHardcore(e.target.checked)} />
          Хардкор: поражение, если погибнет хотя бы один
        </label>

        {error && <p className="error">{error}</p>}
        <button className="btn primary wide" onClick={start}>
          Начать
        </button>
      </div>

      {picking !== null && (
        <Sheet title={`Персонаж: ${seats[picking].name}`} onClose={() => setPicking(null)}>
          <p className="muted">Колода персонажа одна на партию: оба варианта одного класса (М/Ж) взять нельзя. 🔍 на портрете — увеличить карту.</p>
          <div className="hero-grid">
            {CHARACTERS.map((c) => {
              const owner = seats.findIndex((x, j) => j !== picking && deckOf(x.hero) === c.deck)
              return (
                <HeroCard key={c.key} hero={c.key} on={seats[picking].hero === c.key} takenBy={owner >= 0 ? seats[owner].name : undefined}
                  onPick={() => {
                    update(picking, { hero: c.key })
                    setPicking(null)
                  }} />
              )
            })}
          </div>
        </Sheet>
      )}
    </div>
  )
}

const RANGE_RU = { short: 'короткая', medium: 'средняя', long: 'дальняя' }

export function HeroButton({ hero, onClick }: { hero: string; onClick: () => void }) {
  const img = useImages()
  const c = CHARACTERS.find((x) => x.key === hero)!
  return (
    <button className="hero-pick" onClick={onClick}>
      <img src={img.face(c.figures[0].image)} alt="" />
      <span>
        <b>{c.name}</b>
        <div className="hp-line">
          {c.figures.map((f) => `${f.name}: ❤${f.hp} 👁${f.stealth}`).join(' · ')}
        </div>
        <div className="hp-line">
          ★ {c.ability.name}: {c.ability.text}
        </div>
        <div className="hp-line" style={{ color: 'var(--accent)' }}>
          Нажмите, чтобы выбрать другого
        </div>
      </span>
    </button>
  )
}

function HeroCard({ hero, on, takenBy, onPick }: { hero: string; on: boolean; takenBy?: string; onPick: () => void }) {
  const img = useImages()
  const zoom = useZoom()
  const c = CHARACTERS.find((x) => x.key === hero)!
  return (
    <div className={`hero-card ${on ? 'on' : ''}`} style={takenBy ? { opacity: 0.4 } : undefined}>
      <div className="portraits">
        {c.figures.map((f) => (
          <span key={f.name} className="cbtn">
            <img src={img.face(f.image)} alt="" />
            <button type="button" className="czoom" onClick={() => zoom(img.face(f.image))} aria-label="Увеличить">
              🔍
            </button>
          </span>
        ))}
      </div>
      <b>{c.name}</b>
      {c.figures.map((f) => (
        <small key={f.name}>
          {f.name}: ❤ {f.hp} · 👁 {f.stealth} (истощён {f.stealthTired})
        </small>
      ))}
      <small>
        ★ <b>{c.ability.name}</b>
        {c.ability.range ? ` (${RANGE_RU[c.ability.range]})` : ''}: {c.ability.text}
      </small>
      {takenBy ? (
        <span className="taken">Колода занята: {takenBy}</span>
      ) : (
        <button className={`btn small ${on ? 'primary' : ''}`} onClick={onPick}>
          {on ? 'Выбран' : 'Выбрать'}
        </button>
      )}
    </div>
  )
}

// ---------- Для лобби сетевой игры ----------

export function MissionList({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const mission = MISSIONS.find((m) => m.id === value)!
  return (
    <>
      <div className="mission-list">
        {MISSIONS.map((m) => (
          <button key={m.id} className={`mission ${m.id === value ? 'active' : ''}`} disabled={disabled && m.id !== value}
            onClick={() => !disabled && onChange(m.id)}>
            <b>
              {m.num}. {m.name}
            </b>
            <span>
              {m.difficulty} · {SET_NAMES[m.set]}
            </span>
          </button>
        ))}
      </div>
      <p className="mission-text">{mission.text}</p>
    </>
  )
}

/** Окно выбора персонажа; takenBy(deck) — кто уже занял колоду этого класса */
export function HeroPickSheet({ title, current, takenBy, onPick, onClose }: {
  title: string
  current: string
  takenBy: (deck: string) => string | undefined
  onPick: (hero: string) => void
  onClose: () => void
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="muted">Колода персонажа одна на партию: оба варианта одного класса (М/Ж) взять нельзя.</p>
      <div className="hero-grid">
        {CHARACTERS.map((c) => (
          <HeroCard key={c.key} hero={c.key} on={current === c.key} takenBy={takenBy(c.deck)} onPick={() => onPick(c.key)} />
        ))}
      </div>
    </Sheet>
  )
}