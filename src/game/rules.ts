// Основные правила: урон, голод, монстры, жетоны, находки, вход на тайл, ход игрока.
import {
  MAX_MARKERS,
  MAX_MARKERS_PER_TILE,
  cardDef,
  charDef,
  check,
  hasPassive,
  inRange,
  keyOf,
  living,
  log,
  mainFigure,
  markersOnBoard,
  monsterDef,
  monsterOwner,
  neighbors,
  playersAt,
  roll2d6,
  same,
  shuffle,
  slotsTotal,
  slotsUsed,
  stealthOf,
  tileAt,
  tileDef,
} from './core.ts'
import { runEffects } from './effects.ts'
import * as M from './missionRules.ts'
import type { Color, GameState, MEff, MonsterInst, PlayerState, TEff, TileInst, XY } from './types.ts'

export const HAND_LIMIT = 10
const STARVE_SCALE = [2, 4, 6, 8]

export const over = (s: GameState) => s.phase === 'won' || s.phase === 'lost'

export function lose(s: GameState, reason: string) {
  if (over(s)) return
  s.phase = 'lost'
  s.result = reason
  s.pendings = []
  log(s, `ПОРАЖЕНИЕ: ${reason}`)
}
export function win(s: GameState, reason: string) {
  if (over(s)) return
  s.phase = 'won'
  s.result = reason
  s.pendings = []
  log(s, `ПОБЕДА: ${reason}`)
}

// ---------- Карты в руке, колоде, сбросе ----------

export function discardCard(s: GameState, holder: PlayerState | null, id: string) {
  if (cardDef(id).group === 'survivor' && holder) holder.discard.push(id)
  else s.findDiscard.push(id)
}

export function removeFromHand(p: PlayerState, id: string) {
  const i = p.hand.indexOf(id)
  check(i >= 0, 'Этой карты нет в руке')
  p.hand.splice(i, 1)
}

export function checkHand(s: GameState, p: PlayerState) {
  const extra = p.hand.length - HAND_LIMIT
  if (extra > 0 && !s.pendings.some((x) => x.seat === p.seat && x.kind === 'discard'))
    s.pendings.push({ seat: p.seat, kind: 'discard', prompt: `В руке больше ${HAND_LIMIT} карт: сбросьте лишние`, cards: [...p.hand], pick: extra,
      data: { limit: true } })
}

export function drawSurvivor(s: GameState, p: PlayerState, n: number) {
  for (let i = 0; i < n && p.alive; i++) {
    const id = p.deck.shift()
    if (!id) return killPlayer(s, p, 'в колоде кончились карты')
    p.hand.push(id)
  }
  checkHand(s, p)
}

export function burn(s: GameState, p: PlayerState, n: number) {
  for (let i = 0; i < n; i++) {
    const id = p.deck.shift()
    if (!id) return
    p.discard.push(id)
    log(s, `${p.name}: сгорает карта «${cardDef(id).name}»`)
  }
}

// ---------- Снаряжение ----------

export function equip(s: GameState, p: PlayerState, id: string, runOnEquip = true) {
  const d = cardDef(id)
  check(d.gear, `«${d.name}» — не снаряжение`)
  check(slotsUsed(p) + d.gear!.slots <= slotsTotal(p), 'Не хватает ячеек снаряжения')
  check(d.find === 'fuel' || !p.equip.some((e) => cardDef(e.id).name === d.name), 'Нельзя экипировать две одинаковые карты')
  p.equip.push({ id, ammo: d.gear!.ammo ?? d.gear!.fuel ?? 0, dmgMod: 0, notch: false, attached: [] })
  log(s, `${p.name} экипирует «${d.name}»`)
  if (runOnEquip && d.gear!.onEquip) runEffects(s, p, d.gear!.onEquip, { source: id, params: {} })
}

export function unequip(s: GameState, p: PlayerState, equipId: string, toDiscard = true) {
  const i = p.equip.findIndex((e) => e.id === equipId)
  check(i >= 0, 'Нет такого снаряжения')
  const [e] = p.equip.splice(i, 1)
  for (const a of e.attached) discardCard(s, p, a)
  if (toDiscard) discardCard(s, p, e.id)
  return e
}

// ---------- Голод ----------

export function addHunger(s: GameState, p: PlayerState, n: number) {
  for (let i = 0; i < n && p.alive; i++) {
    if (!p.exhausted) {
      p.hunger++
      if (p.hunger >= 6) {
        p.hunger = 6
        p.exhausted = true
        p.starve = 0
        log(s, `${p.name} истощён`)
        onExhausted(s, p)
        starveDamage(s, p)
      }
    } else {
      p.starve++
      if (p.starve >= STARVE_SCALE.length) return killPlayer(s, p, 'голод')
      starveDamage(s, p)
    }
  }
}

function starveDamage(s: GameState, p: PlayerState) {
  if (p.noStarve) return
  const dmg = STARVE_SCALE[p.starve]
  p.figures.forEach((f, i) => f.alive && damagePlayer(s, p, dmg, 'starve', i))
}

function onExhausted(s: GameState, p: PlayerState) {
  if (charDef(p).ability.passive !== 'colt') return
  const colt = p.equip.find((e) => keyOf(e.id) === 'gs_colt')
  if (!colt) return
  unequip(s, p, colt.id, false)
  p.deck.push(colt.id)
  shuffle(s, p.deck)
  log(s, `${p.name} возвращает Кольт в колоду`)
}

export function reduceHunger(_s: GameState, p: PlayerState, n: number) {
  if (n <= 0 || !p.alive) return
  if (p.exhausted) {
    p.exhausted = false
    p.starve = 0
    p.hunger = Math.max(1, 6 - n)
  } else p.hunger = Math.max(1, p.hunger - n)
}

export function addPoison(s: GameState, p: PlayerState) {
  if (hasPassive(p, 'statusImmune').length) return
  p.poison++
  log(s, `${p.name} отравлен (${p.poison})`)
}

// ---------- Урон игрокам ----------

export type DamageKind = 'monster' | 'effect' | 'poison' | 'starve'

export function damagePlayer(s: GameState, p: PlayerState, amount: number, kind: DamageKind, fig?: number): number {
  if (!p.alive || amount <= 0 || over(s)) return 0
  let idx = fig ?? p.figures.indexOf(mainFigure(p)!)
  if (!p.figures[idx]?.alive) idx = p.figures.findIndex((f) => f.alive)
  const f = p.figures[idx]
  if (!f) return 0
  if (s.mission.flags.shelterImmune === p.seat) return 0
  if (f.immune) return 0
  let dealt = amount
  if (kind === 'monster' || kind === 'effect') {
    let reduce = 0
    for (const e of p.equip) {
      const ps = cardDef(e.id).gear?.passive
      if (!ps) continue
      reduce += ps.reduceDamage ?? 0
      reduce += (f.companion ? ps.reduceCompanionDamage : ps.reduceMainDamage) ?? 0
    }
    dealt = Math.max(0, amount - reduce)
  }
  if (dealt <= 0) return 0
  f.hp -= dealt
  log(s, `${f.name} (${p.name}) получает ${dealt} урона`)
  if (f.hp <= 0) {
    f.hp = 0
    f.alive = false
    log(s, `${f.name} погибает`)
    if (!p.figures.some((x) => x.alive)) killPlayer(s, p, 'нет здоровья')
    else if (!f.companion) mainFigureDied(s, p)
  }
  if (p.alive && (kind === 'monster' || kind === 'effect')) turret(s, p)
  return dealt
}

function turret(s: GameState, p: PlayerState) {
  for (const e of p.equip) {
    const t = cardDef(e.id).gear?.passive?.turret
    if (!t || e.ammo <= 0 || !p.monsters.length) continue
    e.ammo--
    log(s, `Турель ${p.name} отвечает`)
    damageMonster(s, p, p.monsters[0].id, t, 0)
  }
}

/** Погиб Ветеран, остался Пёс: у собаки нет рук — снаряжение падает (находки — на тайл, свои карты — в сброс). */
function mainFigureDied(s: GameState, p: PlayerState) {
  const keep = (id: string) => (cardDef(id).gear?.passive?.reduceCompanionDamage ?? 0) > 0 // Ошейник остаётся на собаке
  for (const e of [...p.equip]) {
    if (keep(e.id)) continue
    unequip(s, p, e.id, false)
    if (cardDef(e.id).group !== 'find') {
      p.discard.push(e.id)
      continue
    }
    const pile = s.dropped.find((d) => d.x === p.pos.x && d.y === p.pos.y)
    if (pile) pile.cards.push(e.id)
    else s.dropped.push({ x: p.pos.x, y: p.pos.y, cards: [e.id] })
  }
  const dog = p.figures.find((x) => x.alive)
  log(s, `${p.name}: дальше играет ${dog?.name ?? 'спутник'} — снаряжение Ветерана выпало`)
}

export function healFigure(s: GameState, healer: PlayerState | null, p: PlayerState, fig: number, amount: number) {
  const f = p.figures[fig]
  if (!f?.alive) return
  const bonus = healer ? healer.equip.reduce((n, e) => n + (cardDef(e.id).gear?.passive?.healBonus ?? 0), 0) : 0
  const before = f.hp
  f.hp = Math.min(f.maxHp, f.hp + amount + bonus)
  if (f.hp > before) log(s, `${f.name} восстанавливает ${f.hp - before} здоровья`)
}

export function killPlayer(s: GameState, p: PlayerState, reason: string) {
  if (!p.alive) return
  p.alive = false
  p.figures.forEach((f) => {
    f.alive = false
    f.hp = 0
  })
  log(s, `${p.name} погибает: ${reason}`)
  const n = p.monsters.length
  s.monsterDiscard.push(...p.monsters.map((m) => m.id))
  p.monsters = []
  const drop = [...p.hand, ...p.equip.flatMap((e) => [e.id, ...e.attached])].filter((id) => cardDef(id).group === 'find')
  if (drop.length) s.dropped.push({ x: p.pos.x, y: p.pos.y, cards: drop })
  p.hand = []
  p.equip = []
  s.pendings = s.pendings.filter((x) => x.seat !== p.seat)
  if (s.turn.lent?.seat === p.seat) s.turn.lent = null
  const t = tileAt(s, p.pos)
  for (let i = 0; i < n && t; i++) placeMarker(s, t)
  if (s.options.hardcore) return lose(s, `погиб ${p.name}`)
  if (!living(s).length) return lose(s, 'все выжившие погибли')
}

// ---------- Жетоны и монстры ----------

export function placeMarker(s: GameState, t: TileInst) {
  if (over(s)) return
  const here = playersAt(s, t)
  if (here.length) {
    for (const p of here) takeMonster(s, p)
    return
  }
  if (t.markers >= MAX_MARKERS_PER_TILE) return
  if (markersOnBoard(s) >= MAX_MARKERS) return lose(s, 'закончились жетоны монстров')
  t.markers++
}

function drawMonsterCard(s: GameState): string | null {
  if (!s.monsterDeck.length && s.monsterDiscard.length) {
    s.monsterDeck = shuffle(s, s.monsterDiscard)
    s.monsterDiscard = []
    log(s, 'Колода монстров перемешана заново')
  }
  return s.monsterDeck.shift() ?? null
}

export function takeMonster(s: GameState, p: PlayerState, opts: { card?: string; skipLadder?: boolean } = {}) {
  if (!p.alive || over(s)) return
  if (!opts.card && !opts.skipLadder && hasPassive(p, 'ladder').length) {
    s.pendings.push({ seat: p.seat, kind: 'ladder', prompt: 'Вы должны взять карту монстра. Сбросить Лестницу и не брать?',
      options: ['Сбросить Лестницу', 'Взять монстра'] })
    return
  }
  const id = opts.card ?? drawMonsterCard(s)
  if (!id) return log(s, 'Монстры закончились')
  const d = monsterDef(id)
  p.monsters.push({ id, wounds: 0, stunnedBy: null })
  log(s, `${p.name} берёт монстра: ${d.name}${d.boss ? ' (БОСС)' : ''}`)
  for (const e of d.entry ?? []) {
    if (!p.alive || !p.monsters.some((m) => m.id === id)) break
    monsterEffect(s, p, e)
  }
  for (const q of living(s)) {
    const mine = q.equip.find((e) => cardDef(e.id).gear?.passive?.mine)
    if (!mine || !p.monsters.some((m) => m.id === id)) continue
    const dmg = cardDef(mine.id).gear!.passive!.mine!
    unequip(s, q, mine.id)
    log(s, `Мина ${q.name} взрывается`)
    damageMonster(s, q, id, dmg, 0)
    break
  }
}

export function monsterEffect(s: GameState, p: PlayerState, e: MEff) {
  switch (e.k) {
    case 'drawMonster':
      return takeMonster(s, p)
    case 'markersAdjacent':
      return neighbors(s, p.pos).forEach((t) => placeMarker(s, t))
    case 'gearOrDamage':
      return gearOrDamage(s, p, e.amount)
    case 'findOrDamage': {
      const finds = p.hand.filter((id) => cardDef(id).group === 'find')
      if (!finds.length) return void damagePlayer(s, p, e.amount, 'effect')
      s.pendings.push({ seat: p.seat, kind: 'findOrDamage', prompt: `Сбросьте карту находки или получите ${e.amount} урона`,
        cards: finds, pick: 1, options: [`Получить ${e.amount} урона`], data: { amount: e.amount } })
      return
    }
    case 'poison':
      return addPoison(s, p)
    case 'burn':
      return burn(s, p, e.n)
    case 'allDiscardGear':
      for (const q of living(s))
        if (q.equip.length)
          s.pendings.push({ seat: q.seat, kind: 'loseGear', prompt: 'Сбросьте одну карту снаряжения',
            options: q.equip.map((x) => cardDef(x.id).name) })
      return
    case 'healAliens':
      for (const q of s.players) for (const m of q.monsters) if (monsterDef(m.id).set === 'A') m.wounds = 0
      return log(s, 'Все пришельцы полностью вылечены')
    case 'discardHand':
      p.hand.forEach((id) => discardCard(s, p, id))
      p.hand = []
      return log(s, `${p.name} сбрасывает руку`)
    case 'discardAllAmmo':
      p.equip.forEach((x) => cardDef(x.id).gear?.ammo !== undefined && (x.ammo = 0))
      return log(s, `${p.name} теряет все боеприпасы`)
    case 'destroyAllAmmo':
      s.players.forEach((q) => q.equip.forEach((x) => cardDef(x.id).gear?.ammo !== undefined && (x.ammo = 0)))
      return log(s, 'Все боеприпасы в игре уничтожены')
  }
}

export function gearOrDamage(s: GameState, p: PlayerState, amount: number) {
  if (!p.equip.length) return void damagePlayer(s, p, amount, 'effect')
  s.pendings.push({ seat: p.seat, kind: 'gearOrDamage', prompt: `Сбросьте снаряжение или получите ${amount} урона`,
    options: [...p.equip.map((x) => `Сбросить «${cardDef(x.id).name}»`), `Получить ${amount} урона`], data: { amount } })
}

const anyInPlay = (s: GameState, passive: string) =>
  s.players.reduce((n, q) => n + q.monsters.filter((m) => monsterDef(m.id).passive === passive).length, 0)

/** Урон монстру. bonus — бонусы игрока и оружия (уже посчитаны вызывающим). */
export function damageMonster(s: GameState, attacker: PlayerState | null, id: string, amount: number, bonus: number) {
  const own = monsterOwner(s, id)
  if (!own || over(s)) return
  const d = monsterDef(id)
  let dmg = amount + bonus
  if (d.set === 'R' && anyInPlay(s, 'phalanx')) dmg -= 1
  if (dmg <= 0) return
  const inst = own.p.monsters[own.idx]
  inst.wounds += dmg
  log(s, `${d.name} получает ${dmg} урона (${Math.max(0, d.hp - inst.wounds)}/${d.hp})`)
  if (inst.wounds >= d.hp) killMonster(s, attacker, own.p, inst)
}

export function killMonster(s: GameState, killer: PlayerState | null, holder: PlayerState, inst: MonsterInst) {
  holder.monsters = holder.monsters.filter((m) => m.id !== inst.id)
  const d = monsterDef(inst.id)
  log(s, `${d.name} уничтожен`)
  if (!M.onMonsterKilled(s, d, inst.id)) s.monsterDiscard.push(inst.id)
  if (d.onDeath) damagePlayer(s, holder, d.onDeath, 'effect')
  if (killer?.alive && d.set === 'Z' && anyInPlay(s, 'queen')) {
    log(s, 'Королева зомби: убивший тянет монстра')
    takeMonster(s, killer)
  }
  if (killer?.alive && s.turn.bodySearch && killer.seat === s.turn.seat) askFindColor(s, killer, 'Обыск тел: из какой колоды взять находку?')
}

export function stealthCheck(s: GameState, p: PlayerState, penalty: number) {
  const roll = roll2d6(s)
  const need = stealthOf(p) - penalty
  log(s, `${p.name}: проверка скрытности ${roll} против ${need} — ${roll <= need ? 'успех' : 'провал'}`)
  return roll <= need
}

export function attractMarkers(s: GameState, p: PlayerState, t: TileInst) {
  const n = t.markers
  t.markers = 0
  for (let i = 0; i < n; i++) takeMonster(s, p)
}

// ---------- Находки ----------

export function askFindColor(s: GameState, p: PlayerState, prompt: string, n = 1) {
  s.pendings.push({ seat: p.seat, kind: 'findColor', prompt, options: ['Красная', 'Зелёная', 'Синяя'], data: { n } })
}
export const COLORS: Color[] = ['red', 'green', 'blue']

export function gainFind(s: GameState, p: PlayerState, id: string) {
  const d = cardDef(id)
  log(s, `${p.name} находит «${d.name}»`)
  if (d.find === 'ambush') {
    s.findDiscard.push(id)
    return takeMonster(s, p)
  }
  if (d.find === 'empty') return void s.findDiscard.push(id)
  if (d.find === 'fuel') return askFuel(s, p, id)
  p.hand.push(id)
  checkHand(s, p)
}

/** Найдено топливо: экипировать, заменить снаряжение, оставить на тайле или сбросить. */
export function askFuel(s: GameState, p: PlayerState, id: string) {
  const codes: string[] = []
  const options: string[] = []
  const add = (code: string, label: string) => {
    codes.push(code)
    options.push(label)
  }
  if (slotsUsed(p) + 1 <= slotsTotal(p)) add('equip', 'Экипировать (бесплатно)')
  else
    for (const e of p.equip)
      if ((cardDef(e.id).gear?.slots ?? 0) > 0) add(`swap:${e.id}`, `Сбросить «${cardDef(e.id).name}» и экипировать топливо`)
  add('drop', 'Оставить на тайле (подобрать позже свободным действием)')
  add('discard', 'Сбросить')
  s.pendings.push({ seat: p.seat, kind: 'fuel',
    prompt: slotsUsed(p) + 1 <= slotsTotal(p) ? 'Найдено топливо' : 'Найдено топливо, но свободных ячеек нет',
    options, data: { card: id, codes } })
}

/** Положить находку на тайл игрока (её можно подобрать действием «Подобрать») */
export function dropOnTile(s: GameState, p: PlayerState, id: string) {
  const pile = s.dropped.find((d) => d.x === p.pos.x && d.y === p.pos.y)
  if (pile) pile.cards.push(id)
  else s.dropped.push({ x: p.pos.x, y: p.pos.y, cards: [id] })
  log(s, `${p.name} оставляет «${cardDef(id).name}» на тайле`)
}

export function search(s: GameState, p: PlayerState, color: Color) {
  const deck = s.finds[color]
  if (!deck.length) return log(s, 'Колода находок этого цвета пуста')
  if (hasPassive(p, 'flashlight').length && deck.length >= 2) {
    const cards = deck.splice(0, 2)
    s.pendings.push({ seat: p.seat, kind: 'keepFinds', prompt: 'Фонарь: оставьте одну карту, другая уйдёт в низ колоды',
      cards, pick: 1, data: { rest: 'bottom', color } })
    return
  }
  gainFind(s, p, deck.shift()!)
}

// ---------- Тайлы ----------

export function revealTile(s: GameState, t: TileInst, by: PlayerState | null, withEffects: boolean) {
  if (t.revealed) return
  t.revealed = true
  log(s, `Открыт тайл «${tileDef(t).name}»`)
  if (withEffects && by) for (const e of tileDef(t).reveal ?? []) tileEffect(s, by, t, e)
  M.onReveal(s, t, by)
}

export function tileEffect(s: GameState, p: PlayerState, t: TileInst, e: TEff) {
  if (!p.alive || over(s)) return
  const current = s.turn.seat === p.seat
  switch (e.k) {
    case 'endTurn':
      if (current) {
        s.turn.actions = 0
        s.turn.freeMoves = 0
        log(s, `${p.name}: ход заканчивается`)
      }
      return
    case 'loseAction':
      if (current) s.turn.actions = Math.max(0, s.turn.actions - 1)
      return
    case 'discardCards': {
      const n = Math.min(e.n, p.hand.length)
      if (n > 0) s.pendings.push({ seat: p.seat, kind: 'discard', prompt: `Сбросьте ${n} карт(ы)`, cards: [...p.hand], pick: n })
      return
    }
    case 'markersAdjacent':
      return neighbors(s, t).forEach((x) => placeMarker(s, x))
    case 'hunger':
      return e.n > 0 ? addHunger(s, p, e.n) : reduceHunger(s, p, -e.n)
    case 'draw':
      return drawSurvivor(s, p, e.n)
    case 'allLoseGear':
      for (const q of living(s)) [...q.equip].forEach((x) => unequip(s, q, x.id))
      return log(s, 'Все игроки теряют снаряжение')
    case 'burn':
      return burn(s, p, e.n)
    case 'discardFood': {
      const food = p.hand.filter((id) => cardDef(id).find === 'food')
      food.forEach((id) => {
        removeFromHand(p, id)
        s.findDiscard.push(id)
      })
      if (food.length) log(s, `${p.name} сбрасывает всю еду`)
      return
    }
    case 'poison':
      return addPoison(s, p)
    case 'allDrawMonster':
      return living(s).forEach((q) => takeMonster(s, q))
    case 'drawMonster':
      return takeMonster(s, p)
    case 'freeSearch': {
      const c = tileDef(t).colors[0]
      if (c) search(s, p, c)
      return
    }
    case 'heal':
      return p.figures.forEach((_, i) => healFigure(s, null, p, i, e.n))
    case 'gearOrDamage':
      return gearOrDamage(s, p, e.n)
    case 'damageFrontMonsters':
      return [...p.monsters].forEach((m) => damageMonster(s, p, m.id, e.n, 0))
  }
}

/** Переход игрока на тайл (ход, телепорт). noEffects — без эффектов тайла и жетонов. */
export function enterTile(s: GameState, p: PlayerState, to: XY, noEffects = false) {
  const t = tileAt(s, to)
  check(t, 'Там нет тайла')
  const prev = { ...p.pos }
  p.pos = { x: to.x, y: to.y }
  if (s.turn.seat === p.seat) {
    s.turn.moved = true
    s.turn.prevPos = prev
  }
  if (noEffects) {
    if (!t!.revealed) revealTile(s, t!, p, false)
    return
  }
  revealTile(s, t!, p, true)
  const d = tileDef(t!)
  if (d.special === 'river' && !hasPassive(p, 'ladder').length && !stealthCheck(s, p, 0)) {
    p.pos = prev
    log(s, `${p.name} не смог пересечь реку`)
    return
  }
  for (const e of d.enter ?? []) tileEffect(s, p, t!, e)
  if (!p.alive || over(s)) return
  if (d.special === 'forest')
    s.pendings.push({ seat: p.seat, kind: 'forest', prompt: 'Лес: закончить перемещение в этом ходу или взять монстра?',
      options: ['Закончить перемещение', 'Взять монстра'] })
  M.onEnter(s, p, t!)
  if (t!.markers > 0 && p.alive) {
    const noSneak = hasPassive(p, 'scientist').length > 0 || p.monsters.some((m) => monsterDef(m.id).passive === 'noSneak')
    if (noSneak) attractMarkers(s, p, t!)
    else if (!p.monsters.length)
      s.pendings.push({ seat: p.seat, kind: 'sneak', prompt: `На тайле жетонов: ${t!.markers}. Прокрасться или привлечь монстров?`,
        options: ['Проверка скрытности', 'Привлечь монстров'], data: { x: t!.x, y: t!.y } })
  }
}

// ---------- Ход ----------

export function playerBonus(s: GameState, p: PlayerState) {
  const gear = p.equip.reduce((n, e) => n + (cardDef(e.id).gear?.passive?.damageBonus ?? 0), 0)
  const buffs = s.buffs.filter((b) => b.who === 'all' || b.who === p.seat).reduce((n, b) => n + b.amount, 0)
  return gear + buffs
}

export function freshTurn(seat: number): GameState['turn'] {
  return { seat, stage: 'actions', actions: 4, moved: false, freeMoves: 0, noMove: false, searched: [], freeDiscardUsed: false,
    tradeUsed: false, jacketUsed: false, bodySearch: false, lent: null, endStep: 0, prevPos: null }
}

export function startTurn(s: GameState, seat: number) {
  const p = s.players[seat]
  s.buffs = s.buffs.filter((b) => b.clearAt !== seat)
  for (const q of s.players) for (const m of q.monsters) if (m.stunnedBy === seat) m.stunnedBy = null
  p.figures.forEach((f) => (f.immune = false))
  p.noStarve = false
  s.turn = freshTurn(seat)
  s.mission.flags.shelterImmune = -1
  p.startPos = { ...p.pos }
  log(s, `— Ход: ${p.name} —`)
  const roll = roll2d6(s)
  log(s, `Появление монстров: выпало ${roll}`)
  M.onSpawnRoll(s, roll)
  for (const t of s.tiles) if (t.revealed && tileDef(t).spawn === roll) placeMarker(s, t)
  if (over(s) || !p.alive) return
  drawSurvivor(s, p, 1)
}

/** Следующий живой игрок по часовой. */
export function nextTurn(s: GameState) {
  if (over(s)) return
  const n = s.players.length
  for (let i = 1; i <= n; i++) {
    const seat = (s.turn.seat + i) % n
    if (seat <= s.turn.seat) {
      s.round++
      M.onRound(s)
      if (over(s)) return
    }
    if (s.players[seat].alive) {
      startTurn(s, seat)
      if (!s.players[seat].alive && !over(s)) return nextTurn(s)
      return
    }
  }
  lose(s, 'все выжившие погибли')
}

/** Фаза конца хода; останавливается, если нужен выбор игрока, и продолжается после него. */
export function runEndPhase(s: GameState) {
  const p = s.players[s.turn.seat]
  while (s.turn.stage === 'end' && !s.pendings.length && !over(s)) {
    if (!p.alive) return nextTurn(s)
    const step = s.turn.endStep++
    const t = tileAt(s, p.pos)!
    if (step === 0) {
      s.buffs = s.buffs.filter((b) => !b.endTurn)
      for (const e of tileDef(t).end ?? []) tileEffect(s, p, t, e)
      if (tileDef(t).special === 'shelter' && !same(p.startPos, p.pos)) {
        s.mission.flags.shelterImmune = p.seat
        log(s, `${p.name} в безопасности в Убежище`)
      }
    } else if (step === 1) addHunger(s, p, 1)
    else if (step === 2) monsterAttacks(s, p)
    else if (step === 3) {
      if (p.poison > 0) damagePlayer(s, p, p.poison, 'poison')
    } else if (step === 4) {
      M.checkWin(s)
    } else return nextTurn(s)
  }
}

function monsterAttacks(s: GameState, p: PlayerState) {
  const reach = { short: 0, medium: 1, long: 2 }
  const scientists = anyInPlay(s, 'alienBoost')
  let single = 0
  for (const inst of [...p.monsters]) {
    if (!p.alive || over(s)) return
    if (!p.monsters.some((m) => m.id === inst.id) || inst.stunnedBy !== null) continue
    const d = monsterDef(inst.id)
    let dmg = d.passive === 'idleKiller' && !s.turn.moved ? 8 : d.dmg
    if (d.set === 'A') dmg += scientists
    const targets = [p]
    if (d.attackAll && d.range)
      for (const q of living(s)) if (q !== p && Math.abs(q.pos.x - p.pos.x) + Math.abs(q.pos.y - p.pos.y) <= reach[d.range]) targets.push(q)
    let hitOwner = 0
    for (const q of targets) {
      const alive = q.figures.map((f, i) => (f.alive ? i : -1)).filter((i) => i >= 0)
      const figs = d.attackAll ? alive : q === p ? [alive[single++ % alive.length]] : [alive[0]]
      for (const fi of figs) {
        const dealt = damagePlayer(s, q, dmg, 'monster', fi)
        if (q === p) hitOwner += dealt
        if (dealt > 0) for (const e of d.attack ?? []) monsterEffect(s, q, e)
      }
    }
    if (d.passive === 'stalker' && hitOwner > 0 && d.range) {
      const weakest = living(s)
        .filter((q) => q !== p && inRange(p.pos, q.pos, d.range!))
        .sort((a, b) => a.figures.reduce((n, f) => n + f.hp, 0) - b.figures.reduce((n, f) => n + f.hp, 0))[0]
      const own = monsterOwner(s, inst.id)
      if (weakest && own) {
        own.p.monsters.splice(own.idx, 1)
        weakest.monsters.push(inst)
        log(s, `${d.name} переходит к ${weakest.name}`)
      }
    }
  }
}
