# Blitz Cyber Era (Intentionally Vulnerable CTF) — LAB USE ONLY

> **⚠️ SECURITY WARNING:**  
> This application contains intentional security vulnerabilities (SQL Injection, IDOR, SSRF, weak JWT secret). **Do NOT host this directly on sensitive infrastructure or production networks.** Run only in isolated sandboxes, dedicated containers, or lab environments.

---

## Local Development
```powershell
npm install
npm start
```
* **Player Portal:** [http://localhost:3000](http://localhost:3000)
* **Admin Watchtower:** [http://localhost:4000](http://localhost:4000) or [http://localhost:3000/admin](http://localhost:3000/admin)
  * Default Credentials: `admin` / `changeme` (configure with `ADMIN_USER` and `ADMIN_PASS`)

---

## Hosting Options

### Option 1: Instant Tunnel (Zero Setup — Share Immediately)
Expose your local server securely to the internet for a live game or demo:

**Using Cloudflare Tunnel (Free, no account required):**
```powershell
npx untun@latest tunnel http://localhost:3000
```
Or with official Cloudflare CLI:
```powershell
cloudflared tunnel --url http://localhost:3000
```

**Using ngrok:**
```powershell
ngrok http 3000
```

---

### Option 2: Free Cloud Hosting (Render / Railway / Fly.io)

This app supports **single-port cloud hosting**. The player app is hosted at `/` and the admin watchtower is hosted at `/admin`.

#### Deploying on Render (Free Tier):
1. Push your repository to GitHub.
2. Sign in to [Render.com](https://render.com) and click **New > Web Service**.
3. Select your repository.
4. Set the following:
   * **Runtime:** Node
   * **Build Command:** `npm install`
   * **Start Command:** `node server.js`
5. Under **Environment Variables**, optionally set:
   * `ADMIN_USER`: your chosen admin username
   * `ADMIN_PASS`: a strong password
6. Click **Deploy**. Your app will be live at `https://your-service.onrender.com`.

---

### Option 3: Docker / VPS (DigitalOcean, AWS, Linode, Hetzner)

#### Using Docker:
```bash
docker build -t blitz-cyber-era .
docker run -d -p 3000:3000 -p 4000:4000 \
  -e ADMIN_USER=admin \
  -e ADMIN_PASS=StrongPasswordHere \
  --name blitz-ctf blitz-cyber-era
```

#### Using Docker Compose:
```bash
docker compose up -d
```

---

## CTF Challenges & Flags Reference
* **1. Whispers in the Dark (Easy - 100 pts):** `/robots.txt` → `/graveyard/whispers.txt`
* **2. Lost Souls (Intermediate - 200 pts):** IDOR: `/api/souls/13`
* **3. Warden's Gate (Intermediate - 250 pts):** SQLi: username `warden'--` with any password
* **4. The Keeper's Vault (Advanced - 350 pts):** Crack weak HS256 secret (`crypt`), forge role `keeper`, `GET /api/vault`
* **5. Seance (Hard - 500 pts):** SSRF filter bypass to hit internal ritual (`http://127.1:3000/internal/ritual`, `http://[::1]:3000/internal/ritual`, etc.)
