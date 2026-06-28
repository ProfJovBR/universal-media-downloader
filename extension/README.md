# Deep Media Downloader

Extensao Chrome Manifest V3 para detectar e baixar midias acessiveis ao navegador.

## Recursos

- Varredura de imagens, videos diretos, `srcset`, posters, links, metadados, estilos e backgrounds.
- Observacao de requisicoes de rede via `webRequest`.
- Gancho leve em `fetch`, `XMLHttpRequest` e `setAttribute` da pagina para encontrar URLs criadas por JavaScript.
- Download direto por `chrome.downloads`.
- Montador HLS 100% no navegador para playlists `.m3u8` sem criptografia.

## Limites

Esta extensao nao remove DRM, nao quebra criptografia, nao descriptografa HLS protegido e nao burla controles de acesso. Playlists com `#EXT-X-KEY` diferente de `METHOD=NONE` sao bloqueadas.

## Instalar

1. Abra `chrome://extensions`.
2. Ative `Modo do desenvolvedor`.
3. Clique em `Carregar sem compactacao`.
4. Selecione esta pasta: `extension`.

## Usar

1. Abra a pagina com a midia.
2. Clique no icone da extensao.
3. Use `Busca profunda`.
4. Clique em `Baixar` no item desejado.

Para HLS sem criptografia, a extensao abre uma pagina interna que baixa os segmentos e gera um arquivo `.ts` ou `.mp4` no proprio navegador. Videos muito grandes podem consumir bastante memoria.
