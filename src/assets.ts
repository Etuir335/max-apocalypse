// Все пути к файлам из public строим только через BASE_URL (для GitHub Pages).
export function assetUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\/+/, '')
}

export interface CardInfo {
  id: string
  deck: string
  deckName: string
  cardId: number
  name: string
  description: string
  image: string
}

/** cardId -> путь к рубашке (из scripts/extract-backs.mjs) */
export async function loadBacks(): Promise<Record<string, string>> {
  const res = await fetch(assetUrl('assets/cards/backs.json'))
  if (!res.ok) return {}
  return res.json()
}

export async function loadCards(): Promise<CardInfo[]> {
  const res = await fetch(assetUrl('assets/cards/cards.json'))
  if (!res.ok) throw new Error(`cards.json: HTTP ${res.status}`)
  return res.json()
}
