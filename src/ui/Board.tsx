// Поле: карту можно двигать (палец/мышь), приближать (щипок, колесо, кнопки +/−).
// Положение камеры живёт в компоненте и не сбрасывается при перерисовке. Без CSS-анимаций.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { assetUrl } from '../assets'
import { tileDef } from '../game/core.ts'
import type { GameState, XY } from '../game/types.ts'
import { useImages } from './images'
import { PLAYER_COLORS, playerIcon, useHoverPreview } from './common'

const CELL = 128
const PAD = 24
/** Тайлы в моде 486×486 — даём приблизить до их полного разрешения */
const MAX_K = 486 / 124
const TAP_SLOP = 8

interface View {
  x: number
  y: number
  k: number
}

const TALL_KEY = 'ma-board-tall'
const readTall = () => {
  try {
    return localStorage.getItem(TALL_KEY) === '1'
  } catch {
    return false
  }
}

export default function Board({ s, highlight, selected, active, onTile }: {
  s: GameState
  highlight?: XY[]
  selected?: XY[]
  active?: XY
  onTile: (xy: XY) => void
}) {
  const img = useImages()
  const hover = useHoverPreview()
  const vp = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 0.5 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [tall, setTall] = useState(readTall)

  // Состояние приходит новой копией после каждого действия — пересчитываем рамку только при смене набора тайлов
  const tilesKey = s.tiles.map((t) => `${t.x},${t.y}`).join(';')
  const box = useMemo(() => {
    const xy = tilesKey.split(';').map((p) => p.split(',').map(Number))
    const minX = Math.min(...xy.map((p) => p[0]))
    const minY = Math.min(...xy.map((p) => p[1]))
    const w = Math.max(...xy.map((p) => p[0])) - minX + 1
    const h = Math.max(...xy.map((p) => p[1])) - minY + 1
    return { minX, minY, w, h, pw: w * CELL + PAD * 2, ph: h * CELL + PAD * 2 }
  }, [tilesKey])

  const size = () => {
    const r = vp.current?.getBoundingClientRect()
    return { w: r?.width ?? 360, h: r?.height ?? 300 }
  }
  const fitK = useCallback(() => {
    const { w, h } = size()
    return Math.min(w / box.pw, h / box.ph, 1.2)
  }, [box])
  const minK = () => Math.min(fitK(), 0.35)

  const fit = useCallback(() => {
    const { w, h } = size()
    const k = fitK()
    setView({ k, x: (w - box.pw * k) / 2, y: (h - box.ph * k) / 2 })
  }, [box, fitK])

  const centerOn = (xy: XY, k = Math.max(viewRef.current.k, 0.9)) => {
    const { w, h } = size()
    const cx = PAD + (xy.x - box.minX + 0.5) * CELL
    const cy = PAD + (xy.y - box.minY + 0.5) * CELL
    setView({ k, x: w / 2 - cx * k, y: h / 2 - cy * k })
  }

  /** Масштаб вокруг точки экрана (px, py — внутри поля) */
  const zoomAt = (factor: number, px: number, py: number, from = viewRef.current) => {
    const k = Math.min(MAX_K, Math.max(minK(), from.k * factor))
    const wx = (px - from.x) / from.k
    const wy = (py - from.y) / from.k
    setView({ k, x: px - wx * k, y: py - wy * k })
  }
  const zoomCenter = (factor: number) => {
    const { w, h } = size()
    zoomAt(factor, w / 2, h / 2)
  }

  // Первое показ — всё поле целиком; при смене размеров поля (тайл исчез) — тоже
  useLayoutEffect(() => {
    fit()
  }, [fit, tall])

  // Окно поменяло размер (ПК, поворот телефона) — заново вписываем поле
  useEffect(() => {
    const el = vp.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = `${el.clientWidth}x${el.clientHeight}`
    const ro = new ResizeObserver(() => {
      const now = `${el.clientWidth}x${el.clientHeight}`
      if (now !== last) {
        last = now
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  // Колесо мыши: нужен не-пассивный слушатель, чтобы не прокручивалась страница
  useEffect(() => {
    const el = vp.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  // ---------- Жесты ----------
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const g = useRef<{ moved: boolean; sx: number; sy: number; sv: View; dist: number; mx: number; my: number }>({
    moved: false, sx: 0, sy: 0, sv: view, dist: 0, mx: 0, my: 0,
  })
  const local = (e: PointerEvent) => {
    const r = vp.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const restart = () => {
    const list = [...pts.current.values()]
    const sv = viewRef.current
    if (list.length === 1) g.current = { ...g.current, sx: list[0].x, sy: list[0].y, sv }
    if (list.length >= 2) {
      const [a, b] = list
      g.current = { ...g.current, sv, dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
    }
  }
  const onDown = (e: PointerEvent) => {
    pts.current.set(e.pointerId, local(e))
    if (pts.current.size === 1) g.current.moved = false
    restart()
  }
  const onMove = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.set(e.pointerId, local(e))
    const list = [...pts.current.values()]
    const { sv } = g.current
    if (list.length === 1) {
      const dx = list[0].x - g.current.sx
      const dy = list[0].y - g.current.sy
      if (!g.current.moved && Math.hypot(dx, dy) < TAP_SLOP) return
      if (!g.current.moved) {
        g.current.moved = true
        vp.current?.setPointerCapture(e.pointerId)
      }
      setView({ k: sv.k, x: sv.x + dx, y: sv.y + dy })
    } else if (list.length >= 2 && g.current.dist > 0) {
      g.current.moved = true
      const [a, b] = list
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const k = Math.min(MAX_K, Math.max(minK(), (sv.k * dist) / g.current.dist))
      const wx = (g.current.mx - sv.x) / sv.k
      const wy = (g.current.my - sv.y) / sv.k
      setView({ k, x: mx - wx * k, y: my - wy * k })
    }
  }
  const onUp = (e: PointerEvent) => {
    pts.current.delete(e.pointerId)
    restart()
  }

  const has = (list: XY[] | undefined, t: XY) => !!list?.some((p) => p.x === t.x && p.y === t.y)
  const toggleTall = () => {
    const v = !tall
    setTall(v)
    try {
      localStorage.setItem(TALL_KEY, v ? '1' : '0')
    } catch {
      // не важно, если не сохранится
    }
  }

  return (
    <div className={`board-vp ${tall ? 'tall' : ''}`} ref={vp} style={{ backgroundImage: `url(${assetUrl('assets/ui/bg-board.png')})` }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="board" style={{ width: box.pw, height: box.ph, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        {s.tiles.map((t) => {
          const d = tileDef(t)
          const here = s.players.filter((p) => p.alive && p.pos.x === t.x && p.pos.y === t.y)
          const dropped = s.dropped.some((x) => x.x === t.x && x.y === t.y)
          const src = t.revealed ? img.face(d.image) : img.back(d.image)
          const cls = ['tile', t.revealed ? 'open' : 'closed', has(highlight, t) && 'hl', has(selected, t) && 'sel', active && active.x === t.x && active.y === t.y && 'act']
          return (
            <button
              key={`${t.x},${t.y}`}
              className={cls.filter(Boolean).join(' ')}
              style={{ left: PAD + (t.x - box.minX) * CELL, top: PAD + (t.y - box.minY) * CELL, width: CELL - 4, height: CELL - 4 }}
              onClick={() => !g.current.moved && onTile({ x: t.x, y: t.y })}
              {...(t.revealed && pts.current.size === 0 ? hover(img.face(d.image), d.name, d.text) : {})}
            >
              {src && <img src={src} alt="" draggable={false} />}
              {t.markers > 0 && (
                <span className="tmarkers">
                  {Array.from({ length: t.markers }, (_, i) => (
                    <img key={i} src={assetUrl('assets/ui/token-marker.webp')} alt="" draggable={false} />
                  ))}
                </span>
              )}
              {t.objective && (
                <span className="tobj">
                  <img src={assetUrl('assets/ui/token-star.webp')} alt="" draggable={false} />
                  <b>{t.objective}</b>
                </span>
              )}
              {dropped && <span className="tdrop">📦</span>}
              <span className="tokens">
                {here.map((p) => (
                  <img key={p.seat} src={playerIcon(p, img.face).src} alt={p.name} draggable={false}
                    style={{ borderColor: PLAYER_COLORS[p.seat], objectPosition: playerIcon(p, img.face).pos }} />
                ))}
              </span>
            </button>
          )
        })}
      </div>

      <div className="board-ctrl" onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn small" onClick={() => zoomCenter(1.3)} aria-label="Приблизить">
          +
        </button>
        <button className="btn small" onClick={() => zoomCenter(1 / 1.3)} aria-label="Отдалить">
          −
        </button>
        <button className="btn small" onClick={fit} aria-label="Всё поле" title="Всё поле">
          ⤢
        </button>
        {active && (
          <button className="btn small" onClick={() => centerOn(active)} aria-label="К персонажу" title="К персонажу">
            ◎
          </button>
        )}
        <button className="btn small mob-only" onClick={toggleTall} aria-label="Размер карты" title={tall ? 'Свернуть карту' : 'Развернуть карту'}>
          {tall ? '▴' : '▾'}
        </button>
      </div>
    </div>
  )
}
