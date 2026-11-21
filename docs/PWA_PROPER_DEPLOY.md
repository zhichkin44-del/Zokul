# Proper PWA — Test Deploy & Rollback Guide (PWA-PROPER-001)

The code lives on the branch `feature/pwa-proper`. Production is currently on the emergency-killer.
This guide is for ONE test deployment of the proper PWA, followed by manual
testing on iPhone/Safari. If the test fails — roll back (see the Rollback block).

## A. Preparation (locally, D:\zokul)

```powershell
cd D:\zokul\client

# 1. Switch the SW to the proper implementation
npm run sw:proper

# 2. Build the proper bundle (sw:proper is already called inside build:proper, but the explicit step is safe)
npm run build:proper
# expected: dist/sw.js ~43 kB, precache 7 entries, __WB_MANIFEST consumed

# 3. Check that sw.ts is really the proper one (optional)
Select-String -Path sw.ts -Pattern "precacheAndRoute\("
```

## B. Deploy to production

```powershell
cd D:\zokul
# commit the switch (sw.ts is now proper) — only as part of this test
git add -A
git commit -m "PWA-PROPER test deploy - sw:proper"

# build the release package (keeps ssl/ and .env)
.\scripts\prepare-release.ps1

cd D:\zokul-deploy
git add -A
git commit -m "PWA-PROPER test deploy"
git push origin master:production --force
```

```bash
# On the server
ssh root@zokul.example.com
cd ~/zokul
git fetch origin
git reset --hard origin/production
docker compose -f docker-compose.prod.yml up -d --build
```

## C. curl checks after deployment (from the server)

```bash
# SW and manifest — no-store (not aggressively cached by the browser)
curl -kI https://localhost/sw.js
curl -kI https://localhost/registerSW.js
curl -kI https://localhost/manifest.webmanifest
# expected: Cache-Control: no-store, no-cache, ...

# API is NOT cached (always fresh)
curl -k https://localhost/api/health
curl -kI https://localhost/api/auth/me

# Socket.io is not cached (polling handshake)
curl -k "https://localhost/socket.io/?EIO=4&transport=polling"
```

## D. What to check on iPhone / Safari

1. First visit to https://zokul.example.com — the site loads.
2. Reload (F5 / pull-to-refresh) — NO endless loading, content is fresh.
3. Fully close Safari, reopen it — it works.
4. Login / Logout — the session does not break (auth responses are not served from cache).
5. Socket reconnect — after a network loss the chat reconnects (socket.io is not cached).
6. DevTools (Mac Safari) → Develop → Service Worker → status activated, precache
   contains hashed /assets/*, and NO cached /api/*.

If everything is OK — keep the proper version. If NOT — Rollback (below).

## E. Rollback / Remediation (if the proper PWA hangs on Safari again)

```powershell
cd D:\zokul\client
npm run sw:kill          # put the killer back into sw.ts

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

The killer removes the old caches and unregisters the SW — Safari works again without manually clearing site data.

## F. Return the working tree to the killer after the test (mandatory)

Regardless of the test result, leave the local tree on the killer:

```powershell
cd D:\zokul\client
npm run sw:kill
cd D:\zokul
git status      # should be clean (sw.ts is already the killer)
```
