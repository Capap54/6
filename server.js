const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const userWallets = new Map();
userWallets.set('7275857070', 'EQD...KeeperDefault');

let marketListings = [
  {
    id: 'lot_1',
    username: 'vortexix',
    priceTon: 7.5,
    sellerName: 'Admin',
    createdAt: Date.now()
  }
];

const CONSONANTS = ['b', 'c', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'x', 'z'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'y'];
const RARE_ROOTS = ['vortex', 'zenith', 'kobra', 'shadow', 'pulse', 'cyber', 'ghost', 'drift', 'venom', 'frost', 'storm', 'titan', 'blade', 'spark', 'apex', 'nova', 'aura', 'echo', 'flux', 'core', 'onyx', 'volt'];

function rand(max) {
  return crypto.randomInt(0, max);
}

function cleanName(raw) {
  return String(raw || '').trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function isValidName(u) {
  return /^[a-z][a-z0-9_]{4,31}$/.test(u);
}

function makeSyllables(len) {
  let out = '';
  let c = rand(2) === 0;
  while (out.length < len) {
    out += c ? CONSONANTS[rand(CONSONANTS.length)] : VOWELS[rand(VOWELS.length)];
    c = !c;
  }
  return out.slice(0, len);
}

function generateByStyle(style) {
  const len = style === 'short6' ? 6 : (6 + rand(3));
  if (style === 'rare') {
    const roots = RARE_ROOTS.filter((r) => r.length <= len);
    const root = roots[rand(roots.length)] || 'vortex';
    return root + makeSyllables(Math.max(0, len - root.length));
  }
  if (style === 'with_num') {
    const base = makeSyllables(Math.max(4, len - 2));
    return base + String(rand(90) + 10);
  }
  if (style === 'with_under') {
    const half = Math.max(2, Math.floor((len - 1) / 2));
    return (makeSyllables(half) + '_' + makeSyllables(Math.max(2, len - 1 - half))).slice(0, len);
  }
  return makeSyllables(len);
}

async function fetchSafe(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function checkThreeSources(username) {
  let botChecked = false;
  let botTaken = false;
  if (BOT_TOKEN) {
    try {
      const r = await fetchSafe(`https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=@${encodeURIComponent(username)}`);
      const j = await r.json();
      botChecked = true;
      botTaken = Boolean(j && j.ok);
    } catch (_) {}
  }

  let tmeChecked = false;
  let tmeTaken = false;
  try {
    const r = await fetchSafe(`https://t.me/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await r.text();
    tmeChecked = true;
    tmeTaken = html.includes('tgme_page_title') && !html.includes('If you have <strong>Telegram</strong>, you can contact');
  } catch (_) {}

  let fragChecked = false;
  let fragTaken = false;
  try {
    const r = await fetchSafe(`https://fragment.com/username/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const low = (await r.text()).toLowerCase();
    fragChecked = true;
    fragTaken = (low.includes('on auction') || low.includes('sold') || low.includes('taken')) && !low.includes('username is available');
  } catch (_) {}

  const available = !botTaken && !tmeTaken && !fragTaken;
  const isRare = RARE_ROOTS.some((root) => username.includes(root)) || username.length <= 6;
  const badge = !available
    ? { code: 'taken', label: 'Занят / Fragment' }
    : (isRare ? { code: 'rare_premium', label: '1 редкий (премиум)' } : { code: 'available', label: 'Свободен' });

  return {
    ok: true,
    username,
    available,
    badge,
    checks: {
      botApi: { checked: botChecked, taken: botTaken },
      tMe: { checked: tmeChecked, taken: tmeTaken },
      fragment: { checked: fragChecked, taken: fragTaken }
    }
  };
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/check', async (req, res) => {
  const u = cleanName(req.query.username || '');
  if (!isValidName(u)) {
    return res.status(400).json({ ok: false, message: 'Нужно 5–32 символа (латиница, цифры, _)' });
  }
  const data = await checkThreeSources(u);
  res.json(data);
});

app.get('/api/generate', async (req, res) => {
  const count = Math.min(Math.max(Number(req.query.count) || 6, 1), 15);
  const style = String(req.query.style || 'rare');
  const seen = new Set();
  const items = [];

  for (let i = 0; i < count * 8 && items.length < count; i++) {
    const u = generateByStyle(style);
    if (!isValidName(u) || seen.has(u)) continue;
    seen.add(u);
    const resCheck = await checkThreeSources(u);
    if (resCheck.available) items.push(resCheck);
  }

  res.json({ ok: true, items });
});

app.get('/api/market', (req, res) => {
  res.json({ ok: true, listings: marketListings });
});

app.post('/api/market', (req, res) => {
  const username = cleanName(req.body?.username || '');
  const priceTon = Number(req.body?.priceTon);
  if (!isValidName(username) || !Number.isFinite(priceTon) || priceTon <= 0) {
    return res.status(400).json({ ok: false, error: 'Проверь юзернейм и цену TON' });
  }
  const lot = {
    id: 'lot_' + Date.now(),
    username,
    priceTon,
    sellerName: 'Admin',
    createdAt: Date.now()
  };
  marketListings.unshift(lot);
  res.json({ ok: true, listing: lot });
});

app.post('/api/wallet', (req, res) => {
  const address = String(req.body?.address || '').trim();
  if (!address) return res.status(400).json({ ok: false, error: 'Введите адрес кошелька' });
  userWallets.set('7275857070', address);
  res.json({ ok: true, address });
});

app.get('/api/wallet', (req, res) => {
  res.json({ ok: true, address: userWallets.get('7275857070') || '' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));
                    
