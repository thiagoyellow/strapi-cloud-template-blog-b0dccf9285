# 🚀 Importação Inteligente de Posts do WordPress

Este script foi criado para importar eficientemente os posts restantes do WordPress (`blog.anabbprev.org.br`) para o Strapi Cloud, evitando duplicatas e processando imagens automaticamente.

## 📋 Funcionalidades

- ✅ **Importação Seletiva**: Só importa posts que não existem no Strapi
- ✅ **Processamento de Imagens**: Baixa e faz upload automático das imagens
- ✅ **Modo de Teste**: Permite testar com poucos posts antes da importação completa
- ✅ **Limpeza de Conteúdo**: Remove HTML desnecessário e formata para o Strapi
- ✅ **Relatórios Detalhados**: Mostra progresso e estatísticas da importação
- ✅ **Tratamento de Erros**: Continua a importação mesmo se alguns posts falharem

## 🛠️ Como Usar

### 1. Teste Inicial (Recomendado)
Primeiro, execute um teste com apenas 5 posts para verificar se tudo está funcionando:

```powershell
npm run import:wordpress:test
```

### 2. Importação Completa
Após confirmar que o teste funcionou bem, execute a importação completa:

```powershell
npm run import:wordpress:full
```

## 📊 O que o Script Faz

### Análise Inicial
1. Carrega todos os posts existentes no Strapi
2. Carrega os posts do arquivo `data/wordpress-posts.json`
3. Identifica quantos posts precisam ser importados

### Processamento de Cada Post
1. **Validação**: Verifica se o post tem dados suficientes
2. **Verificação de Duplicata**: Compara pelo slug para evitar posts duplicados
3. **Download de Imagens**: Baixa imagens do WordPress para `public/downloaded_images/`
4. **Upload para Strapi**: Envia as imagens para o sistema de mídia do Strapi
5. **Limpeza de Conteúdo**: Remove HTML malicioso e formata o conteúdo
6. **Criação do Post**: Cria o post no Strapi com status "Aprovado"

### Mapeamento de Campos
- `titulo` → `titulo`
- `slug` → `slug`
- `description` → `description` (limpo)
- `category` → `category`
- `date` → `date`
- `originalImageURL` → `image` e `thumbnail`
- `locale` → `locale` (padrão: pt-BR)
- Posts são criados com `status_aprovacao: 'Aprovado'`

## 📁 Estrutura de Arquivos

```
scripts/
  └── import-wordpress-posts.js      # Script principal
data/
  └── wordpress-posts.json           # Posts do WordPress (fonte)
public/
  └── downloaded_images/             # Imagens baixadas (criado automaticamente)
```

## 🔧 Configurações

Você pode ajustar estas configurações no início do script:

```javascript
const BATCH_SIZE = 5; // Quantos posts importar no modo teste
```

## 📈 Relatório de Importação

O script fornece um relatório detalhado ao final:

```
📊 RESUMO DA IMPORTAÇÃO
═══════════════════════════════════════
✅ Posts importados: 25
⏭️  Posts pulados: 5
❌ Erros: 2
📁 Imagens processadas: verificar pasta public/downloaded_images/
═══════════════════════════════════════
```

## 🚨 Resolução de Problemas

### Erro: "Cannot find module"
```powershell
npm install
```

### Erro de permissão de arquivo
- Verifique se o Strapi não está em desenvolvimento rodando
- Certifique-se de ter permissões de escrita na pasta do projeto

### Imagens não sendo baixadas
- Verificar conexão com internet
- Algumas imagens podem ter URLs inválidas (isso é normal)

### Posts não sendo importados
- Verificar se o arquivo `data/wordpress-posts.json` existe
- Confirmar se o Strapi está configurado corretamente

## 💡 Dicas de Uso

1. **Sempre teste primeiro**: Use `npm run import:wordpress:test` antes da importação completa
2. **Monitore o processo**: O script mostra progresso em tempo real
3. **Verifique as imagens**: Após a importação, confira se as imagens foram processadas corretamente
4. **Backup**: Considere fazer backup do banco antes da importação completa

## 🎯 Próximos Passos

Após a importação:
1. Revisar posts importados no admin do Strapi
2. Verificar se as imagens estão corretas
3. Ajustar categorias se necessário
4. Publicar posts se estiverem como rascunho

---

**Criado por:** GitHub Copilot
**Data:** Novembro 2025
**Versão:** 1.0
