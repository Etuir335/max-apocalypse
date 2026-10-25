// Миссии (колода 22): лицо — цель, рубашка — тайлы поля и состав колод находок.
import type { Color, MonsterSet } from '../types.ts'

/** Имя тайла на рубашке → имя тайла в TILES */
export type TileList = [string, number][]
/** Вид находки (FindKind или 'food') → количество */
export type FindList = Partial<Record<string, number>>

export interface MissionDef {
  id: string
  num: number
  name: string
  difficulty: string
  image: number
  set: MonsterSet
  /** нужное топливо (0 — не нужно) */
  fuel: number
  tiles: TileList
  finds: Record<Color, FindList>
  boss:
    | { kind: 'none' }
    | { kind: 'aside' } // откладывается, выходит по условию миссии
    | { kind: 'bottom'; under: number } // N карт + босс замешиваются в низ колоды
    | { kind: 'shuffle'; count: number; bottomExtra?: boolean }
    | { kind: 'bottomHalf' }
  text: string
}

const std = {
  red: { food: 2, fuel: 4, meds: 2, ammo: 1, binoculars: 1, empty: 1, parts: 1, ambush: 1 },
  green: { food: 6, fuel: 2, ammo: 1, flashlight: 1, empty: 1, parts: 1, ambush: 1 },
}

export const MISSIONS: MissionDef[] = [
  { id: 'm0', num: 0, name: 'Обучение', difficulty: 'очень легко', image: 180200, set: 'Z', fuel: 4, boss: { kind: 'none' },
    tiles: [['Госпиталь', 1], ['Убежище', 1], ['Бензоколонка', 2], ['Городская улица', 1], ['Ферма', 2], ['Поле', 1], ['Река', 1], ['Лес', 1],
      ['Торговый центр', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 1]],
    finds: {
      red: { food: 2, fuel: 4, meds: 2, ammo: 1, binoculars: 1, parts: 1, empty: 2 },
      green: { food: 6, fuel: 2, ammo: 1, flashlight: 1, parts: 1, empty: 1 },
      blue: { food: 2, fuel: 2, ammo: 3, pistol: 1, radio: 1, binoculars: 1, parts: 1, empty: 1 },
    },
    text: 'Найдите 4 канистры топлива и доберитесь до Фургона. Все начинают в открытом Торговом центре.' },
  { id: 'm1', num: 1, name: 'Спасти учёного', difficulty: 'легко', image: 180201, set: 'Z', fuel: 4, boss: { kind: 'aside' },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 2], ['Туннель', 2], ['Городская улица', 1], ['Ферма', 2], ['Река', 2], ['Поле', 2],
      ['Лес', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 2]],
    finds: { ...std, blue: { food: 2, fuel: 2, ammo: 3, pistol: 1, binoculars: 1, radio: 1, empty: 1, parts: 2 } },
    text: 'Спасите учёного в Полицейском участке (2 действия там) и доставьте его к Фургону. Первый вошедший в участок открывает Босса.' },
  { id: 'm2', num: 2, name: 'Собрать образцы', difficulty: 'очень легко', image: 180202, set: 'Z', fuel: 4, boss: { kind: 'bottom', under: 9 },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 3], ['Туннель', 2], ['Кладбище', 1], ['Поле', 2], ['Городская улица', 2], ['Река', 2],
      ['Лес', 2], ['Ферма', 2], ['Торговый центр', 1], ['Магазин продуктов', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 2]],
    finds: { red: std.red, green: { ...std.green, fuel: 4 }, blue: { food: 2, fuel: 2, ammo: 3, binoculars: 1, pistol: 1, radio: 1, parts: 1, empty: 1 } },
    text: 'Убейте зомби и соберите по 2 образца: Бродяга, Плевун, Пёс, Солдат. Затем топливо и Фургон.' },
  { id: 'm3', num: 3, name: 'Найти лекарство', difficulty: 'легко', image: 180203, set: 'Z', fuel: 0, boss: { kind: 'bottom', under: 9 },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 3], ['Туннель', 2], ['Кладбище', 1], ['Поле', 2], ['Городская улица', 2], ['Река', 2],
      ['Лес', 2], ['Ферма', 2], ['Торговый центр', 1], ['Магазин продуктов', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 2]],
    finds: {
      red: { ...std.red, antidote: 2 },
      green: { ...std.green, fuel: 4, antidote: 2 },
      blue: { food: 2, fuel: 2, ammo: 3, binoculars: 1, pistol: 1, radio: 1, parts: 1, empty: 2, antidote: 1, meds: 1 },
    },
    text: 'Доставьте Учёного в Госпиталь, сдав там 2 Медикамента и 3 Противоядия. Учёный у одного из игроков с начала игры.' },
  { id: 'm4', num: 4, name: 'Ядерная зима', difficulty: 'нормально', image: 180204, set: 'M', fuel: 3, boss: { kind: 'bottom', under: 9 },
    tiles: [['Госпиталь', 1], ['Убежище', 1], ['Бензоколонка', 2], ['Туннель', 2], ['Пустыня', 1], ['Городская улица', 2], ['Ферма', 1], ['Поле', 2],
      ['Торговый центр', 1], ['Магазин продуктов', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 2], ['Электростанция', 1]],
    finds: {
      red: { food: 3, fuel: 4, meds: 2, antidote: 3, ammo: 1, pistol: 1, backpack: 1, empty: 2, ambush: 1, blanket: 1 },
      green: { food: 9, fuel: 1, ammo: 2, binoculars: 1, parts: 1, newspaper: 1, blanket: 2, antidote: 2 },
      blue: { food: 3, fuel: 2, antidote: 1, ammo: 4, pistol: 1, radio: 1, flashlight: 2, binoculars: 1, ambush: 1, newspaper: 2 },
    },
    text: 'Сдайте в Убежище 3 Топлива, 2 Одеяла, 2 Газеты и Еду на 5. Все в Убежище и все монстры уничтожены — победа.' },
  { id: 'm5', num: 5, name: 'Обезвредить бомбу', difficulty: 'нормально', image: 180205, set: 'M', fuel: 3, boss: { kind: 'aside' },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 3], ['Туннель', 2], ['Пустыня', 2], ['Городская улица', 2], ['Ферма', 2], ['Поле', 2],
      ['Торговый центр', 1], ['Магазин продуктов', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 2], ['Электростанция', 1]],
    finds: {
      red: { food: 3, fuel: 4, meds: 2, antidote: 3, ammo: 1, pistol: 1, backpack: 1, empty: 2, parts: 1, ambush: 1 },
      green: { food: 9, fuel: 1, ammo: 2, binoculars: 1, empty: 2, parts: 1, ambush: 1, antidote: 2 },
      blue: { food: 3, fuel: 2, antidote: 1, ammo: 4, flashlight: 2, pistol: 1, binoculars: 1, radio: 1, parts: 2, ambush: 1 },
    },
    text: 'На маркере задачи (≥5 тайлов от фургона) возьмите Пыльную книгу и откройте Босса. С книгой потратьте 2 действия на Электростанции. Затем за 3 раунда все к Фургону с топливом.' },
  { id: 'm6', num: 6, name: 'Радиоактивные осадки', difficulty: 'нормально', image: 180206, set: 'M', fuel: 3, boss: { kind: 'bottom', under: 5 },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 3], ['Туннель', 2], ['Пустыня', 2], ['Поле', 2], ['Городская улица', 2], ['Ферма', 2],
      ['Оазис', 1], ['Тюрьма', 1], ['Торговый центр', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 2], ['Электростанция', 1], ['Аэропорт', 1]],
    finds: {
      red: { food: 3, fuel: 4, meds: 2, antidote: 3, ammo: 1, pistol: 1, backpack: 1, empty: 2, parts: 1, ambush: 1 },
      green: { food: 9, fuel: 1, ammo: 2, binoculars: 1, empty: 1, parts: 1, ambush: 1, antidote: 2 },
      blue: { food: 3, fuel: 2, ammo: 4, binoculars: 1, pistol: 1, flashlight: 2, radio: 1, parts: 2, ambush: 1, antidote: 1 },
    },
    text: 'Фургон в центре. Почините фургон 3 Запчастями (по действию у фургона) и заправьте его. Выпало 7 — открывается внешний тайл, а если все открыты — один внешний тайл исчезает.' },
  { id: 'm7', num: 7, name: 'Замечено движение пришельцев', difficulty: 'трудно', image: 180207, set: 'A', fuel: 4, boss: { kind: 'aside' },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 2], ['Туннель', 2], ['Пустыня', 1], ['Аэропорт', 1], ['Городская улица', 2], ['Ферма', 2],
      ['Горы', 2], ['Река', 1], ['Магазин продуктов', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 1], ['Электростанция', 1],
      ['Парк аттракционов', 1], ['Место крушения', 1]],
    finds: {
      red: { food: 2, fuel: 4, meds: 2, ammo: 2, binoculars: 1, empty: 1, parts: 1, ambush: 1, book: 1 },
      green: { food: 6, fuel: 2, ammo: 2, flashlight: 1, backpack: 1, empty: 1, parts: 1, ambush: 1 },
      blue: { food: 2, fuel: 2, ammo: 4, pistol: 1, radio: 1, flashlight: 1, empty: 1, parts: 2, ambush: 1, book: 1 },
    },
    text: 'Исследуйте все тайлы и вернитесь к Фургону с топливом. Исследовавший тайл с маркером цели открывает Босса.' },
  { id: 'm8', num: 8, name: 'Восстановление данных', difficulty: 'трудно', image: 180208, set: 'A', fuel: 0, boss: { kind: 'aside' },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 2], ['Туннель', 2], ['Пустыня', 1], ['Магазин продуктов', 1], ['Горы', 2],
      ['Городская улица', 2], ['Ферма', 2], ['Река', 1], ['Оазис', 1], ['Тюрьма', 1], ['Парк аттракционов', 1], ['Полицейский участок', 1],
      ['Лагерь бандитов', 1], ['Место крушения', 1], ['Военная база', 1], ['Аэропорт', 1]],
    finds: {
      red: { food: 2, fuel: 4, meds: 2, ammo: 2, binoculars: 1, empty: 1, parts: 1, ambush: 1, book: 1 },
      green: { food: 6, fuel: 2, ammo: 2, backpack: 1, flashlight: 1, empty: 1, parts: 1, ambush: 1 },
      blue: { food: 2, fuel: 2, ammo: 4, pistol: 1, flashlight: 1, radio: 1, empty: 1, parts: 2, ambush: 1, book: 1 },
    },
    text: 'Доберитесь до маркера задачи (≥5 от Военной базы), пройдите там проверку скрытности: успех — заберите Учёного (действие), провал — с Книгой получите данные, без неё поражение. Вернитесь на Военную базу.' },
  { id: 'm9', num: 9, name: 'Люди наносят ответный удар', difficulty: 'очень трудно', image: 180209, set: 'A', fuel: 0,
    boss: { kind: 'shuffle', count: 2 },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 2], ['Туннель', 2], ['Пустыня', 1], ['Тюрьма', 1], ['Городская улица', 2], ['Ферма', 2],
      ['Река', 1], ['Горы', 2], ['Оазис', 1], ['Фабрика', 1], ['Военная база', 1], ['Магазин продуктов', 1], ['Полицейский участок', 1],
      ['Лагерь бандитов', 1], ['Место крушения', 1], ['Аэропорт', 1]],
    finds: {
      red: { food: 2, fuel: 4, meds: 2, ammo: 2, binoculars: 1, parts: 1, ambush: 1, book: 1, empty: 1 },
      green: { food: 6, fuel: 2, ammo: 2, flashlight: 1, backpack: 1, parts: 1, empty: 1, ambush: 1 },
      blue: { food: 2, fuel: 2, ammo: 4, pistol: 1, radio: 1, flashlight: 1, parts: 1, empty: 1, ambush: 1, book: 1 },
    },
    text: 'Уничтожьте 2 передатчика (действие на тайле с маркером), затем доставьте Учёного на Место крушения.' },
  { id: 'm10', num: 10, name: 'Конвой', difficulty: 'трудно', image: 180210, set: 'R', fuel: 6, boss: { kind: 'aside' },
    tiles: [['Госпиталь', 1], ['Убежище', 1], ['Бензоколонка', 2], ['Туннель', 2], ['Пустыня', 1], ['Тюрьма', 1], ['Городская улица', 2], ['Ферма', 2],
      ['Поле', 2], ['Горы', 2], ['Лес', 2], ['Фабрика', 1], ['Военная база', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 1],
      ['Магазин продуктов', 1], ['Аэропорт', 1]],
    finds: {
      red: { food: 2, fuel: 4, meds: 2, ammo: 2, binoculars: 1, parts: 1, ambush: 1, empty: 2 },
      green: { food: 6, fuel: 1, ammo: 2, flashlight: 1, backpack: 1, parts: 1, empty: 1, ambush: 1 },
      blue: { food: 2, fuel: 1, ammo: 4, pistol: 1, radio: 1, flashlight: 1, parts: 1, empty: 1, ambush: 1 },
    },
    text: 'Фургон и Военная база на разных краях. Игроки начинают с 4 топлива. Маркеры: №1 — 3 Запчасти и 2 Медикамента, №2 — Босс и 3 Одеяла, №3 — 2 Топлива и Медикаменты. Сдайте на базе 6 Топлива, 3 Одеяла, 2 Медикамента, 2 Запчасти.' },
  { id: 'm11', num: 11, name: 'Защитите базу', difficulty: 'трудно', image: 180211, set: 'R', fuel: 0, boss: { kind: 'bottomHalf' },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 2], ['Туннель', 2], ['Пустыня', 2], ['Тюрьма', 1], ['Городская улица', 2], ['Ферма', 2],
      ['Поле', 2], ['Горы', 2], ['Лес', 2], ['Фабрика', 1], ['Военная база', 1], ['Полицейский участок', 1], ['Лагерь бандитов', 2],
      ['Парк аттракционов', 1], ['Магазин продуктов', 1], ['Аэропорт', 1]],
    finds: {
      red: { food: 2, fuel: 4, meds: 2, ammo: 2, binoculars: 1, parts: 1, ambush: 1, empty: 2 },
      green: { food: 6, fuel: 2, ammo: 2, flashlight: 1, backpack: 1, parts: 1, empty: 1, ambush: 1 },
      blue: { food: 2, fuel: 2, ammo: 4, pistol: 1, radio: 1, flashlight: 1, parts: 1, empty: 1, ambush: 1 },
    },
    text: 'Старт на Военной базе без монстров. Зачистите 3 цели (по 3 жетона монстров на каждой), вернитесь на базу и убейте всех монстров перед игроками.' },
  { id: 'm12', num: 12, name: 'Горите, роботы, горите', difficulty: 'очень трудно', image: 180212, set: 'R', fuel: 3,
    boss: { kind: 'shuffle', count: 1, bottomExtra: true },
    tiles: [['Госпиталь', 1], ['Убежище', 2], ['Бензоколонка', 2], ['Туннель', 2], ['Пустыня', 2], ['Тюрьма', 1], ['Городская улица', 2], ['Ферма', 2],
      ['Лес', 2], ['Горы', 2], ['Поле', 2], ['Фабрика', 1], ['Военная база', 1], ['Магазин продуктов', 1], ['Полицейский участок', 1],
      ['Лагерь бандитов', 2], ['Парк аттракционов', 1], ['Аэропорт', 1]],
    finds: {
      red: { food: 2, fuel: 4, meds: 2, ammo: 2, binoculars: 1, parts: 1, ambush: 1, empty: 2 },
      green: { food: 6, fuel: 2, ammo: 2, flashlight: 1, backpack: 1, parts: 1, empty: 1, ambush: 1 },
      blue: { food: 2, fuel: 2, ammo: 4, pistol: 1, radio: 1, flashlight: 1, parts: 1, empty: 1, ambush: 1 },
    },
    text: 'Уничтожьте 3 отмеченных тайла (действие на тайле, тайл исчезает со всем, что на нём) и вернитесь к Фургону с топливом.' },
]

export const missionById = (id: string) => {
  const m = MISSIONS.find((x) => x.id === id)
  if (!m) throw new Error(`Нет миссии ${id}`)
  return m
}
