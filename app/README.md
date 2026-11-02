# Игры KIBERone: приложение

Запускает игры из файлов `.kibgames` в песочнице: без сети, без доступа к файлам и устройствам, без следов на диске. Архитектура: `../docs/adr/0001-prilozhenie-kibgames.md`.

Нужен Node 22.12 или новее.

| Команда | Что делает |
| --- | --- |
| `npm ci` | Ставит зависимости |
| `npm test` | Проверяет формат `.kibgames` |
| `npm run test:redteam` | Тест-«взломщик» на Linux с захватом трафика |
| `node redteam/run.js --portable` | Тот же тест на Windows, без захвата трафика (К4) |
| `npx electron . игра.kibgames` | Запускает игру из исходников |
| `npm run build:win-dir` | Собирает папку для Windows `dist/win-unpacked`, можно на Linux |
| `npm run build:win` | Собирает установщик. Нужна Windows или Wine, см. `../.github/workflows/build-windows.yml` |
| `node scripts/make-test-kit.js` | Собирает комплект для проверки на Windows |

## Как выпустить игру

В папке игры должен лежать `kibgame.json` (пример: `../games/kiberpochta/kibgame.json`).

```bash
npm run kibpack -- keygen vlad
npm run kibpack -- pack ../games/kiberpochta --key ~/.config/kibgames/keys/vlad.key.pem
npm run kibpack -- verify kiberpochta-1.0.0.kibgames
```

Закрытый ключ нельзя никому передавать и класть в репозиторий. При его потере обновления игр придётся ставить как новые игры, поэтому сделайте резервную копию.

Школа отмечает авторов, которым доверяет, в файле `%APPDATA%\Игры KIBERone\trusted-keys.json`: `{ "отпечаток ключа": "Имя" }`. Отпечаток показывает `kibpack verify`. Игры остальных авторов запускаются только после предупреждения.
