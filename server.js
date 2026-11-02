// BLITZ CYBER ERA - intentionally vulnerable CTF. Run ONLY in an isolated lab / VM / container.
const express = require('express'), Database = require('better-sqlite3'), jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser'), path = require('path'), crypto = require('crypto');

const PLAYER_PORT = process.env.PORT || 3000, ADMIN_PORT = process.env.ADMIN_PORT || 4000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin', ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const JWT_SECRET = 'crypt'; // INTENTIONALLY WEAK (challenge 4)

// ---- Flags & scoring (edit freely) ----
const CH = {
  1: { title: 'Whispers in the Dark', diff: 'Easy',         pts: 100, flag: 'BLITZ{r0b0ts_t0ld_th3_gh0sts_wh3r3}' },
  2: { title: 'Lost Souls',           diff: 'Intermediate', pts: 200, flag: 'BLITZ{1d0r_s0uls_4r3_n0t_y0urs}' },
  3: { title: "Warden's Gate",        diff: 'Intermediate', pts: 250, flag: 'BLITZ{sql_1nj3ct10n_0p3ns_th3_g4t3}' },
  4: { title: "The Keeper's Vault",   diff: 'Advanced',     pts: 350, flag: 'BLITZ{w34k_s3cr3t_f0rg3d_th3_k33p3r}' },
  5: { title: 'Seance',               diff: 'Hard',         pts: 500, flag: 'BLITZ{ssrf_cr0ss3d_th3_v31l}' },
};

// ================= DATABASE (Optimized for High Concurrency) =================
const db = new Database('blitz.db');
db.pragma('journal_mode = WAL');       // WAL mode for fast concurrent reads & writes
db.pragma('synchronous = NORMAL');     // Optimal durability and low disk I/O
db.pragma('cache_size = -32000');       // 32MB cache in memory
db.pragma('temp_store = MEMORY');

db.exec(`
create table if not exists players(id text primary key, name text unique, score int default 0, created int, last_seen int);
create table if not exists solves(pid text, cid int, ts int, primary key(pid,cid));
create table if not exists events(id integer primary key autoincrement, pid text, type text, detail text, ts int);
create table if not exists users(id integer primary key, username text, password text, role text, note text);
create table if not exists souls(id integer primary key, owner text, note text);
create index if not exists idx_events_id on events(id desc);
`);

if (!db.prepare('select count(*) c from users').get().c) {
  db.prepare('insert into users(username,password,role,note) values (?,?,?,?)').run('ghost', 'boo123', 'visitor', 'Just a lost spirit. Hint: tokens are only as strong as their secrets.');
  db.prepare('insert into users(username,password,role,note) values (?,?,?,?)').run('warden', crypto.randomBytes(12).toString('hex'), 'warden', 'The Warden guards: ' + CH[3].flag);
  const notes = ['Cold hands.', 'I hear scratching.', 'The mirror blinked.', 'Do not open the cellar.', 'Whispers at 3AM.', 'The doll moved.',
    'Candles died.', 'Footsteps upstairs.', 'Who is knocking?', 'The well is deep.', 'I smell smoke.', 'Count the steps.'];
  notes.forEach((n, i) => db.prepare('insert into souls(id,owner,note) values (?,?,?)').run(i + 1, 'spirit' + (i + 1), n));
  db.prepare('insert into souls(id,owner,note) values (?,?,?)').run(13, 'the_forgotten', 'My secret: ' + CH[2].flag);
}

const log = (pid, type, detail) => {
  try {
    db.prepare('insert into events(pid,type,detail,ts) values (?,?,?,?)').run(pid || null, type, String(detail).slice(0, 300), Date.now());
  } catch {}
};

// Auto-cleanup: keep latest 3000 events to prevent DB bloat under heavy load
setInterval(() => {
  try {
    db.prepare('delete from events where id < (select max(id) - 3000 from events)').run();
  } catch {}
}, 5 * 60 * 1000);

// ================= RATE LIMITING & DOS PROTECTION =================
const rateLimits = new Map();
const rateLimiter = (maxReqs, windowMs = 60000) => (req, res, next) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const key = `${req.path}:${ip}`;
  const now = Date.now();
  let record = rateLimits.get(key);
  if (!record || now - record.start > windowMs) {
    record = { count: 1, start: now };
    rateLimits.set(key, record);
    return next();
  }
  record.count++;
  if (record.count > maxReqs) {
    res.set('Retry-After', String(Math.ceil((record.start + windowMs - now) / 1000)));
    return res.status(429).json({ error: 'Slow down! Too many requests. Please wait a moment.' });
  }
  next();
};

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits.entries()) {
    if (now - v.start > 60000) rateLimits.delete(k);
  }
}, 5 * 60 * 1000);

// ================= PLAYER APP =================
const app = express();
app.set('trust proxy', 1); // Respect reverse proxy headers on Render
app.use(express.json({ limit: '64kb' }), cookieParser());

// Movement tracking: every request by a known player is logged
app.use((req, res, next) => {
  const pid = req.cookies.pid;
  if (pid && !/\.(css|js|png|ico|svg|woff2?)$/.test(req.path)) {
    try {
      db.prepare('update players set last_seen=? where id=?').run(Date.now(), pid);
      if (!['/api/me', '/api/scoreboard', '/api/track'].includes(req.path)) log(pid, 'request', `${req.method} ${req.originalUrl}`);
    } catch {}
  }
  next();
});

// Protect all API endpoints from abusive traffic (180 requests/minute per IP)
app.use('/api', rateLimiter(180));

app.use(express.static(path.join(__dirname, 'public'))); // Ch1: robots.txt + /graveyard/ live here
const me = req => db.prepare('select * from players where id=?').get(req.cookies.pid);

app.post('/api/join', rateLimiter(30), (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 24);
  if (!name) return res.status(400).json({ error: 'Name required' });
  let p = db.prepare('select * from players where name=?').get(name);
  if (!p) {
    const id = crypto.randomBytes(8).toString('hex');
    db.prepare('insert into players(id,name,created,last_seen) values (?,?,?,?)').run(id, name, Date.now(), Date.now());
    p = { id, name };
  }
  res.cookie('pid', p.id, { httpOnly: true, maxAge: 864e5 * 3 });
  log(p.id, 'join', name);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const p = me(req); if (!p) return res.status(401).json({});
  res.json({ name: p.name, score: p.score, soulId: 1 + (parseInt(p.id.slice(0, 4), 16) % 12),
    solved: db.prepare('select cid from solves where pid=?').all(p.id).map(r => r.cid) });
});

app.get('/api/challenges', (_, res) => res.json(Object.entries(CH).map(([id, c]) => ({ id: +id, title: c.title, diff: c.diff, pts: c.pts }))));
app.get('/api/scoreboard', (_, res) => res.json(db.prepare('select name,score from players order by score desc, last_seen asc limit 50').all()));
app.post('/api/track', (req, res) => { if (req.cookies.pid) log(req.cookies.pid, 'ui', `${req.body.type}: ${req.body.detail || ''}`); res.json({}); });

app.post('/api/submit', rateLimiter(45), (req, res) => {
  const p = me(req); if (!p) return res.status(401).json({ error: 'Join first' });
  const c = CH[req.body.cid]; if (!c) return res.status(400).json({ error: 'No such challenge' });
  const ok = String(req.body.flag || '').trim() === c.flag;
  log(p.id, ok ? 'flag_correct' : 'flag_wrong', `Ch${req.body.cid} ${c.title}`);
  if (!ok) return res.json({ correct: false });
  if (db.prepare('select 1 from solves where pid=? and cid=?').get(p.id, req.body.cid)) return res.json({ correct: true, already: true });
  db.prepare('insert into solves values (?,?,?)').run(p.id, req.body.cid, Date.now());
  db.prepare('update players set score=score+? where id=?').run(c.pts, p.id);
  res.json({ correct: true, pts: c.pts });
});

// ---- Ch2 (Intermediate): IDOR - no ownership check on soul ids ----
app.get('/api/souls/:id', (req, res) => {
  const s = db.prepare('select * from souls where id=?').get(req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'No soul here' });
});

// ---- Ch3 (Intermediate): SQL injection - string concatenation ----
app.post('/api/login', rateLimiter(60), (req, res) => {
  const { username = '', password = '' } = req.body;
  try {
    const u = db.prepare(`select * from users where username='${username}' and password='${password}'`).get();
    if (!u) return res.status(401).json({ error: 'The gate stays shut.' });
    res.cookie('crypt_token', jwt.sign({ user: u.username, role: u.role }, JWT_SECRET, { algorithm: 'HS256' }));
    res.json({ welcome: u.username, role: u.role, note: u.note });
  } catch (e) { res.status(500).json({ error: 'DB error: ' + e.message }); }
});

// ---- Ch4 (Advanced): weak JWT secret -> forge role "keeper" ----
app.get('/api/vault', (req, res) => {
  try {
    const t = jwt.verify(req.cookies.crypt_token || '', JWT_SECRET, { algorithms: ['HS256'] });
    if (t.role !== 'keeper') return res.status(403).json({ error: `Role "${t.role}" may not enter. Only the keeper.` });
    res.json({ vault: CH[4].flag });
  } catch { res.status(401).json({ error: 'No valid token. Log in at the gate first.' }); }
});

// ---- Ch5 (Hard): SSRF with a weak string blocklist ----
app.post('/api/seance', rateLimiter(25), async (req, res) => {
  const url = String(req.body.url || '');
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Only http(s) spirits may be summoned.' });
  // Block loopback string and cloud metadata while preserving challenge solutions (127.1, 0.0.0.0, [::1])
  if (/localhost|127\.0\.0\.1|169\.254\.|metadata\.google/i.test(url)) return res.status(403).json({ error: 'The living realm is forbidden.' });
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    res.json({ status: r.status, body: (await r.text()).slice(0, 1500) });
  } catch (e) { res.status(502).json({ error: 'The spirit did not answer.' }); }
});

app.get('/internal/ritual', (req, res) => { // loopback only
  const ip = req.socket.remoteAddress || '';
  if (ip === '::1' || ip.includes('127.0.0.1')) return res.send('Ritual complete. ' + CH[5].flag);
  res.status(403).send('Only from within.');
});

// ================= ADMIN APP (basic auth, accessible on ADMIN_PORT or /admin) =================
const admin = express();
admin.use((req, res, next) => {
  const [u, p] = Buffer.from((req.headers.authorization || '').split(' ')[1] || '', 'base64').toString().split(':');
  if (u === ADMIN_USER && p === ADMIN_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="Blitz Admin"').status(401).send('Authentication required');
});
admin.get('/', (_, res) => res.sendFile(path.join(__dirname, 'admin', 'admin.html')));
admin.get('/api/players', (_, res) => res.json(db.prepare(`select p.id,p.name,p.score,p.last_seen,
  (select count(*) from solves s where s.pid=p.id) solved,
  (select detail from events e where e.pid=p.id order by e.id desc limit 1) last_action
  from players p order by score desc`).all()));
admin.get('/api/events', (req, res) => res.json(db.prepare(`select e.id,e.type,e.detail,e.ts,p.name from events e
  left join players p on p.id=e.pid where e.id>? order by e.id desc limit 150`).all(+req.query.since || 0)));

// Mount admin on main app so single-port cloud hosts (Render, Railway, Fly.io, etc.) can access /admin
app.use('/admin', admin);

// ================= SERVER LIFECYCLE & KEEP-ALIVE =================
app.listen(PLAYER_PORT, () => {
  console.log(`[player] http://localhost:${PLAYER_PORT}`);
  console.log(`[admin ] http://localhost:${PLAYER_PORT}/admin  (${ADMIN_USER}/${ADMIN_PASS})`);

  // Render Free Tier Keep-Alive: Ping self every 13 minutes to prevent sleep
  const pingUrl = process.env.RENDER_EXTERNAL_URL || process.env.PING_URL;
  if (pingUrl) {
    console.log(`[keepalive] Active for ${pingUrl} (every 13m)`);
    setInterval(async () => {
      try {
        await fetch(`${pingUrl}/api/challenges`);
        console.log(`[keepalive] Periodic keep-alive ping succeeded`);
      } catch (err) {
        console.warn(`[keepalive] Ping notice:`, err.message);
      }
    }, 13 * 60 * 1000);
  }
});

// Also listen on dedicated ADMIN_PORT if configured and different from PLAYER_PORT
if (ADMIN_PORT && String(ADMIN_PORT) !== String(PLAYER_PORT)) {
  admin.listen(ADMIN_PORT, () => console.log(`[admin ] http://localhost:${ADMIN_PORT}  (${ADMIN_USER}/${ADMIN_PASS})`));
}
