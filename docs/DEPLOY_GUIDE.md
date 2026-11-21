# Deploy Guide — Zokul Production

## 1. Commit changes (in D:\zokul\)

```powershell
git add -A
git commit -m "ZOKUL-XXX - short description"
```

## 2. Check the local build

```powershell
docker compose -f docker-compose.prod.yml build
# If there are errors — fix them before deploying
```

## 3. Prepare the release package

```powershell
.\scripts\prepare-release.ps1
# Copies clean code to D:\zokul-deploy\, preserving ssl/ and .env
```

## 4. Push to GitHub (production branch)

```powershell
cd D:\zokul-deploy
git add -A
git commit -m "ZOKUL-XXX production"
git remote add origin https://github.com/example/zokul.git  # only if not added yet
git push origin master:production --force
```

## 5. Deploy on the server

```bash
ssh root@zokul.example.com
cd ~/zokul
git fetch origin
git reset --hard origin/production
docker compose -f docker-compose.prod.yml up -d --build
```

## Quick check after deployment

```bash
curl -k https://zokul.example.com/api/health
curl -k -i https://zokul.example.com/api/auth/me  # expected: 401 (not 429)
```

## Service Worker / PWA check after deployment

Open https://zokul.example.com in a normal tab (without `?v=...`):
- The site should load and work
- DevTools → Application → Service Workers → status `activated and is running` (or `deactivated` after unregister)

On iPhone/Safari:
- Open https://zokul.example.com — it should work without `?v=clean3`
- Close Safari, open it again — it should still work
- To clear the cache: Safari → Settings → Safari → Advanced → Website Data → Remove All

**If the site does not load:** open `https://zokul.example.com/login?v=clean` — this bypasses the SW.

## Cloudflare Tunnel — main entry without VPN (ZOKUL-NET-001)

The ISP blocks direct TLS to the server's public IP (`203.0.113.10:443`), so without a VPN the site is unavailable. A Cloudflare Tunnel makes the site reachable without a VPN: traffic goes to Cloudflare, not to the public IP.

### Step A. Create the tunnel in Cloudflare (via the UI)

1. Go to **Cloudflare Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Name it `zokul`.
3. In the installation step choose **Docker** and copy the **tunnel token** (a string starting with `eyJ...`).
4. Add a **Public Hostname**:
   - Subdomain: `zokul`, Domain: `example.com`
   - Type: `HTTPS`, URL: `https://localhost:443`
   - (Cloudflare will create the DNS CNAME `zokul.example.com → <tunnel-id>.cfargotunnel.com` automatically)
5. Save.

> If Cloudflare complains about the local nginx certificate, add `originRequest: noTLSVerify: true` to the tunnel config (this is safe — it only covers the local hop to localhost:443, where the certbot certificate is valid).

### Step B. Run the tunnel on the server

The token is stored in `~/zokul/.env` (already in the preserved set, not committed):

```bash
ssh root@<server>
cd ~/zokul
echo "CF_TUNNEL_TOKEN=<token from step A>" >> .env
docker compose -f docker-compose.prod.yml up -d tunnel
```

Check: `docker logs $(docker compose -f docker-compose.prod.yml ps -q tunnel)` → `Registered tunnel connection`.

### Step C. Check without VPN

On a client **without VPN**:

```powershell
curl.exe -s -o /dev/null -w "%{http_code}" https://zokul.example.com
# expected: 200
```

And in a browser without VPN: `https://zokul.example.com` loads, login/registration works.

Direct `443` remains as a fallback (works with VPN). Do not close it.

## PWA_SWITCH — choosing the Service Worker implementation (PWA-PROPER-001)

The Service Worker is chosen at build time. Two implementations:

- `client/sw.kill.ts` — **emergency-killer** (network-only fetch + deletion of all caches + unregister). Clears old Safari/iPhone caches. **This is the production default** until stability is confirmed.
- `client/sw.pwa.ts` — **proper PWA** (precache only hashed assets via `precacheAndRoute(self.__WB_MANIFEST)`, network-only for navigation/`/api/*`/`/socket.io/*`/`/uploads/*`, versioned cache cleanup on activate). NOT an aggressive offline cache.

The script `client/scripts/select-sw.mjs` copies the chosen implementation to `client/sw.ts` based on the argument `kill`/`proper`.

### Emergency deploy (default)

```powershell
cd D:\zokul\client
npm run build:kill   # = sw:kill + vite build
```

### Proper PWA deploy (only after manual Safari/iPhone verification)

```powershell
cd D:\zokul\client
npm run build:proper # = sw:proper + vite build
```

> `vite.config.ts` keeps `filename: 'sw.ts'` — select-sw replaces the contents before the build.
> The nginx `no-store` rule for `/sw.js`, `/registerSW.js`, `/manifest.webmanifest` is kept in both variants (see `client/nginx.conf`).

### When to switch to proper

Only after the emergency-killer has run for 1–2 production deployments and manual checks on iPhone/Safari confirm: first load, reload (no endless loading), close/reopen, login/logout, socket reconnect — all OK. Then build `build:proper` and deploy it.
