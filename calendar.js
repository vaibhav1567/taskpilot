import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { currentUser, requireAuth } from './auth.js';

const dataFile = path.join(process.cwd(), 'data', 'calendar-connections.json');
const pending = new Map();
let connections = {};
const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || '';
const redirectUri = () => process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/calendar/callback';
const key = () => { const raw = process.env.CALENDAR_ENCRYPTION_KEY || ''; if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error('Set CALENDAR_ENCRYPTION_KEY to 64 hex characters.'); return Buffer.from(raw, 'hex'); };
function encrypt(obj) { const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',key(),iv); const data=Buffer.concat([cipher.update(JSON.stringify(obj)),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64'); }
function decrypt(encoded) { const b=Buffer.from(encoded,'base64'); const dec=crypto.createDecipheriv('aes-256-gcm',key(),b.subarray(0,12)); dec.setAuthTag(b.subarray(12,28)); return JSON.parse(Buffer.concat([dec.update(b.subarray(28)),dec.final()]).toString()); }
async function save() { await fs.mkdir(path.dirname(dataFile),{recursive:true}); const tmp=dataFile+'.'+crypto.randomUUID()+'.tmp'; await fs.writeFile(tmp,JSON.stringify(connections,null,2),{mode:0o600}); await fs.rename(tmp,dataFile); }
async function exchange(params) { const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)}); const data=await response.json(); if(!response.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed'); return data; }
async function accessToken(userId) { const saved=connections[userId]; if(!saved) throw new Error('Connect Google Calendar first.'); const t=decrypt(saved); if(t.expires_at>Date.now()+60_000) return t.access_token; if(!t.refresh_token) throw new Error('Google connection expired. Reconnect Calendar.'); const updated=await exchange({client_id:clientId(),client_secret:clientSecret(),grant_type:'refresh_token',refresh_token:t.refresh_token}); const next={...t,...updated,expires_at:Date.now()+(updated.expires_in||3600)*1000}; connections[userId]=encrypt(next); await save(); return next.access_token; }
export async function initCalendar() { try { connections=JSON.parse(await fs.readFile(dataFile,'utf8')); } catch(e) { if(e.code!=='ENOENT') throw e; connections={}; } }
export function mountCalendar(app) {
 app.get('/api/calendar/callback', async(req,res)=>{
  const state=String(req.query.state||''); const record=pending.get(state); pending.delete(state);
  if(!record || record.until<Date.now() || !currentUser(req) || currentUser(req).id!==record.userId) return res.status(403).send('Calendar authorization expired. Return to TaskPilot and reconnect.');
  if(req.query.error) return res.redirect('/?calendar=denied');
  try { if(typeof req.query.code!=='string') throw new Error('Missing authorization code'); const t=await exchange({client_id:clientId(),client_secret:clientSecret(),redirect_uri:redirectUri(),grant_type:'authorization_code',code:req.query.code,code_verifier:record.verifier}); connections[record.userId]=encrypt({...t,expires_at:Date.now()+(t.expires_in||3600)*1000}); await save(); res.redirect('/?calendar=connected'); }
  catch(e){ console.error('Calendar OAuth:',e.message); res.status(502).send('Could not connect Google Calendar. Check your Google OAuth configuration.'); }
 });
 app.get('/api/calendar/status',requireAuth,(req,res)=>res.json({connected:!!connections[req.user.id],configured:!!(clientId()&&clientSecret()&&process.env.CALENDAR_ENCRYPTION_KEY)}));
 app.get('/api/calendar/connect',requireAuth,(req,res)=>{
  if(!clientId()||!clientSecret()) return res.status(503).json({error:'Google OAuth credentials are not configured.'});
  try { key(); } catch(e) { return res.status(503).json({error:e.message}); }
  const state=crypto.randomBytes(24).toString('hex'); const verifier=crypto.randomBytes(32).toString('base64url'); const challenge=crypto.createHash('sha256').update(verifier).digest('base64url'); pending.set(state,{userId:req.user.id,verifier,until:Date.now()+10*60_000});
  const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [k,v] of Object.entries({client_id:clientId(),redirect_uri:redirectUri(),response_type:'code',scope:'https://www.googleapis.com/auth/calendar.events',access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'})) u.searchParams.set(k,v);
  res.json({url:u.toString()});
 });
 app.post('/api/calendar/disconnect',requireAuth,async(req,res)=>{ delete connections[req.user.id]; await save(); res.json({ok:true}); });
 app.post('/api/calendar/events',requireAuth,async(req,res)=>{
  const {summary,start,end,description,timeZone}=req.body||{};
  if(typeof summary!=='string'||!summary.trim()||summary.length>200||typeof start!=='string'||typeof end!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(start)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(end)||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)) return res.status(400).json({error:'Provide a title and valid start/end ISO timestamps with timezone offsets.'});
  if(description!=null&&(typeof description!=='string'||description.length>2000)) return res.status(400).json({error:'Description too long.'});
  if(typeof timeZone!=='string'||!/^[-A-Za-z_]+\/[-A-Za-z_]+$|^UTC$/.test(timeZone)) return res.status(400).json({error:'Provide an IANA timezone such as Asia/Kolkata.'});
  try { const token=await accessToken(req.user.id); const response=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({summary:summary.trim(),description:description||'',start:{dateTime:start,timeZone},end:{dateTime:end,timeZone}})}); const result=await response.json(); if(!response.ok) return res.status(502).json({error:result.error?.message||'Google Calendar rejected the event.'}); res.status(201).json({event:{id:result.id,link:result.htmlLink,summary:result.summary}}); }
  catch(e){ console.error('Calendar event:',e.message); res.status(502).json({error:e.message}); }
 });
}
