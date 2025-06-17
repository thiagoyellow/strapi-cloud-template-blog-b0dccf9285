const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const xml2js = require('xml2js');

// Caminho para seu XML exportado do WordPress
const xmlFile = path.resolve(__dirname, '../blog-anabbprev.WordPress.2025-06-16.xml');
const outputFile = path.resolve(__dirname, '../data/wordpress-posts.json');
const imageFolder = path.resolve(__dirname, '../data/imagens');
if (!fs.existsSync(imageFolder)) fs.mkdirSync(imageFolder, { recursive: true });

// Extrai a primeira <img src="..."> do HTML
function extractImageFromContent(content) {
  const match = content.match(/<img[^>]+src=["']([^"'>]+)["']/i);
  return match ? match[1] : '';
}

// Faz download da imagem, retorna nome do arquivo salvo
function downloadImage(url) {
  if (!url) return null;
  const filename = path.basename(url.split('?')[0]);
  const filepath = path.join(imageFolder, filename);
  if (fs.existsSync(filepath)) return filename;

  const file = fs.createWriteStream(filepath);
  const client = url.startsWith('https') ? https : http;

  client.get(url, res => {
    if (res.statusCode === 200) {
      res.pipe(file);
    } else {
      console.warn(`⚠️ Falha ao baixar ${url}: código ${res.statusCode}`);
      file.close(() => {
        if (fs.existsSync(filepath)) fs.unlink(filepath, () => {});
      });
    }
  }).on('error', err => {
    console.warn(`⚠️ Erro ao baixar ${url}: ${err.message}`);
    file.close(() => {
      if (fs.existsSync(filepath)) fs.unlink(filepath, () => {});
    });
  });

  return filename;
}

function convert(xml) {
  const parser = new xml2js.Parser({ explicitArray: true });
  parser.parseString(xml, (err, result) => {
    if (err) throw err;

    const items = result.rss.channel[0].item || [];
    const posts = items
      .filter(i => i['wp:post_type']?.[0] === 'post')
      .filter(i => i['wp:status']?.[0] === 'publish')
      .map(item => {
        const description = item['content:encoded']?.[0] || '';

        // Prioriza url > contentUrl > imagem do HTML
        const urlField = item['url']?.[0];
        const contentUrlField = item['contentUrl']?.[0];
        const fallbackImage = extractImageFromContent(description);
        const selectedImage = urlField || contentUrlField || fallbackImage;

        const imageFilename = selectedImage ? downloadImage(selectedImage) : '';

        return {
          titulo: item.title?.[0] || '',
          slug: item['wp:post_name']?.[0] || '',
          date: item['wp:post_date']?.[0]?.split(' ')[0] || '',
          createdAt: item['wp:post_date_gmt']?.[0]
            ? new Date(item['wp:post_date_gmt'][0]).toISOString()
            : '',
          description,
          image: imageFilename,
          originalImageURL: selectedImage || '',
          locale: 'pt-BR',
          thumbnail: '',
          category: item.category?.[0] || '',
        };
      });

    fs.writeFileSync(outputFile, JSON.stringify(posts, null, 2), 'utf-8');
    console.log(`✅ Exportados ${posts.length} posts`);
    console.log(`🖼️ Imagens salvas em: ${imageFolder}`);
  });
}

fs.readFile(xmlFile, 'utf-8', (err, data) => {
  if (err) throw err;
  convert(data);
});