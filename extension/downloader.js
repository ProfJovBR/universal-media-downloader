const elements = {
  subtitle: document.getElementById("subtitle"),
  progress: document.getElementById("progress"),
  percent: document.getElementById("percent"),
  status: document.getElementById("status"),
  details: document.getElementById("details"),
  log: document.getElementById("log"),
  startButton: document.getElementById("startButton"),
  cancelButton: document.getElementById("cancelButton")
};

let job = null;
let controller = null;
let started = false;

elements.startButton.addEventListener("click", start);
elements.cancelButton.addEventListener("click", () => {
  controller?.abort();
  setStatus("Cancelado pelo usuario.");
});

init();

async function init() {
  const params = new URLSearchParams(location.search);
  const jobId = params.get("job");
  if (!jobId) {
    fail("Job HLS ausente.");
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "GET_HLS_JOB", jobId });
  if (!response?.ok || !response.job) {
    fail("Job HLS expirado ou nao encontrado.");
    return;
  }

  job = response.job;
  elements.subtitle.textContent = job.title || "Stream HLS";
  elements.details.textContent = job.url;
  elements.startButton.disabled = false;
  log("Pronto para baixar HLS sem criptografia.");
}

async function start() {
  if (!job || started) {
    return;
  }

  started = true;
  elements.startButton.disabled = true;
  controller = new AbortController();

  try {
    const playlist = await loadPlaylist(job.url, controller.signal);
    if (playlist.kind === "master") {
      log(`Manifesto mestre: ${playlist.variants.length} variante(s).`);
      const best = playlist.variants.sort((a, b) => b.bandwidth - a.bandwidth)[0];
      log(`Selecionada variante com bandwidth ${best.bandwidth || "desconhecido"}.`);
      const nested = await loadPlaylist(best.url, controller.signal);
      await downloadMediaPlaylist(nested, best.url);
      return;
    }

    await downloadMediaPlaylist(playlist, job.url);
  } catch (error) {
    fail(error.name === "AbortError" ? "Download cancelado." : error.message);
  }
}

async function loadPlaylist(url, signal) {
  setStatus("Baixando manifesto...");
  const text = await fetchText(url, signal);
  if (!text.includes("#EXTM3U")) {
    throw new Error("O arquivo encontrado nao parece ser uma playlist HLS valida.");
  }

  if (/#EXT-X-KEY:([^\n\r]+)/i.test(text)) {
    const keyLines = text.match(/#EXT-X-KEY:([^\n\r]+)/gi) || [];
    const encrypted = keyLines.some((line) => !/METHOD=NONE/i.test(line));
    if (encrypted) {
      throw new Error("Este HLS declara criptografia. A extensao nao remove DRM nem descriptografa conteudo protegido.");
    }
  }

  if (/#EXT-X-BYTERANGE:/i.test(text)) {
    throw new Error("Esta playlist usa byte ranges. Esta versao do montador HLS nao suporta esse formato.");
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variants = [];
  const segments = [];
  let initMap = "";
  let lastStreamInfo = null;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      lastStreamInfo = parseAttributes(line);
      continue;
    }

    if (line.startsWith("#EXT-X-MAP")) {
      const attrs = parseAttributes(line);
      if (attrs.URI) {
        initMap = new URL(stripQuotes(attrs.URI), url).href;
      }
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    const resolved = new URL(line, url).href;
    if (lastStreamInfo) {
      variants.push({
        url: resolved,
        bandwidth: Number(lastStreamInfo.BANDWIDTH) || 0
      });
      lastStreamInfo = null;
    } else {
      segments.push(resolved);
    }
  }

  if (variants.length) {
    return { kind: "master", url, variants };
  }

  if (!segments.length) {
    throw new Error("Nenhum segmento HLS foi encontrado no manifesto.");
  }

  return {
    kind: "media",
    url,
    initMap,
    segments,
    extension: guessExtension(initMap || segments[0])
  };
}

async function downloadMediaPlaylist(playlist) {
  if (playlist.kind !== "media") {
    throw new Error("Playlist de midia invalida.");
  }

  const chunks = [];
  const total = playlist.segments.length + (playlist.initMap ? 1 : 0);
  let completed = 0;

  setStatus(`Baixando ${playlist.segments.length} segmento(s)...`);

  if (playlist.initMap) {
    chunks.push(await fetchBinary(playlist.initMap, controller.signal));
    completed += 1;
    updateProgress(completed, total);
  }

  for (const segmentUrl of playlist.segments) {
    chunks.push(await fetchBinary(segmentUrl, controller.signal));
    completed += 1;
    updateProgress(completed, total);
    if (completed === 1 || completed % 10 === 0 || completed === total) {
      log(`${completed}/${total} partes baixadas`);
    }
  }

  setStatus("Gerando arquivo no navegador...");
  const extension = playlist.extension === "mp4" || playlist.extension === "m4s" ? "mp4" : "ts";
  const mime = extension === "mp4" ? "video/mp4" : "video/mp2t";
  const blob = new Blob(chunks, { type: mime });
  const objectUrl = URL.createObjectURL(blob);
  const filename = sanitizeFileName(`${job.title || "hls-video"}.${extension}`);

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  updateProgress(total, total);
  setStatus(`Arquivo gerado: ${filename}`);
  log(`Tamanho aproximado: ${formatBytes(blob.size)}`);
}

async function fetchText(url, signal) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    signal
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar manifesto: HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchBinary(url, signal) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    signal
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar segmento: HTTP ${response.status}`);
  }

  return response.blob();
}

function parseAttributes(line) {
  const attrs = {};
  const afterColon = line.slice(line.indexOf(":") + 1);
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;
  while ((match = pattern.exec(afterColon))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function stripQuotes(value) {
  return String(value || "").replace(/^"|"$/g, "");
}

function guessExtension(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".mp4")) return "mp4";
    if (path.endsWith(".m4s")) return "m4s";
    return "ts";
  } catch {
    return "ts";
  }
}

function updateProgress(done, total) {
  const value = total ? Math.round((done / total) * 100) : 0;
  elements.progress.value = value;
  elements.percent.textContent = `${value}%`;
}

function setStatus(message) {
  elements.status.classList.remove("error");
  elements.status.textContent = message;
}

function fail(message) {
  elements.status.classList.add("error");
  elements.status.textContent = message;
  log(`Erro: ${message}`);
  elements.startButton.disabled = true;
}

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  elements.log.textContent += `[${stamp}] ${message}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function sanitizeFileName(value) {
  return String(value || "hls-video.ts")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
