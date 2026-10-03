'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = String(process.env.ADMIN_PIN || 'CHANGE_ME');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY = 1_000_000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const FRONTEND = path.join(ROOT, 'souq-store-luxury.html');
const sessions = new Map();
const rate = new Map();

fs.mkdirSync(DATA_DIR, {recursive:true});
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({products:[],promos:[],orders:[],settings:{storeName:'SOUQ Luxury'}}, null, 2));
if (!fs.existsSync(FRONTEND)) throw new Error('Frontend missing');
if (ADMIN_PIN === 'CHANGE_ME' || ADMIN_PIN.length < 6) console.warn('WARNING: Set a strong ADMIN_PIN in .env before production.');

function readStore(){
  try {
    const d = JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
    return {products:Array.isArray(d.products)?d.products:[], promos:Array.isArray(d.promos)?d.promos:[], orders:Array.isArray(d.orders)?d.orders:[], settings:d.settings||{storeName:'SOUQ Luxury'}};
  } catch { return {products:[],promos:[],orders:[],settings:{storeName:'SOUQ Luxury'}}; }
}
function writeStore(data){
  const tmp = `${DB_FILE}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data,null,2),'utf8');
  fs.renameSync(tmp, DB_FILE);
}
function json(res,status,data,extra={}){
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});
  res.end(JSON.stringify(data));
}
function security(res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
}
function parseCookies(req){
  const out={}; for(const p of (req.headers.cookie||'').split(';')){const i=p.indexOf('='); if(i>0) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));} return out;
}
function isAuthed(req){ const token=parseCookies(req).souq_session; const s=token&&sessions.get(token); return !!(s && s.expires>Date.now()); }
function loginAllowed(ip){
  const now=Date.now(), x=rate.get(ip)||{count:0,reset:now+10*60*1000};
  if(now>x.reset){x.count=0;x.reset=now+10*60*1000;}
  if(x.count>=8)return false; x.count++; rate.set(ip,x); return true;
}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>MAX_BODY){reject(new Error('too_large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch{reject(new Error('invalid_json'));}});req.on('error',reject);});}
function validateProduct(p){return p&&Number.isFinite(Number(p.id))&&typeof p.name==='string'&&p.name.trim()&&typeof p.cat==='string'&&Number.isFinite(Number(p.price));}
function validateStore(d){return Array.isArray(d.products)&&d.products.every(validateProduct)&&Array.isArray(d.promos)&&d.promos.every(x=>x&&typeof x.code==='string'&&Number.isFinite(Number(x.rate))&&x.rate>=0&&x.rate<=1);}
function serveFile(res,file,type){const b=fs.readFileSync(file);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(b);}

const server=http.createServer(async(req,res)=>{
  security(res);
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  const ip=req.socket.remoteAddress||'unknown';
  try{
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')) return serveFile(res,FRONTEND,'text/html; charset=utf-8');
    if(req.method==='GET'&&url.pathname==='/health') return json(res,200,{ok:true,service:'souq-luxury-store',version:'1.0.0',time:new Date().toISOString()});
    if(req.method==='GET'&&url.pathname==='/api/store'){
      const d=readStore(); return json(res,200,{products:d.products,promos:d.promos,orders:isAuthed(req)?d.orders:[] ,settings:d.settings});
    }
    if(req.method==='POST'&&url.pathname==='/api/auth/login'){
      if(!loginAllowed(ip)) return json(res,429,{error:'Too many attempts. Try again later.'});
      const d=await body(req);
      if(String(d.pin||'')!==ADMIN_PIN) return json(res,401,{error:'Unauthorized'});
      const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{expires:Date.now()+SESSION_TTL_MS});
      return json(res,200,{ok:true},{'Set-Cookie':`souq_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS/1000}`});
    }
    if(req.method==='POST'&&url.pathname==='/api/auth/logout'){
      const token=parseCookies(req).souq_session; if(token)sessions.delete(token);
      return json(res,200,{ok:true},{'Set-Cookie':'souq_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
    }
    if(req.method==='GET'&&url.pathname==='/api/auth/me') return json(res,200,{authenticated:isAuthed(req)});
    if(req.method==='PUT'&&url.pathname==='/api/store'){
      if(!isAuthed(req)) return json(res,401,{error:'Unauthorized'});
      const d=await body(req); if(!validateStore(d)) return json(res,400,{error:'Invalid store payload'});
      const old=readStore(); writeStore({products:d.products,promos:d.promos,orders:old.orders,settings:old.settings});
      return json(res,200,{ok:true,updatedAt:new Date().toISOString()});
    }
    if(req.method==='POST'&&url.pathname==='/api/orders'){
      const o=await body(req);
      if(!o||!String(o.name||'').trim()||!String(o.phone||'').trim()||!Array.isArray(o.items)||!o.items.length) return json(res,400,{error:'Invalid order'});
      const d=readStore(); const id=d.orders.length?Math.max(...d.orders.map(x=>Number(x.id)||0))+1:1;
      const order={...o,id,date:new Date().toISOString()}; d.orders.unshift(order); d.orders=d.orders.slice(0,5000); writeStore(d);
      return json(res,201,{ok:true,id});
    }
    if(req.method==='GET'&&url.pathname==='/api/admin/stats'){
      if(!isAuthed(req)) return json(res,401,{error:'Unauthorized'}); const d=readStore();
      const revenue=d.orders.reduce((s,o)=>s+Number(o.total||0),0); return json(res,200,{products:d.products.length,promos:d.promos.length,orders:d.orders.length,revenue});
    }
    return json(res,404,{error:'Not found'});
  }catch(e){ if(e.message==='too_large') return json(res,413,{error:'Payload too large'}); if(e.message==='invalid_json') return json(res,400,{error:'Invalid JSON'}); console.error(e); return json(res,500,{error:'Internal server error'}); }
});
server.listen(PORT,()=>console.log(`SOUQ Luxury running on http://localhost:${PORT}`));
