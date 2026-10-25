// Панель выжившего на планшете из настолки: монстры сверху, сброс/колода/персонаж и 4 ячейки снаряжения снизу,
// шкала голода и шестиугольники действий. Координаты — в процентах от картинки планшета.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { assetUrl } from '../assets'
import { cardDef, charDef, imageOf, monsterDef, slotsTotal, slotsUsed, stealthOf, tileAt, tileDef } from '../game/core.ts'
import type { GameState, PlayerState } from '../game/types.ts'
import { CardImg, PLAYER_COLORS, cardText, useHoverPreview, useZoom } from './common'
import { useImages } from './images'

export type CardPlace = 'hand' | 'equip' | 'monster'

const box = (left: number, top: number, width: number, height: number): CSSProperties => ({
  left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
})
const SLOT_W = 10.3
const SLOT_H = 24.5
const ROW_Y = 53.5
const GEAR_X = [40.7, 52.4, 64.6, 76.6]
const HEX: Record<number, [number, number]> = { 0: [9.9, 33.5], 1: [12.8, 30.3], 2: [12.8, 36.7], 3: [9.9, 39.8], 4: [7, 36.7], 5: [7, 30.3], 6: [9.9, 27.3] }
/** Центры клеток шкалы голода (1–5, затем 2-4-6-8-☠), % ширины планшета */
const HUNGER_X = [16.1, 18.6, 21.1, 23.7, 26.2, 28.9, 31.4, 33.9, 36.5, 39.0]

function Slot({ style, src, onClick, badge, dim, info }: {
  style: CSSProperties
  src: string
  onClick?: () => void
  badge?: ReactNode
  dim?: boolean
  /** что показать в предпросмотре при наведении */
  info?: { name: string; text: string } | null
}) {
  const hover = useHoverPreview()
  return (
    <button type="button" className={`slot ${dim ? 'dim' : ''}`} style={style} onClick={onClick} {...hover(src, info?.name, info?.text)}>
      {src && <img src={src} alt="" draggable={false} />}
      {badge !== undefined && <span className="sbadge">{badge}</span>}
    </button>
  )
}

export default function PlayerPanel({ s, p, onCard, withHand = true }: {
  s: GameState
  p: PlayerState
  onCard: (id: string, place: CardPlace, seat: number) => void
  /** на ПК рука — отдельная панель */
  withHand?: boolean
}) {
  const img = useImages()
  const zoom = useZoom()
  const ch = charDef(p)
  const tile = tileAt(s, p.pos)
  const face = (id: string) => img.face(imageOf(id))
  const isTurn = s.turn.seat === p.seat && s.phase === 'play'
  const hungerIdx = p.exhausted ? Math.min(9, 5 + p.starve) : Math.max(0, p.hunger - 1)
  const topDiscard = p.discard[p.discard.length - 1]
  const anyCard = p.deck[0] ?? topDiscard ?? p.hand[0]
  const gear = p.equip.slice(0, GEAR_X.length)
  const extraGear = p.equip.slice(GEAR_X.length)
  const heroInfo = { name: ch.name, text: `★ ${ch.ability.name}: ${ch.ability.text}` }
  const [big, setBig] = useState(false)
  useEffect(() => {
    if (!big) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBig(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [big])

  const statsEl = (
    <div className="stats">
      {p.figures.map((f) => (
        <span key={f.name} className={f.alive ? '' : 'bad'}>
          ❤ {f.name}: <b>{f.hp}</b>/{f.maxHp}
          {f.immune ? ' 🛡' : ''}
        </span>
      ))}
      <span>👁 скрытность {stealthOf(p)}</span>
      <span>🍖 {p.exhausted ? 'истощён' : `голод ${p.hunger}/6`}</span>
      {p.poison > 0 && <span className="bad">☣ яд {p.poison}</span>}
      <span>
        🎒 {slotsUsed(p)}/{slotsTotal(p)}
      </span>
      {tile && <span>📍 {tile.revealed ? tileDef(tile).name : '?'}</span>}
    </div>
  )

  const boardEl = (
      <div className="pboard" style={{ backgroundImage: `url(${assetUrl('assets/ui/board-player.webp')})` }}>
        {/* Действия: жетон на числе оставшихся действий */}
        {isTurn && (
          <span className="hexmark" style={{ left: `${HEX[Math.min(6, s.turn.actions)][0]}%`, top: `${HEX[Math.min(6, s.turn.actions)][1]}%` }} />
        )}

        {/* Монстры перед игроком */}
        <div className="pmonsters" style={box(28.8, 23.2, 58.2, 23)}>
          {p.monsters.map((m) => {
            const d = monsterDef(m.id)
            return (
              <Slot key={m.id} style={{}} src={face(m.id)} info={cardText(m.id)} onClick={() => onCard(m.id, 'monster', p.seat)}
                badge={`${d.hp - m.wounds}/${d.hp}${m.stunnedBy !== null ? '💫' : ''}`} />
            )
          })}
        </div>

        {/* Сброс, колода, персонаж */}
        <Slot style={box(4.8, ROW_Y, SLOT_W, SLOT_H)} src={topDiscard ? face(topDiscard) : ''} info={topDiscard ? cardText(topDiscard) : null} badge={p.discard.length || undefined}
          onClick={topDiscard ? () => zoom(face(topDiscard)) : undefined} />
        <Slot style={box(16.3, ROW_Y, SLOT_W, SLOT_H)} src={anyCard && p.deck.length ? img.back(imageOf(anyCard)) : ''} badge={p.deck.length} />
        <Slot style={box(28.5, ROW_Y, SLOT_W, SLOT_H)}
          src={p.exhausted ? img.back(ch.figures[0].image) : img.face(ch.figures[0].image)}
          onClick={() => zoom(p.exhausted ? img.back(ch.figures[0].image) : img.face(ch.figures[0].image))}
          dim={!p.figures[0].alive} badge={`❤${p.figures[0].hp}`} info={heroInfo} />
        {ch.figures[1] && (
          <Slot style={box(88.4, ROW_Y, SLOT_W, SLOT_H)}
            src={p.exhausted ? img.back(ch.figures[1].image) : img.face(ch.figures[1].image)}
            onClick={() => zoom(img.face(ch.figures[1].image))} dim={!p.figures[1].alive} badge={`❤${p.figures[1].hp}`} />
        )}
        {p.poison > 0 && (
          <span className="ppoison" style={{ left: '29.5%', top: '47%' }}>
            <img src={assetUrl('assets/ui/token-poison.webp')} alt="" />
            <b>{p.poison}</b>
          </span>
        )}

        {/* Снаряжение */}
        {gear.map((e, i) => {
          const g = cardDef(e.id).gear!
          const charge = g.ammo !== undefined ? `🔹${e.ammo}` : g.fuel !== undefined ? `⛽${e.ammo}` : ''
          const mods = (e.dmgMod ? ` +${e.dmgMod}` : '') + (e.notch ? ' ✦' : '')
          return <Slot key={e.id} style={box(GEAR_X[i], ROW_Y, SLOT_W, SLOT_H)} src={face(e.id)} info={cardText(e.id)} onClick={() => onCard(e.id, 'equip', p.seat)}
            badge={charge || mods ? charge + mods : undefined} />
        })}

        {/* Голод: 1–5, затем урон от голода 2-4-6-8-☠ */}
        <span className="hungermark" style={{ left: `${HUNGER_X[hungerIdx]}%`, top: '83.2%' }} />
      </div>
  )

  return (
    <section className={`ppanel board-panel ${p.alive ? '' : 'dead'}`}>
      <div className="phead">
        <span className="pdot" style={{ background: PLAYER_COLORS[p.seat] }} />
        <b>{p.name}</b>
        <span className="muted">{ch.name}</span>
        {!p.alive && <span className="bad">погиб</span>}
      </div>
      {statsEl}

      <div className="pboard-wrap">
        {boardEl}
        <button type="button" className="pb-expand" onClick={() => setBig(true)} title="Развернуть планшет" aria-label="Развернуть планшет">
          ⛶
        </button>
      </div>

      {big && (
        <div className="pb-overlay" onClick={() => setBig(false)}>
          <div className="pb-big" onClick={(e) => e.stopPropagation()}>
            <div className="pb-head">
              <span className="pdot" style={{ background: PLAYER_COLORS[p.seat] }} />
              <b>
                {p.name} — {ch.name}
              </b>
              <button className="btn small" onClick={() => setBig(false)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            {statsEl}
            {boardEl}
            <h4>Рука ({p.hand.length})</h4>
            <HandView p={p} onCard={onCard} />
          </div>
        </div>
      )}

      {extraGear.length > 0 && (
        <>
          <h4>Ещё снаряжение</h4>
          <div className="row">
            {extraGear.map((e) => <CardImg key={e.id} id={e.id} className="cimg small" onClick={() => onCard(e.id, 'equip', p.seat)} />)}
          </div>
        </>
      )}

      {withHand && (
        <>
          <h4>Рука ({p.hand.length})</h4>
          <HandView p={p} onCard={onCard} />
        </>
      )}
    </section>
  )
}

export function HandView({ p, onCard }: { p: PlayerState; onCard: (id: string, place: CardPlace, seat: number) => void }) {
  return (
    <div className="row hand">
      {p.hand.length ? p.hand.map((id) => <CardImg key={id} id={id} className="cimg" caption onClick={() => onCard(id, 'hand', p.seat)} />) : <span className="muted">пусто</span>}
    </div>
  )
}
