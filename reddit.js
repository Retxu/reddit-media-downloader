const {pipeline}=require('node:stream/promises');
const dns=require('node:dns').promises;
const net=require('node:net');
const {Readable}=require('node:stream');
const ALLOWED = new Set(['redd.it','v.redd.it','redditmedia.com','redditstatic.com','www.reddit.com','preview.redd.it','external-preview.redd.it','i.imgur.com','redgifs.com','www.redgifs.com']);
const UA = 'Mozilla/5.0 (compatible; RedditMediaFetcher/1.0; +https://www.reddit.com/)';
function allowedHost(host) { host=host.toLowerCase(); return [...ALLOWED].some(d => host===d || host.endsWith('.'+d)); }
function checkedUrl(raw) { let u; try { u=new URL(raw); } catch { throw new Error('URL de média invalide.'); } if (u.protocol!=='https:' || !allowedHost(u.hostname) || u.username || u.password || u.port) throw new Error('Hôte de téléchargement non autorisé : '+u.hostname); return u; }
async function safeFetch(raw, options) { let u=checkedUrl(raw); for(let n=0;n<4;n++){const addrs=net.isIP(u.hostname)?[{address:u.hostname}]:await dns.lookup(u.hostname,{all:true}); if(!addrs.length||addrs.some(x=>{const a=x.address.toLowerCase();return a==='::1'||a==='::'||a.startsWith('fc')||a.startsWith('fd')||a.startsWith('fe80:')||a.startsWith('127.')||a.startsWith('10.')||a.startsWith('192.168.')||a.startsWith('169.254.')||/^172\.(1[6-9]|2[0-9]|3[01])\./.test(a)}))throw new Error('Adresse IP non publique pour l’hôte de téléchargement.'); const response=await fetch(u,{...options,redirect:'manual'}); if([301,302,303,307,308].includes(response.status)){const loc=response.headers.get('location');if(!loc||n===3)throw new Error('Redirection média invalide ou trop longue.');u=checkedUrl(new URL(loc,u).href);continue;}return response;} throw new Error('Redirection média invalide.'); }
async function getJson(url, attempt=0) {
  const u=checkedUrl(url);
  let res;
  try { res=await safeFetch(u.href,{headers:{'User-Agent':UA,'Accept':'application/json'},signal:AbortSignal.timeout(25000)}); }
  catch(e) { if(attempt<3){await new Promise(r=>setTimeout(r,700*2**attempt));return getJson(url,attempt+1);} throw new Error('Reddit est inaccessible : '+e.message); }
  if([301,302,303,307,308].includes(res.status))throw new Error('Redirection Reddit invalide.');
  if(res.status===403) throw new Error('Reddit a refusé la requête (403). Réessayez plus tard.');
  if(res.status===429){if(attempt<3){await new Promise(r=>setTimeout(r,1000*2**attempt));return getJson(url,attempt+1);}throw new Error('Limite Reddit atteinte (429). Réessayez plus tard.');}
  if(!res.ok) throw new Error(`Erreur Reddit HTTP ${res.status}.`);
  return res.json();
}
function parseTarget(raw) {
  const s=String(raw||'').trim().replace(/^https?:\/\/(www\.)?reddit\.com\//i,'').replace(/^\/+|\/+$/g,'');
  let m=s.match(/^(?:r|u|user)\/([A-Za-z0-9_-]{1,21})(?:\/)?$/i);
  if(!m) throw new Error('Cible invalide. Utilisez r/nomdusubreddit ou u/nomdutilisateur.');
  return {name:m[1],type:/^(r)$/i.test(s.split('/')[0])?'subreddit':'user'};
}
function candidates(post, options) {
  const out=[]; const seen=new Set(); const add=(url,kind,ext)=>{if(!url)return;try{url=checkedUrl(url).href;}catch{return;}if(seen.has(url))return;seen.add(url);out.push({url,kind,ext});};
  const v=post.media?.reddit_video;
  if(options.videos!==false && v?.fallback_url) add(v.fallback_url,'video','mp4');
  const md=post.media_metadata||{};
  if(options.images!==false){
    for(const x of Object.values(md)){if(x?.s?.u)add(x.s.u,'image',x.m?.split('/').pop()?.replace('jpeg','jpg')||'jpg');}
    if(post.url_overridden_by_dest && /(^https:\/\/(i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|i\.imgur\.com|redgifs\.com|www\.redgifs\.com)\/)/i.test(post.url_overridden_by_dest) && !v) add(post.url_overridden_by_dest,'image',post.post_hint==='image'?'jpg':'bin');
    if(post.preview?.images?.[0]?.source?.url && !out.length) add(post.preview.images[0].source.url,'image','jpg');
  }
  return out;
}
async function scan(rawTarget, options={}) {
 const target=parseTarget(rawTarget), sort=['hot','new','top','rising','controversial'].includes(options.sort)?options.sort:'hot';
 const reqLimit=Number(options.limit);
 const limit=reqLimit===0?100000:Math.max(1,Math.min(100000,reqLimit||100));
 const time=['hour','day','week','month','year','all'].includes(options.time)?options.time:'all';
 const posts=[]; let after=null, pages=0;
 while(posts.length<limit && pages<20){
   const root=target.type==='user'?`https://www.reddit.com/user/${encodeURIComponent(target.name)}/submitted.json`:`https://www.reddit.com/r/${encodeURIComponent(target.name)}/${sort}.json`;
   const url=new URL(root);url.searchParams.set('limit','100');url.searchParams.set('raw_json','1');if(target.type==='user'){url.searchParams.set('sort',sort);if(sort==='top')url.searchParams.set('t',time);}else if(sort==='top')url.searchParams.set('t',time);if(after)url.searchParams.set('after',after);
   const data=await getJson(url.href);const children=data?.data?.children||[];if(!children.length)break;
   for(const child of children){const p=child.data;for(const asset of candidates(p,options))posts.push({...asset,title:p.title||p.id,postId:p.id});if(posts.length>=limit)break;}
   after=data.data.after;pages++;if(!after)break;
 }
 return posts.slice(0,limit);
}
async function download(raw, dest, attempts=3){
 let url=checkedUrl(raw);
 for(let i=0;i<=attempts;i++){
  const r=await safeFetch(url.href,{headers:{'User-Agent':UA},signal:AbortSignal.timeout(60000)});
  if(r.status===403)throw new Error('Le serveur du média a refusé le téléchargement (403).');
  if(r.status===429&&i<attempts){await new Promise(x=>setTimeout(x,1000*2**i));continue;}
  if(!r.ok)throw new Error(`Échec du média : HTTP ${r.status}.`);
  const fs=require('node:fs'); await pipeline(Readable.fromWeb(r.body),fs.createWriteStream(dest));return;
 }
 throw new Error('Téléchargement impossible après plusieurs tentatives.');
}
module.exports={scan,download,parseTarget,checkedUrl,safeFetch};
