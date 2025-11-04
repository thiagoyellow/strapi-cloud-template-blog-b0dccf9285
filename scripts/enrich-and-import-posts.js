// Script: enrich-and-import-posts.js
// Objetivo: Enriquecer posts (gerar/atribuir imagem) e importar no Strapi evitando duplicações.
// Uso: STRAPI_TOKEN=xxx node scripts/enrich-and-import-posts.js [--limit=5]
// Variáveis de ambiente suportadas:
//  STRAPI_URL (default http://localhost:1337)
//  STRAPI_TOKEN (obrigatório)
//  IMAGE_PROVIDER (pexels|unsplash|picsum) default picsum
//  PEXELS_API_KEY / UNSPLASH_ACCESS_KEY quando aplicável
//  RATE_LIMIT_MS (default 1200)
//  USE_ORIGINAL_PUBLISHED_AT=true para usar data original
//  DRAFT_MODE=true para criar como rascunho (ignora publishedAt)
//  MAX_RETRIES=2 (download/upload)
// Saída de log: JSON lines no arquivo migration-log.jsonl

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ===== Config =====
const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
if (!STRAPI_TOKEN) { console.error('Defina STRAPI_TOKEN'); process.exit(1); }
const POSTS_SOURCE = path.resolve(__dirname, '../posts_stripe_full_com_imagens.json');
const LOG_FILE = path.resolve(__dirname, '../migration-log.jsonl');
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'picsum').toLowerCase();
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '1200', 10);
const USE_ORIGINAL_PUBLISHED_AT = /^true$/i.test(process.env.USE_ORIGINAL_PUBLISHED_AT || 'true');
const DRAFT_MODE = /^true$/i.test(process.env.DRAFT_MODE || 'false');
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2', 10);

// ===== Util =====
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function toSlug(str){
  return (str||'')
    .normalize('NFD').replace(/[^\p{L}\p{N}]+/gu,'-')
    .replace(/^-+|-+$/g,'')
    .toLowerCase().slice(0,120);
}
function stripHtml(html){ return (html||'').replace(/<[^>]*>/g,' '); }
function cleanContent(html){
  return (html||'')
    .replace(/\[rock-convert-pdf[^\]]*\]/gi,'')
    .replace(/\[(gallery|embed|shortcode)[^\]]*\]/gi,'')
    .replace(/<!--\s*wp:[^>]*-->/gi,'')
    .replace(/<!--\/?wp:[^>]*-->/gi,'')
    .replace(/\u00a0/g,' ');
}
function isImageUrl(u){ return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u||''); }
function isPdf(u){ return /\.pdf(\?|$)/i.test(u||''); }
function logLine(obj){ fs.appendFileSync(LOG_FILE, JSON.stringify(obj)+'\n'); }

async function getExistingPostBySlug(slug){
  try {
    const res = await axios.get(`${STRAPI_URL}/api/posts`, {
      params: { 'filters[slug][$eq]': slug, 'pagination[limit]': 1 },
      headers: { Authorization: `Bearer ${STRAPI_TOKEN}` }
    });
    return res.data?.data?.length ? res.data.data[0] : null;
  } catch(e){ return null; }
}

async function uploadBufferToStrapi(buffer, filename, mime){
  const attempt = async () => {
    const form = new FormData();
    form.append('files', buffer, { filename, contentType: mime });
    return axios.post(`${STRAPI_URL}/api/upload`, form, { headers: { ...form.getHeaders(), Authorization: `Bearer ${STRAPI_TOKEN}` } });
  };
  for (let i=0;i<=MAX_RETRIES;i++){ // i=0 primeira tentativa
    try {
      const res = await attempt();
      return res.data?.[0]?.id || null;
    } catch(e){
      if (i===MAX_RETRIES){
        logLine({ level:'error', stage:'upload', filename, attempt:i, error: e.response?.data || e.message });
        return null;
      }
      await sleep(500 * (i+1));
    }
  }
}

async function fetchRemoteImage(url){
  for (let i=0;i<=MAX_RETRIES;i++){
    try {
      const res = await axios.get(url, { responseType:'arraybuffer', timeout:15000 });
      const ct = res.headers['content-type'] || 'image/jpeg';
      return { buffer: Buffer.from(res.data), mime: ct };
    } catch(e){
      if (i===MAX_RETRIES){
        logLine({ level:'warn', stage:'download', url, attempt:i, error:e.message });
        return null;
      }
      await sleep(400 * (i+1));
    }
  }
}

async function getImageForPost(post){
  // 1. Se já há campo imagem com URL válida de imagem
  if (post.imagem && /^https?:\/\//i.test(post.imagem) && isImageUrl(post.imagem)) {
    const fetched = await fetchRemoteImage(post.imagem);
    if (fetched) return { ...fetched, filename: path.basename(post.imagem.split('?')[0]) };
  }
  // 2. Caso seja PDF ignorar
  if (post.imagem && isPdf(post.imagem)) {
    logLine({ level:'info', stage:'image-skip-pdf', post_id:post.post_id, url:post.imagem });
  }
  // 3. Provider externo
  const keywords = extractKeywords(post);
  if (IMAGE_PROVIDER === 'pexels') return await fetchFromPexels(keywords, post);
  if (IMAGE_PROVIDER === 'unsplash') return await fetchFromUnsplash(keywords, post);
  // 4. Fallback picsum
  const seed = encodeURIComponent((post.slug || toSlug(post.titulo || 'seed')));
  return await fetchRemoteImage(`https://picsum.photos/seed/${seed}/960/540`)
    .then(r => r && { ...r, filename: `${seed}.jpg` });
}

function extractKeywords(post){
  const base = `${post.titulo || ''} ${(stripHtml(post.descricao||post.descricao)||'')}`.toLowerCase();
  // Palavras relevantes (simples): remove stopwords básicas PT
  const stop = new Set(['de','da','do','a','o','e','para','por','em','um','uma','no','na','que','os','as','com','se','sobre','ao','mais','menos']);
  const freq = {};
  base.split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>3 && !stop.has(w)).forEach(w=>{ freq[w]=(freq[w]||0)+1; });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(p=>p[0]);
}

async function fetchFromPexels(keywords, post){
  const key = process.env.PEXELS_API_KEY;
  if (!key){ logLine({ level:'warn', stage:'image-provider-missing-key', provider:'pexels' }); return null; }
  try {
    const query = keywords[0] || 'finance';
    const res = await axios.get('https://api.pexels.com/v1/search', { params:{ query, per_page:1 }, headers:{ Authorization: key }});
    const photo = res.data?.photos?.[0];
    if (!photo) return null;
    const fetched = await fetchRemoteImage(photo.src?.large || photo.src?.original);
    return fetched && { ...fetched, filename: `pexels-${photo.id}.jpg` };
  } catch(e){ logLine({ level:'warn', stage:'pexels', error:e.message }); return null; }
}

async function fetchFromUnsplash(keywords, post){
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key){ logLine({ level:'warn', stage:'image-provider-missing-key', provider:'unsplash' }); return null; }
  try {
    const query = keywords.join(' ') || 'finance';
    const res = await axios.get('https://api.unsplash.com/photos/random', { params:{ query, orientation:'landscape' }, headers:{ Authorization: `Client-ID ${key}` }});
    const url = res.data?.urls?.regular || res.data?.urls?.full;
    if (!url) return null;
    const fetched = await fetchRemoteImage(url);
    return fetched && { ...fetched, filename: `unsplash-${res.data.id}.jpg` };
  } catch(e){ logLine({ level:'warn', stage:'unsplash', error:e.message }); return null; }
}

async function createPostInStrapi(post, mediaId){
  const descricao = post.descricao || post.description || '';
  const dateRaw = post.data || post.date || '';
  const date = dateRaw ? dateRaw.split(' ')[0] : null;
  const category = Array.isArray(post.categorias) ? post.categorias[0] : (post.category || '');
  const publishedAt = (!DRAFT_MODE && post.status === 'publish')
    ? (USE_ORIGINAL_PUBLISHED_AT && dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString())
    : null;
  const payload = { data: {
    titulo: post.titulo,
    description: cleanContent(descricao),
    date,
    image: mediaId ? [mediaId] : [],
    thumbnail: mediaId || null,
    category,
    publishedAt,
  }};
  try {
    const res = await axios.post(`${STRAPI_URL}/api/posts`, payload, { headers:{ Authorization:`Bearer ${STRAPI_TOKEN}` }});
    return res.data;
  } catch(e){
    throw new Error(JSON.stringify(e.response?.data || e.message));
  }
}

async function processPost(raw){
  const start = Date.now();
  const slug = toSlug(raw.slug || raw.titulo || raw.post_id || 'post');
  raw.slug = slug; // para referência local
  // Deduplicação
  const existing = await getExistingPostBySlug(slug);
  if (existing){
    logLine({ level:'info', action:'skip-exists', slug, post_id: raw.post_id });
    return { skipped:true };
  }
  let mediaId = null;
  try {
    const img = await getImageForPost(raw);
    if (img){
      mediaId = await uploadBufferToStrapi(img.buffer, img.filename, img.mime);
    }
    const created = await createPostInStrapi(raw, mediaId);
    logLine({ level:'info', action:'created', slug, post_id: raw.post_id, mediaId, elapsed_ms: Date.now()-start });
    return { created:true };
  } catch(e){
    logLine({ level:'error', action:'create-failed', slug, post_id: raw.post_id, error: e.message });
    return { error:true };
  }
}

async function main(){
  if (!fs.existsSync(POSTS_SOURCE)) { console.error('Arquivo fonte não encontrado'); process.exit(1);}  
  if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  const posts = JSON.parse(fs.readFileSync(POSTS_SOURCE,'utf-8'));
  const limitArg = process.argv.find(a=>a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1],10) : posts.length;
  let processed=0, created=0, skipped=0, failed=0;
  for (const post of posts.slice(0,limit)){
    await sleep(RATE_LIMIT_MS); // rate limit externo
    const res = await processPost(post);
    processed++;
    if (res.created) created++; else if (res.skipped) skipped++; else if (res.error) failed++;
    process.stdout.write(`\rProcessados: ${processed}/${limit} | Criados:${created} Skipped:${skipped} Erros:${failed}`);
  }
  console.log('\nConcluído. Ver log em', LOG_FILE);
  const summary = { timestamp: new Date().toISOString(), processed, created, skipped, failed, provider: IMAGE_PROVIDER, draftMode: DRAFT_MODE, useOriginalPublishedAt: USE_ORIGINAL_PUBLISHED_AT };
  logLine({ level:'summary', ...summary });
  if (failed>0) process.exitCode = 1;
}

main().catch(e=>{ console.error('Falha geral', e); });
