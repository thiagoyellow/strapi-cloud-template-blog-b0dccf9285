const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const mime = require('mime-types');
const csv = require('csv-parser');

// Configurações
const CSV_FILE = path.join(__dirname, '..', 'export-media-urls-232106.csv');
const WORDPRESS_DATA = path.join(__dirname, '..', 'data', 'wordpress-posts.json');
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'downloaded_images');

class SuperImageMatcher {
  constructor() {
    this.mediaUrls = [];
    this.posts = [];
    this.wordpressPosts = [];
    this.successfulMatches = 0;
    this.processedImages = 0;
  }

  async init() {
    console.log('🚀 SUPER IMAGE MATCHER - Versão Melhorada\n');
    
    // 1. Carregar dados do WordPress original
    this.wordpressPosts = JSON.parse(fs.readFileSync(WORDPRESS_DATA, 'utf8'));
    console.log(`📚 Posts WordPress carregados: ${this.wordpressPosts.length}`);
    
    // 2. Carregar URLs do CSV (SEM FILTROS RESTRITIVOS)
    await this.loadAllMediaUrls();
    
    // 3. Carregar posts do Strapi
    await this.loadStrapiPosts();
    
    console.log(`📊 Dados carregados:`);
    console.log(`   • URLs de mídia: ${this.mediaUrls.length}`);
    console.log(`   • Posts no Strapi: ${this.posts.length}`);
    console.log(`   • Posts WordPress: ${this.wordpressPosts.length}\n`);
  }

  async loadAllMediaUrls() {
    return new Promise((resolve, reject) => {
      const results = [];
      
      fs.createReadStream(CSV_FILE)
        .pipe(csv())
        .on('data', (row) => {
          const cleanRow = {
            id: row.ID,
            title: row.Title ? row.Title.replace(/"/g, '').trim() : '',
            fileName: row['File Name'] ? row['File Name'].trim() : '',
            url: row.URL ? row.URL.trim() : '',
            dateUploaded: row['Date Uploaded'] ? row['Date Uploaded'].trim() : ''
          };
          
          // CARREGAR TODAS as imagens (sem filtros restritivos)
          if (cleanRow.url && cleanRow.fileName) {
            results.push(cleanRow);
          }
        })
        .on('end', () => {
          this.mediaUrls = results;
          console.log(`✅ ${results.length} URLs carregadas (TODAS, sem filtros)`);
          resolve();
        })
        .on('error', reject);
    });
  }
  async loadStrapiPosts() {
    try {
      console.log('🔍 Tentando carregar posts do Strapi...');
      
      // Método 1: Usando documents API
      try {
        const posts = await strapi.documents('api::post.post').findMany({
          fields: ['titulo', 'slug', 'createdAt'],
          populate: { image: { fields: ['name', 'url'] } },
          pagination: { page: 1, pageSize: 10000 }
        });
        
        this.posts = posts.results || posts || [];
        console.log(`✅ ${this.posts.length} posts carregados via documents API`);
        return;
      } catch (docError) {
        console.log(`⚠️  Documents API falhou: ${docError.message}`);
        
        // Método 2: Usando entityService
        try {
          const posts = await strapi.entityService.findMany('api::post.post', {
            fields: ['titulo', 'slug', 'createdAt'],
            populate: { image: { fields: ['name', 'url'] } },
            limit: 10000
          });
          
          this.posts = Array.isArray(posts) ? posts : [];
          console.log(`✅ ${this.posts.length} posts carregados via entityService`);
          return;
        } catch (entityError) {
          console.log(`⚠️  EntityService falhou: ${entityError.message}`);
          
          // Método 3: Usando query direta
          try {
            const posts = await strapi.db.query('api::post.post').findMany({
              select: ['titulo', 'slug', 'createdAt'],
              populate: { image: { select: ['name', 'url'] } },
              limit: 10000
            });
            
            this.posts = Array.isArray(posts) ? posts : [];
            console.log(`✅ ${this.posts.length} posts carregados via query direta`);
            return;
          } catch (queryError) {
            console.log(`❌ Query direta falhou: ${queryError.message}`);
            this.posts = [];
          }
        }
      }
      
      if (this.posts.length > 0) {
        console.log(`📝 Exemplo de post: "${this.posts[0].titulo}" (slug: ${this.posts[0].slug})`);
      }
    } catch (error) {
      console.error('❌ Erro geral ao carregar posts:', error.message);
      this.posts = [];
    }
  }

  // Método SUPER melhorado de matching
  findBestMatch(mediaItem) {
    const mediaTitle = (mediaItem.title || '').toLowerCase().trim();
    const fileName = (mediaItem.fileName || '').toLowerCase().trim();
    const fileNameWithoutExt = fileName.replace(/\.(jpg|jpeg|png|gif|webp|pdf)$/i, '');
    
    let bestMatch = null;
    let bestScore = 0;
    let matchReason = '';
    
    for (const post of this.posts) {
      const postSlug = (post.slug || '').toLowerCase().trim();
      const postTitle = (post.titulo || '').toLowerCase().trim();
      
      let score = 0;
      let reasons = [];
      
      // Estratégia 1: Match EXATO do título da mídia com slug
      if (mediaTitle && postSlug && mediaTitle === postSlug) {
        score += 1000;
        reasons.push('título=slug');
      }
      
      // Estratégia 2: Slug contém título da mídia OU vice-versa
      if (mediaTitle && postSlug) {
        if (postSlug.includes(mediaTitle) || mediaTitle.includes(postSlug)) {
          score += 800;
          reasons.push('slug/título contém');
        }
      }
      
      // Estratégia 3: Palavras-chave em comum (mais flexível)
      if (mediaTitle && postSlug) {
        const mediaWords = mediaTitle.split(/[-_\s]+/).filter(w => w.length > 3);
        const slugWords = postSlug.split('-').filter(w => w.length > 3);
        
        let commonWords = 0;
        for (const mediaWord of mediaWords) {
          for (const slugWord of slugWords) {
            if (mediaWord.includes(slugWord) || slugWord.includes(mediaWord)) {
              commonWords++;
              break;
            }
          }
        }
        
        if (commonWords > 0) {
          const percentage = (commonWords / Math.max(mediaWords.length, slugWords.length));
          score += percentage * 600;
          reasons.push(`${commonWords}/${Math.max(mediaWords.length, slugWords.length)} palavras`);
        }
      }
      
      // Estratégia 4: Similaridade de título completo
      if (mediaTitle && postTitle) {
        const similarity = this.calculateSimilarity(mediaTitle, postTitle);
        if (similarity > 0.3) {
          score += similarity * 400;
          reasons.push(`${(similarity*100).toFixed(0)}% similar`);
        }
      }
      
      // Estratégia 5: Data aproximada (se disponível)
      if (mediaItem.dateUploaded && post.createdAt) {
        const mediaDate = new Date(mediaItem.dateUploaded);
        const postDate = new Date(post.createdAt);
        const diffDays = Math.abs((mediaDate - postDate) / (1000 * 60 * 60 * 24));
        
        if (diffDays < 7) { // Dentro de uma semana
          score += 100;
          reasons.push('data próxima');
        }
      }
      
      // Estratégia 6: Match por número/ID (para anabbprev_images)
      if (fileName.includes('anabbprev_anabbprev_image_')) {
        const imageId = fileName.match(/anabbprev_anabbprev_image_(\d+)/);
        if (imageId && postTitle.includes(imageId[1])) {
          score += 500;
          reasons.push('ID numérico');
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = post;
        matchReason = reasons.join(', ');
      }
    }
    
    // Retornar match mesmo com score baixo, mas indicar confiança
    if (bestMatch) {
      return {
        post: bestMatch,
        score: bestScore,
        confidence: bestScore > 500 ? 'ALTA' : bestScore > 200 ? 'MÉDIA' : 'BAIXA',
        reason: matchReason
      };
    }
    
    return null;
  }

  calculateSimilarity(str1, str2) {
    const words1 = str1.split(/\s+/).filter(w => w.length > 2);
    const words2 = str2.split(/\s+/).filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    let matches = 0;
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1.includes(word2) || word2.includes(word1)) {
          matches++;
          break;
        }
      }
    }
    
    return matches / Math.max(words1.length, words2.length);
  }

  async processAllImages() {
    console.log('🔄 PROCESSANDO TODAS AS IMAGENS...');
    console.log('═'.repeat(60));
    
    let postsUpdated = 0;
    let postsWithImageAlready = 0;
    let noMatchFound = 0;
    let lowConfidenceMatches = 0;
    
    for (let i = 0; i < this.mediaUrls.length; i++) {
      const mediaItem = this.mediaUrls[i];
      this.processedImages++;
      
      console.log(`\\n[${i + 1}/${this.mediaUrls.length}] ${mediaItem.fileName}`);
      console.log('─'.repeat(50));
      
      // Verificar se a imagem já foi baixada
      const imagePath = path.join(IMAGES_DIR, mediaItem.fileName);
      if (!await fs.pathExists(imagePath)) {
        console.log('   ⏭️  Imagem não baixada, pulando...');
        continue;
      }
      
      // Encontrar melhor match
      const matchResult = this.findBestMatch(mediaItem);
      
      if (!matchResult) {
        console.log('   ❌ Nenhum match encontrado');
        noMatchFound++;
        continue;
      }
      
      const { post, score, confidence, reason } = matchResult;
      console.log(`   🎯 Match: "${post.titulo.substring(0, 50)}..."`);
      console.log(`   📊 Score: ${score.toFixed(1)} | Confiança: ${confidence}`);
      console.log(`   💡 Razão: ${reason}`);
      
      // Verificar se post já tem imagem
      if (post.image && post.image.length > 0) {
        console.log('   ⏭️  Post já tem imagem');
        postsWithImageAlready++;
        continue;
      }
      
      // Processar apenas matches de confiança MÉDIA ou ALTA
      if (confidence === 'BAIXA' && score < 150) {
        console.log('   ⚠️  Confiança muito baixa, pulando...');
        lowConfidenceMatches++;
        continue;
      }
      
      // Tentar fazer upload e associar
      const success = await this.processImageForPost(mediaItem, post);
      if (success) {
        postsUpdated++;
        console.log('   ✅ Post atualizado com sucesso!');
      }
      
      // Pausa entre processamentos
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Relatório final
    console.log('\\n' + '═'.repeat(60));
    console.log('📊 RELATÓRIO FINAL');
    console.log('═'.repeat(60));
    console.log(`📥 Imagens processadas: ${this.processedImages}`);
    console.log(`✅ Posts atualizados: ${postsUpdated}`);
    console.log(`⏭️  Posts já tinham imagem: ${postsWithImageAlready}`);
    console.log(`❌ Sem match encontrado: ${noMatchFound}`);
    console.log(`⚠️  Confiança baixa: ${lowConfidenceMatches}`);
    console.log(`📈 Taxa de sucesso: ${((postsUpdated / this.processedImages) * 100).toFixed(1)}%`);
    console.log('═'.repeat(60));
  }

  async processImageForPost(mediaItem, post) {
    try {
      const imagePath = path.join(IMAGES_DIR, mediaItem.fileName);
      
      // Upload para Strapi se necessário
      let uploadedImage = await this.findExistingImage(mediaItem.fileName);
      
      if (!uploadedImage) {
        uploadedImage = await this.uploadImageToStrapi(imagePath, mediaItem.fileName);
        if (!uploadedImage) return false;
      }
      
      // Atualizar post
      await strapi.documents('api::post.post').update({
        documentId: post.documentId,
        data: { image: [uploadedImage] }
      });
      
      return true;
    } catch (error) {
      console.log(`   ❌ Erro: ${error.message}`);
      return false;
    }
  }

  async findExistingImage(fileName) {
    try {
      const nameWithoutExt = path.basename(fileName, path.extname(fileName));
      const existingFile = await strapi.query('plugin::upload.file').findOne({
        where: { name: nameWithoutExt }
      });
      return existingFile;
    } catch (error) {
      return null;
    }
  }

  async uploadImageToStrapi(imagePath, originalName) {
    try {
      const stats = await fs.stat(imagePath);
      const ext = path.extname(imagePath);
      const mimeType = mime.lookup(ext) || 'application/octet-stream';
      const fileName = path.basename(originalName, path.extname(originalName));

      const fileData = {
        filepath: imagePath,
        originalFileName: path.basename(imagePath),
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
              alternativeText: `Imagem: ${fileName}`,
              caption: fileName,
              name: fileName,
            },
          },
        });

      return uploadedFiles[0];
    } catch (error) {
      return null;
    }
  }
}

async function runSuperMatcher() {
  const matcher = new SuperImageMatcher();
  
  try {
    await matcher.init();
    await matcher.processAllImages();
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
    
    await runSuperMatcher();
    
    console.log('\\n🎉 Processamento concluído!');
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

module.exports = { SuperImageMatcher };
