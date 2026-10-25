// Мастер выбора целей: по шагам собирает params для действия (режим, цели, игрок, тайл, оружие, карта, колоды).
import { useState } from 'react'
import { cardDef, tileAt, tileDef } from '../game/core.ts'
import { monsterLabel, requirements, type Requirement } from '../game/targets.ts'
import type { Action, Color, GameState, Params, XY } from '../game/types.ts'
import { CardImg } from './common'

export interface WizardSpec {
  title: string
  seat: number
  getReqs: (params: Params) => Requirement[]
  finish: (params: Params) => Action
}

type FigureReq = { kind: 'figure'; key: 'figure'; label: string; cands: { i: number; name: string }[] }
export interface Step {
  r: Requirement | FigureReq
  inner?: boolean
}

export function nextStep(s: GameState, spec: WizardSpec, params: Params): Step | null {
  for (const r of spec.getReqs(params)) {
    if (r.kind === 'mode' && params.mode === undefined) return { r }
    if (r.kind === 'monsters' && params.targets === undefined) return { r }
    if (r.kind === 'player') {
      if (params.players === undefined) return { r }
      const q = s.players[params.players[0]]
      const figs = q.figures.map((f, i) => ({ i, name: f.name, alive: f.alive })).filter((f) => f.alive)
      if (r.figure && figs.length > 1 && params.figure === undefined)
        return { r: { kind: 'figure', key: 'figure', label: `Кого именно (${q.name})`, cands: figs } }
    }
    if (r.kind === 'tile' && !params.tile) return { r }
    if (r.kind === 'tiles' && !params.tiles) return { r }
    if (r.kind === 'weapon' && !params.weapon) return { r }
    if (r.kind === 'card') {
      if (!params.card) return { r }
      if (r.inner) {
        const d = cardDef(params.card)
        const p = s.players[spec.seat]
        const inner = nextStep(s, { ...spec, getReqs: (ip) => requirements(s, p, d.effect ?? [], d.range, ip) }, params.inner ?? {})
        if (inner) return { ...inner, inner: true }
      }
    }
    if (r.kind === 'colors' && (params.colors?.length ?? 0) < r.n) return { r }
  }
  return null
}

const COLOR_NAMES: [Color, string][] = [
  ['red', 'Красная'],
  ['green', 'Зелёная'],
  ['blue', 'Синяя'],
]

export function tileName(s: GameState, xy: XY) {
  const t = tileAt(s, xy)
  return t ? (t.revealed ? tileDef(t).name : 'Закрытый тайл') : '?'
}

/** Панель текущего шага. Для тайлов — узкая полоса, чтобы поле оставалось видно. */
export function WizardPanel({ s, title, step, params, onSet, onCancel, pickedTiles, setPickedTiles }: {
  s: GameState
  title: string
  step: Step
  params: Params
  onSet: (key: keyof Params, value: unknown) => void
  onCancel: () => void
  /** отмеченные тайлы — общие с картой (клик по полю тоже отмечает) */
  pickedTiles: XY[]
  setPickedTiles: (v: XY[]) => void
}) {
  const { r } = step
  const [picked, setPicked] = useState<string[]>([])
  const cur = step.inner ? params.inner ?? {} : params

  const body = () => {
    switch (r.kind) {
      case 'mode':
        return r.labels.map((l, i) => (
          <button key={i} className="btn wide" onClick={() => onSet('mode', i)}>
            {l}
          </button>
        ))
      case 'monsters':
        if (!r.cands.length) return <p className="muted">Нет подходящих целей в пределах дальности.</p>
        if (r.max === 1)
          return r.cands.map((id) => (
            <button key={id} className="btn wide" onClick={() => onSet('targets', [id])}>
              {monsterLabel(s, id)}
            </button>
          ))
        return (
          <>
            {r.cands.map((id) => (
              <label key={id} className="check">
                <input type="checkbox" checked={picked.includes(id)} disabled={!picked.includes(id) && picked.length >= r.max}
                  onChange={() => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])} />
                {monsterLabel(s, id)}
              </label>
            ))}
            <button className="btn primary wide" disabled={picked.length < r.min} onClick={() => onSet('targets', picked)}>
              Готово ({picked.length})
            </button>
          </>
        )
      case 'player':
        if (!r.cands.length) return <p className="muted">Нет подходящих игроков.</p>
        return r.cands.map((seat) => (
          <button key={seat} className="btn wide" onClick={() => onSet('players', [seat])}>
            {s.players[seat].name}
          </button>
        ))
      case 'figure':
        return r.cands.map((f) => (
          <button key={f.i} className="btn wide" onClick={() => onSet('figure', f.i)}>
            {f.name}
          </button>
        ))
      case 'tile':
        if (!r.cands.length) return <p className="muted">Нет подходящих тайлов.</p>
        return (
          <>
            <p className="muted">Нажмите подсвеченный тайл на поле или выберите здесь:</p>
            {r.cands.map((xy) => (
              <button key={`${xy.x},${xy.y}`} className="btn small" onClick={() => onSet('tile', xy)}>
                {tileName(s, xy)} ({xy.x},{xy.y})
              </button>
            ))}
          </>
        )
      case 'tiles':
        if (!r.cands.length) return <p className="muted">Нет закрытых тайлов в пределах.</p>
        return (
          <>
            <p className="muted">
              Отметьте до {r.n} тайлов на поле (подсвечены) или здесь, затем нажмите «Открыть». Отмечено: {pickedTiles.length}/{r.n}
            </p>
            {r.cands.map((xy) => {
              const on = pickedTiles.some((p) => p.x === xy.x && p.y === xy.y)
              return (
                <button key={`${xy.x},${xy.y}`} className={`btn small ${on ? 'primary' : ''}`}
                  onClick={() => setPickedTiles(on ? pickedTiles.filter((p) => p.x !== xy.x || p.y !== xy.y) : pickedTiles.length < r.n ? [...pickedTiles, xy] : pickedTiles)}>
                  ({xy.x},{xy.y})
                </button>
              )
            })}
            <button className="btn primary wide" disabled={!pickedTiles.length} onClick={() => onSet('tiles', pickedTiles)}>
              Открыть ({pickedTiles.length})
            </button>
          </>
        )
      case 'weapon':
        if (!r.cands.length) return <p className="muted">Нет подходящего оружия.</p>
        return r.cands.map((id) => (
          <button key={id} className="btn wide" onClick={() => onSet('weapon', id)}>
            {cardDef(id).name}
          </button>
        ))
      case 'card':
        if (!r.cands.length) return <p className="muted">Нет подходящих карт.</p>
        return (
          <div className="row wrap">
            {r.cands.map((id) => (
              <CardImg key={id} id={id} className="cimg large" caption onClick={() => onSet('card', id)} />
            ))}
          </div>
        )
      case 'colors':
        return (
          <>
            {(cur.colors?.length ?? 0) > 0 && <p className="muted">Выбрано: {cur.colors!.map((c) => COLOR_NAMES.find((x) => x[0] === c)![1]).join(', ')}</p>}
            {COLOR_NAMES.map(([c, name]) => (
              <button key={c} className={`btn wide color-${c}`} onClick={() => onSet('colors', [...(cur.colors ?? []), c])}>
                {name} ({s.finds[c].length})
              </button>
            ))}
          </>
        )
    }
  }

  const slim = r.kind === 'tile' || r.kind === 'tiles'
  return (
    <div className={`wizard ${slim ? 'slim' : ''}`}>
      <div className="sheet-head">
        <b>
          {title}: {r.label}
        </b>
        <button className="btn small" onClick={onCancel}>
          Отмена
        </button>
      </div>
      <div className="sheet-body">{body()}</div>
    </div>
  )
}
