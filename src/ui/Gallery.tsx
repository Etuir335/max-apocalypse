import { useEffect, useMemo, useState } from 'react'
import { assetUrl, loadBacks, loadCards, type CardInfo } from '../assets'
import { DECKS } from '../decks'

interface DeckGroup {
  deck: string
  deckName: string
  cards: CardInfo[]
}

function groupByDeck(cards: CardInfo[]): DeckGroup[] {
  const map = new Map<string, DeckGroup>()
  for (const card of cards) {
    let group = map.get(card.deck)
    if (!group) {
      group = { deck: card.deck, deckName: card.deckName, cards: [] }
      map.set(card.deck, group)
    }
    group.cards.push(card)
  }
  return [...map.values()].sort((a, b) => a.deck.localeCompare(b.deck))
}

export default function Gallery({ onBack }: { onBack: () => void }) {
  const [cards, setCards] = useState<CardInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState<CardInfo | null>(null)
  const [backs, setBacks] = useState<Record<string, string>>({})
  const [showBack, setShowBack] = useState(false)

  useEffect(() => {
    loadCards().then(setCards, (e: Error) => setError(e.message))
    loadBacks().then(setBacks, () => {})
  }, [])

  const openCard = (c: CardInfo | null) => {
    setShowBack(false)
    setOpened(c)
  }
  const openedBack = opened ? backs[opened.cardId] : undefined

  const decks = useMemo(() => (cards ? groupByDeck(cards) : []), [cards])

  return (
    <div className="page" style={{ backgroundImage: `url(${assetUrl('assets/ui/bg-menu.png')})` }}>
      <div className="overlay">
        <header className="top">
          <button className="btn small" onClick={onBack}>← Меню</button>
          <h1>Галерея карт</h1>
          {cards && (
            <p>
              {decks.length} колод, {cards.length} карт
            </p>
          )}
          {decks.length > 0 && (
            <nav className="deck-nav">
              {decks.map((d) => (
                <a key={d.deck} href={`#${d.deck}`}>
                  {DECKS[d.deck]?.title ?? d.deck}
                </a>
              ))}
            </nav>
          )}
        </header>

        {error && <p className="error">Не удалось загрузить карты: {error}</p>}
        {!cards && !error && <p className="loading">Загрузка…</p>}

        {decks.map((d) => (
          <section key={d.deck} id={d.deck} className="deck">
            <h2>
              {DECKS[d.deck] && <span className="deck-name">{DECKS[d.deck].title} </span>}
              <span className="count">
                ({d.deck}) — {d.cards.length} шт.
              </span>
            </h2>
            <div className="grid">
              {d.cards.map((c) => (
                <button key={c.id} className="card" onClick={() => openCard(c)}>
                  <img src={assetUrl(c.image)} alt={c.id} loading="lazy" decoding="async" />
                  <span className="card-id">{c.id}</span>
                  {c.name && <span className="card-name">{c.name}</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {opened && (
        <div className="viewer" onClick={() => openCard(null)}>
          <img src={assetUrl(showBack && openedBack ? openedBack : opened.image)} alt={opened.id} />
          <div className="viewer-text">
            <b>{opened.id}</b>
            {opened.name && <div>{opened.name}</div>}
            {opened.description && <div className="viewer-desc">{opened.description}</div>}
            {openedBack && (
              <button
                className="flip"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowBack((v) => !v)
                }}
              >
                {showBack ? 'Показать лицо' : 'Перевернуть'}
              </button>
            )}
            <div className="hint">нажмите вне кнопки, чтобы закрыть</div>
          </div>
        </div>
      )}
    </div>
  )
}
