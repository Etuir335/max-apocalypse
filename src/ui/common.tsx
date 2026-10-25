// Общие мелкие компоненты: картинка карты (с увеличением), выдвижная панель снизу.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { assetUrl } from '../assets'
import { cardDef, charDef, isCard, monsterDef } from '../game/core.ts'
import type { PlayerState } from '../game/types.ts'
import { useCardImage } from './images'

// ---------- Увеличение карты на весь экран ----------

const ZoomCtx = createContext<(src: string) => void>(() => {})

// ---------- Предпросмотр при наведении мыши (только где есть мышь) ----------

export interface PreviewData {
  src: string
  title?: string
  text?: string
  /** по какую сторону экрана был курсор: показываем с противоположной */
  side: 'left' | 'right'
}
const PreviewCtx = createContext<(p: PreviewData | null) => void>(() => {})
const canHover = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches

export function ZoomProvider({ children }: { children: ReactNode }) {
  const [src, setSrc] = useState('')
  const [prev, setPrev] = useState<PreviewData | null>(null)
  // Карта могла исчезнуть под курсором (разыграли) — убираем предпросмотр при любом нажатии
  useEffect(() => {
    const off = () => setPrev(null)
    window.addEventListener('pointerdown', off)
    return () => window.removeEventListener('pointerdown', off)
  }, [])
  return (
    <ZoomCtx.Provider value={setSrc}>
      <PreviewCtx.Provider value={setPrev}>
        {children}
        {prev && !src && (
          <div className={`hoverprev ${prev.side === 'left' ? 'at-right' : 'at-left'}`}>
            <img src={prev.src} alt="" />
            {(prev.title || prev.text) && (
              <div className="hp-text">
                {prev.title && <b>{prev.title}</b>}
                {prev.text && <span>{prev.text}</span>}
              </div>
            )}
          </div>
        )}
        {src && (
          <div className="zoom" onClick={() => setSrc('')}>
            <img src={src} alt="" />
            <span className="muted">нажмите, чтобы закрыть</span>
          </div>
        )}
      </PreviewCtx.Provider>
    </ZoomCtx.Provider>
  )
}
export const useZoom = () => useContext(ZoomCtx)

/** Обработчики наведения: показать крупную карту с чётким текстом */
export function useHoverPreview() {
  const set = useContext(PreviewCtx)
  return (src: string, title?: string, text?: string) =>
    canHover() && src
      ? {
          onMouseEnter: (e: { clientX: number }) =>
            set({ src, title, text, side: e.clientX < window.innerWidth / 2 ? 'left' : 'right' }),
          onMouseLeave: () => set(null),
        }
      : {}
}

/** Картинка по готовому адресу с кнопкой 🔍 */
export function ZoomImg({ src, className = 'cimg' }: { src: string; className?: string }) {
  const zoom = useZoom()
  return src ? <img src={src} alt="" className={className} onClick={() => zoom(src)} /> : <div className={`${className} noimg`} />
}

/** Название и текст карты из данных — чёткий шрифт вместо мелкого текста на картинке */
export function cardText(id: string): { name: string; text: string } | null {
  if (isCard(id)) {
    const d = cardDef(id)
    return { name: d.name, text: d.text }
  }
  try {
    const m = monsterDef(id)
    return { name: m.name, text: `❤${m.hp} ⚔${m.dmg}${m.text ? ' · ' + m.text : ''}` }
  } catch {
    return null
  }
}

export function CardImg({ id, className = 'cimg', onClick, selected, badge, caption }: {
  id: string
  className?: string
  onClick?: () => void
  selected?: boolean
  badge?: ReactNode
  /** показать название и текст карты под картинкой */
  caption?: boolean
}) {
  const src = useCardImage(id)
  const zoom = useZoom()
  const hover = useHoverPreview()
  const info = cardText(id)
  const cap = caption ? info : null
  return (
    <span className={`cbtn ${selected ? 'selected' : ''} ${cap ? 'captioned' : ''}`} {...hover(src, info?.name, info?.text)}>
      <button type="button" className="cface" onClick={onClick ?? (() => src && zoom(src))}>
        {src ? <img src={src} alt="" className={className} loading="lazy" decoding="async" /> : <div className={`${className} noimg`} />}
        {cap && (
          <span className="ccap">
            <b>{cap.name}</b>
            <span className="ccap-text">{cap.text}</span>
          </span>
        )}
      </button>
      {badge !== undefined && <span className="cbadge">{badge}</span>}
      {src && (
        <button type="button" className="czoom" onClick={() => zoom(src)} aria-label="Увеличить">
          🔍
        </button>
      )}
    </span>
  )
}

/** Панель снизу экрана с затемнением. Без анимаций (в Telegram WebView двойные анимации мерцают). */
export function Sheet({ title, onClose, children }: { title?: ReactNode; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b>{title}</b>
          {onClose && (
            <button className="btn small" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          )}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

export const PLAYER_COLORS = ['#e8553f', '#3fa7e8', '#5fcf5a', '#e8c23f']

/** Портрет игрока: фигурка персонажа; если Ветеран погиб и играет собака — её карта (кадрируем на морду). */
export function playerIcon(p: PlayerState, face: (cardId: number) => string): { src: string; pos: string } {
  const ch = charDef(p)
  const mainAlive = p.figures.some((f) => f.alive && !f.companion)
  if (!mainAlive) {
    const i = p.figures.findIndex((f) => f.alive && f.companion)
    if (i >= 0) return { src: face(ch.figures[i].image), pos: '50% 38%' }
  }
  return { src: assetUrl(`assets/ui/fig/${p.hero}.webp`), pos: 'top' }
}
