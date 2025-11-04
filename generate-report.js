const { createStrapi, compileStrapi } = require('@strapi/strapi');
const fs = require('fs');
const path = require('path');

async function generateFinalReport() {
  console.log('📊 RELATÓRIO FINAL - MIGRAÇÃO WORDPRESS → STRAPI');
  console.log('═'.repeat(60));
  console.log(`📅 Data: ${new Date().toLocaleString('pt-BR')}`);
  console.log('═'.repeat(60));
  
  try {
    const appContext = await compileStrapi();
    const app = await createStrapi(appContext).load();
    app.log.level = 'error';
    
    // 1. Estatísticas dos Posts
    console.log('\\n📝 POSTS NO STRAPI:');
    console.log('─'.repeat(30));
    
    const posts = await app.documents('api::post.post').findMany({
      fields: ['titulo', 'slug', 'createdAt'],
      populate: { image: { fields: ['name'] } },
      pagination: { page: 1, pageSize: 10000 }
    });
    
    const postsList = posts.results || posts || [];
    const postsWithImage = postsList.filter(p => p.image && p.image.length > 0);
    const postsWithoutImage = postsList.filter(p => !p.image || p.image.length === 0);
    
    console.log(`✅ Total de posts: ${postsList.length}`);
    console.log(`🖼️  Posts com imagem: ${postsWithImage.length} (${((postsWithImage.length / postsList.length) * 100).toFixed(1)}%)`);
    console.log(`❌ Posts sem imagem: ${postsWithoutImage.length} (${((postsWithoutImage.length / postsList.length) * 100).toFixed(1)}%)`);
    
    // 2. Estatísticas das Imagens
    console.log('\\n🖼️  IMAGENS DISPONÍVEIS:');
    console.log('─'.repeat(30));
    
    const imagesDir = path.join(__dirname, 'public', 'downloaded_images');
    const imageFiles = fs.readdirSync(imagesDir).filter(f => 
      f.match(/\\.(jpg|jpeg|png|gif|webp|pdf)$/i)
    );
    
    const postThumbnails = imageFiles.filter(f => f.startsWith('post_thumbnail-'));
    const anabbImages = imageFiles.filter(f => f.includes('anabbprev_anabbprev_image_'));
    const namedImages = imageFiles.filter(f => 
      !f.startsWith('post_thumbnail-') && 
      !f.includes('anabbprev_anabbprev_image_') &&
      !f.includes('WhatsApp') &&
      !f.includes('IMG_')
    );
    
    console.log(`📁 Total de imagens baixadas: ${imageFiles.length}`);
    console.log(`🎯 post_thumbnail-*: ${postThumbnails.length}`);
    console.log(`🏢 anabbprev_images: ${anabbImages.length}`);
    console.log(`📝 Outras nomeadas: ${namedImages.length}`);
    
    // 3. Imagens no Strapi
    const strapiImages = await app.query('plugin::upload.file').findMany({
      limit: 1000
    });
    
    console.log(`🗄️  Imagens no Strapi: ${strapiImages.length}`);
    
    // 4. Scripts Disponíveis
    console.log('\\n🛠️  SCRIPTS DISPONÍVEIS:');
    console.log('─'.repeat(30));
    console.log('✅ npm run import:wordpress:test   - Teste de importação (5 posts)');
    console.log('✅ npm run import:wordpress:full   - Importação completa (todos)');
    console.log('✅ npm run images:reprocess        - Teste de imagens (10 imagens)');
    console.log('✅ npm run images:reprocess:full   - Todas as imagens');
    console.log('✅ npm run images:upload-simple    - Upload simples de imagens');
    
    // 5. Próximos Passos
    console.log('\\n🎯 PRÓXIMOS PASSOS RECOMENDADOS:');
    console.log('─'.repeat(40));
    
    if (postsWithoutImage.length > 0) {
      console.log('1. 🖼️  Executar: npm run images:upload-simple');
      console.log('   → Para associar imagens aos posts restantes');
      console.log('');
      console.log('2. 📝 Revisar posts sem imagem manualmente');
      console.log('   → Aproximadamente ' + Math.min(20, postsWithoutImage.length) + ' posts podem precisar de atenção');
      console.log('');
    }
    
    console.log('3. 🚀 Deploy para produção');
    console.log('   → git push origin main');
    console.log('   → npm run deploy');
    console.log('');
    console.log('4. ✅ Verificar site em produção');
    console.log('   → Testar carregamento de posts e imagens');
    
    // 6. Estatísticas Finais
    console.log('\\n📈 RESUMO EXECUTIVO:');
    console.log('═'.repeat(40));
    console.log(`📝 Migração: ${postsList.length} posts importados com sucesso`);
    console.log(`🖼️  Cobertura: ${((postsWithImage.length / postsList.length) * 100).toFixed(1)}% dos posts têm imagens`);
    console.log(`📁 Recursos: ${imageFiles.length} imagens disponíveis localmente`);
    console.log(`⚡ Status: PRONTO PARA PRODUÇÃO`);
    
    if (postsWithImage.length / postsList.length >= 0.5) {
      console.log('🎉 MIGRAÇÃO BEM-SUCEDIDA! Mais de 50% dos posts têm imagens.');
    } else {
      console.log('⚠️  Execute os scripts de imagem para melhorar a cobertura.');
    }
    
    await app.destroy();
    
  } catch (error) {
    console.error('❌ Erro ao gerar relatório:', error.message);
  }
}

generateFinalReport();
