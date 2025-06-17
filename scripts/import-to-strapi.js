// scripts/import-to-strapi.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// @ts-ignore
const posts = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/wordpress-posts.json')));
const imageFolder = path.resolve(__dirname, '../data/imagens');

const STRAPI_URL = 'http://localhost:1337/api/posts'; // ajuste se necessário
const STRAPI_UPLOAD = 'http://localhost:1337/api/upload';
const STRAPI_TOKEN = 'c5a6c7ccc89fc5cacbf6e06bfa799c677ff81640f9f8d745c7f639f81eab2b206ea5063b4f7825b24528547e0007beb7af20831b2f0696740fc0c35d6cca00b7d237876049b7fc19688153ca7295d3d76c9de7b7bcbc4a6044bbadfe40eb125eb7b5103b8e1cbe19a14651951b4dbb6614c04afa083c54239be2b6dbb68912c6';

async function uploadImage(filename) {
  const filePath = path.join(imageFolder, filename);
  if (!fs.existsSync(filePath)) return null;

  const form = new FormData();
  form.append('files', fs.createReadStream(filePath));

  try {
    const res = await axios.post(STRAPI_UPLOAD, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${STRAPI_TOKEN}`,
      },
    });
    return res.data?.[0]?.id || null;
  } catch (err) {
    console.warn(`❌ Erro ao fazer upload de ${filename}`);
    return null;
  }
}

async function importPosts() {
  let success = 0;
  let fail = 0;

  for (const post of posts) {
    const { image, ...postData } = post;

    if (image) {
      const imageId = await uploadImage(image);
      if (imageId) postData.image = imageId;
    }

    try {
      await axios.post(
        STRAPI_URL,
        { data: postData },
        {
          headers: {
            Authorization: `Bearer ${STRAPI_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      success++;
      console.log(`✅ Post criado: ${postData.titulo}`);
    } catch (err) {
      fail++;
      console.error(`❌ Falha em ${postData.titulo}:`, err.response?.data || err.message);
    }
  }

  console.log(`\n🟢 Sucesso: ${success} | 🔴 Falhas: ${fail}`);
}

importPosts();