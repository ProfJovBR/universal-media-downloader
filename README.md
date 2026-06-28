# Deep Media Downloader

Extensao para Chrome que detecta midias acessiveis em paginas web, permite preview de videos/streams e baixa links diretos quando o navegador tem acesso ao arquivo.

## Recursos

- Detecta imagens, videos diretos, playlists HLS `.m3u8`, manifests DASH `.mpd`, posters, links, estilos, scripts e requisicoes de rede.
- Popup com filtros, busca, preview, abrir em nova aba, copiar URL e baixar.
- Preview grande em aba interna com suporte a HLS/DASH.
- Botao flutuante `Baixar` em midias da pagina, com chave liga/desliga.
- Montador HLS para playlists sem criptografia.
- Doacao opcional por Pix para BR e PayPal para usuarios internacionais.

## Instalar no Chrome

1. Clique em `Code` e depois em `Download ZIP`.
2. Extraia o ZIP em uma pasta fixa do seu computador.
3. Abra o Chrome e acesse:

```text
chrome://extensions
```

4. Ative `Modo do desenvolvedor`.
5. Clique em `Carregar sem compactacao`.
6. Selecione a pasta:

```text
universal-media-downloader/extension
```

7. Fixe a extensao na barra do Chrome, se quiser.

Importante: nao apague nem mova a pasta extraida depois de instalar. O Chrome carrega a extensao diretamente dessa pasta.

## Como Usar

1. Abra uma pagina que tenha imagem, video ou stream.
2. Clique no icone da extensao.
3. Use `Busca profunda` se a lista ainda estiver vazia.
4. Escolha uma midia na lista.
5. Use:

- `Preview`: abre uma aba interna para conferir o video.
- `Abrir`: abre a URL da midia em outra aba.
- `Copiar`: copia a URL detectada.
- `Baixar`: envia o download para o Chrome ou abre o montador HLS.

## Botao na Pagina

A extensao tambem mostra um botao `Baixar` sobre algumas midias visiveis na pagina.

Para ligar ou desligar:

1. Abra o popup da extensao.
2. Use a chave `Botoes na pagina`.

## Limites

Esta extensao nao remove DRM, nao quebra criptografia, nao burla login e nao descriptografa conteudo protegido.

Alguns videos podem nao funcionar quando o site exige:

- DRM.
- Cookies especificos.
- Token temporario expirado.
- Referer obrigatorio.
- Bloqueio por CORS.
- Codec nao suportado pelo Chrome.

## Atualizar

1. Baixe o ZIP mais recente do GitHub.
2. Extraia por cima da pasta antiga ou em uma nova pasta fixa.
3. Acesse `chrome://extensions`.
4. Clique no botao de recarregar da extensao.

## Remover

1. Acesse `chrome://extensions`.
2. Encontre `Deep Media Downloader`.
3. Clique em `Remover`.
