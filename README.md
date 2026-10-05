# PITLANE Web

Отдельный веб-продукт (phone + desktop): паспорт машины → лог круга (GPX/CSV) → дельта к себе и к связке машина+трек+резина → экипаж → дуэль.

Не Mini App. Не iOS/Android. Telegram не обязателен.

## Стек

- **Клиент:** Vite + React + React Router  
- **Сервер:** Express  
- **БД:** SQLite (`better-sqlite3`) в `data/pitlane.sqlite`  
- **Auth:** email magic link (в MVP без SMTP — ссылка показывается в UI)  
- **Парсер:** GPX (точки + time, детекция кругов по возврату к старту) и CSV (`lap,time,s1,s2,s3`)

## Локальный запуск

```bash
npm install
npm install --prefix client
npm run seed
npm run dev
```

- UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:8787  

Прод-сборка (один процесс раздаёт UI + API):

```bash
npm run build
npm start
```

## Как войти

1. Откройте `/auth`  
2. Введите email (для демо: `demo@pitlane.local`)  
3. Нажмите «Получить ссылку» → «Открыть magic link»  
4. SMTP нет: ссылка выдаётся сразу в интерфейсе  

Демо-экипаж: инвайт-код `DEMOCREW`.

## Критерий готовности

Новый юзер: заводит машину → создаёт сессию → грузит GPX/CSV или вводит круг → видит лучший круг и Δ к себе → зовёт второго в экипаж → сравнивает две сессии одного трека в Дуэли.

## Парсер GPX — что умеет

- Читает `trkpt` / `rtept` с `lat`, `lon`, `time`  
- Детектит круги: возврат в ~25 м от старта после ≥800 м  
- Секторы: 3 равных по длине пути отрезка круга  
- Если круги не нашлись, но трасса длинная — один круг целиком  
- Fallback: ручной ввод `m:ss.mmm` или CSV  


## Публичный URL

**https://pitlane-web.pitlane-taksimaga.workers.dev**

Провайдер: Cloudflare Workers + KV (assets SPA).  
Вход: `/auth` → `demo@pitlane.local` → «Получить ссылку» → «Открыть magic link».

Деплой:
```bash
npm run build
npx wrangler deploy
```

## Ограниции MVP

- Нет реального SMTP (magic link в UI)  
- Нет фонового GPS / OBD / голоса / сима / оплаты / ленты / чата / 3D  
- Секторы — по дистанции, не по трек-маршалам  
- Топ только при фильтре модель+резина и флаге «в зачёт»  
- Деплой: Node-хост; GH Pages — только статика (нужен API отдельно)

## Коммиты

`Grok Bot <bot@pitlane.local>`
