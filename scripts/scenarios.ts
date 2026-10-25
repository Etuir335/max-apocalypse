// Точечные проверки правил на подготовленных ситуациях. Запуск: node scripts/scenarios.ts
import { reduce } from '../src/game/engine.ts'
import { findTile, makeId, neighbors } from '../src/game/core.ts'
import type { GameState } from '../src/game/types.ts'

let failed = 0
const ok = (cond: unknown, name: string) => {
  console.log(`${cond ? 'OK ' : 'FAIL'} ${name}`)
  if (!cond) failed++
}

function game(missionId: string, heroes = ['firefighter', 'surgeon']): GameState {
  let s = reduce(null, { type: 'create', seed: 7, missionId, players: heroes.map((h, i) => ({ uid: `u${i}`, name: `P${i}`, hero: h })) })
  s = reduce(s, { type: 'begin', seat: 0, first: 0 })
  // разобрать стартовые выборы, если есть
  while (s.pendings.length) s = reduce(s, { type: 'choose', seat: s.pendings[0].seat, option: 1, cards: s.players[s.pendings[0].seat].hand.slice(0, s.pendings[0].pick ?? 0) })
  return s
}
const clear = (s: GameState) => {
  for (const p of s.players) p.monsters = []
  s.pendings = []
  return s
}

// 1. Миссия 0: сдать топливо у фургона и победить в конце хода
{
  let s = clear(game('m0'))
  const van = findTile(s, 'van')!
  for (const p of s.players) p.pos = { x: van.x, y: van.y }
  const p = s.players[0]
  for (let i = 0; i < 4; i++) p.equip.push({ id: makeId(s, 'fuel', 192106), ammo: 0, dmgMod: 0, notch: false, attached: [] })
  p.equip = p.equip.slice(-4)
  for (const e of [...p.equip]) s = reduce(s, { type: 'deliver', seat: 0, card: e.id })
  ok(s.mission.fuel === 4, 'm0: сдано 4 топлива')
  s.turn.actions = 0
  s = reduce(s, { type: 'endTurn', seat: 0 })
  ok(s.phase === 'won', `m0: победа (${s.phase} ${s.result})`)
}

// 2. Голод: истощение на 6, урон по шкале, смерть на ☠
{
  let s = clear(game('m0'))
  const p = s.players[0]
  p.hunger = 5
  s.turn.actions = 0
  s = reduce(s, { type: 'endTurn', seat: 0 })
  const q = s.players[0]
  ok(q.exhausted && q.figures[0].hp === 32 - 2, `голод 6: истощение и 2 урона (hp ${q.figures[0].hp})`)
}

// 3. Вход на тайл с жетонами без монстров → выбор «прокрасться/привлечь»; привлечь = карты монстров
{
  let s = clear(game('m0'))
  const p = s.players[0]
  const n = neighbors(s, p.pos)[0]
  n.revealed = true
  n.key = 'grocery'
  n.markers = 2
  s = reduce(s, { type: 'move', seat: 0, to: { x: n.x, y: n.y } })
  const pd = s.pendings.find((x) => x.kind === 'sneak')
  ok(pd, 'жетоны: предложен выбор')
  while (s.pendings.length && s.pendings[0].kind !== 'sneak')
    s = reduce(s, { type: 'choose', seat: s.pendings[0].seat, option: 1, cards: s.players[0].hand.slice(0, 1) })
  s = reduce(s, { type: 'choose', seat: 0, option: 1 })
  ok(s.players[0].monsters.length >= 2, `привлечь: взято монстров ${s.players[0].monsters.length}`)
}

// 4. Миссия 1: первый вошедший в участок получает босса
{
  let s = clear(game('m1'))
  const police = findTile(s, 'police')!
  const p = s.players[0]
  const near = neighbors(s, police).find(Boolean)!
  p.pos = { x: near.x, y: near.y }
  near.revealed = true
  police.markers = 0
  s = reduce(s, { type: 'move', seat: 0, to: { x: police.x, y: police.y } })
  ok(s.players[0].monsters.some((m) => m.id.startsWith('z_horde') || m.id.startsWith('z_queen')), 'm1: босс вышел в участке')
}

// 5. Миссия 12: уничтожение отмеченного тайла с отходом
{
  let s = clear(game('m12'))
  const t = s.tiles.find((x) => x.objective)!
  const p = s.players[0]
  p.pos = { x: t.x, y: t.y }
  const away = neighbors(s, t)[0]
  away.markers = 0
  const before = s.tiles.length
  s = reduce(s, { type: 'mission', seat: 0, kind: 'destroyTile', to: { x: away.x, y: away.y } })
  ok(s.tiles.length === before - 1 && s.mission.cleared.length === 1, 'm12: тайл уничтожен')
}

// 6. Стрелок начинает с Кольтом и теряет его при истощении
{
  let s = clear(game('m0', ['gunslinger']))
  ok(s.players[0].equip.some((e) => e.id.startsWith('gs_colt')), 'Стрелок: Кольт в игре')
  s.players[0].hunger = 5
  s.turn.actions = 0
  s = reduce(s, { type: 'endTurn', seat: 0 })
  ok(!s.players[0].equip.some((e) => e.id.startsWith('gs_colt')), 'Стрелок: Кольт ушёл в колоду при истощении')
}

// 7. «Где мой топор?» достаёт топор (даже из сброса) и вводит в игру, потом спрашивает колоду находок
{
  let s = clear(game('m0', ['firefighter']))
  const p = s.players[0]
  const all = [...p.deck, ...p.hand]
  const axes = all.filter((id) => id.startsWith('ff_axe'))
  const where = all.find((id) => id.startsWith('ff_where_axe'))!
  p.deck = p.deck.filter((id) => !axes.includes(id) && id !== where)
  p.hand = [where]
  p.discard = [axes[0]]
  p.equip = []
  const deckBefore = p.deck.length
  s = reduce(s, { type: 'play', seat: 0, card: where })
  ok(s.players[0].equip.some((e) => e.id.startsWith('ff_axe')), 'Где мой топор?: топор в игре')
  ok(s.players[0].hand.length === 1 && s.players[0].deck.length === deckBefore - 1 && !s.pendings.length,
    'Где мой топор?: затем карта из своей колоды (не из находок)')
}

// 8. Топливо при полных ячейках: можно оставить на тайле и подобрать позже
{
  let s = clear(game('m0', ['firefighter']))
  const p = s.players[0]
  const gear = [...p.deck, ...p.hand].filter((id) => /^ff_(helmet|ladder|jacket)/.test(id))
  p.equip = gear.slice(0, 4).map((id) => ({ id, ammo: 0, dmgMod: 0, notch: false, attached: [] }))
  p.deck = p.deck.filter((id) => !gear.includes(id))
  p.hand = p.hand.filter((id) => !gear.includes(id))
  const fuel = makeId(s, 'fuel', 192106)
  s.finds.red.unshift(fuel)
  s.tiles.find((t) => t.x === p.pos.x && t.y === p.pos.y)!.key = 'gas1'
  s = reduce(s, { type: 'search', seat: 0, color: 'red' })
  const pd = s.pendings[0]
  const dropIdx = pd?.options?.findIndex((o) => o.startsWith('Оставить')) ?? -1
  ok(pd?.kind === 'fuel' && dropIdx >= 0 && !pd.options!.some((o) => o.startsWith('Экипировать')), 'топливо: нет ячеек — предложено оставить/заменить')
  s = reduce(s, { type: 'choose', seat: 0, option: dropIdx })
  ok(s.dropped.some((d) => d.cards.includes(fuel)), 'топливо лежит на тайле')
  s = reduce(s, { type: 'pickUp', seat: 0, cards: [fuel] })
  ok(s.pendings[0]?.kind === 'fuel', 'подобрал — снова выбор, куда деть топливо')
}

// 9. Ветеран погиб — играет Пёс: снаряжение выпало (кроме ошейника), способность недоступна, урон идёт Псу
{
  let s = clear(game('m0', ['veteran']))
  const p = s.players[0]
  const all = [...p.deck, ...p.hand]
  const garand = all.find((id) => id.startsWith('vet_garand'))!
  const collar = all.find((id) => id.startsWith('vet_collar'))!
  const pistol = makeId(s, 'pistol', 192350)
  p.deck = p.deck.filter((id) => id !== garand && id !== collar)
  p.hand = p.hand.filter((id) => id !== garand && id !== collar)
  p.equip = [garand, collar, pistol].map((id) => ({ id, ammo: 3, dmgMod: 0, notch: false, attached: [] }))
  p.figures[0].hp = 1
  s.pendings = []
  // монстр с атакой: прямой урон через конец хода
  p.monsters = [{ id: makeId(s, 'z_soldier', 193345), wounds: 0, stunnedBy: null }]
  s.turn.actions = 0
  s = reduce(s, { type: 'endTurn', seat: 0 })
  const q = s.players[0]
  ok(q.alive && !q.figures[0].alive && q.figures[1].alive, 'Ветеран погиб, Пёс жив')
  ok(q.equip.length === 1 && q.equip[0].id === collar, 'у Пса остался только Ошейник')
  ok(s.dropped.some((d) => d.cards.includes(pistol)) && q.discard.includes(garand), 'пистолет на тайле, Гаранд в сбросе')
}

// 10. Состояние не мутируется
{
  const s = clear(game('m0'))
  const copy = JSON.stringify(s)
  reduce(s, { type: 'draw', seat: 0 })
  ok(JSON.stringify(s) === copy, 'reduce не меняет входное состояние')
}

console.log(failed ? `Провалено: ${failed}` : 'Все проверки пройдены')
