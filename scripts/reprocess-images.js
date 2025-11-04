'use strict';

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const mime = require('mime-types');
const csv = require('csv-parser');

// Configurações
const CSV_FILE = path.join(__dirname, '..', 'export-media-urls-232106.csv');
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'downloaded_images');
const BATCH_SIZE = 10; // Processar 10 imagens por vez

class ImageReprocessor {
  constructor() {
    this.successCount = 0;
    this.errorCount = 0;
    this.processedCount = 0;
    this.mediaUrls = [];
    this.posts = [];
  }

  async init() {
    console.log('🖼️ Iniciando reprocessamento de imagens...\n');
    
    // Garantir que o diretório existe
    await fs.ensureDir(IMAGES_DIR);
    
    // Carregar URLs do CSV
    await this.loadMediaUrls();
    
    // Carregar posts do Strapi
    await this.loadPosts();
    
    console.log(`📊 Dados carregados:`);
    console.log(`   • URLs de mídia: ${this.mediaUrls.length}`);
    console.log(`   • Posts no Strapi: ${this.posts.length}\n`);
    
    return true;
  }

  async loadMediaUrls() {
    return new Promise((resolve, reject) => {
      const results = [];
      
      fs.createReadStream(CSV_FILE)
        .pipe(csv())
        .on('data', (row) => {
          // Limpar e processar dados do CSV
          const cleanRow = {
            id: row.ID,
            title: row.Title ? row.Title.replace(/"/g, '') : '',
            fileName: row['File Name'] ? row['File Name'].replace(/"/g, '') : '',
            url: row.URL ? row.URL.replace(/"/g, '') : '',
            dateUploaded: row['Date Uploaded'] ? row['Date Uploaded'].replace(/"/g, '') : ''
          };
            // FILTRAR APENAS THUMBNAILS: post_thumbnail- ou imagens com nome descritivo relacionado ao post
          const isThumbnail = cleanRow.fileName.startsWith('post_thumbnail-') || 
                            (cleanRow.title && cleanRow.title.length > 10 && !cleanRow.fileName.includes('WhatsApp') && !cleanRow.fileName.includes('IMG_') && !cleanRow.fileName.includes('cropped-'));
          
          if (cleanRow.url && cleanRow.fileName && isThumbnail) {
            results.push(cleanRow);
          }
        })        .on('end', () => {
          this.mediaUrls = results;
          console.log(`✅ ${results.length} URLs de thumbnails carregadas do CSV`);
          console.log(`📋 Tipos de imagem encontrados:`);
          const postThumbnails = results.filter(r => r.fileName.startsWith('post_thumbnail-')).length;
          const namedImages = results.filter(r => !r.fileName.startsWith('post_thumbnail-')).length;
          console.log(`   • post_thumbnail-*: ${postThumbnails}`);
          console.log(`   • Imagens nomeadas: ${namedImages}`);
          resolve();
        })
        .on('error', reject);
    });
  }  async loadPosts() {
    try {
      // Tentar diferentes formas de consultar posts
      console.log('🔍 Tentando carregar posts...');
      
      // Método 1: Usando documents API
      try {
        const posts = await strapi.documents('api::post.post').findMany({
          fields: ['titulo', 'slug', 'createdAt'],
          populate: {
            image: {
              fields: ['name', 'url']
            }
          },
          pagination: { page: 1, pageSize: 10000 }
        });
        
        this.posts = posts.results || posts || [];
        console.log(`✅ ${this.posts.length} posts carregados via documents API`);
      } catch (docError) {
        console.log(`⚠️  Documents API falhou: ${docError.message}`);
        
        // Método 2: Usando entityService
        try {
          const posts = await strapi.entityService.findMany('api::post.post', {
            fields: ['titulo', 'slug', 'createdAt'],
            populate: {
              image: {
                fields: ['name', 'url']
              }
            },
            limit: 10000
          });
          
          this.posts = Array.isArray(posts) ? posts : [];
          console.log(`✅ ${this.posts.length} posts carregados via entityService`);
        } catch (entityError) {
          console.log(`⚠️  EntityService falhou: ${entityError.message}`);
          
          // Método 3: Usando query direta
          try {
            const posts = await strapi.db.query('api::post.post').findMany({
              select: ['titulo', 'slug', 'createdAt'],
              populate: {
                image: {
                  select: ['name', 'url']
                }
              },
              limit: 10000
            });
            
            this.posts = Array.isArray(posts) ? posts : [];
            console.log(`✅ ${this.posts.length} posts carregados via query direta`);
          } catch (queryError) {
            console.log(`❌ Query direta falhou: ${queryError.message}`);
            this.posts = [];
          }
        }
      }
      
      // Debug: mostrar alguns posts se carregados
      if (this.posts.length > 0) {
        console.log(`📝 Exemplo de post: "${this.posts[0].titulo}" (slug: ${this.posts[0].slug})`);
        console.log(`📝 Tem imagem? ${this.posts[0].image ? 'Sim' : 'Não'}`);
      }
    } catch (error) {
      console.error('❌ Erro geral ao carregar posts:', error.message);
      console.error('Stack trace:', error.stack);
      this.posts = [];
    }
  }

  async downloadImage(imageUrl, fileName) {
    try {
      const imagePath = path.join(IMAGES_DIR, fileName);
      
      // Verificar se já existe
      if (await fs.pathExists(imagePath)) {
        console.log(`   📁 Já existe: ${fileName}`);
        return imagePath;
      }

      console.log(`   📥 Baixando: ${fileName}`);
      
      const response = await axios({
        method: 'GET',
        url: imageUrl,
        responseType: 'stream',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const writer = fs.createWriteStream(imagePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          this.successCount++;
          resolve(imagePath);
        });
        writer.on('error', (error) => {
          this.errorCount++;
          reject(error);
        });
      });
    } catch (error) {
      console.log(`   ❌ Erro: ${fileName} - ${error.message}`);
      this.errorCount++;
      return null;
    }
  }

  async uploadImageToStrapi(imagePath, originalName) {
    try {
      if (!imagePath || !await fs.pathExists(imagePath)) {
        return null;
      }

      const stats = await fs.stat(imagePath);
      const ext = path.extname(imagePath);
      const mimeType = mime.lookup(ext) || 'application/octet-stream';
      const fileName = path.basename(originalName, path.extname(originalName));

      // Verificar se já existe no Strapi
      const existingFile = await strapi.query('plugin::upload.file').findOne({
        where: { name: fileName }
      });

      if (existingFile) {
        console.log(`   📁 Já no Strapi: ${fileName}`);
        return existingFile;
      }

      console.log(`   📤 Enviando: ${fileName}`);

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
      console.log(`   ❌ Erro upload: ${error.message}`);
      return null;
    }
  }  findPostForImage(mediaItem) {
    const mediaTitle = (mediaItem.title || '').toLowerCase().trim();
    const fileName = (mediaItem.fileName || '').toLowerCase().trim();
    
    // Remover extensão do arquivo para comparação
    const fileNameWithoutExt = fileName.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
    
    let bestMatch = null;
    let bestScore = 0;
    
    console.log(`   🔍 Procurando post para: "${mediaTitle}"`);
    
    for (const post of this.posts) {
      const postSlug = (post.slug || '').toLowerCase().trim();
      const postTitle = (post.titulo || '').toLowerCase().trim();
      
      let score = 0;
      
      // Estratégia 1: Match EXATO do título da mídia com slug do post (PRIORIDADE MÁXIMA)
      if (mediaTitle && postSlug && mediaTitle === postSlug) {
        score += 1000; // Score muito alto para match exato
      }
      
      // Estratégia 2: Match do título da mídia com palavras do slug
      if (mediaTitle && postSlug) {
        const mediaWords = mediaTitle.split(/[-_\s]+/).filter(w => w.length > 3);
        const slugWords = postSlug.split('-').filter(w => w.length > 3);
        
        let matchedWords = 0;
        for (const mediaWord of mediaWords) {
          if (slugWords.some(sw => sw.includes(mediaWord) || mediaWord.includes(sw))) {
            matchedWords++;
          }
        }
        
        if (matchedWords > 0) {
          score += (matchedWords / mediaWords.length) * 200;
        }
      }
      
      // Estratégia 3: Match do título da mídia com título do post
      if (mediaTitle && postTitle) {
        const titleSimilarity = this.stringSimilarity(mediaTitle, postTitle);
        score += titleSimilarity * 100;
      }
      
      // Estratégia 4: Match de filename com slug (para post_thumbnail-)
      if (fileName.startsWith('post_thumbnail-') && postSlug) {
        const slugWords = postSlug.split('-');
        const fileWords = fileNameWithoutExt.replace('post_thumbnail-', '').split(/[-_]/);
        
        let commonWords = 0;
        for (const slugWord of slugWords) {
          if (slugWord.length > 3 && fileWords.some(fw => fw.includes(slugWord) || slugWord.includes(fw))) {
            commonWords++;
          }
        }
        score += (commonWords / slugWords.length) * 50;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = post;
      }
    }
    
    console.log(`   📊 Melhor match: ${bestMatch ? bestMatch.titulo : 'Nenhum'} (score: ${bestScore.toFixed(1)})`);
    
    // Só retornar match se tiver pontuação mínima de confiança
    return bestScore > 50 ? bestMatch : null;
  }

  stringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const words1 = str1.split(/\s+/).filter(w => w.length > 2);
    const words2 = str2.split(/\s+/).filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    let matches = 0;
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1.includes(word2) || word2.includes(word1) || this.levenshteinDistance(word1, word2) <= 2) {
          matches++;
          break;
        }
      }
    }
    
    return matches / Math.max(words1.length, words2.length);
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[str2.length][str1.length];
  }

  async updatePostWithImage(post, uploadedImage) {
    try {
      await strapi.documents('api::post.post').update({
        documentId: post.documentId,
        data: {
          image: [uploadedImage],
          thumbnail: uploadedImage,
        },
      });
      
      console.log(`   ✅ Post atualizado: ${post.titulo}`);
      return true;
    } catch (error) {
      console.log(`   ❌ Erro ao atualizar post: ${error.message}`);
      return false;
    }
  }

  async processImages(testMode = true) {
    const imagesToProcess = testMode ? this.mediaUrls.slice(0, BATCH_SIZE) : this.mediaUrls;
    
    console.log(`🔄 ${testMode ? 'MODO TESTE: ' : ''}Processando ${imagesToProcess.length} imagens...`);
    console.log('═'.repeat(60));

    for (let i = 0; i < imagesToProcess.length; i++) {
      const mediaItem = imagesToProcess[i];
      this.processedCount++;
      
      console.log(`\n[${i + 1}/${imagesToProcess.length}] ${mediaItem.fileName}`);
      console.log('─'.repeat(50));
      
      // Baixar imagem
      const imagePath = await this.downloadImage(mediaItem.url, mediaItem.fileName);
      
      if (imagePath) {
        // Upload para Strapi
        const uploadedImage = await this.uploadImageToStrapi(imagePath, mediaItem.fileName);
        
        if (uploadedImage) {
          // Encontrar post relacionado
          const relatedPost = this.findPostForImage(mediaItem);
            if (relatedPost && (!relatedPost.image || relatedPost.image.length === 0)) {
            await this.updatePostWithImage(relatedPost, uploadedImage);
          } else if (relatedPost) {
            console.log(`   ⏭️  Post já tem imagem: ${relatedPost.titulo}`);
          } else {
            console.log(`   🔍 Nenhum post relacionado encontrado`);
            console.log(`   📄 Título da mídia: "${mediaItem.title}"`);
            console.log(`   📁 Nome do arquivo: "${mediaItem.fileName}"`);
          }
        }
      }
      
      // Pausa entre processamentos
      if (i < imagesToProcess.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.printSummary(testMode);
  }

  printSummary(testMode = false) {
    console.log('\n' + '═'.repeat(60));
    console.log(`📊 RESUMO DO REPROCESSAMENTO ${testMode ? '(TESTE)' : ''}`);
    console.log('═'.repeat(60));
    console.log(`📥 Imagens processadas: ${this.processedCount}`);
    console.log(`✅ Downloads bem-sucedidos: ${this.successCount}`);
    console.log(`❌ Erros de download: ${this.errorCount}`);
    console.log(`📁 Pasta de imagens: ${IMAGES_DIR}`);
    console.log('═'.repeat(60));
    
    if (testMode) {
      console.log('\n💡 Este foi um teste com poucas imagens.');
      console.log('   Para processar todas, execute: npm run reprocess:images:full');
    }
  }
}

async function runReprocessing(testMode = true) {
  const reprocessor = new ImageReprocessor();
  
  try {
    await reprocessor.init();
    await reprocessor.processImages(testMode);
  } catch (error) {
    console.error('💥 Erro durante reprocessamento:', error);
    process.exit(1);
  }
}

async function main() {
  console.log('🚀 Script iniciado...');
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  
  try {
    console.log('🏁 Inicializando Strapi...');
    const appContext = await compileStrapi();
    console.log('📦 Strapi compilado, carregando...');
    const app = await createStrapi(appContext).load();
    console.log('✅ Strapi carregado com sucesso');
    
    app.log.level = 'error';
    
    const args = process.argv.slice(2);
    const testMode = !args.includes('--full');
    console.log(`📋 Modo de teste: ${testMode}`);
    
    global.strapi = app;
    
    await runReprocessing(testMode);
    
    console.log('\n🎉 Reprocessamento concluído!');
    await app.destroy();
    process.exit(0);
  } catch (error) {
    console.error('💥 Erro ao inicializar:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ImageReprocessor, runReprocessing };
