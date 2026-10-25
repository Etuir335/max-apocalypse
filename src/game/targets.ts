// Для интерфейса: какие выборы нужны карте/способности перед розыгрышем (по её эффектам).
import { cardDef, dist, inRange, living, monsterDef, monsterOwner } from './core.ts'
import { monstersInRange } from './effects.ts'
import type { Eff, GameState, Params, PlayerState, Range, XY } from './types.ts'

export type Requirement =
  | { kind: 'mode'; key: 'mode'; label: string; labels: string[] }
  | { kind: 'monsters'; key: 'targets'; label: string; min: number; max: number; cands: string[] }
  | { kind: 'player'; key: 'players'; label: string; cands: number[]; figure: boolean }
  | { kind: 'tile'; key: 'tile'; label: string; cands: XY[] }
  | { kind: 'tiles'; key: 'tiles'; label: string; n: number; cands: XY[] }
  | { kind: 'weapon'; key: 'weapon'; label: string; cands: string[] }
  | { kind: 'card'; key: 'card'; label: string; cands: string[]; inner?: boolean }
  | { kind: 'colors'; key: 'colors'; label: string; n: number }

const xy = (t: XY) => ({ x: t.x, y: t.y })

/** Список требований с учётом уже выбранного режима (params.mode). */
export function requirements(s: GameState, p: PlayerState, effs: Eff[], range: Range | undefined, params: Params): Requirement[] {
  const out: Requirement[] = []
  const r = range ?? 'short'
  const monsters = () => monstersInRange(s, p, r)
  const playersIn = (ok: (q: PlayerState) => boolean) => living(s).filter(ok).map((q) => q.seat)
  const anyTwoFig = () => living(s).some((q) => q.figures.length > 1)

  const walk = (list: Eff[]) => {
    for (const e of list) {
      switch (e.k) {
        case 'if':
          walk(e.then)
          break
        case 'damage': {
          let max = e.targets ?? 1
          if (e.extraPerAmmo) {
            const w = p.equip.find((x) => x.id === params.weapon)
            if (w) max = Math.min(max, 1 + Math.max(0, w.ammo - 1))
          }
          out.push({ kind: 'monsters', key: 'targets', label: max > 1 ? `Цели (до ${max})` : 'Цель', min: 1, max, cands: monsters() })
          break
        }
        case 'splash':
          if (e.scope === 'front') out.push({ kind: 'monsters', key: 'targets', label: 'Основная цель', min: 1, max: 1, cands: monsters() })
          else out.push({ kind: 'monsters', key: 'targets', label: `Основная цель и до ${e.maxOther} других`, min: 1, max: 1 + (e.maxOther ?? 0), cands: monsters() })
          break
        case 'heal':
          if (e.target !== 'self')
            out.push({ kind: 'player', key: 'players', label: 'Кого лечить', figure: anyTwoFig(),
              cands: playersIn((q) => e.target === 'any' || inRange(p.pos, q.pos, r)) })
          break
        case 'drawFinds':
          out.push({ kind: 'colors', key: 'colors', label: `Колоды находок (${e.n})`, n: e.n })
          break
        case 'stun':
        case 'flamingGuns':
          out.push({ kind: 'monsters', key: 'targets', label: 'Цель', min: 1, max: 1, cands: monsters() })
          break
        case 'lasso':
          out.push({ kind: 'monsters', key: 'targets', label: 'Какого монстра притянуть', min: 1, max: 1, cands: monsters() })
          break
        case 'camouflage':
          out.push({ kind: 'monsters', key: 'targets', label: 'Монстр перед вами (не Босс)', min: 1, max: 1,
            cands: p.monsters.filter((m) => !monsterDef(m.id).boss).map((m) => m.id) })
          break
        case 'removeMarkers':
          out.push({ kind: 'tile', key: 'tile', label: 'Тайл с жетонами',
            cands: s.tiles.filter((t) => t.markers > 0 && (e.where === 'anyTile' || inRange(p.pos, t, r))).map(xy) })
          break
        case 'mortar':
          out.push({ kind: 'mode', key: 'mode', label: 'Мортира', labels: ['Очистить тайл от жетонов', `${e.amount} урона всем на тайле`] })
          out.push({ kind: 'tile', key: 'tile', label: 'Тайл', cands: s.tiles.filter((t) => inRange(p.pos, t, r)).map(xy) })
          break
        case 'nailBomb':
          out.push({ kind: 'mode', key: 'mode', label: 'Бомба с гвоздями', labels: [`До ${e.maxTargets} врагов по ${e.amount} урона`, 'Очистить соседний тайл'] })
          if (params.mode) out.push({ kind: 'tile', key: 'tile', label: 'Соседний тайл', cands: s.tiles.filter((t) => dist(t, p.pos) === 1).map(xy) })
          else out.push({ kind: 'monsters', key: 'targets', label: `Цели (до ${e.maxTargets})`, min: 1, max: e.maxTargets, cands: monsters() })
          break
        case 'teleportPlayer':
          out.push({ kind: 'player', key: 'players', label: 'Кого переместить', figure: false, cands: playersIn(() => true) })
          out.push({ kind: 'tile', key: 'tile', label: 'Куда (исследованный тайл)', cands: s.tiles.filter((t) => t.revealed).map(xy) })
          break
        case 'pullPlayer':
          out.push({ kind: 'player', key: 'players', label: 'Кого подтянуть', figure: false, cands: playersIn((q) => q !== p && inRange(p.pos, q.pos, r)) })
          break
        case 'reveal':
          out.push({ kind: 'tiles', key: 'tiles', label: `Открыть тайлы (${e.n})`, n: e.n,
            cands: s.tiles.filter((t) => !t.revealed && (e.adjacent ? dist(t, p.pos) === 1 : range ? inRange(p.pos, t, r) : true)).map(xy) })
          break
        case 'lendActions':
          out.push({ kind: 'player', key: 'players', label: 'Какой игрок', figure: false, cands: playersIn((q) => q !== p) })
          break
        case 'reload':
          out.push({ kind: 'weapon', key: 'weapon', label: 'Какое оружие зарядить',
            cands: p.equip.filter((x) => cardDef(x.id).gear?.ammo !== undefined).map((x) => x.id) })
          break
        case 'reloadAny':
          out.push({ kind: 'weapon', key: 'weapon', label: 'Оружие на вашем тайле',
            cands: living(s).filter((q) => inRange(p.pos, q.pos, r)).flatMap((q) => q.equip.filter((x) => cardDef(x.id).gear?.ammo !== undefined).map((x) => x.id)) })
          break
        case 'attachMod':
          out.push({ kind: 'weapon', key: 'weapon', label: 'На какое оружие',
            cands: e.mod === 'notch'
              ? p.equip.filter((x) => cardDef(x.id).gear?.ammo !== undefined).map((x) => x.id)
              : living(s).filter((q) => inRange(p.pos, q.pos, r)).flatMap((q) => q.equip.filter((x) => cardDef(x.id).gear?.action).map((x) => x.id)) })
          break
        case 'focusedShot':
          out.push({ kind: 'weapon', key: 'weapon', label: 'Из какого оружия (1 патрон)',
            cands: p.equip.filter((x) => cardDef(x.id).gear?.ammo !== undefined && x.ammo > 0).map((x) => x.id) })
          out.push({ kind: 'monsters', key: 'targets', label: 'Цель', min: 1, max: 1, cands: monsters() })
          break
        case 'gearFromDiscard':
          out.push({ kind: 'card', key: 'card', label: 'Снаряжение из сброса',
            cands: [...s.findDiscard, ...s.players.flatMap((q) => q.discard)].filter((id) => cardDef(id).gear) })
          break
        case 'replayInstant':
          out.push({ kind: 'card', key: 'card', label: 'Мгновенная карта из вашего сброса', inner: true,
            cands: p.discard.filter((id) => cardDef(id).type === 'instant' && cardDef(id).effect?.length) })
          break
        case 'equipFromOther':
          out.push({ kind: 'card', key: 'card', label: 'Снаряжение другого игрока',
            cands: living(s).filter((q) => q !== p && inRange(p.pos, q.pos, r)).flatMap((q) => q.equip.map((x) => x.id)) })
          break
        case 'retrieveDiscard':
          if (p.discard.length) out.push({ kind: 'card', key: 'card', label: 'Карта из вашего сброса', cands: [...p.discard] })
          break
        case 'cureOrHunger':
          out.push({ kind: 'mode', key: 'mode', label: 'Пестик и ступка', labels: ['Вылечить состояния', `Голод −${e.hunger}`] })
          break
      }
    }
  }
  walk(effs)
  // Режим всегда спрашиваем первым
  return [...out.filter((x) => x.kind === 'mode'), ...out.filter((x) => x.kind !== 'mode')]
}

/** Подпись монстра для списка целей: «Зомби пёс (у Игрок2) 3/5» */
export function monsterLabel(s: GameState, id: string) {
  const own = monsterOwner(s, id)
  const d = monsterDef(id)
  const m = own?.p.monsters[own.idx]
  return `${d.name}${own ? ` (у ${own.p.name})` : ''} ${d.hp - (m?.wounds ?? 0)}/${d.hp}`
}

export const figureChoices = (q: PlayerState) => q.figures.map((f, i) => ({ i, name: f.name, alive: f.alive })).filter((f) => f.alive)
