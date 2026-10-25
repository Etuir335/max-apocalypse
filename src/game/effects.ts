// Исполнение эффектов карт (Eff из data/*). Цели берутся из params, иначе выбираются автоматически.
import {
  cardDef,
  check,
  companion,
  companionAlive,
  dist,
  fail,
  inRange,
  keyOf,
  living,
  log,
  mainFigure,
  monsterDef,
  monsterOwner,
  neighbors,
  same,
  shuffle,
  slotsTotal,
  slotsUsed,
  tileAt,
} from './core.ts'
import {
  COLORS,
  addHunger,
  checkHand,
  damageMonster,
  damagePlayer,
  discardCard,
  drawSurvivor,
  enterTile,
  equip,
  gainFind,
  healFigure,
  playerBonus,
  reduceHunger,
  revealTile,
  takeMonster,
} from './rules.ts'
import type { Color, Cond, Eff, Equip, GameState, Params, PlayerState, Range, XY } from './types.ts'

export interface Ctx {
  source: string
  params: Params
  range?: Range
  /** оружие, которым сделано действие */
  equip?: Equip
  /** бонус оружия (модификаторы), посчитанный до траты патрона */
  weaponBonus?: number
  /** карта осталась лежать на оружии (не сбрасывать) */
  attached?: boolean
}

// ---------- Поиск целей ----------

/** id монстров в пределах дальности от игрока */
export function monstersInRange(s: GameState, p: PlayerState, range: Range = 'short'): string[] {
  const out: string[] = []
  for (const q of living(s))
    if (inRange(p.pos, q.pos, range))
      for (const m of q.monsters) if (!(range === 'short' && monsterDef(m.id).passive === 'noShort')) out.push(m.id)
  return out
}

function pickMonsters(ctx: Ctx, cands: string[], max: number): string[] {
  const given = ctx.params.targets
  if (!given?.length) return cands.slice(0, max)
  check(new Set(given).size === given.length, 'Цели повторяются')
  check(given.length <= max, `Можно выбрать не больше ${max} целей`)
  for (const id of given) check(cands.includes(id), 'Цель вне дальности')
  return given
}

function targetPlayer(s: GameState, p: PlayerState, ctx: Ctx): PlayerState {
  const seat = ctx.params.players?.[0]
  if (seat === undefined) return p
  const q = s.players[seat]
  check(q?.alive, 'Нет такого живого игрока')
  return q
}

function targetFigure(q: PlayerState, ctx: Ctx) {
  const f = ctx.params.figure
  if (f !== undefined && q.figures[f]?.alive) return f
  return q.figures.indexOf(mainFigure(q)!)
}

const bonusOf = (s: GameState, p: PlayerState, ctx: Ctx) => playerBonus(s, p) + (ctx.weaponBonus ?? 0)

function condOk(p: PlayerState, c: Cond) {
  const has = (...keys: string[]) => p.equip.some((e) => keys.includes(keyOf(e.id)))
  if (c === 'companionAlive') return companionAlive(p)
  if (c === 'companionDead') return !companionAlive(p)
  if (c === 'hasLighter') return has('ff_lighter')
  return has('hu_bow', 'hu_crossbow')
}

function autoColors(s: GameState, n: number, given?: Color[]): Color[] {
  if (given?.length) return given
  return Array.from({ length: n }, () => [...COLORS].sort((a, b) => s.finds[b].length - s.finds[a].length)[0])
}

/** Карты находок: показать n, оставить keep */
export function drawFindsKeep(s: GameState, p: PlayerState, n: number, keep: number, colors?: Color[]) {
  const cards: string[] = []
  for (const c of autoColors(s, n, colors).slice(0, n)) {
    const id = s.finds[c].shift()
    if (id) cards.push(id)
  }
  if (!cards.length) return log(s, 'Колоды находок пусты')
  if (cards.length <= keep) return cards.forEach((id) => gainFind(s, p, id))
  s.pendings.push({ seat: p.seat, kind: 'keepFinds', prompt: `Оставьте ${keep} из ${cards.length} карт находок`, cards, pick: keep,
    data: { rest: 'discard' } })
}

function findEquipAnywhere(s: GameState, id: string) {
  for (const q of s.players) {
    const e = q.equip.find((x) => x.id === id)
    if (e) return { q, e }
  }
  return null
}

function weaponOf(p: PlayerState, ctx: Ctx, needAmmo: boolean): Equip {
  const id = ctx.params.weapon ?? p.equip.find((e) => (needAmmo ? cardDef(e.id).gear?.ammo !== undefined : !!cardDef(e.id).gear?.action))?.id
  const e = p.equip.find((x) => x.id === id)
  check(e, 'Выберите своё оружие')
  return e!
}

// ---------- Исполнение ----------

export function runEffects(s: GameState, p: PlayerState, effs: Eff[], ctx: Ctx) {
  for (const e of effs) {
    if (!p.alive || s.phase === 'won' || s.phase === 'lost') return
    runOne(s, p, e, ctx)
  }
}

function runOne(s: GameState, p: PlayerState, e: Eff, ctx: Ctx) {
  const range = ctx.range ?? 'short'
  const P = ctx.params
  switch (e.k) {
    case 'if':
      if (condOk(p, e.cond)) runEffects(s, p, e.then, ctx)
      else log(s, 'Условие карты не выполнено — эффекта нет')
      return

    case 'damage': {
      const max = e.targets ?? 1
      const chosen = pickMonsters(ctx, monstersInRange(s, p, range), e.extraPerAmmo ? max : max)
      check(chosen.length, 'Нет целей в пределах дальности')
      if (e.extraPerAmmo && chosen.length > 1) {
        check(ctx.equip && ctx.equip.ammo >= chosen.length - 1, 'Не хватает патронов на дополнительные цели')
        ctx.equip!.ammo -= chosen.length - 1
      }
      const b = bonusOf(s, p, ctx)
      for (const id of chosen) {
        if (e.stun) stun(s, p, id)
        damageMonster(s, p, id, e.amount, b)
      }
      return
    }

    case 'damageAll': {
      const b = bonusOf(s, p, ctx)
      for (const id of monstersInRange(s, p, range)) damageMonster(s, p, id, e.amount, b)
      if (e.players)
        for (const q of living(s)) if (inRange(p.pos, q.pos, range)) q.figures.forEach((f, i) => f.alive && damagePlayer(s, q, e.players!, 'effect', i))
      return
    }

    case 'splash': {
      const cands = monstersInRange(s, p, range)
      const main = P.targets?.[0] ?? cands[0]
      check(main && cands.includes(main), 'Нет основной цели в пределах дальности')
      let others: string[]
      if (e.scope === 'front') others = p.monsters.map((m) => m.id).filter((id) => id !== main)
      else {
        const pool =
          e.scope === 'tile'
            ? cands.filter((id) => id !== main && same(monsterOwner(s, id)!.p.pos, monsterOwner(s, main)!.p.pos))
            : cands.filter((id) => id !== main)
        const given = P.targets?.slice(1)
        others = given?.length ? given : pool.slice(0, e.maxOther ?? pool.length)
        check(others.length <= (e.maxOther ?? 99) && others.every((id) => pool.includes(id)), 'Неверные дополнительные цели')
      }
      const b = bonusOf(s, p, ctx)
      damageMonster(s, p, main, e.main, b)
      for (const id of others) damageMonster(s, p, id, e.other, b)
      return
    }

    case 'heal': {
      const q = e.target === 'self' ? p : targetPlayer(s, p, ctx)
      if (e.target === 'range') check(inRange(p.pos, q.pos, range), 'Игрок вне дальности')
      return healFigure(s, p, q, targetFigure(q, ctx), e.amount)
    }
    case 'healCompanion': {
      const c = companion(p)
      if (c) healFigure(s, p, p, p.figures.indexOf(c), e.amount)
      return
    }
    case 'healBoth':
      return p.figures.forEach((_, i) => healFigure(s, p, p, i, e.amount))

    case 'hunger': {
      const who = e.who === 'all' ? living(s) : [p]
      for (const q of who) e.amount < 0 ? reduceHunger(s, q, -e.amount) : addHunger(s, q, e.amount)
      return log(s, e.amount < 0 ? `Голод уменьшен на ${-e.amount}` : `Голод увеличен на ${e.amount}`)
    }
    case 'draw':
      return drawSurvivor(s, p, e.n)
    case 'drawFinds':
      return drawFindsKeep(s, p, e.n, e.keep, P.colors)

    case 'stun': {
      const [id] = pickMonsters(ctx, monstersInRange(s, p, range), 1)
      check(id, 'Нет целей в пределах дальности')
      return stun(s, p, id)
    }
    case 'stunAll':
      return monstersInRange(s, p, range).forEach((id) => stun(s, p, id))

    case 'removeMarkers': {
      const tile = P.tile ? tileAt(s, P.tile) : undefined
      check(tile, 'Выберите тайл')
      if (e.where === 'range') check(inRange(p.pos, tile!, range), 'Тайл вне дальности')
      const n = e.count === 'all' ? tile!.markers : Math.min(e.count, tile!.markers)
      tile!.markers -= n
      log(s, `С тайла убрано жетонов: ${n}`)
      if (e.takeMonster) takeMonster(s, p)
      return
    }

    case 'mortar': {
      const tile = P.tile ? tileAt(s, P.tile) : undefined
      check(tile && inRange(p.pos, tile, range), 'Выберите тайл в пределах дальности')
      if (!P.mode) {
        tile!.markers = 0
        return log(s, 'Тайл очищен от жетонов')
      }
      const b = bonusOf(s, p, ctx)
      for (const q of living(s).filter((q) => same(q.pos, tile!))) {
        for (const m of [...q.monsters]) damageMonster(s, p, m.id, e.amount, b)
        q.figures.forEach((f, i) => f.alive && damagePlayer(s, q, e.amount, 'effect', i))
      }
      return
    }

    case 'nailBomb': {
      if (P.mode) {
        const tile = P.tile ? tileAt(s, P.tile) : undefined
        check(tile && dist(tile, p.pos) === 1, 'Выберите соседний тайл')
        tile!.markers = 0
        return log(s, 'Соседний тайл очищен от жетонов')
      }
      const chosen = pickMonsters(ctx, monstersInRange(s, p, range), e.maxTargets)
      check(chosen.length, 'Нет целей в пределах дальности')
      const b = bonusOf(s, p, ctx)
      return chosen.forEach((id) => damageMonster(s, p, id, e.amount, b))
    }

    case 'buff':
      s.buffs.push({ amount: e.amount, who: e.who === 'all' ? 'all' : p.seat, clearAt: p.seat, endTurn: e.until === 'endTurn' })
      return log(s, `Урон ${e.who === 'all' ? 'всех игроков' : p.name} +${e.amount}`)

    case 'move':
      if (s.turn.seat === p.seat && !s.turn.lent) s.turn.freeMoves += e.steps
      return log(s, `${p.name} может бесплатно пройти ${e.steps} тайл(а)`)

    case 'teleportPlayer': {
      const q = targetPlayer(s, p, ctx)
      const tile = P.tile ? tileAt(s, P.tile) : undefined
      check(tile?.revealed, 'Выберите исследованный тайл')
      return enterTile(s, q, tile!)
    }
    case 'pullPlayer': {
      const q = targetPlayer(s, p, ctx)
      check(q !== p && inRange(p.pos, q.pos, range), 'Игрок вне дальности')
      const tile = P.tile ? tileAt(s, P.tile) : neighbors(s, q.pos).find((t) => dist(t, p.pos) < dist(q.pos, p.pos))
      check(tile && dist(tile, q.pos) === 1 && dist(tile, p.pos) < dist(q.pos, p.pos), 'Нужен тайл на шаг ближе к вам')
      return enterTile(s, q, tile!, true)
    }

    case 'reveal': {
      const cands = s.tiles.filter((t) => !t.revealed && (e.adjacent ? dist(t, p.pos) === 1 : ctx.range ? inRange(p.pos, t, range) : true))
      const chosen = (P.tiles?.length ? P.tiles : cands.slice(0, e.n)).slice(0, e.n)
      for (const xy of chosen) {
        const t = cands.find((c) => same(c, xy))
        check(t, 'Этот тайл нельзя открыть')
        revealTile(s, t!, p, false)
      }
      return
    }

    case 'lendActions': {
      const q = targetPlayer(s, p, ctx)
      check(q !== p, 'Выберите другого игрока')
      s.turn.lent = { seat: q.seat, n: e.n, playOnly: !!e.playOnly }
      return log(s, `${q.name} получает ${e.n} ${e.playOnly ? 'розыгрыша карт' : 'действия'} прямо сейчас`)
    }
    case 'extraActions':
      s.turn.actions += e.n
      return log(s, `+${e.n} действия`)

    case 'reload': {
      const w = weaponOf(p, ctx, true)
      const cap = cardDef(w.id).gear!.ammo
      check(cap !== undefined, 'Это оружие заряжается не патронами')
      if (w.notch) dropNotch(s, p, w)
      w.ammo = e.amount === 'full' ? cap! : Math.min(cap!, w.ammo + e.amount)
      return log(s, `«${cardDef(w.id).name}» заряжено: ${w.ammo}`)
    }
    case 'reloadAny': {
      const found = P.weapon ? findEquipAnywhere(s, P.weapon) : null
      check(found && inRange(p.pos, found.q.pos, range), 'Выберите оружие в пределах дальности')
      const cap = cardDef(found!.e.id).gear!.ammo
      check(cap !== undefined, 'Это оружие заряжается не патронами')
      if (found!.e.notch) dropNotch(s, found!.q, found!.e)
      found!.e.ammo = cap!
      return log(s, `«${cardDef(found!.e.id).name}» полностью заряжено`)
    }
    case 'attachMod': {
      const found = P.weapon ? findEquipAnywhere(s, P.weapon) : { q: p, e: weaponOf(p, ctx, e.mod === 'notch') }
      check(found, 'Выберите оружие')
      const { q, e: w } = found!
      check(cardDef(w.id).gear?.action, 'Это не оружие')
      if (e.mod === 'upgrade') {
        check(inRange(p.pos, q.pos, range), 'Оружие вне дальности')
        w.dmgMod += 1
      } else {
        check(q === p && cardDef(w.id).gear!.ammo !== undefined, 'Насечку кладут на своё оружие с патронами')
        w.ammo = cardDef(w.id).gear!.ammo!
        w.notch = true
      }
      w.attached.push(ctx.source)
      ctx.attached = true
      return log(s, `На «${cardDef(w.id).name}» положена карта «${cardDef(ctx.source).name}»`)
    }

    case 'flare':
      for (const q of living(s))
        if (q !== p && inRange(p.pos, q.pos, range) && q.monsters.length) {
          log(s, `Монстры ${q.name} переходят к ${p.name}`)
          p.monsters.push(...q.monsters)
          q.monsters = []
        }
      return
    case 'lasso': {
      const [id] = pickMonsters(ctx, monstersInRange(s, p, range), 1)
      check(id, 'Нет целей в пределах дальности')
      const own = monsterOwner(s, id)!
      const [inst] = own.p.monsters.splice(own.idx, 1)
      inst.stunnedBy = p.seat
      p.monsters.push(inst)
      return log(s, `${monsterDef(id).name} оглушён и переходит к ${p.name}`)
    }
    case 'camouflage': {
      const id = P.targets?.[0] ?? p.monsters.find((m) => !monsterDef(m.id).boss)?.id
      const i = p.monsters.findIndex((m) => m.id === id)
      check(i >= 0 && !monsterDef(id!).boss, 'Выберите монстра перед собой (не Босса)')
      p.monsters.splice(i, 1)
      s.monsterDiscard.push(id!)
      const t = tileAt(s, p.pos)!
      t.markers = Math.min(3, t.markers + 1)
      log(s, `${monsterDef(id!).name} сброшен, на тайле жетон`)
      return void damagePlayer(s, p, e.selfDamage, 'effect')
    }

    case 'gearFromDiscard': {
      const id = P.card
      check(id && cardDef(id).gear, 'Выберите снаряжение из сброса')
      const pile = [s.findDiscard, ...s.players.map((q) => q.discard)].find((d) => d.includes(id!))
      check(pile, 'Этой карты нет в сбросе')
      pile!.splice(pile!.indexOf(id!), 1)
      if (e.toPlay) return equip(s, p, id!)
      p.hand.push(id!)
      return checkHand(s, p)
    }
    case 'replayInstant': {
      const id = P.card
      check(id && p.discard.includes(id) && cardDef(id).type === 'instant', 'Выберите мгновенную карту из своего сброса')
      p.discard.splice(p.discard.indexOf(id!), 1)
      s.removed.push(id!)
      const d = cardDef(id!)
      log(s, `${p.name} повторяет «${d.name}»`)
      const inner: Ctx = { source: id!, params: P.inner ?? {}, range: d.range }
      runEffects(s, p, d.effect ?? [], inner)
      if (inner.attached) s.removed.splice(s.removed.indexOf(id!), 1)
      return
    }
    case 'equipFromOther': {
      const found = P.card ? findEquipAnywhere(s, P.card) : null
      check(found && found.q !== p && inRange(p.pos, found.q.pos, range), 'Выберите снаряжение другого игрока в пределах дальности')
      const d = cardDef(found!.e.id)
      check(slotsUsed(p) + d.gear!.slots <= slotsTotal(p), 'Не хватает ячеек снаряжения')
      check(d.find === 'fuel' || !p.equip.some((x) => cardDef(x.id).name === d.name), 'Нельзя экипировать две одинаковые карты')
      found!.q.equip.splice(found!.q.equip.indexOf(found!.e), 1)
      p.equip.push(found!.e)
      return log(s, `${p.name} забирает «${d.name}» у ${found!.q.name}`)
    }
    case 'findAxe': {
      // Топор ищем в колоде выжившего, а если его там нет — в своём сбросе
      const pile = p.deck.some((id) => keyOf(id) === 'ff_axe') ? p.deck : p.discard
      const i = pile.findIndex((id) => keyOf(id) === 'ff_axe')
      if (i >= 0) {
        const [axe] = pile.splice(i, 1)
        try {
          equip(s, p, axe)
          log(s, `${p.name} находит Надёжный топор и сразу берёт его в руки`)
        } catch {
          p.hand.push(axe)
          log(s, `${p.name} находит Надёжный топор — ячеек не хватает, топор в руке`)
          checkHand(s, p)
        }
      } else log(s, 'Топора нет ни в колоде, ни в сбросе (он уже в игре или в руке)')
      shuffle(s, p.deck)
      // «Вытяните карту» — из своей колоды выжившего
      return drawSurvivor(s, p, 1)
    }
    case 'drawMonster':
      return takeMonster(s, p)
    case 'cure':
      if (e.scope === 'self') p.poison = 0
      else living(s).forEach((q) => inRange(p.pos, q.pos, range) && (q.poison = 0))
      return log(s, 'Эффекты состояний вылечены')
    case 'cureOrHunger':
      for (const q of living(s)) if (inRange(p.pos, q.pos, range)) P.mode ? reduceHunger(s, q, e.hunger) : (q.poison = 0)
      return log(s, P.mode ? `Голод игроков рядом уменьшен на ${e.hunger}` : 'Отравление вылечено')

    case 'flamingGuns': {
      const [id] = pickMonsters(ctx, monstersInRange(s, p, range), 1)
      check(id, 'Нет целей в пределах дальности')
      let x = 0
      for (const w of p.equip)
        if (cardDef(w.id).gear?.ammo !== undefined) {
          x += w.ammo
          w.ammo = 0
        }
      return damageMonster(s, p, id, e.base + x, playerBonus(s, p))
    }
    case 'focusedShot': {
      const w = weaponOf(p, ctx, true)
      check(w.ammo > 0, 'В оружии нет патронов')
      const [id] = pickMonsters(ctx, monstersInRange(s, p, range), 1)
      check(id, 'Нет целей в пределах дальности')
      w.ammo--
      return damageMonster(s, p, id, e.amount, playerBonus(s, p))
    }
    case 'bodySearch':
      s.turn.bodySearch = true
      return log(s, 'Обыск тел до конца хода')
    case 'noStarve':
      p.noStarve = true
      return log(s, `${p.name} не получает урон от голода до следующего хода`)
    case 'selfDamage': {
      const f = e.who === 'companion' ? companion(p) : p.figures.find((x) => !x.companion)
      if (f?.alive) damagePlayer(s, p, e.amount, 'effect', p.figures.indexOf(f))
      return
    }
    case 'companionImmune': {
      const c = companion(p)
      if (c?.alive) c.immune = true
      return log(s, 'Пёс невосприимчив к урону до следующего хода')
    }
    case 'retrieveDiscard': {
      const id = P.card ?? p.discard[p.discard.length - 1]
      if (!id) return log(s, 'Сброс пуст')
      check(p.discard.includes(id), 'Этой карты нет в вашем сбросе')
      p.discard.splice(p.discard.indexOf(id), 1)
      p.hand.push(id)
      checkHand(s, p)
      return log(s, `${p.name} возвращает «${cardDef(id).name}» в руку`)
    }
  }
  fail(`Неизвестный эффект ${(e as Eff).k}`)
}

function stun(s: GameState, p: PlayerState, id: string) {
  const own = monsterOwner(s, id)
  if (!own) return
  own.p.monsters[own.idx].stunnedBy = p.seat
  log(s, `${monsterDef(id).name} оглушён`)
}

function dropNotch(s: GameState, q: PlayerState, w: Equip) {
  w.notch = false
  const i = w.attached.findIndex((id) => keyOf(id) === 'gs_notch')
  if (i >= 0) discardCard(s, q, w.attached.splice(i, 1)[0])
}

/** Насечка: когда патроны кончились — бонус пропадает. */
export function weaponBonus(w: Equip) {
  return w.dmgMod + (w.notch && w.ammo > 0 ? 2 : 0)
}

export const tileXY = (t: XY) => ({ x: t.x, y: t.y })
