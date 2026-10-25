// Telegram Mini App: всё, что связано с Telegram, — только здесь.
// Вне Telegram (обычный браузер) функции молча ничего не делают.
import { useEffect } from 'react'

interface TgWebApp {
  initData: string
  initDataUnsafe: { user?: { id: number; first_name: string; last_name?: string; username?: string }; start_param?: string }
  version: string
  platform: string
  ready(): void
  expand(): void
  isVersionAtLeast(v: string): boolean
  setHeaderColor?(c: string): void
  setBackgroundColor?(c: string): void
  disableVerticalSwipes?(): void
  openTelegramLink?(url: string): void
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }
}

const webApp = (): TgWebApp | undefined => {
  const w = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp
  // скрипт Telegram есть и в обычном браузере, но initData заполнен только внутри Telegram
  return w && w.initData ? w : undefined
}

export const inTelegram = () => !!webApp()

/** Один раз при старте: готовность, на весь экран, цвета, без закрытия свайпом (мешает двигать карту) */
export function initTelegram() {
  const tg = webApp()
  if (!tg) return
  tg.ready()
  tg.expand()
  try {
    tg.setHeaderColor?.('#0c0c0c')
    tg.setBackgroundColor?.('#121212')
    if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes?.()
  } catch {
    // старые клиенты Telegram — не страшно
  }
}

/** Игрок Telegram (для имени по умолчанию) */
export function tgUser(): { id: number; name: string } | null {
  const u = webApp()?.initDataUnsafe.user
  return u ? { id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 16) } : null
}

/** Код комнаты из ссылки-приглашения: t.me/<бот>/<приложение>?startapp=КОД */
export function tgStartRoom(): string | null {
  const p = webApp()?.initDataUnsafe.start_param?.toUpperCase()
  return p && /^[A-Z0-9]{5}$/.test(p) ? p : null
}

/** Ссылка-приглашение в комнату (если известен адрес Mini App) */
export function inviteLink(code: string): string | null {
  const base = import.meta.env.VITE_TG_APP_URL as string | undefined
  return base ? `${base}?startapp=${code}` : null
}

/** Поделиться приглашением: внутри Telegram — окно выбора чата, иначе — в буфер обмена */
export function shareInvite(code: string) {
  const link = inviteLink(code)
  const text = `Максимум Апокалипсис: заходи в комнату ${code}`
  const tg = webApp()
  if (tg?.openTelegramLink && link) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`)
    return 'Выберите чат для приглашения'
  }
  navigator.clipboard?.writeText(link ? `${text}\n${link}` : text).catch(() => {})
  return 'Приглашение скопировано'
}

/** Системная кнопка «Назад» Telegram: показана, пока передан обработчик */
export function useTelegramBack(handler: (() => void) | null) {
  useEffect(() => {
    const tg = webApp()
    if (!tg || !handler) return
    tg.BackButton.onClick(handler)
    tg.BackButton.show()
    return () => {
      tg.BackButton.offClick(handler)
      tg.BackButton.hide()
    }
  }, [handler])
}
