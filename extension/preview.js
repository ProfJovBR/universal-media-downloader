const elements = {
  title: document.getElementById("title"),
  subtitle: document.getElementById("subtitle"),
  video: document.getElementById("video"),
  imagePreview: document.getElementById("imagePreview"),
  message: document.getElementById("message"),
  qualitySelect: document.getElementById("qualitySelect"),
  kindInput: document.getElementById("kindInput"),
  sourceInput: document.getElementById("sourceInput"),
  details: document.getElementById("details"),
  urlField: document.getElementById("urlField"),
  openButton: document.getElementById("openButton"),
  copyButton: document.getElementById("copyButton"),
  downloadButton: document.getElementById("downloadButton")
};

let job = null;
let hls = null;
let dashPlayer = null;
let retriedHlsWithoutCredentials = false;

elements.openButton.addEventListener("click", openUrl);
elements.copyButton.addEventListener("click", copyUrl);
elements.downloadButton.addEventListener("click", downloadItem);
elements.qualitySelect.addEventListener("change", changeQuality);
window.addEventListener("beforeunload", destroyPlayers);

init();

async function init() {
  const params = new URLSearchParams(location.search);
  const jobId = params.get("job");
  if (!jobId) {
    showMessage("Job de preview ausente.", true);
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "GET_PREVIEW_JOB", jobId });
  if (!response?.ok || !response.job) {
    showMessage("Preview expirado ou nao encontrado.", true);
    return;
  }

  job = response.job;
  renderMetadata();
  startPreview();
}

function renderMetadata() {
  elements.title.textContent = job.fileName || job.title || labelForKind(job.kind);
  elements.subtitle.textContent = job.pageUrl || job.url;
  elements.kindInput.value = labelForKind(job.kind);
  elements.sourceInput.value = (job.sources || [job.source]).filter(Boolean).join(", ") || "desconhecida";
  elements.urlField.value = job.url;

  const parts = [];
  if (job.width && job.height) {
    parts.push(`${job.width}x${job.height}`);
  }
  if (job.bytes) {
    parts.push(formatBytes(job.bytes));
  }
  if (job.host) {
    parts.push(job.host);
  }
  if (job.isProtected) {
    parts.push("Protegido por DRM/criptografia");
  }
  if (job.isLikelySegment) {
    parts.push("Parece ser um segmento isolado");
  }
  elements.details.textContent = parts.length ? parts.join(" | ") : "Sem metadados adicionais.";
}

function startPreview() {
  if (job.isProtected) {
    showMessage("Preview bloqueado: este item parece protegido por DRM ou criptografia.", true);
    return;
  }

  if (job.kind === "image") {
    showImage();
    return;
  }

  showVideo();

  if (job.kind === "hls") {
    startHls(true);
    return;
  }

  if (job.kind === "dash") {
    startDash();
    return;
  }

  elements.video.src = job.url;
}

function showImage() {
  elements.imagePreview.src = job.url;
  elements.imagePreview.classList.add("active");
  elements.imagePreview.onerror = () => {
    showMessage("Nao foi possivel carregar a imagem.", true);
  };
}

function showVideo() {
  elements.video.classList.add("active");
  elements.video.onerror = () => {
    showMessage("Nao foi possivel tocar esta URL. Ela pode exigir cookie, referer, token temporario ou codec diferente.", true);
  };
}

function startHls(withCredentials) {
  if (elements.video.canPlayType("application/vnd.apple.mpegurl")) {
    elements.video.src = job.url;
    return;
  }

  if (!window.Hls?.isSupported()) {
    showMessage("HLS nao e suportado neste navegador.", true);
    return;
  }

  hls?.destroy();
  hls = new window.Hls({
    enableWorker: false,
    lowLatencyMode: false,
    xhrSetup: (xhr) => {
      xhr.withCredentials = withCredentials;
    }
  });

  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    populateHlsQualities();
    setMessage(withCredentials ? "HLS carregado com tentativa de credenciais/cookies." : "HLS carregado sem credenciais.");
  });

  hls.on(window.Hls.Events.LEVEL_SWITCHED, (_event, data) => {
    if (data?.level >= 0) {
      elements.qualitySelect.value = String(data.level);
    }
  });

  hls.on(window.Hls.Events.ERROR, (_event, data) => {
    if (!data?.fatal) {
      return;
    }

    hls.destroy();
    hls = null;

    if (withCredentials && !retriedHlsWithoutCredentials) {
      retriedHlsWithoutCredentials = true;
      setMessage("HLS falhou com credenciais. Tentando novamente sem credenciais...");
      startHls(false);
      return;
    }

    showMessage("Preview HLS falhou. A URL pode exigir referer especifico, token valido, CORS compativel ou nao pode estar protegida por DRM.", true);
  });

  hls.loadSource(job.url);
  hls.attachMedia(elements.video);
}

function populateHlsQualities() {
  elements.qualitySelect.textContent = "";

  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = "Auto";
  elements.qualitySelect.appendChild(auto);

  const levels = hls?.levels || [];
  levels.forEach((level, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = qualityLabel(level, index);
    elements.qualitySelect.appendChild(option);
  });

  elements.qualitySelect.disabled = levels.length === 0;
  elements.qualitySelect.value = "auto";
}

function startDash() {
  if (!window.dashjs?.MediaPlayer) {
    showMessage("DASH nao e suportado neste navegador.", true);
    return;
  }

  try {
    dashPlayer = window.dashjs.MediaPlayer().create();
    dashPlayer.updateSettings({
      streaming: {
        xhrWithCredentials: true,
        delay: {
          liveDelayFragmentCount: 4
        }
      }
    });
    dashPlayer.on(window.dashjs.MediaPlayer.events.ERROR, () => {
      showMessage("Preview DASH falhou. A URL pode exigir referer especifico, token valido, CORS compativel ou DRM.", true);
    });
    dashPlayer.initialize(elements.video, job.url, false);
    setMessage("DASH carregando com tentativa de credenciais/cookies.");
  } catch {
    showMessage("Preview DASH falhou.", true);
  }
}

function changeQuality() {
  if (!hls) {
    return;
  }

  if (elements.qualitySelect.value === "auto") {
    hls.currentLevel = -1;
    setMessage("Qualidade HLS: auto.");
    return;
  }

  hls.currentLevel = Number(elements.qualitySelect.value);
  setMessage(`Qualidade HLS: ${elements.qualitySelect.selectedOptions[0]?.textContent || "manual"}.`);
}

async function openUrl() {
  if (!job?.url) {
    return;
  }
  await chrome.tabs.create({ url: job.url, active: true });
}

async function copyUrl() {
  if (!job?.url) {
    return;
  }
  await navigator.clipboard.writeText(job.url);
  setMessage("URL copiada.");
}

async function downloadItem() {
  if (!job?.tabId || !job?.id) {
    showMessage("Nao foi possivel localizar o item original para baixar.", true);
    return;
  }

  elements.downloadButton.disabled = true;
  const type = job.kind === "hls" ? "OPEN_HLS_DOWNLOADER" : "DOWNLOAD_ITEM";
  const response = await chrome.runtime.sendMessage({ type, tabId: job.tabId, id: job.id });
  elements.downloadButton.disabled = false;

  if (!response?.ok) {
    showMessage(response?.error || "Falha ao baixar.", true);
    return;
  }

  setMessage(job.kind === "hls" ? "Montador HLS aberto." : "Download enviado ao Chrome.");
}

function setMessage(message) {
  elements.message.classList.remove("error");
  elements.message.classList.add("active");
  elements.message.textContent = message;
}

function showMessage(message, isError = false) {
  elements.message.classList.toggle("error", isError);
  elements.message.classList.add("active");
  elements.message.textContent = message;
}

function destroyPlayers() {
  hls?.destroy();
  dashPlayer?.reset();
}

function qualityLabel(level, index) {
  const parts = [];
  if (level.height) {
    parts.push(`${level.height}p`);
  }
  if (level.width && level.height) {
    parts.push(`${level.width}x${level.height}`);
  }
  if (level.bitrate) {
    parts.push(`${Math.round(level.bitrate / 1000)} kbps`);
  }
  return parts.length ? parts.join(" | ") : `Nivel ${index + 1}`;
}

function labelForKind(kind) {
  if (kind === "image") return "Imagem";
  if (kind === "hls") return "HLS";
  if (kind === "dash") return "DASH";
  return "Video";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
