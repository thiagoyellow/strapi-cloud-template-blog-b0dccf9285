// Script para migrar posts do posts_data.json para o Strapi, associando imagens
// Uso: STRAPI_TOKEN=seu_token node scripts/migrate-posts-with-images.js
// OBS: Script legado. Preferir usar enrich-and-import-posts.js para nova migração com enriquecimento de imagens.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const csvParse = require('csv-parse/sync');

// Configurações
const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const STRAPI_TOKEN = process.env.STRAPI_TOKEN; // Token via env
if (!STRAPI_TOKEN) {
  console.error('Erro: defina STRAPI_TOKEN no ambiente.');
  process.exit(1);
}
const POSTS_JSON = path.resolve(__dirname, '../posts_data.json');
const MEDIA_CSV = path.resolve(__dirname, '../export-media-urls-232106.csv');
const IMAGES_DIR = path.resolve(__dirname, '../public/downloaded_images');

// Função para upload de imagem
async function uploadImageToStrapi(filePath, fileName) {
  const form = new FormData();
  form.append('files', fs.createReadStream(filePath), fileName);
  try {
    const response = await axios.post(`${STRAPI_URL}/api/upload`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${STRAPI_TOKEN}`,
      },
    });
    return response.data[0]?.id || null;
  } catch (e) {
    console.error('Erro ao fazer upload:', fileName, e.response?.data || e.message);
    return null;
  }
}

// Função para criar post
async function createPost(post, imageId) {
  // Mapeia campos possivelmente divergentes (descricao -> description, data -> date)
  const description = post.description || post.descricao || '';
  const date = post.date || post.data || '';
  const payload = {
    data: {
      titulo: post.titulo,
      description,
      date: date ? date.split(' ')[0] : null,
      image: imageId ? [imageId] : [],
      // publishedAt garante publicação imediata
      publishedAt: post.publishedAt || new Date().toISOString(),
      category: post.category || (Array.isArray(post.categorias) ? post.categorias[0] : post.categoria) || '',
    },
  };
  try {
    const response = await axios.post(`${STRAPI_URL}/api/posts`, payload, {
      headers: { Authorization: `Bearer ${STRAPI_TOKEN}` },
    });
    return response.data;
  } catch (e) {
    console.error('Erro ao criar post:', post.titulo, e.response?.data || e.message);
    return null;
  }
}

// Função principal
async function migrate() {
  // 1. Ler posts
  const posts = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf-8'));
  // 2. Ler CSV de imagens
  const csvContent = fs.readFileSync(MEDIA_CSV, 'utf-8');
  /** @type {any[]} */
  const records = csvParse.parse(csvContent, { columns: true });
  // 3. Criar mapa de título/slug para nome de arquivo
  const imageMap = {};
  for (const rec of records) {
    const r = /** @type {any} */ (rec);
    const titleKey = (r['Title'] || r['title'] || r['Post Title'] || r['post_title'] || '').toString().trim().toLowerCase();
    if (titleKey) {
      const fname = r['File Name'] || r['File'] || r['file_name'];
      if (fname) imageMap[titleKey] = fname;
    }
  }
  // 4. Para cada post, buscar imagem e migrar
  for (const post of posts) {
    let imageId = null;
    // Tenta encontrar imagem pelo título
    const key = post.titulo?.trim().toLowerCase();
    const fileName = imageMap[key];
    if (fileName) {
      const filePath = path.join(IMAGES_DIR, fileName);
      if (fs.existsSync(filePath)) {
        imageId = await uploadImageToStrapi(filePath, fileName);
      } else {
        console.warn('Arquivo de imagem não encontrado:', fileName);
      }
    } else {
      console.warn('Imagem não mapeada para post:', post.titulo);
    }
    // Cria o post no Strapi
    await createPost(post, imageId);
    console.log('Post migrado:', post.titulo);
  }
  console.log('Migração concluída!');
}

migrate();
