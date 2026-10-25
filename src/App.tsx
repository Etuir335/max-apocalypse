import { lazy, Suspense, useCallback, useState } from 'react'
import { tgStartRoom, useTelegramBack } from './telegram'
import { assetUrl } from './assets'
import Gallery from './ui/Gallery'
import Game from './ui/Game'
import Setup from './ui/Setup'
import { ImagesProvider } from './ui/images'
import { ZoomProvider } from './ui/common'
import { useLocalGame } from './ui/store'

// сетевую часть (Firebase) грузим только когда она нужна
const NetPlay = lazy(() => import('./ui/NetPlay'))

type Screen = 'menu' | 'gallery' | 'setup' | 'game' | 'net'

export default function App() {
  const store = useLocalGame()
  // пришли по приглашению в комнату — сразу в сетевую игру
  const [screen, setScreen] = useState<Screen>(tgStartRoom() ? 'net' : store.state ? 'game' : 'menu')
  const toMenu = useCallback(() => setScreen('menu'), [])
  useTelegramBack(screen === 'menu' ? null : toMenu)

  return (
    <ImagesProvider>
      <ZoomProvider>
      {screen === 'gallery' && <Gallery onBack={() => setScreen('menu')} />}
      {screen === 'net' && (
        <Suspense fallback={<p className="loading">Загрузка…</p>}>
          <NetPlay onBack={() => setScreen('menu')} />
        </Suspense>
      )}
      {screen === 'setup' && (
        <Setup
          onBack={() => setScreen('menu')}
          onCreate={(a) => {
            store.reset()
            const err = store.dispatch(a)
            if (!err) setScreen('game')
            return err
          }}
        />
      )}
      {screen === 'game' && store.state && <Game store={store} onMenu={() => setScreen('menu')} />}
      {(screen === 'menu' || (screen === 'game' && !store.state)) && (
        <div className="page" style={{ backgroundImage: `url(${assetUrl('assets/ui/bg-menu.png')})` }}>
          <div className="overlay menu">
            <h1 className="title">
              <img className="logo" src={assetUrl('assets/ui/logo.webp')} alt="Максимум Апокалипсис" />
            </h1>
            <p className="subtitle">кооперативное выживание</p>
            <div className="menu-buttons">
              {store.state && (
                <button className="btn primary" onClick={() => setScreen('game')}>
                  Продолжить партию
                </button>
              )}
              <button className="btn primary" onClick={() => setScreen('setup')}>
                Новая игра (на одном устройстве)
              </button>
              <button className="btn primary" onClick={() => setScreen('net')}>
                Игра по сети
              </button>
              <button className="btn" onClick={() => setScreen('gallery')}>
                Галерея карт
              </button>
            </div>
          </div>
        </div>
      )}
      </ZoomProvider>
    </ImagesProvider>
  )
}
