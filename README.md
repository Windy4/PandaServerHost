# 🐼 PandaServerHost

A self-hosted **Minecraft server hosting platform**. Users register, request a
server (type + version + resources), and **you approve or reject** each request.
Approved servers are deployed automatically into **resource-limited Docker
containers**, each on its **own port** that you port-forward manually. Every
user gets a **token-authenticated dashboard** scoped to only their own
server(s), with a **sandboxed file browser** for mods, plugins, and configs.

---

## Why this design meets the requirements

| Requirement | How it's implemented |
|---|---|
| Lightweight Linux distro | **Debian 12 "Bookworm" (minimal / netinstall)** — see below |
| Web server for hosting | Node.js + Express control panel |
| Request → admin approval | Requests sit in `pending` until you approve in `/admin` |
| Login system | bcrypt password hashing + JWT login tokens (httpOnly cookie) |
| Automated deployment + version download | Docker + `itzg/minecraft-server` downloads the correct Paper/Fabric/Vanilla/Forge jar |
| Resource limits | Docker cgroup caps: `Memory`, `NanoCpus`, `PidsLimit` — a server **cannot** exceed its grant |
| File browser (mods/plugins/config) | Sandboxed file API over each server's `/data` volume, path-traversal proof |
| Attack protection | Helmet headers, CSP, rate limiting, dropped Linux caps, `no-new-privileges`, input validation |
| Per-server dashboard w/ token auth | Ownership checks on every `/servers/:id` route; only owner or admin get in |
| Unique port per server | Auto-allocated from a configurable range; **you port-forward manually** |
| No personal data committed | Strict `.gitignore` (DB, `.env`, server data, secrets all excluded) |

---

## Recommended distro: Debian 12 (minimal)

**Debian 12 "Bookworm" netinstall / minimal** is the best fit:

- Tiny footprint (a minimal install idles at well under 512 MB RAM).
- First-class Docker support and long, stable security-update lifecycle.
- Uses **glibc**, so Java + Minecraft "just work" — unlike Alpine's musl libc,
  which frequently causes Minecraft/mod JVM issues. (Alpine is lighter but not
  worth the compatibility pain for a Minecraft host.)

Great alternatives if you prefer them: **Ubuntu Server 24.04 LTS (minimized)**
or **Rocky/AlmaLinux 9 minimal**. Any of these run this project unchanged.

---

## Requirements

- **Docker** installed and running (the panel talks to `/var/run/docker.sock`).
- **Node.js 18+**.
- Ports you intend to hand out (default `25565-25600`) forwarded on your router.

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env
# Edit .env and set a strong JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start the control panel
npm start
# -> http://localhost:8080
```

**The first account you register automatically becomes the admin (you).**
Alternatively, create/promote an admin from the CLI:

```bash
node scripts/create-admin.js myname 'a-strong-password'
```

---

## How it works

1. A user registers and logs in (`/register`, `/login`).
2. They submit a **server request** from their dashboard: name, type
   (Paper/Fabric/Vanilla/Forge), version, RAM, CPU, disk.
3. You open `/admin`, review pending requests, and **Approve** or **Reject**.
4. On approval the platform:
   - allocates a free host port,
   - creates a Docker container from `itzg/minecraft-server` with the requested
     type/version and **hard resource limits**,
   - mounts a per-server data directory for the file browser,
   - starts the server.
5. The user opens **their** server dashboard (`/servers/:id`) — access requires
   their login token **and** ownership — to Start/Stop/Restart, watch the live
   console, view CPU/RAM usage, and manage files (upload mods/plugins, edit
   `server.properties` and configs, create folders, download files).
6. **You port-forward** the server's shown port on your router so players can
   connect at `your-public-ip:PORT`.

---

## Security notes

- Passwords are hashed with **bcrypt** (cost 12); never stored in plaintext.
- Auth uses signed **JWTs** in an httpOnly, SameSite=Lax cookie.
- **Rate limiting** on auth (20 / 15 min) and globally (300 / min).
- **Helmet** sets a strict Content-Security-Policy and other hardening headers.
- Each Minecraft container runs with **all Linux capabilities dropped**,
  `no-new-privileges`, a PID cap, and **no swap beyond its RAM grant**.
- The file browser is **jailed** to each server's data directory — path
  traversal (`../`), absolute paths, and NUL bytes are rejected.
- Only the **owner** of a server (or an admin) can view or control it.

> Run the panel behind **nginx/Caddy with HTTPS** for internet exposure and set
> `SECURE_COOKIES=true`. Consider a firewall (ufw) allowing only the panel port
> and your forwarded Minecraft ports.

---

## Configuration reference

See `.env.example` — key settings: `PORT`, `JWT_SECRET`, `MC_PORT_MIN/MAX`,
`MC_IMAGE`, `SERVERS_DIR`, and the `MAX_RAM_MB` / `MAX_CPU_CORES` /
`MAX_DISK_MB` safety caps on what a single server may be granted.

## Project layout

```
server.js              # Express app entry (security middleware, routes)
src/config.js          # env-driven config
src/db.js              # SQLite schema (users, requests, servers)
src/middleware/auth.js # JWT auth, admin gate, cookie helpers
src/services/docker.js # deploy/start/stop + resource limits + logs/stats
src/services/ports.js  # unique port allocation
src/services/safepath.js # path-traversal-proof file jail
src/routes/            # auth, requests, admin, servers, files, pages
views/                 # EJS templates
public/                # CSS + client JS (strict CSP, no inline scripts)
scripts/create-admin.js
```
