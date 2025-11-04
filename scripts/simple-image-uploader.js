const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

// Configurações
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'downloaded_images');

class SimpleImageUploader {
  constructor() {
    this.processed = 0;
    this.uploaded = 0;
    this.matched = 0;
  }

  async init() {
    console.log('🚀 SIMPLE IMAGE UPLOADER - Processamento Local\n');
  }

  async processAvailableImages() {
    try {
      // Listar todas as imagens baixadas
      const imageFiles = fs.readdirSync(IMAGES_DIR).filter(f => 
        f.match(/\.(jpg|jpeg|png|gif|webp)$/i)
      );
      
      console.log(`📁 Imagens encontradas: ${imageFiles.length}`);
      
      // Carregar posts do Strapi
      const posts = await this.loadStrapiPosts();
      console.log(`📝 Posts carregados: ${posts.length}`);
      
      const postsWithoutImage = posts.filter(p => !p.image || p.image.length === 0);
      console.log(`❌ Posts sem imagem: ${postsWithoutImage.length}`);
      
      console.log('\n🔄 INICIANDO PROCESSAMENTO...');
      console.log('═'.repeat(60));
      
      let successCount = 0;
      
      // Estratégia 1: Match por nome de arquivo similar ao slug
      for (const post of postsWithoutImage) {
        if (successCount >= Math.min(50, imageFiles.length)) break; // Limite de 50 processamentos por execução
        
        const bestImage = this.findBestImageForPost(post, imageFiles);
        
        if (bestImage) {
          console.log(`\n[${successCount + 1}] Processando: ${post.titulo.substring(0, 50)}...`);
          console.log(`    Imagem: ${bestImage}`);
          
          const success = await this.uploadAndAssignImage(bestImage, post);
          if (success) {
            successCount++;
            console.log(`    ✅ Sucesso!`);
          } else {
            console.log(`    ❌ Falhou`);
          }
        }
        
        this.processed++;
        
        // Pausa entre processamentos
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log('\n' + '═'.repeat(60));
      console.log('📊 RESUMO:');
      console.log(`📥 Processados: ${this.processed}`);
      console.log(`✅ Associados: ${successCount}`);
      console.log(`📈 Taxa de sucesso: ${((successCount / this.processed) * 100).toFixed(1)}%`);
      
    } catch (error) {
      console.error('❌ Erro:', error.message);
    }
  }

  async loadStrapiPosts() {
    try {
      // Usar método que sabemos que funciona
      const posts = await strapi.documents('api::post.post').findMany({
        fields: ['titulo', 'slug', 'createdAt'],
        populate: { image: { fields: ['name'] } },
        pagination: { page: 1, pageSize: 10000 }
      });
      
      return posts.results || posts || [];
    } catch (error) {
      console.log('Tentando método alternativo...');
      
      try {
        const posts = await strapi.entityService.findMany('api::post.post', {
          fields: ['titulo', 'slug', 'createdAt'],
          populate: { image: { fields: ['name'] } },
          limit: 10000
        });
        
        return Array.isArray(posts) ? posts : [];
      } catch (error2) {
        console.error('Erro ao carregar posts:', error2.message);
        return [];
      }
    }
  }

  findBestImageForPost(post, imageFiles) {
    const postSlug = (post.slug || '').toLowerCase();
    const postTitle = (post.titulo || '').toLowerCase();
    
    // Estratégia 1: Match direto por slug
    for (const imageFile of imageFiles) {
      const imageName = imageFile.toLowerCase().replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
      
      if (imageName === postSlug) {
        return imageFile;
      }
    }
    
    // Estratégia 2: Post thumbnails com palavras-chave do título
    const postThumbnails = imageFiles.filter(f => f.startsWith('post_thumbnail-'));
    if (postThumbnails.length > 0) {
      // Retornar um thumbnail aleatório (melhor que nada)
      return postThumbnails[Math.floor(Math.random() * postThumbnails.length)];
    }
    
    // Estratégia 3: Match por palavras-chave no nome da imagem
    const titleWords = postTitle.split(/\s+/).filter(w => w.length > 4);
    for (const word of titleWords) {
      for (const imageFile of imageFiles) {
        if (imageFile.toLowerCase().includes(word)) {
          return imageFile;
        }
      }
    }
    
    // Estratégia 4: Imagens nomeadas específicas
    const namedImages = imageFiles.filter(f => 
      f.includes('previdencia') || 
      f.includes('investimento') || 
      f.includes('anabbprev') ||
      f.includes('financeiro')
    );
    
    if (namedImages.length > 0) {
      return namedImages[Math.floor(Math.random() * namedImages.length)];
    }
    
    return null;
  }

  async uploadAndAssignImage(imageFileName, post) {
    try {
      const imagePath = path.join(IMAGES_DIR, imageFileName);
      
      // Verificar se já existe no Strapi
      const fileNameWithoutExt = path.basename(imageFileName, path.extname(imageFileName));
      let uploadedImage = await strapi.query('plugin::upload.file').findOne({
        where: { name: fileNameWithoutExt }
      });
      
      // Se não existe, fazer upload
      if (!uploadedImage) {
        const stats = await fs.stat(imagePath);
        const ext = path.extname(imagePath);
        const mimeType = mime.lookup(ext) || 'application/octet-stream';

        const fileData = {
          filepath: imagePath,
          originalFileName: imageFileName,
          size: stats.size,
          mimetype: mimeType,
        };

        const uploadedFiles = await strapi
          .plugin('upload')
          .service('upload')
          .upload({
            files: fileData,
            data: {
              fileInfo: {
                alternativeText: `Imagem: ${fileNameWithoutExt}`,
                caption: fileNameWithoutExt,
                name: fileNameWithoutExt,
              },
            },
          });

        uploadedImage = uploadedFiles[0];
      }
      
      // Associar ao post
      if (uploadedImage) {
        await strapi.documents('api::post.post').update({
          documentId: post.documentId,
          data: { image: [uploadedImage] }
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.log(`    Erro: ${error.message}`);
      return false;
    }
  }
}

async function runSimpleUploader() {
  const uploader = new SimpleImageUploader();
  
  try {
    await uploader.init();
    await uploader.processAvailableImages();
  } catch (error) {
    console.error('💥 Erro durante processamento:', error);
    process.exit(1);
  }
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  
  try {
    console.log('🏁 Inicializando Strapi...');
    const appContext = await compileStrapi();
    const app = await createStrapi(appContext).load();
    app.log.level = 'error';
    
    global.strapi = app;
    
    await runSimpleUploader();
    
    console.log('\n🎉 Processamento concluído!');
    await app.destroy();
    process.exit(0);
  } catch (error) {
    console.error('💥 Erro ao inicializar:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { SimpleImageUploader };
