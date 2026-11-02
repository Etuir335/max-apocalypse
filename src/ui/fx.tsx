// Кинематографичные эффекты: сравниваем прошлое и новое состояние партии и запускаем анимации.
// Движок о них не знает — всё выводится из разницы состояний и новых строк журнала.
import { useEffect, useRef, useState } from 'react'
import { cardDef, charDef, isCard, monsterDef, tileDef } from '../game/core.ts'
import type { GameState, PlayerState, XY } from '../game/types.ts'
import { PLAYER_COLORS, playerIcon } from './common'
import { useCardImage, useImages } from './images'
import './fx.css'

/** Всплывающая надпись над тайлом поля */
export interface Float {
  id: number
  x: number
  y: number
  text: string
  kind: 'dmg' | 'heal' | 'hit' | 'kill' | 'monster' | 'ok' | 'fail' | 'spawn'
  /** задержка появления, мс — чтобы надписи на одном тайле не слипались */
  delay: number
}

/** Крупная сцена поверх экрана (по очереди) */
export type Scene =
  | { id: number; kind: 'turn'; seat: number; round: number; dice: [number, number] | null; hits: number }
  | { id: number; kind: 'dice'; dice: [number, number]; hits: number }
  | { id: number; kind: 'boss'; monster: string; seat: number }
  | { id: number; kind: 'death'; seat: number }

/** Карта, всплывающая сбоку (находка, новый монстр) — не мешает игре */
export interface Pop {
  id: number
  card: string
  title: string
  seat: number
}

const DUR: Record<Scene['kind'], number> = { turn: 1500, dice: 1500, boss: 2400, death: 2200 }
const turnDur = (sc: Scene) => (sc.kind === 'turn' && sc.dice ? 2300 : DUR[sc.kind])

/** Пока идёт сцена, боты ждут — иначе ход убегает вперёд анимации */
export const fxClock = { until: 0 }

const FX_KEY = 'ma-fx'
export const readFx = () => {
  try {
    return localStorage.getItem(FX_KEY) !== '0'
  } catch {
    return true
  }
}
export const saveFx = (on: boolean) => {
  try {
    localStorage.setItem(FX_KEY, on ? '1' : '0')
  } catch {
    // не важно, если не сохранится
  }
}

/** Новые строки журнала (журнал обрезается спереди до 40 строк) */
function newLines(prev: string[], next: string[]): string[] {
  if (prev === next) return []
  for (let a = 0; a <= prev.length; a++) {
    const tail = prev.slice(a)
    if (tail.length > next.length) continue
    if (tail.every((l, i) => next[i] === l)) return next.slice(tail.length)
  }
  return next.slice(-6)
}

/** Две кости с заданной суммой — в журнале только сумма */
function splitDice(sum: number): [number, number] {
  const lo = Math.max(1, sum - 6)
  const hi = Math.min(6, sum - 1)
  const a = lo + Math.floor(Math.random() * (hi - lo + 1))
  return [a, sum - a]
}

const hpOf = (p: PlayerState) => p.figures.reduce((n, f) => n + (f.alive ? f.hp : 0), 0)

function monsterMap(s: GameState) {
  const m = new Map<string, { seat: number; wounds: number }>()
  for (const p of s.players) for (const x of p.monsters) m.set(x.id, { seat: p.seat, wounds: x.wounds })
  return m
}

let uid = 0

export function useFx(s: GameState, enabled: boolean) {
  const prev = useRef<GameState | null>(null)
  const [floats, setFloats] = useState<Float[]>([])
  const [pops, setPops] = useState<Pop[]>([])
  const [queue, setQueue] = useState<Scene[]>([])
  const [hurt, setHurt] = useState(0)

  useEffect(() => {
    const old = prev.current
    prev.current = s
    if (!old || !enabled || old === s || s.phase === 'setup' || old.phase === 'setup') return

    const fl: Float[] = []
    const pp: Pop[] = []
    const sc: Scene[] = []
    const perTile = new Map<string, number>()
    const float = (xy: XY, text: string, kind: Float['kind']) => {
      const k = `${xy.x},${xy.y}`
      const n = perTile.get(k) ?? 0
      perTile.set(k, n + 1)
      fl.push({ id: ++uid, x: xy.x, y: xy.y, text, kind, delay: n * 260 })
    }
    const byName = (name: string) => s.players.find((p) => p.name === name)

    // --- журнал: ход, кости, скрытность, находки ---
    for (const line of newLines(old.log, s.log)) {
      let m: RegExpMatchArray | null
      if ((m = line.match(/^— Ход: (.+) —$/))) {
        const p = byName(m[1])
        if (p) sc.push({ id: ++uid, kind: 'turn', seat: p.seat, round: s.round, dice: null, hits: 0 })
      } else if ((m = line.match(/^Появление монстров: выпало (\d+)/))) {
        const sum = Number(m[1])
        const hitTiles = s.tiles.filter((t) => t.revealed && tileDef(t).spawn === sum)
        for (const t of hitTiles) float(t, '☠', 'spawn')
        const last = sc[sc.length - 1]
        if (last?.kind === 'turn' && !last.dice) {
          last.dice = splitDice(sum)
          last.hits = hitTiles.length
        } else sc.push({ id: ++uid, kind: 'dice', dice: splitDice(sum), hits: hitTiles.length })
      } else if ((m = line.match(/^(.+): проверка скрытности (\d+) против (-?\d+) — (успех|провал)/))) {
        const p = byName(m[1])
        if (p) float(p.pos, `🎲 ${m[2]} / ${m[3]} ${m[4] === 'успех' ? '✓' : '✗'}`, m[4] === 'успех' ? 'ok' : 'fail')
      } else if ((m = line.match(/^(.+) находит «(.+)»/))) {
        const p = byName(m[1])
        const name = m[2]
        if (p && !p.bot) {
          const id = [...p.hand, ...p.equip.map((e) => e.id)].find((c) => isCard(c) && cardDef(c).name === name)
          if (id) pp.push({ id: ++uid, card: id, title: `Находка: ${name}`, seat: p.seat })
        }
      }
    }

    // --- здоровье игроков, гибель ---
    for (const p of s.players) {
      const o = old.players[p.seat]
      if (!o) continue
      const d = hpOf(p) - hpOf(o)
      if (d < 0) float(p.pos, `−${-d} ❤`, 'dmg')
      if (d > 0) float(p.pos, `+${d} ❤`, 'heal')
      if (o.alive && !p.alive) sc.push({ id: ++uid, kind: 'death', seat: p.seat })
    }
    if (s.players.some((p) => hpOf(p) < hpOf(old.players[p.seat] ?? p))) setHurt((h) => h + 1)

    // --- монстры: новые, раны, уничтоженные ---
    const was = monsterMap(old)
    const now = monsterMap(s)
    for (const [id, m] of now) {
      const o = was.get(id)
      const p = s.players[m.seat]
      if (!o) {
        const d = monsterDef(id)
        if (d.boss) sc.push({ id: ++uid, kind: 'boss', monster: id, seat: m.seat })
        else float(p.pos, `☠ ${d.name}`, 'monster')
      } else if (m.wounds > o.wounds) float(p.pos, `−${m.wounds - o.wounds}`, 'hit')
    }
    for (const [id, o] of was) {
      if (now.has(id)) continue
      const p = old.players[o.seat]
      float(p.pos, `✖ ${monsterDef(id).name}`, 'kill')
    }

    if (fl.length) {
      setFloats((f) => [...f, ...fl])
      const ids = new Set(fl.map((x) => x.id))
      setTimeout(() => setFloats((f) => f.filter((x) => !ids.has(x.id))), 1900 + fl.length * 260)
    }
    if (pp.length) {
      setPops((x) => [...x, ...pp].slice(-3))
      const ids = new Set(pp.map((x) => x.id))
      setTimeout(() => setPops((x) => x.filter((y) => !ids.has(y.id))), 2600)
    }
    if (sc.length) {
      setQueue((q) => [...q, ...sc].slice(-4))
      fxClock.until = Math.max(fxClock.until, Date.now()) + sc.reduce((n, x) => n + turnDur(x), 0)
    }
  }, [s, enabled])

  // Сцены — по одной
  const scene = queue[0] ?? null
  useEffect(() => {
    if (!scene) return
    const t = setTimeout(() => setQueue((q) => q.slice(1)), turnDur(scene))
    return () => clearTimeout(t)
  }, [scene])

  useEffect(() => {
    if (!enabled) {
      setQueue([])
      setFloats([])
      setPops([])
      fxClock.until = 0
    }
  }, [enabled])

  const skip = () => {
    setQueue((q) => q.slice(1))
    fxClock.until = Date.now()
  }

  return { floats, pops, scene, hurt, skip }
}

// ---------- Отрисовка ----------

function Die({ v, i }: { v: number; i: number }) {
  // точки по сетке 3×3
  const dots: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }
  return (
    <span className={`die d${i}`}>
      {Array.from({ length: 9 }, (_, k) => (
        <i key={k} className={dots[v].includes(k) ? 'on' : ''} />
      ))}
    </span>
  )
}

function Dice({ dice, hits }: { dice: [number, number]; hits: number }) {
  return (
    <div className="fx-dice">
      <div className="fx-dice-row">
        <Die v={dice[0]} i={0} />
        <Die v={dice[1]} i={1} />
      </div>
      <div className="fx-dice-sum">
        <b>{dice[0] + dice[1]}</b>
        <span>{hits ? `монстры идут: ${hits} ${hits === 1 ? 'тайл' : hits < 5 ? 'тайла' : 'тайлов'}` : 'тишина… пока'}</span>
      </div>
    </div>
  )
}

function Portrait({ p, className }: { p: PlayerState; className: string }) {
  const img = useImages()
  const ic = playerIcon(p, img.face)
  return <img className={className} src={ic.src} alt="" style={{ objectPosition: ic.pos, borderColor: PLAYER_COLORS[p.seat] }} />
}

function BossCard({ id }: { id: string }) {
  const src = useCardImage(id)
  return src ? <img className="fx-boss-card" src={src} alt="" /> : null
}

function PopCard({ pop }: { pop: Pop }) {
  const src = useCardImage(pop.card)
  return (
    <div className="fx-pop" style={{ borderColor: PLAYER_COLORS[pop.seat] }}>
      {src && <img src={src} alt="" />}
      <b>{pop.title}</b>
    </div>
  )
}

export function FxLayer({ s, fx }: { s: GameState; fx: ReturnType<typeof useFx> }) {
  const sc = fx.scene
  return (
    <>
      {fx.hurt > 0 && <div key={fx.hurt} className="fx-hurt" />}
      {fx.pops.length > 0 && (
        <div className="fx-pops">
          {fx.pops.map((p) => (
            <PopCard key={p.id} pop={p} />
          ))}
        </div>
      )}
      {sc && (
        <div key={sc.id} className="fx-scene" onClick={fx.skip}>
          <div className="fx-bar top" />
          <div className="fx-bar bottom" />
          {sc.kind === 'turn' && (
            <div className="fx-turn" style={{ ['--pc' as string]: PLAYER_COLORS[sc.seat] }}>
              <Portrait p={s.players[sc.seat]} className="fx-portrait" />
              <div className="fx-turn-text">
                <small>Раунд {sc.round}</small>
                <b>{s.players[sc.seat].name}</b>
                <span>{charDef(s.players[sc.seat]).name}</span>
              </div>
              {sc.dice && <Dice dice={sc.dice} hits={sc.hits} />}
            </div>
          )}
          {sc.kind === 'dice' && <Dice dice={sc.dice} hits={sc.hits} />}
          {sc.kind === 'boss' && (
            <div className="fx-boss">
              <small>БОСС</small>
              <BossCard id={sc.monster} />
              <b>{monsterDef(sc.monster).name}</b>
              <span>выходит на {s.players[sc.seat].name}</span>
            </div>
          )}
          {sc.kind === 'death' && (
            <div className="fx-death">
              <Portrait p={s.players[sc.seat]} className="fx-portrait dead" />
              <b>{s.players[sc.seat].name} погибает</b>
              <span>Пустошь забирает ещё одного…</span>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** Надписи над тайлами — рисуются внутри поля, в его координатах */
export function BoardFloats({ floats, cell, pad, minX, minY, k }: {
  floats: Float[]
  cell: number
  pad: number
  minX: number
  minY: number
  k: number
}) {
  // шрифт не мельчает при отдалении карты
  const size = Math.max(22, 18 / k)
  return (
    <>
      {floats.map((f) => (
        <span key={f.id} className={`bfloat ${f.kind}`}
          style={{ left: pad + (f.x - minX + 0.5) * cell, top: pad + (f.y - minY + 0.5) * cell, fontSize: size, animationDelay: `${f.delay}ms` }}>
          {f.text}
        </span>
      ))}
    </>
  )
}
