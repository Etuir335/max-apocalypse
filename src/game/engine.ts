// Движок: чистая функция reduce(state, action) → новое состояние. Входное состояние не меняется.
import { FIND_CARDS } from './data/finds.ts'
import { missionById } from './data/missions.ts'
import { MONSTERS } from './data/monsters.ts'
import { SURVIVOR_CARDS } from './data/survivor.ts'
import { characterByKey } from './data/characters.ts'
import {
  GameError,
  cardDef,
  charDef,
  check,
  dist,
  equipDef,
  fail,
  hasPassive,
  keyOf,
  log,
  makeId,
  shuffle,
  tileAt,
  tileDef,
  same,
} from './core.ts'
import { runEffects, weaponBonus, drawFindsKeep, type Ctx } from './effects.ts'
import * as M from './missionRules.ts'
import {
  COLORS,
  HAND_LIMIT,
  addHunger,
  attractMarkers,
  checkHand,
  damagePlayer,
  discardCard,
  dropOnTile,
  drawSurvivor,
  enterTile,
  equip,
  freshTurn,
  gainFind,
  nextTurn,
  over,
  removeFromHand,
  runEndPhase,
  search,
  startTurn,
  stealthCheck,
  takeMonster,
  unequip,
} from './rules.ts'
import type { Action, Color, GameState, PlayerState } from './types.ts'

export { GameError }

export function reduce(state: GameState | null, action: Action): GameState {
  if (action.type === 'create') return create(action)
  check(state, 'Партия не создана')
  const s = structuredClone(state!)
  check(!over(s), 'Партия окончена')
  apply(s, action)
  afterAction(s)
  return s
}

/** То же, но вместо исключения возвращает текст ошибки. */
export function tryReduce(state: GameState | null, action: Action): { state: GameState | null; error?: string } {
  try {
    return { state: reduce(state, action) }
  } catch (e) {
    if (e instanceof GameError) return { state, error: e.message }
    throw e
  }
}

// ---------- Создание партии ----------

function create(a: Extract<Action, { type: 'create' }>): GameState {
  check(a.players.length >= 1 && a.players.length <= 4, 'Нужно от 1 до 4 игроков')
  const m = missionById(a.missionId)
  const s: GameState = {
    v: 1, rng: a.seed | 0, phase: 'setup', result: '', missionId: m.id, monsterSet: m.set, options: { hardcore: !!a.hardcore },
    players: [], tiles: [], monsterDeck: [], monsterDiscard: [], bossAside: [], finds: { red: [], green: [], blue: [] },
    findDiscard: [], removed: [], dropped: [], mission: { fuel: 0, delivered: {}, samples: {}, repairs: 0, cleared: [], flags: {} },
    buffs: [], round: 1, turn: freshTurn(0), pendings: [], log: [], serial: 0,
  }
  M.buildBoard(s)
  const start = M.startTile(s)
  a.players.forEach((pl, seat) => {
    const ch = characterByKey(pl.hero)
    check(!s.players.some((q) => characterByKey(q.hero).deck === ch.deck), `Колода «${ch.name}» уже занята`)
    const deck: string[] = []
    for (const c of SURVIVOR_CARDS.filter((x) => x.deck === ch.deck))
      for (let i = 0; i < c.copies; i++) deck.push(makeId(s, c.key, c.images[i % c.images.length]))
    shuffle(s, deck)
    const p: PlayerState = {
      seat, uid: pl.uid, name: pl.name, hero: ch.key,
      figures: ch.figures.map((f) => ({ name: f.name, hp: f.hp, maxHp: f.hp, alive: true, companion: !!f.companion, slots: f.slots, immune: false })),
      hunger: 1, exhausted: false, starve: 0, poison: 0, pos: { x: start.x, y: start.y }, hand: [], deck, discard: [], equip: [],
      monsters: [], alive: true, noStarve: false, mulliganDone: false, startPos: { x: start.x, y: start.y },
      ...(pl.bot ? { bot: pl.bot } : {}),
    }
    if (ch.ability.passive === 'colt') {
      const colt = p.deck.find((id) => keyOf(id) === 'gs_colt')
      if (colt) {
        p.deck.splice(p.deck.indexOf(colt), 1)
        p.equip.push({ id: colt, ammo: equipDef(colt).ammo ?? 0, dmgMod: 0, notch: false, attached: [] })
      }
    }
    p.hand = p.deck.splice(0, 4)
    s.players.push(p)
  })
  // Колоды находок по рубашке миссии
  const pool: string[] = []
  for (const c of FIND_CARDS) if (c.key !== 'scientist') for (const img of c.images) pool.push(makeId(s, c.key, img))
  shuffle(s, pool)
  for (const color of COLORS) {
    for (const [kind, count] of Object.entries(m.finds[color])) {
      for (let i = 0; i < (count ?? 0); i++) {
        const j = pool.findIndex((id) => cardDef(id).find === kind)
        if (j >= 0) s.finds[color].push(pool.splice(j, 1)[0])
      }
    }
    shuffle(s, s.finds[color])
  }
  // Колода монстров (без боссов)
  for (const md of MONSTERS.filter((x) => x.set === m.set && !x.boss)) for (const img of md.images) s.monsterDeck.push(makeId(s, md.key, img))
  shuffle(s, s.monsterDeck)
  M.setupObjectives(s)
  log(s, `Миссия «${m.name}». Можно заменить до 4 карт, затем начать игру.`)
  return s
}

// ---------- Кто может действовать ----------

const actor = (s: GameState) => (s.turn.lent ? s.turn.lent.seat : s.turn.seat)

function me(s: GameState, seat: number): PlayerState {
  const p = s.players[seat]
  check(p, 'Нет такого игрока')
  check(p.alive, 'Ваш персонаж погиб')
  return p
}

/** Потратить действие: обычное, перемещение (сначала бесплатные шаги) или розыгрыш карты. */
function spend(s: GameState, seat: number, kind: 'act' | 'move' | 'play', n = 1) {
  check(s.phase === 'play', 'Игра ещё не началась')
  check(s.turn.stage === 'actions', 'Ход уже завершается')
  const lent = s.turn.lent
  if (lent) {
    check(seat === lent.seat, 'Сейчас действует другой игрок')
    check(!lent.playOnly || kind === 'play', 'Можно только разыгрывать карты')
    check(lent.n >= n, 'Не хватает действий')
    lent.n -= n
    if (lent.n <= 0) s.turn.lent = null
    return
  }
  check(seat === s.turn.seat, 'Сейчас не ваш ход')
  if (kind === 'move' && s.turn.freeMoves > 0) {
    s.turn.freeMoves--
    return
  }
  check(s.turn.actions >= n, 'Действия закончились')
  s.turn.actions -= n
}

/** Свободные действия — только в свой ход (или во время одолженных действий). */
function free(s: GameState, seat: number) {
  check(s.phase === 'play' && s.turn.stage === 'actions', 'Сейчас нельзя')
  check(seat === actor(s) || seat === s.turn.seat, 'Сейчас не ваш ход')
}

// ---------- Применение действий ----------

function apply(s: GameState, a: Action) {
  if (a.type === 'choose') return choose(s, a)
  // Пока кто-то выбирает — остальные ждут. Сбросить снаряжение (освободить ячейку) можно и во время выбора.
  if (s.pendings.length && !(a.type === 'discardGear' && s.pendings[0].seat === a.seat))
    fail(`Ждём выбора: ${s.players[s.pendings[0].seat].name} — ${s.pendings[0].prompt}`)

  switch (a.type) {
    case 'mulligan': {
      check(s.phase === 'setup', 'Замена карт только перед игрой')
      const p = me(s, a.seat)
      check(!p.mulliganDone, 'Замена уже была')
      check(a.cards.length <= 4, 'Можно заменить не больше 4 карт')
      for (const id of a.cards) removeFromHand(p, id)
      p.hand.push(...p.deck.splice(0, a.cards.length))
      p.deck.push(...a.cards)
      shuffle(s, p.deck)
      p.mulliganDone = true
      return log(s, `${p.name} заменяет карт: ${a.cards.length}`)
    }
    case 'begin':
      return begin(s, a.first)

    case 'move': {
      const p = me(s, a.seat)
      check(!(s.turn.noMove && a.seat === s.turn.seat), 'Вы закончили перемещение в этом ходу (Лес)')
      const t = tileAt(s, a.to)
      check(t && dist(t, p.pos) === 1, 'Можно идти только на соседний тайл по горизонтали или вертикали')
      spend(s, a.seat, 'move')
      return enterTile(s, p, a.to)
    }
    case 'draw': {
      const p = me(s, a.seat)
      spend(s, a.seat, 'act')
      return drawSurvivor(s, p, 1)
    }
    case 'play':
      return play(s, a.seat, a.card, a.params ?? {})
    case 'useGear': {
      const p = me(s, a.seat)
      const e = p.equip.find((x) => x.id === a.equip)
      check(e, 'Нет такого снаряжения')
      const g = cardDef(e!.id).gear!
      check(g.action, 'У этой карты нет действия')
      const charged = g.ammo !== undefined || g.fuel !== undefined
      if (charged) check(e!.ammo > 0, g.fuel !== undefined ? 'Нужна заправка топливом' : 'Нет патронов')
      spend(s, a.seat, 'act')
      const ctx: Ctx = { source: e!.id, params: a.params ?? {}, range: cardDef(e!.id).range, equip: e, weaponBonus: weaponBonus(e!) }
      if (charged) e!.ammo--
      log(s, `${p.name}: «${cardDef(e!.id).name}»`)
      return runEffects(s, p, g.action!, ctx)
    }
    case 'ability': {
      const p = me(s, a.seat)
      const ab = charDef(p).ability
      check(ab.action, 'У персонажа нет активной способности')
      check(!p.exhausted, 'Истощённый персонаж не может использовать способность')
      check(p.figures.some((f) => f.alive && !f.companion), `${p.figures[0].name} погиб — его способность недоступна`)
      spend(s, a.seat, 'act')
      log(s, `${p.name}: «${ab.name}»`)
      return runEffects(s, p, ab.action!, { source: 'ability', params: a.params ?? {}, range: ab.range })
    }
    case 'search': {
      const p = me(s, a.seat)
      const t = tileAt(s, p.pos)!
      const colors = tileDef(t).colors
      check(t.revealed && colors.length, 'На этом тайле нечего обыскивать')
      const key = `${t.x},${t.y}`
      check(!s.turn.searched.includes(key), 'Этот тайл уже обыскан в этом ходу')
      const color: Color = a.color ?? colors[0]
      check(colors.includes(color), 'Тайл не даёт находки этого цвета')
      spend(s, a.seat, 'act')
      s.turn.searched.push(key)
      return search(s, p, color)
    }
    case 'tileAction': {
      const p = me(s, a.seat)
      const here = tileAt(s, p.pos)!
      const sp = tileDef(here).special
      const to = tileAt(s, a.to)
      check(to?.revealed && !same(to, here), 'Выберите другой открытый тайл')
      if (sp === 'airport') check(here.markers === 0 && !p.monsters.length, 'В аэропорту есть монстры')
      else if (sp === 'tunnel') check(tileDef(to!).special === 'tunnel', 'Можно перейти только в другой туннель')
      else fail('У этого тайла нет действия')
      spend(s, a.seat, 'act')
      return enterTile(s, p, a.to)
    }
    case 'refuel': {
      const p = me(s, a.seat)
      const w = p.equip.find((x) => x.id === a.equip)
      const f = p.equip.find((x) => x.id === a.fuel)
      check(w && cardDef(w.id).gear?.fuel, 'Это снаряжение не заправляется топливом')
      check(f && cardDef(f.id).find === 'fuel', 'Нужна экипированная карта топлива')
      spend(s, a.seat, 'act')
      unequip(s, p, f!.id)
      w!.ammo = cardDef(w!.id).gear!.fuel!
      return log(s, `${p.name} заправляет «${cardDef(w!.id).name}»`)
    }
    case 'discardGear': {
      const p = me(s, a.seat)
      if (!s.pendings.length) free(s, a.seat)
      const e = p.equip.find((x) => x.id === a.equip)
      check(e, 'Нет такого снаряжения')
      const g = cardDef(e!.id).gear!
      unequip(s, p, e!.id)
      log(s, `${p.name} сбрасывает «${cardDef(e!.id).name}»`)
      if (g.onDiscard) runEffects(s, p, g.onDiscard, { source: e!.id, params: a.params ?? {}, range: cardDef(e!.id).range })
      return
    }
    case 'jacket': {
      const p = me(s, a.seat)
      check(a.seat === s.turn.seat && s.phase === 'play' && s.turn.stage === 'actions', 'Сейчас нельзя')
      check(hasPassive(p, 'jacket').length, 'Нужна Специальная куртка')
      check(!s.turn.jacketUsed, 'Уже использовано в этом ходу')
      s.turn.jacketUsed = true
      s.turn.actions++
      log(s, `${p.name}: дополнительное действие за голод`)
      return addHunger(s, p, 1)
    }
    case 'freeDiscard': {
      const p = me(s, a.seat)
      free(s, a.seat)
      check(!s.turn.freeDiscardUsed, 'Уже использовано в этом ходу')
      check(a.cards.length === 2 && a.cards.every((id) => cardDef(id).group === 'survivor'), 'Нужно сбросить 2 карты выжившего')
      for (const id of a.cards) removeFromHand(p, id)
      a.cards.forEach((id) => p.discard.push(id))
      s.turn.freeDiscardUsed = true
      return drawSurvivor(s, p, 1)
    }
    case 'trade':
      return trade(s, a)
    case 'pickUp': {
      const p = me(s, a.seat)
      free(s, a.seat)
      check(!s.turn.tradeUsed, 'Обмен уже был в этом ходу')
      const pile = s.dropped.find((d) => d.x === p.pos.x && d.y === p.pos.y)
      check(pile && a.cards.length && a.cards.every((id) => pile!.cards.includes(id)), 'Здесь нет этих карт')
      s.turn.tradeUsed = true
      pile!.cards = pile!.cards.filter((id) => !a.cards.includes(id))
      s.dropped = s.dropped.filter((d) => d.cards.length)
      return a.cards.forEach((id) => (cardDef(id).find === 'fuel' ? gainFind(s, p, id) : p.hand.push(id)))
    }
    case 'deliver': {
      const p = me(s, a.seat)
      free(s, a.seat)
      return M.deliver(s, p, a.card)
    }
    case 'mission': {
      const p = me(s, a.seat)
      const def = M.missionActions(s, p).find((x) => x.kind === a.kind)
      check(def, 'Это действие сейчас недоступно')
      spend(s, a.seat, 'act', def!.cost)
      return M.missionAction(s, p, a.kind, a.to)
    }
    case 'pass': {
      check(s.turn.lent?.seat === a.seat, 'Нечего пропускать')
      s.turn.lent = null
      return log(s, `${s.players[a.seat].name} отказывается от оставшихся действий`)
    }
    case 'endTurn': {
      check(s.phase === 'play' && a.seat === s.turn.seat, 'Сейчас не ваш ход')
      check(s.turn.stage === 'actions', 'Ход уже завершается')
      check(!s.turn.lent, 'Другой игрок ещё не использовал одолженные действия')
      check(s.turn.actions === 0, `Нужно выполнить ровно 4 действия (осталось ${s.turn.actions})`)
      s.turn.stage = 'end'
      return runEndPhase(s)
    }
  }
}

function begin(s: GameState, first: number) {
  check(s.phase === 'setup', 'Игра уже идёт')
  check(s.players[first], 'Нет такого игрока')
  s.phase = 'play'
  s.turn = freshTurn(first)
  const m = missionById(s.missionId)
  if (m.num !== 11) for (const p of s.players) takeMonster(s, p)
  M.placeBosses(s)
  M.onBegin(s)
  for (const p of s.players)
    if (charDef(p).ability.passive === 'hunterFind')
      s.pendings.push({ seat: p.seat, kind: 'findColor', prompt: 'Находка: из какой колоды взять карту?', options: ['Красная', 'Зелёная', 'Синяя'], data: { n: 1 } })
  s.mission.flags.awaitStart = true
  log(s, 'Игра началась')
}

function play(s: GameState, seat: number, card: string, params: Ctx['params']) {
  const p = me(s, seat)
  check(p.hand.includes(card), 'Этой карты нет в руке')
  const d = cardDef(card)
  check(!(d.type === 'instant' && !d.effect?.length), `«${d.name}» — предмет для миссии: его сдают, а не разыгрывают`)
  spend(s, seat, 'play')
  removeFromHand(p, card)
  log(s, `${p.name} разыгрывает «${d.name}»`)
  if (d.type === 'gear') {
    try {
      equip(s, p, card)
    } catch (e) {
      p.hand.push(card)
      throw e
    }
    return
  }
  const ctx: Ctx = { source: card, params, range: d.range }
  runEffects(s, p, d.effect ?? [], ctx)
  if (!ctx.attached) discardCard(s, p, card)
}

function trade(s: GameState, a: Extract<Action, { type: 'trade' }>) {
  const p = me(s, a.seat)
  free(s, a.seat)
  check(!s.turn.tradeUsed, 'Обмен уже был в этом ходу')
  const q = me(s, a.with)
  check(q !== p && same(q.pos, p.pos), 'Обмениваться можно с игроком на том же тайле')
  const move = (from: PlayerState, to: PlayerState, ids: string[]) => {
    for (const id of ids) {
      check(cardDef(id).group === 'find', 'Обмениваться можно только картами находок')
      if (from.hand.includes(id)) {
        removeFromHand(from, id)
        to.hand.push(id)
      } else {
        const e = from.equip.find((x) => x.id === id)
        check(e, 'У игрока нет этой карты')
        from.equip.splice(from.equip.indexOf(e!), 1)
        to.equip.push(e!)
      }
    }
  }
  move(p, q, a.give)
  move(q, p, a.take)
  s.turn.tradeUsed = true
  checkHand(s, p)
  checkHand(s, q)
  log(s, `${p.name} и ${q.name} обмениваются находками`)
}

// ---------- Выборы (pending) ----------

function choose(s: GameState, a: Extract<Action, { type: 'choose' }>) {
  const pd = s.pendings[0]
  check(pd, 'Сейчас нечего выбирать')
  check(pd.seat === a.seat, 'Сейчас выбирает другой игрок')
  const p = s.players[a.seat]
  const opt = a.option
  const cards = a.cards ?? []
  const needOpt = (n: number) => check(opt !== undefined && opt >= 0 && opt < n, 'Выберите вариант')
  s.pendings.shift()
  try {
    switch (pd.kind) {
      case 'discard': {
        // рука могла измениться с момента вопроса — считаем по текущей
        const need = pd.data?.limit ? Math.max(0, p.hand.length - HAND_LIMIT) : Math.min(pd.pick ?? 0, p.hand.length)
        check(cards.length === need, `Выберите ${need} карт(ы)`)
        for (const id of cards) removeFromHand(p, id)
        return cards.forEach((id) => discardCard(s, p, id))
      }
      case 'sneak': {
        needOpt(2)
        const t = tileAt(s, pd.data as { x: number; y: number })!
        if (opt === 0 && stealthCheck(s, p, t.markers)) return
        return attractMarkers(s, p, t)
      }
      case 'gearOrDamage': {
        needOpt(p.equip.length + 1)
        if (opt! < p.equip.length) return void unequip(s, p, p.equip[opt!].id)
        return void damagePlayer(s, p, pd.data!.amount as number, 'effect')
      }
      case 'findOrDamage': {
        if (cards.length) {
          check(cards.length === 1 && p.hand.includes(cards[0]), 'Выберите одну карту находки')
          removeFromHand(p, cards[0])
          return void s.findDiscard.push(cards[0])
        }
        return void damagePlayer(s, p, pd.data!.amount as number, 'effect')
      }
      case 'loseGear':
        needOpt(p.equip.length)
        return void unequip(s, p, p.equip[opt!].id)
      case 'fuel': {
        const codes = (pd.data!.codes as string[] | undefined) ?? ['equip', 'discard']
        needOpt(codes.length)
        const id = pd.data!.card as string
        const code = codes[opt!]
        if (code === 'equip') return equip(s, p, id)
        if (code.startsWith('swap:')) {
          unequip(s, p, code.slice(5))
          return equip(s, p, id)
        }
        if (code === 'drop') return dropOnTile(s, p, id)
        return void s.findDiscard.push(id)
      }
      case 'keepFinds': {
        const keep = Math.min(pd.pick ?? 1, pd.cards!.length)
        check(cards.length === keep && cards.every((id) => pd.cards!.includes(id)), `Выберите ${keep} карт(ы)`)
        const rest = pd.cards!.filter((id) => !cards.includes(id))
        if (pd.data?.rest === 'bottom') s.finds[pd.data.color as Color].push(...rest)
        else s.findDiscard.push(...rest)
        return cards.forEach((id) => gainFind(s, p, id))
      }
      case 'ladder': {
        needOpt(2)
        if (opt === 0) {
          const l = hasPassive(p, 'ladder')[0]
          if (l) {
            unequip(s, p, l.id)
            return log(s, `${p.name} сбрасывает Лестницу и избегает монстра`)
          }
        }
        return takeMonster(s, p, { skipLadder: true })
      }
      case 'forest':
        needOpt(2)
        if (opt === 0) {
          s.turn.noMove = true
          return log(s, `${p.name} заканчивает перемещение`)
        }
        return takeMonster(s, p)
      case 'findColor': {
        needOpt(3)
        return drawFindsKeep(s, p, 1, 1, [COLORS[opt!]])
      }
    }
    fail(`Неизвестный выбор ${pd.kind}`)
  } catch (e) {
    s.pendings.unshift(pd)
    throw e
  }
}

// ---------- После каждого действия ----------

function afterAction(s: GameState) {
  if (over(s) || s.phase !== 'play') return
  if (s.pendings.length) return
  // Первый ход начинается, когда разобраны стартовые выборы
  if (s.mission.flags.awaitStart) {
    s.mission.flags.awaitStart = false
    startTurn(s, s.turn.seat)
    if (!s.players[s.turn.seat].alive) nextTurn(s)
    return afterAction(s)
  }
  const cur = s.players[s.turn.seat]
  if (!cur.alive) return nextTurn(s)
  if (s.turn.stage === 'end') runEndPhase(s)
}

/** Подсказка для UI: какие действия миссии доступны игроку. */
export const missionActionsFor = (s: GameState, seat: number) => M.missionActions(s, s.players[seat])
export { missionProgress } from './missionRules.ts'
