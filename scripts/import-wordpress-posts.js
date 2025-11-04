'use strict';

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const mime = require('mime-types');

// Configurações
const WORDPRESS_POSTS_FILE = path.join(__dirname, '..', 'data', 'wordpress-posts.json');
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'downloaded_images');
const BATCH_SIZE = 5; // Importar em lotes de 5 posts por vez

class WordPressImporter {
  constructor() {
    this.existingPosts = new Set();
    this.importedCount = 0;
    this.skippedCount = 0;
    this.errorCount = 0;
  }
  async init() {
    console.log('🚀 Iniciando importação inteligente de posts do WordPress...\n');
    
    try {
      // Garantir que o diretório de imagens existe
      console.log('📁 Criando diretório de imagens...');
      await fs.ensureDir(IMAGES_DIR);
      console.log(`✅ Diretório criado: ${IMAGES_DIR}`);
      
      // Carregar posts existentes no Strapi
      console.log('🔍 Carregando posts existentes no Strapi...');
      await this.loadExistingPosts();
      
      // Carregar posts do WordPress
      console.log('📖 Carregando posts do WordPress...');
      const wordpressPosts = await this.loadWordPressPosts();
      
      console.log(`📊 Resumo inicial:`);
      console.log(`   • Posts no WordPress: ${wordpressPosts.length}`);
      console.log(`   • Posts já existentes no Strapi: ${this.existingPosts.size}`);
      console.log(`   • Posts a serem importados: ${wordpressPosts.length - this.existingPosts.size}\n`);
      
      return wordpressPosts;
    } catch (error) {
      console.error('❌ Erro durante inicialização:', error.message);
      throw error;
    }
  }

  async loadExistingPosts() {
    try {
      // Buscar todos os posts existentes no Strapi
      const existingPosts = await strapi.documents('api::post.post').findMany({
        fields: ['slug', 'titulo'],
        pagination: { page: 1, pageSize: 10000 }
      });

      // Armazenar slugs dos posts existentes
      existingPosts.results?.forEach(post => {
        if (post.slug) {
          this.existingPosts.add(post.slug);
        }
      });

      console.log(`✅ Carregados ${this.existingPosts.size} posts existentes no Strapi`);
    } catch (error) {
      console.error('❌ Erro ao carregar posts existentes:', error.message);
    }
  }

  async loadWordPressPosts() {
    try {
      const posts = await fs.readJson(WORDPRESS_POSTS_FILE);
      console.log(`✅ Carregados ${posts.length} posts do WordPress`);
      return posts;
    } catch (error) {
      console.error('❌ Erro ao carregar posts do WordPress:', error.message);
      return [];
    }
  }

  shouldImportPost(post) {
    // Verificar se o post já existe
    if (this.existingPosts.has(post.slug)) {
      return false;
    }

    // Verificar se tem dados mínimos necessários
    if (!post.titulo || !post.slug || !post.description) {
      console.log(`⚠️  Post inválido (faltam dados): ${post.titulo || 'Sem título'}`);
      return false;
    }

    return true;
  }

  async downloadImage(imageUrl, fileName) {
    try {
      if (!imageUrl || imageUrl.trim() === '') {
        return null;
      }

      const imagePath = path.join(IMAGES_DIR, fileName);
      
      // Verificar se a imagem já foi baixada
      if (await fs.pathExists(imagePath)) {
        console.log(`   📁 Imagem já existe: ${fileName}`);
        return imagePath;
      }

      console.log(`   📥 Baixando imagem: ${fileName}`);
      
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
        writer.on('finish', () => resolve(imagePath));
        writer.on('error', reject);
      });
    } catch (error) {
      console.log(`   ❌ Erro ao baixar imagem ${fileName}: ${error.message}`);
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

      // Verificar se a imagem já foi enviada para o Strapi
      const existingFile = await strapi.query('plugin::upload.file').findOne({
        where: { name: fileName }
      });

      if (existingFile) {
        console.log(`   📁 Imagem já existe no Strapi: ${fileName}`);
        return existingFile;
      }

      console.log(`   📤 Enviando para Strapi: ${fileName}`);

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
              alternativeText: `Imagem do post: ${fileName}`,
              caption: fileName,
              name: fileName,
            },
          },
        });

      return uploadedFiles[0];
    } catch (error) {
      console.log(`   ❌ Erro ao enviar imagem para Strapi: ${error.message}`);
      return null;
    }
  }
  cleanHtmlContent(html) {
    if (!html) return '';
    
    console.log('   🧹 Limpando e formatando conteúdo HTML...');
    
    let content = html;
    
    // 1. REMOVER elementos perigosos/desnecessários
    content = content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remover scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remover styles  
      .replace(/<!--[\s\S]*?-->/g, '') // Remover comentários
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '') // Remover iframes
      .replace(/\[rock-convert-pdf[^\]]*\]/gi, '') // Remover shortcodes WordPress
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ''); // Remover noscript
    
    // 2. NORMALIZAR quebras de linha e espaços
    content = content
      .replace(/\r\n/g, '\n') // Normalizar quebras de linha
      .replace(/\r/g, '\n')
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Remover quebras excessivas
      .replace(/[ \t]+/g, ' '); // Normalizar espaços
    
    // 3. CORRIGIR formatação de listas
    content = content
      .replace(/<ul>\s*<li>/gi, '<ul>\n<li>') // Quebra após <ul>
      .replace(/<\/li>\s*<li>/gi, '</li>\n<li>') // Quebra entre itens
      .replace(/<\/li>\s*<\/ul>/gi, '</li>\n</ul>') // Quebra antes de </ul>
      .replace(/<ol>\s*<li>/gi, '<ol>\n<li>') // Mesma coisa para <ol>
      .replace(/<\/li>\s*<\/ol>/gi, '</li>\n</ol>');
    
    // 4. CORRIGIR formatação de tabelas
    content = content
      .replace(/<table[^>]*>/gi, '<table>') // Simplificar tag table
      .replace(/<tbody>\s*<tr>/gi, '<tbody>\n<tr>') // Quebras na tabela
      .replace(/<\/tr>\s*<tr>/gi, '</tr>\n<tr>')
      .replace(/<\/tr>\s*<\/tbody>/gi, '</tr>\n</tbody>')
      .replace(/<td[^>]*>/gi, '<td>') // Simplificar células
      .replace(/<th[^>]*>/gi, '<th>'); // Simplificar cabeçalhos
    
    // 5. CORRIGIR parágrafos e títulos
    content = content
      .replace(/<p>\s*<\/p>/gi, '') // Remover parágrafos vazios
      .replace(/<p>/gi, '<p>') // Garantir tags simples
      .replace(/(<h[1-6][^>]*>)/gi, '\n$1') // Quebra antes de títulos
      .replace(/(<\/h[1-6]>)/gi, '$1\n'); // Quebra depois de títulos
    
    // 6. LIMPAR atributos desnecessários mas manter funcionais
    content = content
      .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi, '<a href="$1">') // Simplificar links
      .replace(/target="_blank"\s*/gi, '') // Remover target blank
      .replace(/rel="[^"]*"\s*/gi, '') // Remover rel
      .replace(/<(strong|b)([^>]*)>/gi, '<strong>') // Normalizar negritos
      .replace(/<\/(strong|b)>/gi, '</strong>')
      .replace(/<(em|i)([^>]*)>/gi, '<em>') // Normalizar itálicos  
      .replace(/<\/(em|i)>/gi, '</em>')
      .replace(/<u([^>]*)>/gi, '<u>') // Simplificar sublinhados
      .replace(/<br\s*\/?>/gi, '<br>'); // Normalizar quebras
    
    // 7. CONVERTER quebras de linha simples em parágrafos quando apropriado
    const lines = content.split('\n');
    const processedLines = [];
    let inHtmlBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Verificar se estamos dentro de um bloco HTML
      if (line.match(/<(ul|ol|table|h[1-6]|blockquote)/i)) {
        inHtmlBlock = true;
      }
      if (line.match(/<\/(ul|ol|table|h[1-6]|blockquote)/i)) {
        inHtmlBlock = false;
      }
      
      // Se é uma linha de texto simples (não vazia, não tem tags HTML)
      if (line && !line.match(/^<[^>]+>/) && !inHtmlBlock && !line.match(/<\/[^>]+>$/)) {
        // Se não está já em um parágrafo, adicionar tags de parágrafo
        if (!line.match(/^<p>/i)) {
          processedLines.push(`<p>${line}</p>`);
        } else {
          processedLines.push(line);
        }
      } else {
        processedLines.push(line);
      }
    }
    
    content = processedLines.join('\n');
    
    // 8. LIMPEZA FINAL
    content = content
      .replace(/\n{3,}/g, '\n\n') // Máximo 2 quebras consecutivas
      .replace(/^\s+|\s+$/g, '') // Remover espaços do início/fim
      .replace(/(<p><\/p>\s*){2,}/g, '') // Remover parágrafos vazios repetidos
      .replace(/\s+<\//g, '</') // Remover espaços antes de tags de fechamento
      .replace(/>\s+</g, '><'); // Remover espaços entre tags (exceto conteúdo)
    
    console.log(`   ✅ Conteúdo formatado: ${content.length} caracteres`);
    
    return content;
  }
  extractCategoryName(category) {
    if (!category) return 'Geral';
    
    if (typeof category === 'string') {
      return category;
    }
    
    if (category._ && typeof category._ === 'string') {
      return category._;
    }
    
    return 'Geral';
  }

  // Função adicional para validar se o HTML está bem formatado
  validateHtmlStructure(html) {
    const issues = [];
    
    // Verificar tags não fechadas
    const openTags = html.match(/<(\w+)[^>]*>/g) || [];
    const closeTags = html.match(/<\/(\w+)>/g) || [];
    
    console.log(`   🔍 Validação HTML: ${openTags.length} tags abertas, ${closeTags.length} tags fechadas`);
    
    // Verificar se há conteúdo básico
    const textContent = html.replace(/<[^>]*>/g, '').trim();
    if (textContent.length < 50) {
      issues.push('Conteúdo muito curto');
    }
    
    // Verificar se há formatação preservada
    if (html.includes('<strong>') || html.includes('<em>') || html.includes('<h2>')) {
      console.log('   ✅ Formatação preservada (negrito/itálico/títulos)');
    }
    
    if (html.includes('<ul>') || html.includes('<ol>')) {
      console.log('   ✅ Listas preservadas');
    }
    
    if (html.includes('<a href=')) {
      console.log('   ✅ Links preservados');
    }
    
    return issues;
  }

  async processPostImages(post) {
    const images = [];
    
    // Processar imagem principal
    if (post.originalImageURL && post.originalImageURL.trim() !== '') {
      const imageFileName = `${post.slug}.jpg`;
      const imagePath = await this.downloadImage(post.originalImageURL, imageFileName);
      
      if (imagePath) {
        const uploadedImage = await this.uploadImageToStrapi(imagePath, imageFileName);
        if (uploadedImage) {
          images.push(uploadedImage);
        }
      }
    }

    return images;
  }
  async importPost(wordpressPost) {
    try {
      console.log(`📝 Importando: ${wordpressPost.titulo}`);
      
      // Processar imagens
      const images = await this.processPostImages(wordpressPost);
      
      // Limpar e formatar conteúdo
      const cleanedDescription = this.cleanHtmlContent(wordpressPost.description);
      
      // Validar conteúdo formatado
      const validationIssues = this.validateHtmlStructure(cleanedDescription);
      if (validationIssues.length > 0) {
        console.log(`   ⚠️  Avisos de validação: ${validationIssues.join(', ')}`);
      }
      
      // Preparar dados do post para o Strapi
      const strapiPost = {
        titulo: wordpressPost.titulo,
        slug: wordpressPost.slug,
        description: cleanedDescription,
        category: this.extractCategoryName(wordpressPost.category),
        date: wordpressPost.date,
        locale: wordpressPost.locale || 'pt-BR',
        image: images.length > 0 ? images : undefined,
        thumbnail: images.length > 0 ? images[0] : undefined,
        status_aprovacao: 'Aprovado',
        aprovacao_1: true,
        aprovacao_2: true,
        publishedAt: new Date(),
      };

      // Criar o post no Strapi
      const createdPost = await strapi.documents('api::post.post').create({
        data: strapiPost,
      });

      console.log(`   ✅ Post importado com sucesso! ID: ${createdPost.documentId}`);
      this.importedCount++;
      
      return createdPost;
    } catch (error) {
      console.error(`   ❌ Erro ao importar post "${wordpressPost.titulo}": ${error.message}`);
      this.errorCount++;
      return null;
    }
  }

  async importPosts(wordpressPosts, testMode = false) {
    const postsToImport = wordpressPosts.filter(post => this.shouldImportPost(post));
    
    if (postsToImport.length === 0) {
      console.log('✅ Todos os posts já foram importados!');
      return;
    }

    // Se for modo de teste, importar apenas alguns posts
    const posts = testMode ? postsToImport.slice(0, BATCH_SIZE) : postsToImport;
    
    console.log(`🔄 ${testMode ? 'MODO TESTE: ' : ''}Importando ${posts.length} posts...`);
    console.log('═'.repeat(60));

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      console.log(`\n[${i + 1}/${posts.length}] ${post.titulo}`);
      console.log('─'.repeat(50));
      
      if (this.shouldImportPost(post)) {
        await this.importPost(post);
      } else {
        console.log(`   ⏭️  Post já existe, pulando...`);
        this.skippedCount++;
      }
      
      // Pequena pausa entre imports para não sobrecarregar
      if (i < posts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.printSummary(testMode);
  }

  printSummary(testMode = false) {
    console.log('\n' + '═'.repeat(60));
    console.log(`📊 RESUMO DA IMPORTAÇÃO ${testMode ? '(TESTE)' : ''}`);
    console.log('═'.repeat(60));
    console.log(`✅ Posts importados: ${this.importedCount}`);
    console.log(`⏭️  Posts pulados: ${this.skippedCount}`);
    console.log(`❌ Erros: ${this.errorCount}`);
    console.log(`📁 Imagens processadas: verificar pasta ${IMAGES_DIR}`);
    console.log('═'.repeat(60));
    
    if (testMode) {
      console.log('\n💡 Este foi um teste com poucos posts.');
      console.log('   Para importar todos os posts, execute: npm run import:wordpress:full');
    }
  }
}

async function runImport(testMode = true) {
  const importer = new WordPressImporter();
  
  try {
    const wordpressPosts = await importer.init();
    await importer.importPosts(wordpressPosts, testMode);
  } catch (error) {
    console.error('💥 Erro fatal durante a importação:', error);
    process.exit(1);
  }
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  
  try {
    console.log('🏁 Inicializando Strapi...');
    
    const appContext = await compileStrapi();
    console.log('✅ Strapi compilado com sucesso');
    
    const app = await createStrapi(appContext).load();
    console.log('✅ Strapi carregado com sucesso');
    
    app.log.level = 'error'; // Reduzir logs do Strapi
    
    // Verificar argumentos da linha de comando
    const args = process.argv.slice(2);
    const testMode = !args.includes('--full');
    
    console.log(`🔧 Modo: ${testMode ? 'TESTE' : 'COMPLETO'}`);
    
    global.strapi = app;
    
    await runImport(testMode);
    
    console.log('\n🎉 Importação concluída!');
    await app.destroy();
    process.exit(0);
  } catch (error) {
    console.error('💥 Erro ao inicializar:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Executar apenas se for chamado diretamente
if (require.main === module) {
  main();
}

module.exports = { WordPressImporter, runImport };
