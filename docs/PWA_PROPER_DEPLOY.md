# Proper PWA — Test Deploy & Rollback Guide (PWA-PROPER-001)

Код лежит в ветке `feature/pwa-proper`. Production сейчас на emergency-killer.
Эта инструкция — для ОДНОГО тестового деплоя proper PWA с последующим ручным
тестированием на iPhone/Safari. Если тест провален — откат (см. блок Rollback).

## A. Подготовка (локально, D:\zokul)

```powershell
cd D:\zokul\client

# 1. Переключить SW на proper-реализацию
npm run sw:proper

# 2. Собрать proper-билд (sw:proper уже вызван внутри build:proper, но явный шаг безопасен)
npm run build:proper
# ожидается: dist/sw.js ~43 kB, precache 7 entries, __WB_MANIFEST consumed

# 3. Проверить, что sw.ts действительно proper (опционально)
Select-String -Path sw.ts -Pattern "precacheAndRoute\("
```

## B. Деплой в production

```powershell
cd D:\zokul
# закоммитить переключение (sw.ts теперь proper) — только в рамках теста
git add -A
git commit -m "PWA-PROPER test deploy - sw:proper"

# собрать release-пакет (сохраняет ssl/ и .env)
.\scripts\prepare-release.ps1

cd D:\zokul-deploy
git add -A
git commit -m "PWA-PROPER test deploy"
git push origin master:production --force
```

```bash
# На сервере
ssh root@zokul.example.com
cd ~/zokul
git fetch origin
git reset --hard origin/production
docker compose -f docker-compose.prod.yml up -d --build
```

## C. curl-проверки после деплоя (с сервера)

```bash
# SW и manifest — no-store (не кешируются браузером агрессивно)
curl -kI https://localhost/sw.js
curl -kI https://localhost/registerSW.js
curl -kI https://localhost/manifest.webmanifest
# ожидаем: Cache-Control: no-store, no-cache, ...

# API НЕ кешируется (всегда свежий)
curl -k https://localhost/api/health
curl -kI https://localhost/api/auth/me

# Socket.io не кешируется (polling handshake)
curl -k "https://localhost/socket.io/?EIO=4&transport=polling"
```

## D. Что проверить на iPhone / Safari

1. Первый заход на https://zokul.example.com — сайт грузится.
2. Reload (F5 / pull-to-refresh) — НЕТ вечной загрузки, контент свежий.
3. Закрыть Safari полностью, открыть снова — работает.
4. Login / Logout — сессия не ломается (auth-ответы не из кэша).
5. Socket reconnect — после потери сети чат переподключается (socket.io не кеширован).
6. DevTools (Mac Safari) → Develop → Service Worker → статус activated, precache
   содержит хешированные /assets/*, НЕТ закешированных /api/*.

Если всё ок — оставляем proper. Если НЕТ — Rollback (ниже).

## E. Rollback / Remediation (если proper PWA снова виснет на Safari)

```powershell
cd D:\zokul\client
npm run sw:kill          # вернуть killer в sw.ts

cd D:\zokul
git add -A
git commit -m "PWA-PROPER rollback - revert to sw:kill"

.\scripts\prepare-release.ps1

cd D:\zokul-deploy
git add -A
git commit -m "PWA-PROPER rollback to killer"
git push origin master:production --force
```

```bash
ssh root@zokul.example.com
cd ~/zokul
git fetch origin
git reset --hard origin/production
docker compose -f docker-compose.prod.yml up -d --build
```

Killer удалит старые кэши и unregister SW — Safari снова рабочий без ручной очистки данных.

## F. Вернуть рабочее дерево в killer после теста (обязательно)

Независимо от результата теста, локально оставляем дерево на killer:

```powershell
cd D:\zokul\client
npm run sw:kill
cd D:\zokul
git status      # должно быть чисто (sw.ts уже killer)
```
