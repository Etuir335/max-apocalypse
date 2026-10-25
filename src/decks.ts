// Что лежит в каждой папке public/assets/cards (со слов владельца игры).
export type DeckKind =
  | 'character'
  | 'companion'
  | 'board'
  | 'playerDeck'
  | 'reference'
  | 'food'
  | 'resources'
  | 'locations'
  | 'scenarios'
  | 'enemies'

export interface DeckMeta {
  title: string
  kind: DeckKind
  /** Персонаж, к которому относится колода/карта */
  hero?: 'veteran' | 'firefighter' | 'doctor' | 'mechanic' | 'hunter' | 'gunslinger'
}

export const DECKS: Record<string, DeckMeta> = {
  '01_single': { title: 'Персонажи', kind: 'character' },
  '02_f4f306': { title: 'Спутник Ветерана', kind: 'companion', hero: 'veteran' },
  '03_f4f306': { title: 'Ветеран (альтернативная версия)', kind: 'character', hero: 'veteran' },
  '04_single': { title: 'Пожарный', kind: 'character', hero: 'firefighter' },
  '05_deck': { title: 'Планшеты персонажей', kind: 'board' },
  '06_bcc60e': { title: 'Колода Ветерана', kind: 'playerDeck', hero: 'veteran' },
  '07_8dd101': { title: 'Колода Пожарного', kind: 'playerDeck', hero: 'firefighter' },
  '08_d368aa': { title: 'Колода Доктора', kind: 'playerDeck', hero: 'doctor' },
  '09_single': { title: 'Доктор', kind: 'character', hero: 'doctor' },
  '10_c6d244': { title: 'Колода Механика', kind: 'playerDeck', hero: 'mechanic' },
  '11_single': { title: 'Механик (М)', kind: 'character', hero: 'mechanic' },
  '12_single': { title: 'Механик (Ж)', kind: 'character', hero: 'mechanic' },
  '13_fc791c': { title: 'Колода Охотника', kind: 'playerDeck', hero: 'hunter' },
  '14_single': { title: 'Охотник (Ж)', kind: 'character', hero: 'hunter' },
  '15_single': { title: 'Охотник (М)', kind: 'character', hero: 'hunter' },
  '16_bd1cb5': { title: 'Колода Стрелка', kind: 'playerDeck', hero: 'gunslinger' },
  '17_single': { title: 'Стрелок (Ж)', kind: 'character', hero: 'gunslinger' },
  '18_single': { title: 'Памятка: дистанция атаки', kind: 'reference' },
  '19_9c5719': { title: 'Еда', kind: 'food' },
  '20_9c5719': { title: 'Ресурсы', kind: 'resources' },
  '21_4fd4b5': { title: 'Тайлы локаций', kind: 'locations' },
  '22_8b9865': { title: 'Сценарии', kind: 'scenarios' },
  '23_ca7980': { title: 'Враги', kind: 'enemies' },
  '24_f0f81e': { title: 'Враги (2)', kind: 'enemies' },
}
