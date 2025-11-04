const { createStrapi, compileStrapi } = require('@strapi/strapi');
const fs = require('fs');
const path = require('path');

async function quickImageUpload() {
  console.log('🚀 Iniciando upload rápido de imagens...');
  
  try {
    const appContext = await compileStrapi();
    const app = await createStrapi(appContext).load();
    app.log.level = 'error';
    
    // Carregar posts sem imagem
    const posts = await app.documents('api::post.post').findMany({
      fields: ['titulo', 'slug'],
      populate: { image: { fields: ['name'] } },
      pagination: { page: 1, pageSize: 10000 }
    });
    
    const postsList = posts.results || posts || [];
    const postsWithoutImage = postsList.filter(p => !p.image || p.image.length === 0);
    
    console.log(`📝 Total de posts: ${postsList.length}`);
    console.log(`❌ Posts sem imagem: ${postsWithoutImage.length}`);
    
    // Listar imagens disponíveis
    const imagesDir = path.join(__dirname, 'public', 'downloaded_images');
    const imageFiles = fs.readdirSync(imagesDir).filter(f => 
      f.match(/\.(jpg|jpeg|png|gif|webp)$/i)
    );
    
    console.log(`📁 Imagens disponíveis: ${imageFiles.length}`);
    
    // Processar apenas os primeiros 10 posts para teste
    let processed = 0;
    const limit = Math.min(10, postsWithoutImage.length);
    
    console.log(`\n🔄 Processando ${limit} posts...`);
    
    for (let i = 0; i < limit; i++) {
      const post = postsWithoutImage[i];
      const randomImage = imageFiles[Math.floor(Math.random() * imageFiles.length)];
      
      console.log(`[${i+1}/${limit}] ${post.titulo.substring(0, 40)}... → ${randomImage}`);
      
      try {
        // Verificar se imagem já existe no Strapi
        const imagePath = path.join(imagesDir, randomImage);
        const stats = fs.statSync(imagePath);
        const fileNameWithoutExt = path.basename(randomImage, path.extname(randomImage));
        
        let existingFile = await app.query('plugin::upload.file').findOne({
          where: { name: fileNameWithoutExt }
        });
        
        if (!existingFile) {
          console.log(`   📤 Fazendo upload de ${randomImage}...`);
          
          const mime = require('mime-types');
          const mimeType = mime.lookup(path.extname(randomImage)) || 'application/octet-stream';
          
          const uploadedFiles = await app
            .plugin('upload')
            .service('upload')
            .upload({
              files: {
                filepath: imagePath,
                originalFileName: randomImage,
                size: stats.size,
                mimetype: mimeType,
              },
              data: {
                fileInfo: {
                  alternativeText: fileNameWithoutExt,
                  caption: fileNameWithoutExt,
                  name: fileNameWithoutExt,
                },
              },
            });
          
          existingFile = uploadedFiles[0];
        }
        
        if (existingFile) {
          console.log(`   🔗 Associando ao post...`);
          await app.documents('api::post.post').update({
            documentId: post.documentId,
            data: { image: [existingFile] }
          });
          
          processed++;
          console.log(`   ✅ Sucesso!`);
        }
        
      } catch (error) {
        console.log(`   ❌ Erro: ${error.message}`);
      }
      
      // Pausa entre processamentos
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`\n🎉 Processamento concluído! ${processed}/${limit} posts atualizados.`);
    
    await app.destroy();
    
  } catch (error) {
    console.error('💥 Erro:', error.message);
    process.exit(1);
  }
}

quickImageUpload();
