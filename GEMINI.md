# Universal Media Downloader

Este projeto é um baixador de mídias universal capaz de capturar e baixar vídeos (HLS e HTTPS) e fotos de qualquer site através de uma extensão de navegador.

## Arquitetura
- **App Desktop**: Construído com Tauri v2 + React + TypeScript.
- **Backend (Rust)**: Gerencia um bridge HTTP (porta 43188) para receber capturas da extensão e executa o FFmpeg para downloads HLS.
- **Extensão de Navegador**: Manifest V3 que monitora requisições de rede para detectar arquivos `.m3u8`, `.mp4`, imagens, etc.

## Como usar

### 1. Extensão do Navegador
- Vá em `chrome://extensions/`
- Ative o "Modo do desenvolvedor"
- Clique em "Carregar sem compactação"
- Selecione a pasta `extension/` deste projeto.

### 2. Desenvolvimento do App
Para rodar o app em modo de desenvolvimento:
```bash
npm install
npm run tauri dev
```

### 3. Gerar o .exe (Build)
Para gerar o executável final:
```bash
npm run tauri build
```
O `.exe` será gerado na pasta `src-tauri/target/release/bundle/msi/` ou `exe/`.

## Requisitos
- **FFmpeg**: O app espera que o FFmpeg esteja em `C:\Users\Pc Gamer\Downloads\ffmpeg-2026-06-15-git-44d082edc8-full_build\ffmpeg-2026-06-15-git-44d082edc8-full_build\bin\ffmpeg.exe`.
- **Node.js**: Para o frontend e build.
- **Rust**: Para o backend do Tauri.
