import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const dataPath = path.join(process.cwd(), 'data', 'users.json');
const sessions = new Map();
const attempts = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'tp_session';
let users = [];

export async function initAuth() {
  await fs.mkdir(path.dirname(dataPath), { recursive: true, mode: 0o700 });
  try { users = JSON.parse(await fs.readFile(dataPath, 'utf8')); if (!Array.isArray(users)) throw new Error('Invalid users file'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; users = []; }
}
async function saveUsers() {
  const tmp = dataPath + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(users, null, 2), { mode: 0o600, flag: 'wx' });
  await fs.rename(tmp, dataPath);
}
const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
const validPassword = password => typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password) <= 256;
async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString('hex') };
}
async function checkPassword(password, user) {
  const candidate = await scrypt(password, user.salt, 64);
  const stored = Buffer.from(user.hash, 'hex');
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}
function getCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return cookies;
}
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function cookieOptions(req) { return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${req.secure ? '; Secure' : ''}`; }
function setSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(tokenHash(token), { userId: user.id, expires: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieOptions(req)}`);
}
export function currentUser(req) {
  const token = getCookies(req)[COOKIE]; if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const key = tokenHash(token), session = sessions.get(key);
  if (!session) return null;
  if (session.expires < Date.now()) { sessions.delete(key); return null; }
  return users.find(user => user.id === session.userId) || null;
}
export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in.' });
  req.user = user; next();
}
function rateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
  if (now > entry.until) { entry.count = 0; entry.until = now + 15 * 60_000; }
  entry.count++;
  attempts.set(key, entry);
  if (entry.count > 20) return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  next();
}
export function sameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return res.status(403).json({ error: 'Invalid request origin.' });
  try { if (new URL(origin).host !== host) return res.status(403).json({ error: 'Invalid request origin.' }); }
  catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
  next();
}
export function mountAuth(app) {
  app.get('/api/auth/me', (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: 'Not logged in.' });
    res.json({ user: { id: user.id, email: user.email } });
  });
  app.post('/api/auth/signup', rateLimit, async (req, res) => {
    const email = emailOf(req.body?.email), password = req.body?.password;
    if (!validEmail(email) || !validPassword(password)) return res.status(400).json({ error: 'Enter a valid email and a password of at least 12 characters (max 256 bytes).' });
    if (users.some(user => user.email === email)) return res.status(409).json({ error: 'This email is already registered.' });
    try {
      const { salt, hash } = await hashPassword(password);
      const user = { id: crypto.randomUUID(), email, salt, hash };
      users.push(user);
      await saveUsers();
      setSession(req, res, user);
      res.status(201).json({ user: { id: user.id, email: user.email } });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Unable to create account.' }); }
  });
  app.post('/api/auth/login', rateLimit, async (req, res) => {
    const email = emailOf(req.body?.email), password = req.body?.password;
    if (!validEmail(email) || typeof password !== 'string' || Buffer.byteLength(password) > 256) return res.status(401).json({ error: 'Invalid email or password.' });
    const user = users.find(user => user.email === email);
    try {
      if (!user || !(await checkPassword(password, user))) return res.status(401).json({ error: 'Invalid email or password.' });
      setSession(req, res, user);
      res.json({ user: { id: user.id, email: user.email } });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Unable to log in.' }); }
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = getCookies(req)[COOKIE];
    if (token) sessions.delete(tokenHash(token));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expires < now) sessions.delete(key);
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  }, 600_000).unref();
}
