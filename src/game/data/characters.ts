// Персонажи. Лицо карты — обычная сторона, рубашка — «истощённая» (stealthTired).
import type { CharacterDef } from '../types.ts'

const fig = (name: string, hp: number, stealth: number, stealthTired: number, image: number, slots = 4, companion = false) => ({
  name, hp, stealth, stealthTired, image, slots, companion,
})

export const CHARACTERS: CharacterDef[] = [
  { key: 'firefighter', name: 'Пожарный', deck: 'firefighter', figures: [fig('Пожарный', 32, 6, 5, 194903)],
    ability: { name: 'Удар', range: 'short', action: [{ k: 'damage', amount: 2 }], text: 'Действие: нанесите выбранной цели 2 урона.' } },
  { key: 'firefighterF', name: 'Пожарный (Ж)', deck: 'firefighter', figures: [fig('Пожарный', 34, 5, 4, 189800)],
    ability: { name: 'Привлечение внимания', range: 'medium', action: [{ k: 'removeMarkers', where: 'range', count: 'all', takeMonster: true }],
      text: 'Действие: удалите все жетоны монстров с тайла и возьмите одну карту монстра.' } },
  { key: 'veteran', name: 'Ветеран и Пёс', deck: 'veteran',
    figures: [fig('Ветеран', 22, 7, 6, 194102), fig('Пёс', 12, 9, 8, 194101, 0, true)],
    ability: { name: 'Держи свои лапы от них подальше', action: [{ k: 'selfDamage', who: 'main', amount: 2 }, { k: 'companionImmune' }],
      text: 'Действие: нанесите 2 урона Ветерану; Пёс невосприимчив к урону до вашего следующего хода.' } },
  { key: 'veteranF', name: 'Ветеран (Ж) и Собака', deck: 'veteran',
    figures: [fig('Ветеран', 26, 6, 4, 189700), fig('Собака', 11, 8, 7, 189600, 0, true)],
    ability: { name: 'Хорошая девочка!', action: [{ k: 'healCompanion', amount: 1 }], text: 'Действие: восстановите 1 здоровье своей собаке.' } },
  { key: 'surgeon', name: 'Хирург', deck: 'surgeon', figures: [fig('Хирург', 23, 8, 7, 194000)],
    ability: { name: 'Шов', range: 'short', action: [{ k: 'heal', amount: 1, target: 'range' }], text: 'Действие: восстановите выбранной цели 1 здоровье.' } },
  { key: 'surgeonM', name: 'Хирург (М)', deck: 'surgeon', figures: [fig('Хирург', 18, 7, 6, 189500)],
    ability: { name: 'Лечение', range: 'short', action: [{ k: 'heal', amount: 2, target: 'range' }], text: 'Действие: восстановите 2 здоровья цели.' } },
  { key: 'mechanicM', name: 'Механик (М)', deck: 'mechanic', figures: [fig('Механик', 23, 7, 6, 190000)],
    ability: { name: 'Мгновенный повтор', action: [{ k: 'replayInstant' }],
      text: 'Действие: сыграйте любую карту мгновенного действия из сброса. Удалите её из игры.' } },
  { key: 'mechanicF', name: 'Механик (Ж)', deck: 'mechanic', figures: [fig('Механик', 26, 8, 7, 181900)],
    ability: { name: 'Ремонт', action: [{ k: 'gearFromDiscard', toPlay: false }],
      text: 'Действие: найдите карту снаряжения в любой колоде сброса и возьмите её в руку.' } },
  { key: 'hunterF', name: 'Охотник (Ж)', deck: 'hunter', figures: [fig('Охотник', 24, 9, 8, 182000)],
    ability: { name: 'Разведка', action: [{ k: 'reveal', n: 2, adjacent: true }],
      text: 'Действие: переверните два соседних тайла, не активируя их эффектов.' } },
  { key: 'hunterM', name: 'Охотник (М)', deck: 'hunter', figures: [fig('Охотник', 25, 8, 7, 189900)],
    ability: { name: 'Находка', passive: 'hunterFind', text: 'Пассивное: в начале игры возьмите карту находки из любой колоды.' } },
  { key: 'gunslinger', name: 'Стрелок', deck: 'gunslinger', figures: [fig('Стрелок', 28, 7, 6, 193904)],
    ability: { name: 'Быстрая реакция', passive: 'colt',
      text: 'Пассивное: начинаете с Кольтом. Когда проголодаетесь, верните его в колоду и перетасуйте.' } },
  { key: 'gunslingerF', name: 'Стрелок (Ж)', deck: 'gunslinger', figures: [fig('Стрелок', 26, 8, 8, 189400)],
    ability: { name: 'Красная ярость', action: [{ k: 'buff', amount: 2, until: 'endTurn', who: 'self' }],
      text: 'Действие: увеличьте весь наносимый урон на 2 до конца хода.' } },
]

export const characterByKey = (key: string) => {
  const c = CHARACTERS.find((x) => x.key === key)
  if (!c) throw new Error(`Нет персонажа ${key}`)
  return c
}
