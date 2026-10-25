// Вопрос движка к игроку (pending): варианты и/или выбор карт.
import { useState } from 'react'
import { HAND_LIMIT } from '../game/rules.ts'
import type { Action, GameState } from '../game/types.ts'
import { CardImg, Sheet } from './common'

export default function PendingSheet({ s, act }: { s: GameState; act: (a: Action) => void }) {
  const pd = s.pendings[0]
  const [picked, setPicked] = useState<string[]>([])
  const p = s.players[pd.seat]
  // для сброса с руки — актуальная рука и актуальное число
  const cards = pd.kind === 'discard' ? p.hand : pd.cards ?? []
  const need = pd.kind === 'discard' ? (pd.data?.limit ? Math.max(0, p.hand.length - HAND_LIMIT) : Math.min(pd.pick ?? 0, p.hand.length))
    : Math.min(pd.pick ?? 1, cards.length)
  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < need ? [...picked, id] : need === 1 ? [id] : picked)

  return (
    <Sheet title={`${p.name}: выбор`}>
      <p className="handoff">Передайте телефон: {p.name}</p>
      <p>{pd.prompt}</p>
      {cards.length > 0 && (
        <>
          <div className="row wrap">
            {cards.map((id) => <CardImg key={id} id={id} className="cimg large" caption selected={picked.includes(id)} onClick={() => toggle(id)} />)}
          </div>
          <button className="btn primary wide" disabled={picked.length !== need}
            onClick={() => {
              act({ type: 'choose', seat: pd.seat, cards: picked })
              setPicked([])
            }}>
            Выбрать ({picked.length}/{need})
          </button>
        </>
      )}
      {pd.options?.map((o, i) => (
        <button key={i} className="btn wide" onClick={() => act({ type: 'choose', seat: pd.seat, option: i })}>
          {o}
        </button>
      ))}
    </Sheet>
  )
}
