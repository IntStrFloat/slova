import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const isYandexGames = process.env.EXPO_PUBLIC_GAME_PLATFORM === 'yandex-games';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <meta name="theme-color" content="#101826" />
        <ScrollViewStyleReset />
        {isYandexGames ? (
          <>
            <base id="yandex-runtime-base" />
            <script
              dangerouslySetInnerHTML={{
                __html: `(() => {
                  const originalPath = window.location.pathname;
                  const versionDirectory = originalPath.slice(0, originalPath.lastIndexOf('/') + 1);
                  const base = document.getElementById('yandex-runtime-base');
                  if (base) base.setAttribute('href', window.location.origin + versionDirectory);
                  if (originalPath !== '/') {
                    const state = { ...(window.history.state || {}), yandexVersionDirectory: versionDirectory };
                    window.history.replaceState(state, '', '/' + window.location.search + window.location.hash);
                  }
                  document.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });
                })();`,
              }}
            />
            <script src="/sdk.js" />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.__YANDEX_GAMES_SDK_PROMISE__ = new Promise((resolve, reject) => {
                  const deadline = Date.now() + 10000;
                  const initialize = () => {
                    if (window.YaGames) {
                      Promise.resolve(window.YaGames.init()).then((sdk) => {
                        window.__YANDEX_GAMES_LANGUAGE__ = sdk.environment?.i18n?.lang || 'ru';
                        resolve(sdk);
                      }, reject);
                    } else if (Date.now() < deadline) {
                      window.setTimeout(initialize, 25);
                    } else {
                      reject(new Error('YaGames loader timed out'));
                    }
                  };
                  initialize();
                });
                window.__YANDEX_GAME_READY_PROMISE__ = window.__YANDEX_GAMES_SDK_PROMISE__.then((sdk) => {
                  const ready = sdk.features?.LoadingAPI?.ready;
                  return Promise.resolve(ready ? ready.call(sdk.features.LoadingAPI) : undefined).then(() => {
                    window.__YANDEX_GAME_READY_CALLED__ = true;
                  });
                });`,
              }}
            />
          </>
        ) : null}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body, #root { width: 100%; height: 100%; margin: 0; }
              html { background: #101826; }
              body {
                display: flex;
                justify-content: center;
                overflow: hidden;
                user-select: none;
                -webkit-user-select: none;
                -webkit-touch-callout: none;
                background:
                  radial-gradient(circle at 18% 18%, rgba(75, 95, 135, .55), transparent 35%),
                  radial-gradient(circle at 82% 82%, rgba(94, 42, 128, .42), transparent 38%),
                  #101826;
              }
              #root { width: 100%; max-width: 640px; overflow: hidden; box-shadow: 0 0 80px rgba(0,0,0,.42); }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
