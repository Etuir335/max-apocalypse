// Экран партии (вертикальный телефон): шапка, поле, панель игрока, кнопки действий, панели снизу.
import { useEffect, useState } from 'react'
import { assetUrl } from '../assets'
import { cardDef, charDef, dist, monsterDef, same, tileAt, tileDef } from '../game/core.ts'
import { missionById } from '../game/data/missions.ts'
import { missionActionsFor, missionProgress } from '../game/engine.ts'
import { requirements } from '../game/targets.ts'
import type { Action, Color, Eff, GameState, Params, PlayerState, Range, XY } from '../game/types.ts'
import Board from './Board'
import { CardImg, PLAYER_COLORS, Sheet, ZoomImg, playerIcon } from './common'
import { useImages } from './images'
import DesktopLayout, { useIsDesktop, type PanelDef } from './Layout'
import PendingSheet from './PendingSheet'
import { botToMove, useBots } from './useBots'
import PlayerPanel, { HandView, type CardPlace } from './PlayerPanel'
import type { GameStore } from './store'
import { nextStep, tileName, WizardPanel, type WizardSpec } from './Wizard'

type Panel = null | 'log' | 'goal' | 'free' | 'trade' | 'pickup' | 'discard2' | 'search'

const COLOR_RU: Record<Color, string> = { red: 'Красная', green: 'Зелёная', blue: 'Синяя' }

/** Сетевой режим: чьи места мои, кто считает ботов, ошибки от хоста */
export interface NetInfo {
  code: string
  isHost: boolean
  isMine: (seat: number) => boolean
  remoteError: string
  clearRemoteError: () => void
}

export default function Game({ store, onMenu, net }: { store: GameStore; onMenu: () => void; net?: NetInfo }) {
  const s = store.state!
  const [toast, setToast] = useState('')
  const [viewSeat, setViewSeat] = useState<number | null>(null)
  const [card, setCard] = useState<{ id: string; place: CardPlace; seat: number } | null>(null)
  const [tile, setTile] = useState<XY | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [wizard, setWizard] = useState<{ spec: WizardSpec; params: Params } | null>(null)
  const desktop = useIsDesktop()
  const images = useImages()
  const [pickedTiles, setPickedTiles] = useState<XY[]>([])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // ботов считает только хост (в локальной игре — этот телефон)
  const thinking = useBots(store.state, store.dispatch, !net || net.isHost)
  const mine = (seat: number) => (net ? net.isMine(seat) : true)
  useEffect(() => {
    if (net?.remoteError) {
      setToast(net.remoteError)
      net.clearRemoteError()
    }
  }, [net])
  const botSeat = botToMove(s)

  const act = (a: Action) => {
    if ('seat' in a && a.type !== 'begin' && s.players[a.seat]?.bot) {
      setToast(`За ${s.players[a.seat].name} ходит бот`)
      return false
    }
    const err = store.dispatch(a)
    if (err) setToast(err)
    return !err
  }

  if (s.phase === 'setup') return <SetupPhase s={s} act={act} onMenu={onMenu} mine={mine} canBegin={!net || net.isHost} code={net?.code} />

  const actorSeat = s.turn.lent ? s.turn.lent.seat : s.turn.seat
  const actor = s.players[actorSeat]
  const shown = s.players[viewSeat ?? actorSeat]
  const mission = missionById(s.missionId)

  // ---------- Мастер целей ----------
  const runWizard = (spec: WizardSpec, initial: Params = {}) => {
    if (!nextStep(s, spec, initial)) {
      if (act(spec.finish(initial))) closeAll()
      return
    }
    setWizard({ spec, params: initial })
  }
  const effWizard = (title: string, seat: number, effs: Eff[], range: Range | undefined, finish: WizardSpec['finish'], initial: Params = {}) =>
    runWizard({ title, seat, getReqs: (pp) => requirements(s, s.players[seat], effs, range, pp), finish }, initial)
  const step = wizard ? nextStep(s, wizard.spec, wizard.params) : null
  const setParam = (key: keyof Params, value: unknown) => {
    if (!wizard || !step) return
    setPickedTiles([])
    const params: Params = step.inner
      ? { ...wizard.params, inner: { ...(wizard.params.inner ?? {}), [key]: value } }
      : { ...wizard.params, [key]: value }
    if (!nextStep(s, wizard.spec, params)) {
      setWizard(null)
      if (act(wizard.spec.finish(params))) closeAll()
    } else setWizard({ ...wizard, params })
  }
  const closeAll = () => {
    setCard(null)
    setTile(null)
    setPanel(null)
    setWizard(null)
  }

  // ---------- Клик по тайлу ----------
  const tileStep = step && (step.r.kind === 'tile' || step.r.kind === 'tiles') ? step.r : null
  const onTile = (xy: XY) => {
    if (tileStep) {
      if (!tileStep.cands.some((c) => same(c, xy))) return setToast('Этот тайл не подходит')
      if (tileStep.kind === 'tile') return setParam('tile', xy)
      // Несколько тайлов: клик отмечает/снимает, открытие — кнопкой в панели
      const on = pickedTiles.some((p) => same(p, xy))
      if (on) return setPickedTiles(pickedTiles.filter((p) => !same(p, xy)))
      if (pickedTiles.length >= tileStep.n) return setToast(`Можно выбрать не больше ${tileStep.n}`)
      return setPickedTiles([...pickedTiles, xy])
    }
    setTile(xy)
  }

  // ---------- Действия ----------
  const playCard = (id: string, seat: number) => {
    const d = cardDef(id)
    if (d.type === 'gear') return act({ type: 'play', seat, card: id }) && closeAll()
    effWizard(d.name, seat, d.effect ?? [], d.range, (params) => ({ type: 'play', seat, card: id, params }))
  }
  const useGear = (id: string, seat: number) => {
    const d = cardDef(id)
    effWizard(d.name, seat, d.gear!.action ?? [], d.range, (params) => ({ type: 'useGear', seat, equip: id, params }), { weapon: id })
  }
  const discardGear = (id: string, seat: number) => {
    const d = cardDef(id)
    effWizard(`Сбросить «${d.name}»`, seat, d.gear!.onDiscard ?? [], d.range, (params) => ({ type: 'discardGear', seat, equip: id, params }))
  }
  const useAbility = () => {
    const ab = charDef(actor).ability
    effWizard(ab.name, actorSeat, ab.action ?? [], ab.range, (params) => ({ type: 'ability', seat: actorSeat, params }))
  }
  const missionAct = (kind: string, name: string) => {
    if (kind !== 'destroyTile') return act({ type: 'mission', seat: actorSeat, kind })
    const here = actor.pos
    runWizard({
      title: name, seat: actorSeat,
      getReqs: () => [{ kind: 'tile', key: 'tile', label: 'Куда отойти', cands: s.tiles.filter((t) => dist(t, here) === 1) }],
      finish: (pp) => ({ type: 'mission', seat: actorSeat, kind, to: pp.tile }),
    })
  }
  const doSearch = () => {
    const t = tileAt(s, actor.pos)
    const colors = t ? tileDef(t).colors : []
    if (colors.length > 1) return setPanel('search')
    act({ type: 'search', seat: actorSeat })
  }

  const ab = charDef(actor).ability
  const missionActs = s.turn.stage === 'actions' ? missionActionsFor(s, actorSeat) : []
  const pending = s.pendings[0]

  const centerNode = (
    <>
      <Board s={s} active={actor.pos} highlight={tileStep?.cands} selected={tileStep?.kind === 'tiles' ? pickedTiles : undefined} onTile={onTile} />

      <div className="last-log">{s.log[s.log.length - 1]}</div>

      <footer className="actionbar">
        {botSeat !== null && (
          <div className="botline">
            🤖 {s.players[botSeat].name} {thinking === botSeat ? 'думает…' : 'ходит'}
            {pending && s.players[pending.seat].bot ? ` — ${pending.prompt}` : ''}
          </div>
        )}
        <div className="acts">
          {s.turn.lent ? (
            <>
              Одолжено действий: <b>{s.turn.lent.n}</b>
            </>
          ) : (
            <>
              Действия {s.players[s.turn.seat].name}:
              <span className="pips" title={`Осталось действий: ${s.turn.actions}`}>
                {Array.from({ length: Math.max(4, s.turn.actions) }, (_, i) => (
                  <i key={i} className={i < s.turn.actions ? 'on' : ''} />
                ))}
              </span>
            </>
          )}
          {s.turn.freeMoves > 0 && <> · шагов: {s.turn.freeMoves}</>}
          {s.turn.lent && <> · действует <b>{actor.name}</b></>}
        </div>
        <div className="abtns">
          <button className="btn" onClick={() => act({ type: 'draw', seat: actorSeat })}>
            🂠 Карта
          </button>
          <button className="btn" onClick={doSearch}>
            🔍 Обыск
          </button>
          {ab.action && actor.figures.some((f) => f.alive && !f.companion) && (
            <button className="btn" onClick={useAbility} title={ab.text}>
              ★ {ab.name}
            </button>
          )}
          {missionActs.map((m) => (
            <button key={m.kind} className="btn accent" onClick={() => missionAct(m.kind, m.name)}>
              ★ {m.name} ({m.cost})
            </button>
          ))}
          <button className="btn" onClick={() => setPanel('free')}>
            ⋯ Свободные
          </button>
          {s.turn.lent ? (
            <button className="btn" onClick={() => act({ type: 'pass', seat: actorSeat })}>
              Пропустить
            </button>
          ) : (
            <button className={`btn ${s.turn.actions === 0 ? 'primary' : ''}`} onClick={() => act({ type: 'endTurn', seat: s.turn.seat })}>
              Конец хода
            </button>
          )}
        </div>
        <p className="muted tip">Нажмите тайл, чтобы пойти туда; карту — чтобы сыграть или использовать.</p>
      </footer>
    </>
  )
  const playerNode = (
    <>
      <nav className="tabs">
        {s.players.map((p) => (
          <button key={p.seat} className={`tab ${shown.seat === p.seat ? 'on' : ''} ${p.alive ? '' : 'dead'}`}
            style={{ borderColor: PLAYER_COLORS[p.seat] }} onClick={() => setViewSeat(p.seat)}>
            <img src={playerIcon(p, images.face).src} style={{ objectPosition: playerIcon(p, images.face).pos }} alt="" />
            <span>
              {p.name}
              {p.seat === s.turn.seat ? ' ▶' : ''} <small>{charDef(p).name}</small>
            </span>
          </button>
        ))}
      </nav>

      <PlayerPanel s={s} p={shown} withHand={!desktop} onCard={(id, place, seat) => setCard({ id, place, seat })} />
    </>
  )

  return (
    <div className="game">
      <header className="ghead">
        <button className="btn small" onClick={onMenu} aria-label="Меню">
          ☰
        </button>
        <div className="ginfo">
          <b>
            {mission.name}
            {net && <span className="roomcode"> · комната {net.code}</span>}
          </b>
          <span>
            Раунд {s.round} · ход:{' '}
            <i style={{ color: PLAYER_COLORS[s.turn.seat] }}>{s.players[s.turn.seat].name}</i>
            {s.turn.lent && <> · действует {actor.name}</>}
          </span>
        </div>
        <button className="btn small mob-only" onClick={() => setPanel('goal')}>
          Цель
        </button>
        <button className="btn small mob-only" onClick={() => setPanel('log')}>
          Журнал
        </button>
      </header>

      {desktop ? (
        <DesktopLayout center={<div className="g-center">{centerNode}</div>}
          panels={[{ id: 'player', title: 'Выживший', node: playerNode },
            { id: 'hand', title: `🂠 Рука — ${shown.name} (${shown.hand.length})`, node: <HandView p={shown} onCard={(id, place, seat) => setCard({ id, place, seat })} /> },
            ...sidePanels(s, setViewSeat, images.face)]} />
      ) : (
        <div className="game-grid">
          <div className="g-center">{centerNode}</div>
          <aside className="g-left">{playerNode}</aside>
        </div>
      )}

      {card && !wizard && (
        <CardSheet s={s} card={card} actorSeat={actorSeat} onClose={() => setCard(null)}
          onPlay={() => playCard(card.id, card.seat)} onUse={() => useGear(card.id, card.seat)}
          onDiscard={() => discardGear(card.id, card.seat)}
          onDeliver={() => act({ type: 'deliver', seat: card.seat, card: card.id }) && closeAll()}
          onRefuel={(fuel) => act({ type: 'refuel', seat: card.seat, equip: card.id, fuel }) && closeAll()} />
      )}

      {tile && !wizard && (
        <TileSheet s={s} xy={tile} actor={actor} onClose={() => setTile(null)}
          onMove={() => act({ type: 'move', seat: actorSeat, to: tile }) && closeAll()}
          onTileAction={() => act({ type: 'tileAction', seat: actorSeat, to: tile }) && closeAll()} />
      )}

      {panel === 'search' && (
        <Sheet title="Обыск: нажмите на колоду" onClose={() => setPanel(null)}>
          <FindBoard s={s} enabled={tileDef(tileAt(s, actor.pos)!).colors}
            onPick={(c) => act({ type: 'search', seat: actorSeat, color: c }) && closeAll()} />
        </Sheet>
      )}

      {panel === 'free' && (
        <Sheet title="Свободные действия" onClose={() => setPanel(null)}>
          <button className="btn wide" onClick={() => setPanel('discard2')}>
            Сбросить 2 карты выжившего → взять 1 {s.turn.freeDiscardUsed ? '(было)' : ''}
          </button>
          <button className="btn wide" onClick={() => setPanel('trade')}>
            Обмен находками {s.turn.tradeUsed ? '(было)' : ''}
          </button>
          {s.dropped.some((d) => same(d, actor.pos)) && (
            <button className="btn wide" onClick={() => setPanel('pickup')}>
              Подобрать вещи с тайла 📦
            </button>
          )}
          {actor.equip.some((e) => cardDef(e.id).gear?.passive?.jacket) && (
            <button className="btn wide" onClick={() => act({ type: 'jacket', seat: s.turn.seat }) && closeAll()}>
              Куртка: +1 действие за +1 голод
            </button>
          )}
          <p className="muted">Сдать предмет для миссии — откройте карту в руке или снаряжении.</p>
        </Sheet>
      )}

      {panel === 'discard2' && <Discard2 p={actor} onClose={() => setPanel(null)} onDone={(cards) => act({ type: 'freeDiscard', seat: actorSeat, cards }) && closeAll()} />}
      {panel === 'trade' && <Trade s={s} p={actor} onClose={() => setPanel(null)} onDone={(a) => act(a) && closeAll()} />}
      {panel === 'pickup' && <PickUp s={s} p={actor} onClose={() => setPanel(null)} onDone={(cards) => act({ type: 'pickUp', seat: actorSeat, cards }) && closeAll()} />}

      {panel === 'log' && (
        <Sheet title="Журнал" onClose={() => setPanel(null)}>
          <ul className="log">
            {[...s.log].reverse().map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Sheet>
      )}
      {panel === 'goal' && <GoalSheet s={s} onClose={() => setPanel(null)} />}

      {wizard && step && (
        <WizardPanel key={`${step.r.kind}-${step.r.label}-${step.inner ? 1 : 0}`} s={s} title={wizard.spec.title} step={step}
          params={wizard.params} onSet={setParam} pickedTiles={pickedTiles} setPickedTiles={setPickedTiles}
          onCancel={() => {
            setPickedTiles([])
            setWizard(null)
          }} />
      )}

      {pending && s.phase === 'play' && !s.players[pending.seat].bot && mine(pending.seat) && <PendingSheet key={`${pending.seat}-${pending.kind}-${s.pendings.length}-${s.log.length}`} s={s} act={act} />}

      {(s.phase === 'won' || s.phase === 'lost') && (
        <div className={`gameover ${s.phase}`}>
          <h1>{s.phase === 'won' ? 'Победа!' : 'Поражение'}</h1>
          <p>{s.result}</p>
          <button className="btn primary" onClick={onMenu}>
            В меню
          </button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// ---------- Начало партии: замена карт и первый игрок ----------

function SetupPhase({ s, act, onMenu, mine, canBegin, code }: {
  s: GameState
  act: (a: Action) => boolean
  onMenu: () => void
  mine: (seat: number) => boolean
  canBegin: boolean
  code?: string
}) {
  const [picked, setPicked] = useState<string[]>([])
  // своё место (люди меняют карты сами, боты — автоматически)
  const p = s.players.find((x) => !x.mulliganDone && !x.bot && mine(x.seat))
  const waiting = s.players.filter((x) => !x.mulliganDone)
  return (
    <div className="game setup-phase">
      <header className="ghead">
        <button className="btn small" onClick={onMenu}>
          ☰
        </button>
        <div className="ginfo">
          <b>
            {missionById(s.missionId).name}
            {code && <span className="roomcode"> · комната {code}</span>}
          </b>
          <span>Подготовка</span>
        </div>
      </header>
      {!p && waiting.length > 0 ? (
        <section className="ppanel">
          <p>Ждём, пока остальные решат, менять ли карты: {waiting.map((x) => x.name).join(', ')}</p>
        </section>
      ) : p ? (
        <section className="ppanel">
          <p className="handoff">{code ? `Ваша рука, ${p.name}` : `Передайте телефон: ${p.name}`}</p>
          <p>Можно один раз заменить до 4 карт: нажмите на карты, чтобы отметить, затем «Заменить». 🔍 — посмотреть карту крупно.</p>
          <div className="row wrap">
            {p.hand.map((id) => (
              <CardImg key={id} id={id} className="cimg large" caption selected={picked.includes(id)}
                onClick={() => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])} />
            ))}
          </div>
          <button className="btn primary wide" onClick={() => act({ type: 'mulligan', seat: p.seat, cards: picked }) && setPicked([])}>
            {picked.length ? `Заменить (${picked.length})` : 'Оставить руку'}
          </button>
        </section>
      ) : (
        <section className="ppanel">
          <h2>Кто ходит первым?</h2>
          {!canBegin && <p className="muted">Первого игрока выбирает хост.</p>}
          {canBegin && s.players.map((q) => (
            <button key={q.seat} className="btn wide" onClick={() => act({ type: 'begin', seat: q.seat, first: q.seat })}>
              {q.name} — {charDef(q).name}
            </button>
          ))}
        </section>
      )}
    </div>
  )
}

// ---------- Панель карты ----------

function CardSheet({ s, card, actorSeat, onClose, onPlay, onUse, onDiscard, onDeliver, onRefuel }: {
  s: GameState
  card: { id: string; place: CardPlace; seat: number }
  actorSeat: number
  onClose: () => void
  onPlay: () => void
  onUse: () => void
  onDiscard: () => void
  onDeliver: () => void
  onRefuel: (fuel: string) => void
}) {
  const img = useImages()
  const mine = card.seat === actorSeat || card.seat === s.turn.seat
  if (card.place === 'monster') {
    const d = monsterDef(card.id)
    const m = s.players[card.seat].monsters.find((x) => x.id === card.id)
    return (
      <Sheet title={d.name} onClose={onClose}>
        <ZoomImg className="big" src={img.face(Number(card.id.split(':')[1]))} />
        <p>
          Здоровье {d.hp - (m?.wounds ?? 0)}/{d.hp} · урон {d.dmg}
          {d.range ? ` · дальность: ${RANGE_RU[d.range]}` : ''}
          {m?.stunnedBy !== null && m?.stunnedBy !== undefined ? ' · оглушён' : ''}
        </p>
        {d.text && <p className="muted">{d.text}</p>}
      </Sheet>
    )
  }
  const d = cardDef(card.id)
  const p = s.players[card.seat]
  const e = p.equip.find((x) => x.id === card.id)
  const fuels = p.equip.filter((x) => cardDef(x.id).find === 'fuel')
  return (
    <Sheet title={d.name} onClose={onClose}>
      <ZoomImg className="big" src={img.face(Number(card.id.split(':')[1]))} />
      <p className="muted">
        {d.type === 'gear' ? `Снаряжение, ячеек: ${d.gear!.slots}` : 'Мгновенное действие'}
        {d.range ? ` · дальность: ${RANGE_RU[d.range]}` : ''}
      </p>
      <p>{d.text}</p>
      {mine && card.place === 'hand' && (
        <button className="btn primary wide" onClick={onPlay}>
          {d.type === 'gear' ? 'Экипировать (1 действие)' : 'Разыграть (1 действие)'}
        </button>
      )}
      {mine && card.place === 'equip' && e && (
        <>
          {d.gear?.action && (
            <button className="btn primary wide" onClick={onUse}>
              Использовать (1 действие)
            </button>
          )}
          {d.gear?.fuel !== undefined &&
            fuels.map((f) => (
              <button key={f.id} className="btn wide" onClick={() => onRefuel(f.id)}>
                Заправить топливом (1 действие)
              </button>
            ))}
          <button className="btn wide" onClick={onDiscard}>
            {d.gear?.onDiscard ? 'Сбросить и применить эффект' : 'Сбросить (освободить ячейки)'}
          </button>
        </>
      )}
      {mine && d.group === 'find' && (
        <button className="btn wide" onClick={onDeliver}>
          Сдать для миссии (свободно)
        </button>
      )}
    </Sheet>
  )
}

const RANGE_RU: Record<Range, string> = { short: 'короткая', medium: 'средняя', long: 'дальняя' }

// ---------- Боковые панели на ПК: задание, находки, отряд, журнал ----------

function sidePanels(s: GameState, onSeat: (seat: number) => void, face: (cardId: number) => string): PanelDef[] {
  const m = missionById(s.missionId)
  return [
    {
      id: 'mission',
      title: '📌 Задание',
      node: (
        <>
          <b>
            {m.num}. {m.name}
          </b>
          <span className="muted"> · {m.difficulty}</span>
          <p className="small">{m.text}</p>
          <ul className="small">
            {missionProgress(s).map((l) => (
              <li key={l}>{l}</li>
            ))}
            <li>
              Открыто тайлов: {s.tiles.filter((t) => t.revealed).length}/{s.tiles.length}
            </li>
            <li>Монстров в колоде: {s.monsterDeck.length}</li>
          </ul>
        </>
      ),
    },
    { id: 'finds', title: '🔍 Находки', node: <FindBoard s={s} /> },
    {
      id: 'squad',
      title: '🛡 Отряд',
      node: s.players.map((p) => (
        <button key={p.seat} type="button" className={`squad ${p.alive ? '' : 'dead'}`} onClick={() => onSeat(p.seat)}>
          <img src={playerIcon(p, face).src} alt="" style={{ borderColor: PLAYER_COLORS[p.seat], objectPosition: playerIcon(p, face).pos }} />
          <span>
            <b>
              {p.name}
              {p.seat === s.turn.seat ? ' ▶' : ''}
            </b>{' '}
            <span className="muted">{charDef(p).name}</span>
            <br />
            <span className="small">
              {p.figures.map((f) => `❤${f.hp}`).join(' ')} · 🍖{p.exhausted ? 'истощён' : `${p.hunger}/6`}
              {p.poison ? ` · ☣${p.poison}` : ''} · 👹{p.monsters.length} · 🂠{p.hand.length}
            </span>
            <br />
            <span className="small muted">📍 {tileName(s, p.pos)}</span>
          </span>
        </button>
      )),
    },
    {
      id: 'log',
      title: '📜 Журнал',
      node: (
        <ul className="log">
          {[...s.log].reverse().map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ),
    },
  ]
}

// ---------- Планшет находок (красная / зелёная / синяя колоды) ----------

const FIND_X: Record<Color, number> = { red: 2, green: 35.4, blue: 68.4 }

function FindBoard({ s, enabled, onPick }: { s: GameState; enabled?: Color[]; onPick?: (c: Color) => void }) {
  return (
    <div className="findboard" style={{ backgroundImage: `url(${assetUrl('assets/ui/board-finds.webp')})` }}>
      {(Object.keys(FIND_X) as Color[]).map((c) => {
        const on = !onPick || enabled?.includes(c)
        return (
          <button key={c} type="button" className={`fdeck ${on ? '' : 'off'}`} style={{ left: `${FIND_X[c]}%` }}
            disabled={!onPick || !on} onClick={() => onPick?.(c)}>
            <b>{s.finds[c].length}</b>
            <span>{COLOR_RU[c]}</span>
          </button>
        )
      })}
    </div>
  )
}

// ---------- Панель тайла ----------

function TileSheet({ s, xy, actor, onClose, onMove, onTileAction }: {
  s: GameState
  xy: XY
  actor: PlayerState
  onClose: () => void
  onMove: () => void
  onTileAction: () => void
}) {
  const img = useImages()
  const t = tileAt(s, xy)!
  const d = tileDef(t)
  const here = s.players.filter((p) => p.alive && same(p.pos, t))
  const fromTile = tileAt(s, actor.pos)
  const special = fromTile ? tileDef(fromTile).special : undefined
  const canJump = t.revealed && !same(t, actor.pos) && (special === 'airport' || (special === 'tunnel' && d.special === 'tunnel'))
  return (
    <Sheet title={t.revealed ? d.name : 'Закрытый тайл'} onClose={onClose}>
      {t.revealed && <ZoomImg className="big tileimg" src={img.face(d.image)} />}
      {t.revealed && (
        <p className="muted">
          Появление монстров: {d.spawn || '—'} · обыск: {d.colors.length ? d.colors.map((c) => COLOR_RU[c]).join(', ') : 'нет'}
        </p>
      )}
      {t.revealed && <p>{d.text}</p>}
      <p>
        Жетонов монстров: {t.markers}
        {t.objective ? ` · маркер цели №${t.objective}` : ''}
        {here.length ? ` · здесь: ${here.map((p) => p.name).join(', ')}` : ''}
      </p>
      {dist(t, actor.pos) === 1 && (
        <button className="btn primary wide" onClick={onMove}>
          Идти сюда ({actor.name}, 1 действие)
        </button>
      )}
      {canJump && (
        <button className="btn wide" onClick={onTileAction}>
          {special === 'airport' ? 'Улететь сюда из аэропорта' : 'Пройти туннелем'} (1 действие)
        </button>
      )}
    </Sheet>
  )
}

// ---------- Свободные действия ----------

function Discard2({ p, onClose, onDone }: { p: PlayerState; onClose: () => void; onDone: (cards: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const cards = p.hand.filter((id) => cardDef(id).group === 'survivor')
  return (
    <Sheet title="Сбросить 2 карты → взять 1" onClose={onClose}>
      <div className="row wrap">
        {cards.map((id) => (
          <CardImg key={id} id={id} className="cimg large" caption selected={picked.includes(id)}
            onClick={() => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < 2 ? [...picked, id] : picked)} />
        ))}
      </div>
      <button className="btn primary wide" disabled={picked.length !== 2} onClick={() => onDone(picked)}>
        Сбросить
      </button>
    </Sheet>
  )
}

function Trade({ s, p, onClose, onDone }: { s: GameState; p: PlayerState; onClose: () => void; onDone: (a: Action) => void }) {
  const partners = s.players.filter((q) => q.alive && q !== p && same(q.pos, p.pos))
  const [withSeat, setWith] = useState<number | null>(partners[0]?.seat ?? null)
  const [give, setGive] = useState<string[]>([])
  const [take, setTake] = useState<string[]>([])
  const finds = (q: PlayerState) => [...q.hand, ...q.equip.map((e) => e.id)].filter((id) => cardDef(id).group === 'find')
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  if (!partners.length)
    return (
      <Sheet title="Обмен" onClose={onClose}>
        <p className="muted">На вашем тайле нет других игроков.</p>
      </Sheet>
    )
  const q = s.players[withSeat!]
  return (
    <Sheet title="Обмен находками" onClose={onClose}>
      <div className="row">
        {partners.map((x) => (
          <button key={x.seat} className={`btn small ${x.seat === withSeat ? 'primary' : ''}`} onClick={() => setWith(x.seat)}>
            {x.name}
          </button>
        ))}
      </div>
      <h4>Отдать ({p.name})</h4>
      <div className="row wrap">
        {finds(p).map((id) => <CardImg key={id} id={id} className="cimg small" selected={give.includes(id)} onClick={() => toggle(give, setGive, id)} />)}
      </div>
      <h4>Взять ({q.name})</h4>
      <div className="row wrap">
        {finds(q).map((id) => <CardImg key={id} id={id} className="cimg small" selected={take.includes(id)} onClick={() => toggle(take, setTake, id)} />)}
      </div>
      <button className="btn primary wide" disabled={!give.length && !take.length}
        onClick={() => onDone({ type: 'trade', seat: p.seat, with: q.seat, give, take })}>
        Обменяться
      </button>
    </Sheet>
  )
}

function PickUp({ s, p, onClose, onDone }: { s: GameState; p: PlayerState; onClose: () => void; onDone: (cards: string[]) => void }) {
  const pile = s.dropped.find((d) => same(d, p.pos))
  const [picked, setPicked] = useState<string[]>([])
  return (
    <Sheet title="Вещи на тайле" onClose={onClose}>
      <div className="row wrap">
        {pile?.cards.map((id) => (
          <CardImg key={id} id={id} className="cimg large" caption selected={picked.includes(id)}
            onClick={() => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])} />
        ))}
      </div>
      <button className="btn primary wide" disabled={!picked.length} onClick={() => onDone(picked)}>
        Подобрать
      </button>
    </Sheet>
  )
}

function GoalSheet({ s, onClose }: { s: GameState; onClose: () => void }) {
  const m = missionById(s.missionId)
  const img = useImages()
  const [back, setBack] = useState(false)
  return (
    <Sheet title={`${m.num}. ${m.name}`} onClose={onClose}>
      <img className="big" src={back ? img.back(m.image) : img.face(m.image)} alt="" onClick={() => setBack(!back)} />
      <p className="muted">Нажмите на карту, чтобы перевернуть</p>
      <p>{m.text}</p>
      <h4>Колоды находок</h4>
      <FindBoard s={s} />
      <h4>Прогресс</h4>
      <ul>
        {missionProgress(s).map((l) => (
          <li key={l}>{l}</li>
        ))}
        <li>Тайлов открыто: {s.tiles.filter((t) => t.revealed).length}/{s.tiles.length}</li>
        <li>Колода монстров: {s.monsterDeck.length}</li>
      </ul>
      <p className="muted">Где игроки: {s.players.map((p) => `${p.name} — ${tileName(s, p.pos)}`).join('; ')}</p>
    </Sheet>
  )
}
