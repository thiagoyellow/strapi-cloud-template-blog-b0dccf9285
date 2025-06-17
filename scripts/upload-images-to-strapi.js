// Script para baixar e fazer upload das imagens dos posts para o Strapi
// Salve como scripts/upload-images-to-strapi.js
// Rode com: node scripts/upload-images-to-strapi.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');

const postsFile = path.resolve(__dirname, '../data/wordpress-posts.json');
const outputFile = path.resolve(__dirname, '../data/wordpress-posts-with-images.json');
const STRAPI_UPLOAD_URL = 'http://localhost:1337/api/upload';
const STRAPI_TOKEN = 'COLE_SEU_TOKEN_AQUI'; // Use o mesmo token do import

async function downloadImage(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return response.data;
  } catch (e) {
    console.error('Erro ao baixar imagem:', url);
    return null;
  }
}

async function uploadImageToStrapi(buffer, filename) {
  const form = new FormData();
  form.append('files', buffer, filename);
  try {
    const response = await axios.post(STRAPI_UPLOAD_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${STRAPI_TOKEN}`,
      },
    });
    // Retorna o ID do arquivo
    return response.data[0]?.id;
  } catch (e) {
    console.error('Erro ao fazer upload para o Strapi:', filename, e.response?.data || e.message);
    return null;
  }
}

async function processImages() {
  const posts = JSON.parse(fs.readFileSync(postsFile, 'utf-8'));
  const urlToId = {};
  for (const post of posts) {
    if (post.image && post.image.startsWith('http')) {
      if (!urlToId[post.image]) {
        const buffer = await downloadImage(post.image);
        if (buffer) {
          const ext = path.extname(post.image).split('?')[0] || '.jpg';
          const filename = uuidv4() + ext;
          const id = await uploadImageToStrapi(buffer, filename);
          if (id) urlToId[post.image] = id;
        }
      }
      // Atualiza o campo image para o ID
      post.image = urlToId[post.image] || null;
    } else {
      post.image = null;
    }
  }
  fs.writeFileSync(outputFile, JSON.stringify(posts, null, 2), 'utf-8');
  console.log(`Imagens processadas e JSON salvo em ${outputFile}`);
}

processImages();

// Antes de rodar:
// 1. npm install axios form-data uuid
// 2. Cole seu token de API do Strapi na variável STRAPI_TOKEN
// 3. Certifique-se que o Strapi está rodando e a rota /api/upload está liberada para o token
