// Раскладка для ПК: центр (карта) и две колонки панелей. Панели можно перетаскивать между колонками,
// сворачивать, закрывать (и возвращать), менять им высоту; ширину колонок — разделителями. Всё запоминается.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'

export interface PanelDef {
  id: string
  title: string
  node: ReactNode
}

type Col = 'left' | 'right'
interface LayoutState {
  left: string[]
  right: string[]
  hidden: string[]
  collapsed: string[]
  heights: Record<string, number>
  wLeft: number
  wRight: number
}

const KEY = 'ma-layout'
const DEFAULT: LayoutState = {
  left: ['player', 'hand'],
  right: ['mission', 'finds', 'squad', 'log'],
  hidden: [],
  collapsed: [],
  heights: { log: 320 },
  wLeft: 560,
  wRight: 360,
}

function load(ids: string[]): LayoutState {
  let st = DEFAULT
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) st = { ...DEFAULT, ...(JSON.parse(raw) as LayoutState) }
  } catch {
    st = DEFAULT
  }
  // Убрать неизвестные панели, добавить новые
  const known = (list: string[]) => list.filter((id) => ids.includes(id))
  st = { ...st, left: known(st.left), right: known(st.right), hidden: known(st.hidden) }
  const placed = new Set([...st.left, ...st.right, ...st.hidden])
  const fresh = ids.filter((id) => !placed.has(id))
  st.left = [...st.left, ...fresh.filter((id) => DEFAULT.left.includes(id))]
  st.right = [...st.right, ...fresh.filter((id) => !DEFAULT.left.includes(id))]
  return st
}

export function useIsDesktop() {
  const q = '(min-width: 1100px)'
  const [ok, setOk] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const on = () => setOk(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return ok
}

export default function DesktopLayout({ panels, center }: { panels: PanelDef[]; center: ReactNode }) {
  const ids = panels.map((p) => p.id)
  const [st, setSt] = useState<LayoutState>(() => load(ids))
  const dragId = useRef<string | null>(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const end = () => setDragging(false)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [])

  const update = (fn: (s: LayoutState) => LayoutState) =>
    setSt((prev) => {
      const next = fn(prev)
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // раскладка просто не запомнится
      }
      return next
    })

  const without = (s: LayoutState, id: string): LayoutState => ({
    ...s,
    left: s.left.filter((x) => x !== id),
    right: s.right.filter((x) => x !== id),
    hidden: s.hidden.filter((x) => x !== id),
  })
  const moveTo = (id: string, col: Col, before?: string) =>
    update((s) => {
      const n = without(s, id)
      const list = [...n[col]]
      const i = before ? list.indexOf(before) : -1
      list.splice(i >= 0 ? i : list.length, 0, id)
      return { ...n, [col]: list }
    })
  const toggle = (key: 'collapsed', id: string) =>
    update((s) => ({ ...s, [key]: s[key].includes(id) ? s[key].filter((x) => x !== id) : [...s[key], id] }))

  // ---------- Перетаскивание мышью (размеры) ----------
  const drag = (e: RPointerEvent, onMove: (dx: number, dy: number) => void) => {
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const resizeCol = (col: Col) => (e: RPointerEvent) => {
    const start = col === 'left' ? st.wLeft : st.wRight
    const max = Math.max(320, window.innerWidth * 0.45)
    drag(e, (dx) => {
      const w = Math.min(max, Math.max(260, start + (col === 'left' ? dx : -dx)))
      update((s) => (col === 'left' ? { ...s, wLeft: w } : { ...s, wRight: w }))
    })
  }
  const resizePanel = (id: string, el: HTMLElement | null) => (e: RPointerEvent) => {
    const start = el?.getBoundingClientRect().height ?? 200
    drag(e, (_, dy) => update((s) => ({ ...s, heights: { ...s.heights, [id]: Math.max(80, start + dy) } })))
  }

  const column = (col: Col) => (
    <div className="dl-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (dragId.current) moveTo(dragId.current, col)
        dragId.current = null
      }}>
      {col === 'right' && st.hidden.length > 0 && (
        <div className="dl-restore">
          <span className="muted">Вернуть:</span>
          {st.hidden.map((id) => (
            <button key={id} className="btn small" onClick={() => moveTo(id, 'right')}>
              ＋ {panels.find((p) => p.id === id)?.title}
            </button>
          ))}
        </div>
      )}
      {st[col].map((id) => {
        const p = panels.find((x) => x.id === id)
        if (!p) return null
        const collapsed = st.collapsed.includes(id)
        return <Panel key={id} p={p} collapsed={collapsed} height={st.heights[id]}
          onDragStart={() => {
            dragId.current = id
            setDragging(true)
          }}
          onDropBefore={() => {
            if (dragId.current && dragId.current !== id) moveTo(dragId.current, col, id)
            dragId.current = null
          }}
          onCollapse={() => toggle('collapsed', id)}
          onClose={() => update((s) => ({ ...without(s, id), hidden: [...s.hidden.filter((x) => x !== id), id] }))}
          onResize={resizePanel} />
      })}
      <div className="dl-dropzone muted">перетащите панель сюда</div>
    </div>
  )

  return (
    <div className={`dl ${dragging ? 'dragging' : ''}`} style={{ gridTemplateColumns: `${st.wLeft}px 8px minmax(360px, 1fr) 8px ${st.wRight}px` }}>
      {column('left')}
      <div className="dl-split" onPointerDown={resizeCol('left')} title="Потяните, чтобы изменить ширину" />
      <div className="dl-center">{center}</div>
      <div className="dl-split" onPointerDown={resizeCol('right')} title="Потяните, чтобы изменить ширину" />
      {column('right')}
    </div>
  )
}

function Panel({ p, collapsed, height, onDragStart, onDropBefore, onCollapse, onClose, onResize }: {
  p: PanelDef
  collapsed: boolean
  height?: number
  onDragStart: () => void
  onDropBefore: () => void
  onCollapse: () => void
  onClose: () => void
  onResize: (id: string, el: HTMLElement | null) => (e: RPointerEvent) => void
}) {
  const body = useRef<HTMLDivElement>(null)
  return (
    <section className="dpanel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDropBefore()
      }}>
      <header className="dp-head" draggable onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', p.id)
        onDragStart()
      }}>
        <span className="grip" title="Перетащите панель">⠿</span>
        <h3>{p.title}</h3>
        <button className="dp-btn" onClick={onCollapse} title={collapsed ? 'Развернуть' : 'Свернуть'}>
          {collapsed ? '▸' : '▾'}
        </button>
        <button className="dp-btn" onClick={onClose} title="Закрыть">
          ✕
        </button>
      </header>
      {!collapsed && (
        <>
          <div className="dp-body" ref={body} style={height ? { height } : undefined}>
            {p.node}
          </div>
          <div className="dp-resize" onPointerDown={(e) => onResize(p.id, body.current)(e)} title="Потяните, чтобы изменить высоту" />
        </>
      )}
    </section>
  )
}
