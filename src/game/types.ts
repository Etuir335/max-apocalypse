// Типы игры: описание карт (данные) и состояние партии (одно на всю игру, хранится в Firestore).

export type Range = 'short' | 'medium' | 'long'
export type Color = 'red' | 'green' | 'blue'
export type MonsterSet = 'Z' | 'A' | 'R' | 'M'
export interface XY {
  x: number
  y: number
}

// ---------- Эффекты карт выживших, находок и персонажей ----------

export type Cond = 'companionAlive' | 'companionDead' | 'hasLighter' | 'hasBow'

/** Один шаг эффекта. Числа — здесь, логика — в engine/effects.ts. */
export type Eff =
  | { k: 'damage'; amount: number; targets?: number; stun?: boolean; extraPerAmmo?: boolean }
  | { k: 'damageAll'; amount: number; players?: number }
  | { k: 'splash'; main: number; other: number; maxOther?: number; scope: 'front' | 'tile' | 'range' }
  | { k: 'heal'; amount: number; target: 'self' | 'any' | 'range' }
  | { k: 'healCompanion'; amount: number }
  | { k: 'healBoth'; amount: number }
  | { k: 'hunger'; amount: number; who: 'self' | 'all' }
  | { k: 'draw'; n: number }
  | { k: 'drawFinds'; n: number; keep: number }
  | { k: 'stun' }
  | { k: 'stunAll' }
  | { k: 'removeMarkers'; where: 'anyTile' | 'range'; count: number | 'all'; takeMonster?: boolean }
  | { k: 'mortar'; amount: number }
  | { k: 'nailBomb'; amount: number; maxTargets: number }
  | { k: 'buff'; amount: number; until: 'endTurn' | 'nextTurn'; who: 'self' | 'all' }
  | { k: 'move'; steps: number }
  | { k: 'teleportPlayer' }
  | { k: 'pullPlayer' }
  | { k: 'reveal'; n: number; adjacent: boolean }
  | { k: 'lendActions'; n: number; playOnly?: boolean }
  | { k: 'extraActions'; n: number }
  | { k: 'reload'; amount: number | 'full' }
  | { k: 'reloadAny' }
  | { k: 'attachMod'; mod: 'upgrade' | 'notch' }
  | { k: 'flare' }
  | { k: 'lasso' }
  | { k: 'camouflage'; selfDamage: number }
  | { k: 'gearFromDiscard'; toPlay: boolean }
  | { k: 'replayInstant' }
  | { k: 'equipFromOther' }
  | { k: 'findAxe' }
  | { k: 'drawMonster' }
  | { k: 'cure'; scope: 'self' | 'range' }
  | { k: 'cureOrHunger'; hunger: number }
  | { k: 'flamingGuns'; base: number }
  | { k: 'focusedShot'; amount: number }
  | { k: 'bodySearch' }
  | { k: 'noStarve' }
  | { k: 'selfDamage'; who: 'main' | 'companion'; amount: number }
  | { k: 'companionImmune' }
  | { k: 'retrieveDiscard' }
  | { k: 'if'; cond: Cond; then: Eff[] }

export interface Passive {
  reduceDamage?: number
  reduceMainDamage?: number
  reduceCompanionDamage?: number
  damageBonus?: number
  healBonus?: number
  statusImmune?: boolean
  stealthBonus?: number
  extraSlots?: number
  flashlight?: boolean
  turret?: number
  mine?: number
  ladder?: boolean
  jacket?: boolean
  scientist?: boolean
}

export interface GearDef {
  slots: number
  /** боезапас (синие патроны) */
  ammo?: number
  /** заряд топливом (канистра): перезаряжается только картой топлива */
  fuel?: number
  action?: Eff[]
  onEquip?: Eff[]
  onDiscard?: Eff[]
  passive?: Passive
}

export type FindKind =
  | 'food'
  | 'fuel'
  | 'ammo'
  | 'meds'
  | 'antidote'
  | 'ambush'
  | 'empty'
  | 'newspaper'
  | 'blanket'
  | 'book'
  | 'parts'
  | 'pistol'
  | 'radio'
  | 'binoculars'
  | 'flashlight'
  | 'backpack'
  | 'scientist'

export interface CardDef {
  key: string
  name: string
  /** cardId картинок; копии карты по очереди берут картинки из списка */
  images: number[]
  copies: number
  group: 'survivor' | 'find'
  /** колода персонажа (для карт выживших) */
  deck?: HeroDeck
  type: 'instant' | 'gear'
  range?: Range
  effect?: Eff[]
  gear?: GearDef
  find?: FindKind
  /** число на кружке еды/патронов */
  value?: number
  text: string
}

// ---------- Персонажи ----------

export type HeroDeck = 'veteran' | 'firefighter' | 'surgeon' | 'mechanic' | 'hunter' | 'gunslinger'

export interface FigureDef {
  name: string
  hp: number
  stealth: number
  stealthTired: number
  image: number
  companion?: boolean
  slots: number
}

export interface CharacterDef {
  key: string
  name: string
  deck: HeroDeck
  figures: FigureDef[]
  ability: { name: string; range?: Range; action?: Eff[]; passive?: 'colt' | 'hunterFind'; text: string }
}

// ---------- Монстры ----------

export type MEff =
  | { k: 'drawMonster' }
  | { k: 'markersAdjacent' }
  | { k: 'gearOrDamage'; amount: number }
  | { k: 'findOrDamage'; amount: number }
  | { k: 'poison' }
  | { k: 'burn'; n: number }
  | { k: 'allDiscardGear' }
  | { k: 'healAliens' }
  | { k: 'discardHand' }
  | { k: 'discardAllAmmo' }
  | { k: 'destroyAllAmmo' }

export interface MonsterDef {
  key: string
  name: string
  set: MonsterSet
  hp: number
  dmg: number
  range?: Range
  attackAll?: boolean
  boss?: boolean
  images: number[]
  entry?: MEff[]
  attack?: MEff[]
  onDeath?: number
  passive?: 'queen' | 'alienBoost' | 'noShort' | 'phalanx' | 'noSneak' | 'stalker' | 'idleKiller'
  /** имя для миссии «Собрать образцы» */
  sample?: string
  text: string
}

// ---------- Тайлы ----------

export type TEff =
  | { k: 'endTurn' }
  | { k: 'loseAction' }
  | { k: 'discardCards'; n: number }
  | { k: 'markersAdjacent' }
  | { k: 'hunger'; n: number }
  | { k: 'draw'; n: number }
  | { k: 'allLoseGear' }
  | { k: 'burn'; n: number }
  | { k: 'discardFood' }
  | { k: 'poison' }
  | { k: 'allDrawMonster' }
  | { k: 'drawMonster' }
  | { k: 'freeSearch' }
  | { k: 'heal'; n: number }
  | { k: 'gearOrDamage'; n: number }
  | { k: 'damageFrontMonsters'; n: number }

export interface TileDef {
  key: string
  name: string
  colors: Color[]
  spawn: number
  image: number
  reveal?: TEff[]
  enter?: TEff[]
  end?: TEff[]
  special?: 'airport' | 'tunnel' | 'forest' | 'river' | 'shelter' | 'van'
  text: string
}

// ---------- Состояние партии ----------

export interface Figure {
  name: string
  hp: number
  maxHp: number
  alive: boolean
  companion: boolean
  slots: number
  /** Пёс невосприимчив к урону до следующего хода */
  immune: boolean
}

export interface Equip {
  id: string
  ammo: number
  dmgMod: number
  notch: boolean
  /** карты-модификаторы, лежащие на оружии */
  attached: string[]
}

export interface MonsterInst {
  id: string
  wounds: number
  stunnedBy: number | null
}

export interface PlayerState {
  seat: number
  uid: string
  name: string
  hero: string
  figures: Figure[]
  hunger: number
  exhausted: boolean
  starve: number
  poison: number
  pos: XY
  hand: string[]
  deck: string[]
  discard: string[]
  equip: Equip[]
  monsters: MonsterInst[]
  alive: boolean
  noStarve: boolean
  mulliganDone: boolean
  startPos: XY
  /** уровень бота (1–3); нет — человек */
  bot?: number
}

export interface TileInst {
  key: string
  x: number
  y: number
  revealed: boolean
  markers: number
  objective?: number
}

export interface Buff {
  amount: number
  /** чей бонус: номер места или 'all' */
  who: number | 'all'
  /** снимается в начале хода этого места */
  clearAt: number
  endTurn: boolean
}

export interface Pending {
  seat: number
  kind: string
  prompt: string
  options?: string[]
  cards?: string[]
  pick?: number
  data?: Record<string, unknown>
}

export interface TurnState {
  seat: number
  stage: 'actions' | 'end'
  actions: number
  moved: boolean
  freeMoves: number
  noMove: boolean
  searched: string[]
  freeDiscardUsed: boolean
  tradeUsed: boolean
  jacketUsed: boolean
  bodySearch: boolean
  lent: { seat: number; n: number; playOnly: boolean } | null
  endStep: number
  prevPos: XY | null
}

export interface MissionState {
  fuel: number
  delivered: Record<string, number>
  samples: Record<string, number>
  repairs: number
  cleared: number[]
  flags: Record<string, number | boolean>
}

export interface GameState {
  v: 1
  rng: number
  phase: 'setup' | 'play' | 'won' | 'lost'
  result: string
  missionId: string
  monsterSet: MonsterSet
  options: { hardcore: boolean }
  players: PlayerState[]
  tiles: TileInst[]
  monsterDeck: string[]
  monsterDiscard: string[]
  bossAside: string[]
  finds: Record<Color, string[]>
  findDiscard: string[]
  removed: string[]
  dropped: { x: number; y: number; cards: string[] }[]
  mission: MissionState
  buffs: Buff[]
  round: number
  turn: TurnState
  pendings: Pending[]
  log: string[]
  serial: number
}

// ---------- Действия ----------

export interface Params {
  /** id монстров-целей */
  targets?: string[]
  /** места игроков-целей */
  players?: number[]
  /** фигура у цели (0 — основная, 1 — пёс) */
  figure?: number
  tile?: XY
  tiles?: XY[]
  /** id экипировки (своё оружие) */
  weapon?: string
  /** выбор варианта «или» на карте */
  mode?: number
  /** выбранная карта (из сброса, у другого игрока и т.п.) */
  card?: string
  colors?: Color[]
  /** параметры для вложенной карты (Мгновенный повтор) */
  inner?: Params
}

export type Action =
  | {
      type: 'create'
      seed: number
      missionId: string
      players: { uid: string; name: string; hero: string; bot?: number }[]
      hardcore?: boolean
    }
  | { type: 'mulligan'; seat: number; cards: string[] }
  | { type: 'begin'; seat: number; first: number }
  | { type: 'move'; seat: number; to: XY }
  | { type: 'draw'; seat: number }
  | { type: 'play'; seat: number; card: string; params?: Params }
  | { type: 'useGear'; seat: number; equip: string; params?: Params }
  | { type: 'ability'; seat: number; params?: Params }
  | { type: 'search'; seat: number; color?: Color }
  | { type: 'tileAction'; seat: number; to: XY }
  | { type: 'refuel'; seat: number; equip: string; fuel: string }
  | { type: 'discardGear'; seat: number; equip: string; params?: Params }
  | { type: 'jacket'; seat: number }
  | { type: 'freeDiscard'; seat: number; cards: string[] }
  | { type: 'trade'; seat: number; with: number; give: string[]; take: string[] }
  | { type: 'pickUp'; seat: number; cards: string[] }
  | { type: 'deliver'; seat: number; card: string }
  | { type: 'mission'; seat: number; kind: string; to?: XY }
  | { type: 'choose'; seat: number; option?: number; cards?: string[] }
  | { type: 'endTurn'; seat: number }
  /** отказаться от оставшихся одолженных действий */
  | { type: 'pass'; seat: number }
