# ♞ Chess Puzzles

Шахматные головоломки из реальных партий — с серией побед, инструментами анализа
и подсветкой ходов. Сделано как iOS-приложение (Swift + WKWebView), IPA собирается
автоматически в GitHub Actions.

## Скачать

Готовый неподписанный IPA (arm64, iOS 15+):

```
https://github.com/sqwxxg-dev/chess-puzzles/releases/latest/download/chess-puzzles-unsigned.ipa
```

Подписать: **Sideloadly**, **iLoader**, AltStore, TrollStore и т.п.
(Apple ID бесплатный → приложение живёт 7 дней, платный аккаунт → год).

## Что внутри

- 4400 головоломок из базы Lichess (CC0), реальные партии;
- 4 уровня сложности (слайдер): лёгкий / средний / сложный / очень сложный;
- серия побед: одна ошибка — сброс;
- инструменты в лайв-тайме: заметки-крестики, стрелки (как на Lichess), ластик;
- панель инструментов слева или справа (в настройках);
- вибрация + «отскок» фигуры при неверном ходе;
- подсветка хода соперника синим + показ съеденных фигур;
- кнопка «Посмотреть решение» (серия сбрасывается) и «Перейти к след. головоломке»;
- стрелки ← → для просмотра сыгранных ходов после решения;
- статистика: решено всего, текущая и лучшая серия.

## Структура

```
ios/ChessPuzzles/            Swift-оболочка (WKWebView + мост для вибрации/хранения)
ios/ChessPuzzles/web/        само приложение (HTML/CSS/JS + chess.js)
ios/ChessPuzzles.xcodeproj   проект Xcode (открывается на macOS)
scripts/build_puzzles.py     генератор базы головоломок из дампа Lichess
.github/workflows/           сборка unsigned IPA
```

## Собрать IPA самому

macOS + Xcode:

```bash
xcodebuild -project ios/ChessPuzzles.xcodeproj -target ChessPuzzles \
  -configuration Release -sdk iphoneos SYMROOT="$PWD/build" \
  CODE_SIGNING_ALLOWED=NO build
mkdir -p Payload && cp -R build/Release-iphoneos/ChessPuzzles.app Payload/
zip -qry chess-puzzles-unsigned.ipa Payload
```

## Обновить базу головоломок

```bash
curl -L -o puzzles.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst
python scripts/build_puzzles.py puzzles.csv.zst
```

## Проверить веб-часть в браузере

```bash
cd ios/ChessPuzzles/web && python -m http.server 8000
```

## Лицензии

- головоломки: [Lichess puzzle database](https://database.lichess.org/#puzzles) — CC0;
- фигуры: cburnett (GPLv2+/CC-BY-SA), через lichess-org/lila;
- шахматная логика: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause).
