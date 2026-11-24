# AppLovin test ad в эмуляторе: проверка релиза

Проверено 16 ноября 2026 года. Приложение `com.intstrfloat.slova`, подписанная версия **0.1.30 / 34**, запущенная пользователем на Android Emulator.

**В проверенной сборке не найдено случайного переключения всех рекламных блоков на тестовые.** Встроенный Hermes bundle из настоящих APK и AAB содержит производственные ID:

| Размещение | ID |
|---|---|
| Баннер | `R-M-20249615-1` |
| Межстраничная | `R-M-20249615-3` |
| За награду | `R-M-20249615-2` |

В исполняемом bundle отсутствуют `demo-banner-yandex`, `demo-interstitial-yandex`, `demo-rewarded-yandex`, `demo-interstitial-applovin`. Поиск в собственном коде провайдера, config plugin и Android wrapper не обнаружил вызовов включения AppLovin test mode или установки test device advertising IDs. `fakeRewardedInDev` выключен. В APK не выставлен `application-debuggable`.

В исходном `env.ts` тестовые ID выбираются только для `__DEV__` или явного `EXPO_PUBLIC_YANDEX_TEST_ADS=1`. Этот путь нужен отдельным QA-сборкам; его нельзя удалять ради показа настоящей рекламы в эмуляторе. Встроенные в проверенный release байты подтверждают производственный выбор независимо от текущего `.env`.

AppLovin документирует **автоматическое включение тестовой рекламы на эмуляторах** в официальном [описании SDK 11.4.4](https://github.com/AppLovin/AppLovin-MAX-SDK-Android/releases/tag/release_11_4_4). Поэтому экран MAX «You're seeing a test ad» на эмуляторе соответствует поведению рекламной сети и сам по себе не доказывает, что реальные пользователи получают тестовую рекламу.

По актуальной [инструкции AppLovin Test mode](https://support.applovin.com/en/max/android/testing-networks/test-mode), test mode также может включаться через Mediation Debugger или список тестовых advertising IDs. Его runtime-признак — `Test Mode On: true` в логе инициализации. Наличие `MaxDebuggerTestModeNetworkActivity` в manifest означает встроенный инструмент SDK, а не активированный тестовый режим.

В этой проверке настройки внешнего кабинета AppLovin и runtime-лог конкретного показа отдельно не читались. Поэтому точную причину именно этого callback не объявляем доказанной: автоматическое распознавание эмулятора — подтверждённое SDK-поведение и наиболее соответствующее наблюдению объяснение. Для проверки production-доставки нужен разрешённый обычный телефон, который не зарегистрирован как тестовый. Тестовую классификацию эмулятора не обходить; искусственные просмотры не являются проверкой дохода.

## Повторяемая проверка перед выпуском

Добавлен read-only guard без сторонних зависимостей:

```text
python scripts/verify-release-ad-units.py output/release/slova-0.1.30-vc34-release.apk
python scripts/verify-release-ad-units.py output/release/slova-0.1.30-vc34-rustore.aab
python scripts/__tests__/test_release_ad_units.py
```

Он проверяет именно единственный встроенный Hermes bundle, присутствие трёх ожидаемых production ID и отсутствие demo ID. Он отклоняет неоднозначный архив с дублированным bundle. Это статическая проверка артефакта; она не удостоверяет настройки внешнего кабинета, фактический fill или доход сети.

Проверенные байты:

- APK SHA-256: `48ddac9cf5a914f882abd89f43966f33af31d4eaa8724aba70e94bb0dfb058c6`.
- AAB SHA-256: `bb3773238e15a26dd33d6f5b5ccc5eb0abf486d50d34f0d55125cca66b1f33bb`.
- Одинаковый embedded Hermes SHA-256: `40cd0621880df3621da3d75a2a3af4b125eabe09c1f4a491e6b6b14acb4dd974`.
- Пять тестов guard прошли; SDK/провайдер и настройки рекламы не изменялись.
