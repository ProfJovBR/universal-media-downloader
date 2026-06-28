const state = {
  tab: null,
  items: [],
  filter: "all",
  search: "",
  quickButtonsVisible: true
};

const QUICK_BUTTONS_VISIBLE_KEY = "quickButtonsVisible";
const PIX_CONFIG = {
  key: "57646942000169",
  displayKey: "57.646.942/0001-69",
  amount: "2.00",
  merchantName: "APOIO CAFE",
  merchantCity: "SAO PAULO",
  txid: "CAFE2"
};
const PAYPAL_CONFIG = {
  url: "https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=wcsam%40outlook.com&currency_code=USD&amount=1.00&item_name=Coffee"
};
const SHOW_ALL_DONATION_OPTIONS = false;

const elements = {
  pageTitle: document.getElementById("pageTitle"),
  totalCount: document.getElementById("totalCount"),
  imageCount: document.getElementById("imageCount"),
  videoCount: document.getElementById("videoCount"),
  streamCount: document.getElementById("streamCount"),
  list: document.getElementById("list"),
  template: document.getElementById("itemTemplate"),
  status: document.getElementById("status"),
  searchInput: document.getElementById("searchInput"),
  deepScanButton: document.getElementById("deepScanButton"),
  clearButton: document.getElementById("clearButton"),
  refreshButton: document.getElementById("refreshButton"),
  quickButtonsToggle: document.getElementById("quickButtonsToggle"),
  coffeeButton: document.getElementById("coffeeButton"),
  pixDialog: document.getElementById("pixDialog"),
  pixTitle: document.getElementById("pixTitle"),
  donationText: document.getElementById("donationText"),
  pixQrCode: document.getElementById("pixQrCode"),
  pixValue: document.getElementById("pixValue"),
  copyPixButton: document.getElementById("copyPixButton"),
  closePixButton: document.getElementById("closePixButton"),
  paypalButton: document.getElementById("paypalButton")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  elements.pageTitle.textContent = tab?.title || tab?.url || "Aba atual";

  elements.refreshButton.addEventListener("click", refresh);
  elements.deepScanButton.addEventListener("click", runDeepScan);
  elements.clearButton.addEventListener("click", clearTab);
  elements.quickButtonsToggle.addEventListener("change", setQuickButtonsVisible);
  elements.coffeeButton.addEventListener("click", openPixDialog);
  elements.copyPixButton.addEventListener("click", copyPix);
  elements.closePixButton.addEventListener("click", closePixDialog);
  elements.paypalButton.addEventListener("click", openPaypal);
  elements.pixDialog.addEventListener("click", (event) => {
    if (event.target === elements.pixDialog) {
      closePixDialog();
    }
  });
  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });

  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.filter = button.dataset.filter;
      render();
    });
  });

  await loadQuickButtonsVisible();
  setupPixPanel();
  await refresh();
}

function setupPixPanel() {
  elements.pixValue.value = buildPixPayload();
  elements.copyPixButton.disabled = false;
  elements.coffeeButton.textContent = isBrazilianUser()
    ? "gostou? que tal me pagar um cafe?"
    : "Like it? Buy me a coffee?";
}

async function openPixDialog() {
  elements.pixDialog.hidden = false;
  if (SHOW_ALL_DONATION_OPTIONS) {
    await renderAllDonationOptions();
    return;
  }
  if (isBrazilianUser()) {
    await renderPixDonation();
  } else {
    renderPaypalDonation();
  }
}

function closePixDialog() {
  elements.pixDialog.hidden = true;
}

async function copyPix() {
  const value = pixDonationValue();
  if (!value) {
    setStatus("Chave Pix nao configurada.", true);
    return;
  }

  elements.copyPixButton.disabled = true;
  try {
    await navigator.clipboard.writeText(value);
    setStatus("Pix copiado.");
  } catch (error) {
    setStatus(error?.message || "Falha ao copiar Pix.", true);
  } finally {
    elements.copyPixButton.disabled = false;
  }
}

async function openPaypal() {
  if (!PAYPAL_CONFIG.url) {
    setStatus("PayPal link not configured.", true);
    return;
  }

  await chrome.tabs.create({ url: PAYPAL_CONFIG.url, active: true });
}

function pixDonationValue() {
  return buildPixPayload();
}

async function renderPixQrCode() {
  const payload = buildPixPayload();
  elements.pixValue.value = payload;

  if (!window.QRCode?.toCanvas) {
    setStatus("Gerador de QR Code indisponivel.", true);
    return;
  }

  await window.QRCode.toCanvas(elements.pixQrCode, payload, {
    width: 220,
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#172033",
      light: "#ffffff"
    }
  });
}

async function renderPixDonation() {
  elements.pixTitle.textContent = "Pix de R$ 2,00";
  elements.donationText.textContent = "Escaneie o QR Code ou copie o Pix copia e cola.";
  elements.pixQrCode.hidden = false;
  elements.pixValue.hidden = false;
  elements.copyPixButton.hidden = false;
  elements.paypalButton.hidden = true;
  await renderPixQrCode();
}

async function renderAllDonationOptions() {
  elements.pixTitle.textContent = "Apoiar o projeto";
  elements.donationText.textContent = "Teste Pix de R$ 2,00 ou PayPal de US$ 1,00.";
  elements.pixQrCode.hidden = false;
  elements.pixValue.hidden = false;
  elements.copyPixButton.hidden = false;
  elements.paypalButton.hidden = false;
  elements.paypalButton.disabled = !PAYPAL_CONFIG.url;
  await renderPixQrCode();
}

function renderPaypalDonation() {
  elements.pixTitle.textContent = "Buy me a coffee?";
  elements.donationText.textContent = PAYPAL_CONFIG.url
    ? "Support this project with PayPal."
    : "PayPal support is ready, but the PayPal link is not configured yet.";
  elements.pixQrCode.hidden = true;
  elements.pixValue.hidden = true;
  elements.copyPixButton.hidden = true;
  elements.paypalButton.hidden = false;
  elements.paypalButton.disabled = !PAYPAL_CONFIG.url;
}

function isBrazilianUser() {
  const languages = [
    navigator.language,
    ...(navigator.languages || []),
    chrome.i18n?.getUILanguage?.()
  ].filter(Boolean).map((value) => value.toLowerCase());

  if (languages.some((language) => language === "pt-br" || language.endsWith("-br"))) {
    return true;
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  return [
    "America/Sao_Paulo",
    "America/Manaus",
    "America/Belem",
    "America/Fortaleza",
    "America/Recife",
    "America/Bahia",
    "America/Campo_Grande",
    "America/Cuiaba",
    "America/Porto_Velho",
    "America/Boa_Vista",
    "America/Rio_Branco",
    "America/Noronha",
    "America/Araguaina",
    "America/Maceio",
    "America/Santarem"
  ].includes(timeZone);
}

function buildPixPayload() {
  const merchantAccount = emv("00", "br.gov.bcb.pix") + emv("01", PIX_CONFIG.key);
  const additionalData = emv("05", PIX_CONFIG.txid);
  const payloadWithoutCrc =
    emv("00", "01") +
    emv("26", merchantAccount) +
    emv("52", "0000") +
    emv("53", "986") +
    emv("54", PIX_CONFIG.amount) +
    emv("58", "BR") +
    emv("59", normalizePixText(PIX_CONFIG.merchantName, 25)) +
    emv("60", normalizePixText(PIX_CONFIG.merchantCity, 15)) +
    emv("62", additionalData) +
    "6304";

  return `${payloadWithoutCrc}${crc16(payloadWithoutCrc)}`;
}

function emv(id, value) {
  const text = String(value);
  return `${id}${String(text.length).padStart(2, "0")}${text}`;
}

function normalizePixText(value, maxLength) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 .-]/g, "")
    .trim()
    .slice(0, maxLength)
    .toUpperCase();
}

function crc16(value) {
  let crc = 0xffff;
  for (let index = 0; index < value.length; index += 1) {
    crc ^= value.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

async function loadQuickButtonsVisible() {
  const result = await chrome.storage.local.get({ [QUICK_BUTTONS_VISIBLE_KEY]: true });
  state.quickButtonsVisible = Boolean(result[QUICK_BUTTONS_VISIBLE_KEY]);
  elements.quickButtonsToggle.checked = state.quickButtonsVisible;
}

async function setQuickButtonsVisible(event) {
  state.quickButtonsVisible = Boolean(event.target.checked);
  await chrome.storage.local.set({ [QUICK_BUTTONS_VISIBLE_KEY]: state.quickButtonsVisible });

  if (state.tab?.id) {
    chrome.tabs.sendMessage(state.tab.id, {
      type: "SET_QUICK_BUTTONS_VISIBLE",
      visible: state.quickButtonsVisible
    }).catch(() => {
      // A aba pode nao ter content script, como chrome:// ou pagina interna.
    });
  }

  setStatus(state.quickButtonsVisible ? "Botões na página ativados." : "Botões na página desativados.");
}

async function refresh() {
  if (!state.tab?.id) {
    setStatus("Nenhuma aba ativa encontrada.", true);
    return;
  }

  setStatus("Atualizando...");
  const response = await chrome.runtime.sendMessage({ type: "GET_TAB_MEDIA", tabId: state.tab.id });
  if (!response?.ok) {
    setStatus(response?.error || "Falha ao atualizar.", true);
    return;
  }

  state.items = response.items || [];
  render(response.stats);
  setStatus(`${state.items.length} item(ns) encontrados.`);
}

async function runDeepScan() {
  if (!state.tab?.id) {
    return;
  }

  elements.deepScanButton.disabled = true;
  setStatus("Executando busca profunda...");
  const response = await chrome.runtime.sendMessage({ type: "DEEP_SCAN", tabId: state.tab.id });
  elements.deepScanButton.disabled = false;

  if (!response?.ok) {
    setStatus(response?.error || "Busca profunda falhou.", true);
    return;
  }

  await delay(400);
  await refresh();
}

async function clearTab() {
  if (!state.tab?.id) {
    return;
  }
  await chrome.runtime.sendMessage({ type: "CLEAR_TAB", tabId: state.tab.id });
  state.items = [];
  render();
  setStatus("Lista limpa.");
}

function render(stats = null) {
  const counts = stats || getStats(state.items);
  elements.totalCount.textContent = `${counts.total} total`;
  elements.imageCount.textContent = `${counts.images} img`;
  elements.videoCount.textContent = `${counts.videos} video`;
  elements.streamCount.textContent = `${counts.hls} HLS`;

  const filtered = state.items.filter(matchesFilter);
  elements.list.textContent = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.items.length
      ? "Nenhum item corresponde ao filtro atual."
      : "Nenhuma midia detectada ainda. Use Busca profunda depois que a pagina terminar de carregar.";
    elements.list.appendChild(empty);
    return;
  }

  for (const item of filtered) {
    elements.list.appendChild(renderItem(item));
  }
}

function renderItem(item) {
  const node = elements.template.content.firstElementChild.cloneNode(true);
  const thumb = node.querySelector(".thumb");
  const name = node.querySelector(".name");
  const url = node.querySelector(".url");
  const details = node.querySelector(".details");
  const badges = node.querySelector(".badges");
  const previewButton = node.querySelector(".previewButton");
  const open = node.querySelector(".open");
  const copy = node.querySelector(".copy");
  const download = node.querySelector(".download");
  const preview = node.querySelector(".preview");

  name.textContent = item.fileName || labelForKind(item.kind);
  url.textContent = item.url;
  details.textContent = detailText(item);
  renderBadges(item, badges);

  if (item.isProtected) {
    details.classList.add("warn");
    details.textContent = "Protegido por criptografia/DRM";
    download.disabled = true;
  }

  if (item.isSegmentGroup) {
    previewButton.disabled = true;
    download.disabled = true;
  }

  if (item.kind === "image") {
    const image = document.createElement("img");
    image.src = item.url;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.onerror = () => {
      thumb.textContent = "IMG";
    };
    thumb.appendChild(image);
  } else {
    thumb.textContent = item.kind === "hls" ? "HLS" : item.kind === "dash" ? "MPD" : "VID";
    renderVideoPreview(item, preview);
  }

  previewButton.addEventListener("click", async () => {
    previewButton.disabled = true;
    setStatus("Abrindo preview...");

    const response = await chrome.runtime.sendMessage({
      type: "OPEN_PREVIEW",
      tabId: state.tab.id,
      id: item.id
    });
    previewButton.disabled = false;

    if (!response?.ok) {
      setStatus(response?.error || "Falha ao abrir preview.", true);
      return;
    }

    setStatus("Preview aberto.");
  });

  open.addEventListener("click", async () => {
    open.disabled = true;
    setStatus("Abrindo midia em nova aba...");

    try {
      await chrome.tabs.create({ url: item.url, active: true });
      setStatus("Midia aberta em nova aba.");
    } catch (error) {
      setStatus(error?.message || "Falha ao abrir a midia.", true);
    } finally {
      open.disabled = false;
    }
  });

  copy.addEventListener("click", async () => {
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(item.url);
      setStatus("URL copiada.");
    } catch (error) {
      setStatus(error?.message || "Falha ao copiar URL.", true);
    } finally {
      copy.disabled = false;
    }
  });

  download.addEventListener("click", async () => {
    download.disabled = true;
    setStatus(item.kind === "hls" ? "Abrindo montador HLS..." : "Iniciando download...");

    const type = item.kind === "hls" ? "OPEN_HLS_DOWNLOADER" : "DOWNLOAD_ITEM";
    const response = await chrome.runtime.sendMessage({ type, tabId: state.tab.id, id: item.id });
    download.disabled = false;

    if (!response?.ok) {
      setStatus(response?.error || "Falha ao baixar.", true);
      return;
    }

    setStatus(item.kind === "hls" ? "Montador HLS aberto." : "Download enviado ao Chrome.");
  });

  return node;
}

function renderVideoPreview(item, container) {
  if (item.isProtected) {
    container.classList.add("active");
    container.appendChild(previewNote("Preview bloqueado: este item parece protegido por DRM ou criptografia."));
    return;
  }

  const video = document.createElement("video");
  video.className = "video-preview";
  video.controls = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.referrerPolicy = "no-referrer";

  if (item.kind === "video" && !item.isProtected) {
    video.src = item.url;
    video.onerror = () => {
      container.textContent = "";
      container.appendChild(previewNote("Preview indisponivel. Use Abrir para conferir em outra aba."));
    };
    container.classList.add("active");
    container.appendChild(video);
    return;
  }

  if (item.kind === "hls") {
    container.classList.add("active");
    container.appendChild(previewNote("Use Preview para abrir o player HLS com seletor de qualidade."));
    return;
  }

  if (item.kind === "dash") {
    container.classList.add("active");
    container.appendChild(previewNote("Use Preview para abrir o player DASH em aba maior."));
  }
}

function previewNote(message) {
  const note = document.createElement("div");
  note.className = "preview-note";
  note.textContent = message;
  return note;
}

function renderBadges(item, container) {
  container.textContent = "";
  const badges = [];

  badges.push({ text: labelForKind(item.kind), className: "strong" });

  if (item.isProtected) {
    badges.push({ text: "DRM/protegido", className: "warn" });
  }

  if (item.isLikelySegment) {
    badges.push({ text: "segmento", className: "warn" });
  }

  if (item.isSegmentGroup) {
    badges.push({ text: `${item.segmentCount || 0} segmentos agrupados`, className: "warn" });
  }

  if (item.host) {
    badges.push({ text: item.host });
  }

  for (const badge of badges) {
    const node = document.createElement("span");
    node.className = `badge ${badge.className || ""}`.trim();
    node.textContent = badge.text;
    container.appendChild(node);
  }
}

function matchesFilter(item) {
  const filterOk = state.filter === "all" || item.kind === state.filter || (state.filter === "video" && item.kind === "dash");
  if (!filterOk) {
    return false;
  }

  if (!state.search) {
    return true;
  }

  const haystack = `${item.fileName || ""} ${item.url || ""} ${item.contentType || ""} ${item.host || ""} ${item.extension || ""}`.toLowerCase();
  return haystack.includes(state.search);
}

function getStats(items) {
  return {
    total: items.length,
    images: items.filter((item) => item.kind === "image").length,
    videos: items.filter((item) => item.kind === "video" || item.kind === "dash").length,
    hls: items.filter((item) => item.kind === "hls").length
  };
}

function detailText(item) {
  const parts = [labelForKind(item.kind)];
  if (item.extension) {
    parts.push(item.extension.toUpperCase());
  }
  if (item.width && item.height) {
    parts.push(`${item.width}x${item.height}`);
  }
  if (item.bytes) {
    parts.push(formatBytes(item.bytes));
  }
  if (item.segmentCount) {
    parts.push(`${item.segmentCount} segmentos`);
  }
  if (item.sources?.length) {
    parts.push(item.sources.slice(0, 3).join(", "));
  }
  return parts.join(" | ");
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

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
