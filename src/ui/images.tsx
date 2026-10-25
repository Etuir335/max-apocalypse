// Картинки карт по cardId (из cards.json и backs.json), доступны всем компонентам через контекст.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { assetUrl, loadBacks, loadCards } from '../assets'
import { imageOf } from '../game/core.ts'

interface Images {
  ready: boolean
  face: (cardId: number) => string
  back: (cardId: number) => string
}

const empty: Images = { ready: false, face: () => '', back: () => '' }
const Ctx = createContext<Images>(empty)

export function ImagesProvider({ children }: { children: ReactNode }) {
  const [imgs, setImgs] = useState<Images>(empty)
  useEffect(() => {
    Promise.all([loadCards(), loadBacks()]).then(
      ([cards, backs]) => {
        const faces = new Map(cards.map((c) => [c.cardId, assetUrl(c.image)]))
        setImgs({
          ready: true,
          face: (id) => faces.get(id) ?? '',
          back: (id) => (backs[id] ? assetUrl(backs[id]) : ''),
        })
      },
      () => setImgs({ ...empty, ready: true }),
    )
  }, [])
  return <Ctx.Provider value={imgs}>{children}</Ctx.Provider>
}

export const useImages = () => useContext(Ctx)

/** Картинка лица карты по id экземпляра («ключ:картинка:номер») */
export const useCardImage = (instanceId: string) => useImages().face(imageOf(instanceId))
