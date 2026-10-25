// Подключение к Firebase. Настройки — в .env.local (VITE_FB_*), см. NOTES.md. Без них сетевая игра выключена.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const env = import.meta.env
const config = {
  apiKey: env.VITE_FB_API_KEY as string | undefined,
  authDomain: env.VITE_FB_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FB_PROJECT_ID as string | undefined,
  appId: env.VITE_FB_APP_ID as string | undefined,
}

export const netConfigured = () => !!(config.apiKey && config.projectId && config.appId)

let app: FirebaseApp | null = null
let db: Firestore | null = null

function init() {
  if (!netConfigured()) throw new Error('Сетевая игра не настроена (нет ключей Firebase в .env.local)')
  if (!app) {
    app = initializeApp(config as Record<string, string>)
    db = getFirestore(app)
  }
  return { app: app!, db: db! }
}

export const getDb = () => init().db

let userPromise: Promise<User> | null = null

/** Анонимный вход (один раз за запуск). Возвращает пользователя с постоянным uid на этом устройстве. */
export function ensureUser(): Promise<User> {
  if (userPromise) return userPromise
  const auth = getAuth(init().app)
  userPromise = new Promise<User>((resolve, reject) => {
    const off = onAuthStateChanged(auth, (u) => {
      if (u) {
        off()
        resolve(u)
      }
    })
    signInAnonymously(auth).catch((e) => {
      off()
      userPromise = null
      reject(e)
    })
  })
  return userPromise
}
