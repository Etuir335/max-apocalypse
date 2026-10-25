// Проверка сети на живом Firebase: два анонимных игрока, комната, ход, правила доступа.
// Запуск: node --env-file=.env.local scripts/net-check.ts
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, setDoc, updateDoc } from 'firebase/firestore'
import { reduce, tryReduce } from '../src/game/engine.ts'
import type { Action } from '../src/game/types.ts'

const config = {
  apiKey: process.env.VITE_FB_API_KEY!,
  authDomain: process.env.VITE_FB_AUTH_DOMAIN!,
  projectId: process.env.VITE_FB_PROJECT_ID!,
  appId: process.env.VITE_FB_APP_ID!,
}
let failed = 0
const ok = (c: unknown, name: string) => {
  console.log(`${c ? 'OK  ' : 'FAIL'} ${name}`)
  if (!c) failed++
}
const denied = async (p: Promise<unknown>) => p.then(() => false, (e: { code?: string }) => e.code === 'permission-denied')

async function client(name: string) {
  const app = initializeApp(config, name)
  const user = (await signInAnonymously(getAuth(app))).user
  return { db: getFirestore(app), uid: user.uid }
}

const A = await client('host')
const B = await client('guest')
ok(A.uid && B.uid && A.uid !== B.uid, 'два анонимных входа')

const code = 'T' + Math.random().toString(36).slice(2, 6).toUpperCase()
const room = (db = A.db) => doc(db, 'coop', code)
await setDoc(room(), { code, host: A.uid, status: 'lobby', missionId: 'm0', hardcore: false, bots: [], state: null, v: 0, createdAt: Date.now() })
await setDoc(doc(A.db, 'coop', code, 'members', A.uid), { uid: A.uid, name: 'Хост', hero: 'firefighter', joinedAt: Date.now() })
ok((await getDoc(room(B.db))).exists(), 'гость видит комнату')
await setDoc(doc(B.db, 'coop', code, 'members', B.uid), { uid: B.uid, name: 'Гость', hero: 'surgeon', joinedAt: Date.now() })
ok(true, 'гость записал себя в участники')

ok(await denied(updateDoc(room(B.db), { missionId: 'm5' })), 'гость НЕ может менять комнату')
ok(await denied(setDoc(doc(B.db, 'coop', code, 'members', A.uid), { uid: A.uid, name: 'взлом', hero: 'x', joinedAt: 0 })), 'гость НЕ может писать за хоста')
ok(await denied(addDoc(collection(B.db, 'coop', code, 'actions'), { uid: A.uid, action: '{}', clientAt: 0 })), 'гость НЕ может слать ход от имени хоста')

// Хост начинает партию
let s = reduce(null, { type: 'create', seed: 1, missionId: 'm0', players: [
  { uid: A.uid, name: 'Хост', hero: 'firefighter' }, { uid: B.uid, name: 'Гость', hero: 'surgeon' }] })
await updateDoc(room(), { status: 'game', state: JSON.stringify(s), v: 1 })
const seen = JSON.parse((await getDoc(room(B.db))).data()!.state)
ok(seen.players.length === 2 && seen.players[1].uid === B.uid, 'гость получил состояние партии')

// Гость шлёт ход (замена карт), хост применяет
const act: Action = { type: 'mulligan', seat: 1, cards: [] }
await addDoc(collection(B.db, 'coop', code, 'actions'), { uid: B.uid, action: JSON.stringify(act), clientAt: Date.now() })
const queue = await getDocs(collection(A.db, 'coop', code, 'actions'))
ok(queue.size === 1, 'хост видит ход гостя в очереди')
const q = queue.docs[0]
const r = tryReduce(s, JSON.parse(q.data().action))
ok(!r.error && r.state, 'ход гостя проходит через движок')
s = r.state!
await updateDoc(room(), { state: JSON.stringify(s), v: 2 })
await deleteDoc(q.ref)
ok((await getDocs(collection(A.db, 'coop', code, 'actions'))).size === 0, 'хост убрал ход из очереди')
ok(JSON.parse((await getDoc(room(B.db))).data()!.state).players[1].mulliganDone === true, 'гость видит результат своего хода')
const size = (await getDoc(room())).data()!.state.length
console.log(`Размер состояния в документе: ${size} символов`)

// уборка
for (const uid of [A.uid, B.uid]) await deleteDoc(doc(uid === A.uid ? A.db : B.db, 'coop', code, 'members', uid))
await deleteDoc(room())
console.log(failed ? `Провалено: ${failed}` : 'Сеть работает')
process.exit(failed ? 1 : 0)
