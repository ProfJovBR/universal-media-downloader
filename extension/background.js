const MAX_ITEMS_PER_TAB = 800;
const RECENT_TTL_MS = 20_000;

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp"
]);

const VIDEO_EXTENSIONS = new Set([
  "3gp",
  "avi",
  "cmfv",
  "m4v",
  "m4s",
  "mkv",
  "mov",
  "mp4",
  "mp2t",
  "mpeg",
  "mpg",
  "m2ts",
  "ogv",
  "ts",
  "webm"
]);

const HLS_MIME_PARTS = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "vnd.apple.mpegurl"
];

const DASH_MIME_PARTS = [
  "application/dash+xml"
];

const tabItems = new Map();
const recentRequests = new Map();

chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    try {
      const headers = details.responseHeaders || [];
      const contentType = getHeader(headers, "content-type");
      const item = makeMediaItem({
        url: details.url,
        source: "network",
        contentType,
        tabId: details.tabId,
        initiator: details.initiator || ""
      });

      if (item) {
        addItem(details.tabId, item);
      }
    } catch (error) {
      console.warn("Falha ao processar resposta de midia:", error);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      const item = makeMediaItem({
        url: details.url,
        source: "request",
        tabId: details.tabId,
        initiator: details.initiator || ""
      });

      if (item) {
        addItem(details.tabId, item);
      }
    } catch (error) {
      console.warn("Falha ao processar requisicao de midia:", error);
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabItems.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabItems.delete(tabId);
  }
});

async function handleMessage(message, sender) {
  if (!message || typeof message !== "object") {
    return { ok: false, error: "Mensagem invalida." };
  }

  if (message.type === "MEDIA_FOUND") {
    const tabId = sender.tab?.id ?? message.tabId ?? -1;
    const pageUrl = sender.tab?.url || message.pageUrl || "";
    const item = makeMediaItem({
      ...message.item,
      pageUrl,
      tabId,
      source: message.item?.source || "page"
    });

    if (item) {
      addItem(tabId, item);
    }

    return { ok: true };
  }

  if (message.type === "QUICK_DOWNLOAD_MEDIA") {
    const tabId = sender.tab?.id ?? message.tabId ?? -1;
    const pageUrl = sender.tab?.url || message.pageUrl || "";
    const item = makeMediaItem({
      ...message.item,
      pageUrl,
      tabId,
      source: message.item?.source || "quick-button"
    });

    if (!item) {
      throw new Error("Midia invalida para download rapido.");
    }

    addItem(tabId, item);
    return downloadItem(item);
  }

  if (message.type === "GET_TAB_MEDIA") {
    const tabId = message.tabId;
    return {
      ok: true,
      items: getItems(tabId),
      stats: getStats(tabId)
    };
  }

  if (message.type === "DEEP_SCAN") {
    await triggerDeepScan(message.tabId);
    return {
      ok: true,
      items: getItems(message.tabId),
      stats: getStats(message.tabId)
    };
  }

  if (message.type === "CLEAR_TAB") {
    tabItems.delete(message.tabId);
    return { ok: true, items: [] };
  }

  if (message.type === "DOWNLOAD_ITEM") {
    const item = findItem(message.tabId, message.id);
    if (!item) {
      throw new Error("Midia nao encontrada.");
    }
    return downloadItem(item);
  }

  if (message.type === "OPEN_HLS_DOWNLOADER") {
    const item = findItem(message.tabId, message.id);
    if (!item) {
      throw new Error("Stream HLS nao encontrado.");
    }
    if (item.kind !== "hls") {
      throw new Error("O item selecionado nao e HLS.");
    }
    const jobId = await storeHlsJob(item);
    const url = chrome.runtime.getURL(`downloader.html?job=${encodeURIComponent(jobId)}`);
    const tab = await chrome.tabs.create({ url, active: true });
    return { ok: true, tabId: tab.id };
  }

  if (message.type === "OPEN_PREVIEW") {
    const item = findItem(message.tabId, message.id);
    if (!item) {
      throw new Error("Midia nao encontrada para preview.");
    }
    const jobId = await storePreviewJob(item, message.tabId);
    const url = chrome.runtime.getURL(`preview.html?job=${encodeURIComponent(jobId)}`);
    const tab = await chrome.tabs.create({ url, active: true });
    return { ok: true, tabId: tab.id };
  }

  if (message.type === "GET_HLS_JOB") {
    const key = `hlsJob:${message.jobId}`;
    const result = await chrome.storage.session.get(key);
    return { ok: true, job: result[key] || null };
  }

  if (message.type === "GET_PREVIEW_JOB") {
    const key = `previewJob:${message.jobId}`;
    const result = await chrome.storage.session.get(key);
    return { ok: true, job: result[key] || null };
  }

  return { ok: false, error: "Tipo de mensagem desconhecido." };
}

function addItem(tabId, item) {
  if (tabId < 0 || !item?.url) {
    return;
  }

  pruneRecent();
  const recentKey = `${tabId}:${item.url}`;
  const lastSeen = recentRequests.get(recentKey);
  if (lastSeen && Date.now() - lastSeen < RECENT_TTL_MS) {
    mergeItem(tabId, item);
    return;
  }
  recentRequests.set(recentKey, Date.now());
  mergeItem(tabId, item);
}

function mergeItem(tabId, item) {
  if (!tabItems.has(tabId)) {
    tabItems.set(tabId, new Map());
  }

  const items = tabItems.get(tabId);
  const key = item.id;
  const existing = items.get(key);
  const next = {
    ...(existing || {}),
    ...item,
    sources: Array.from(new Set([...(existing?.sources || []), item.source].filter(Boolean))),
    firstSeen: existing?.firstSeen || Date.now(),
    lastSeen: Date.now()
  };

  items.set(key, next);

  if (items.size > MAX_ITEMS_PER_TAB) {
    const ordered = Array.from(items.values()).sort((a, b) => a.lastSeen - b.lastSeen);
    for (const stale of ordered.slice(0, items.size - MAX_ITEMS_PER_TAB)) {
      items.delete(stale.id);
    }
  }
}

function getItems(tabId) {
  const items = Array.from(tabItems.get(tabId)?.values() || [])
    .sort((a, b) => b.lastSeen - a.lastSeen);
  return groupLikelySegments(items);
}

function getStats(tabId) {
  const items = getItems(tabId);
  return {
    total: items.length,
    images: items.filter((item) => item.kind === "image").length,
    videos: items.filter((item) => item.kind === "video" || item.kind === "dash").length,
    hls: items.filter((item) => item.kind === "hls").length,
    dash: items.filter((item) => item.kind === "dash").length
  };
}

function findItem(tabId, id) {
  return tabItems.get(tabId)?.get(id) || null;
}

async function triggerDeepScan(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("Aba invalida.");
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        if (typeof window.__deepMediaDownloaderRunDeepScan === "function") {
          window.__deepMediaDownloaderRunDeepScan();
        }
      }
    });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        if (typeof window.__deepMediaDownloaderRunDeepScan === "function") {
          window.__deepMediaDownloaderRunDeepScan();
        }
      }
    });
  }
}

async function downloadItem(item) {
  if (item.isProtected) {
    throw new Error("Este item parece protegido por criptografia/DRM e nao sera baixado pela extensao.");
  }

  if (item.kind === "hls") {
    const jobId = await storeHlsJob(item);
    const url = chrome.runtime.getURL(`downloader.html?job=${encodeURIComponent(jobId)}`);
    const tab = await chrome.tabs.create({ url, active: true });
    return { ok: true, opened: true, tabId: tab.id };
  }

  if (item.kind === "dash") {
    throw new Error("DASH/MPD e listado para inspeção, mas esta versao nao remuxa streams DASH.");
  }

  const filename = buildFilename(item);
  const downloadId = await chrome.downloads.download({
    url: item.url,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });

  return { ok: true, downloadId };
}

async function storeHlsJob(item) {
  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await chrome.storage.session.set({
    [`hlsJob:${jobId}`]: {
      url: item.url,
      pageUrl: item.pageUrl || "",
      title: item.title || item.fileName || "hls-video",
      createdAt: Date.now()
    }
  });
  return jobId;
}

async function storePreviewJob(item, tabId) {
  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await chrome.storage.session.set({
    [`previewJob:${jobId}`]: {
      ...item,
      tabId,
      createdAt: Date.now()
    }
  });
  return jobId;
}

function makeMediaItem(input = {}) {
  const url = normalizeUrl(input.url);
  if (!url) {
    return null;
  }

  const contentType = (input.contentType || "").toLowerCase();
  const kind = input.kind || detectKind(url, contentType);
  if (!kind) {
    return null;
  }

  const lowered = url.toLowerCase();
  if (kind === "image" && shouldIgnoreImage(lowered, input)) {
    return null;
  }

  const isProtected = Boolean(input.isProtected || /widevine|fairplay|playready|\.key($|\?)/i.test(url));
  const extension = getExtension(url);
  const isLikelySegment = kind === "video" && isLikelyVideoSegment(url, contentType, extension);

  return {
    id: stableId(url),
    url,
    pageUrl: input.pageUrl || input.initiator || "",
    title: cleanText(input.title || ""),
    kind,
    contentType,
    width: Number(input.width) || 0,
    height: Number(input.height) || 0,
    bytes: Number(input.bytes) || 0,
    extension,
    host: getHost(url),
    fileName: guessFileName(url, kind),
    isProtected,
    isLikelySegment,
    segmentGroup: isLikelySegment ? segmentGroupKey(url) : "",
    source: input.source || "unknown"
  };
}

function detectKind(url, contentType = "") {
  const ext = getExtension(url);
  const mime = contentType.toLowerCase();

  if (ext === "m3u8" || HLS_MIME_PARTS.some((part) => mime.includes(part))) {
    return "hls";
  }

  if (ext === "mpd" || DASH_MIME_PARTS.some((part) => mime.includes(part))) {
    return "dash";
  }

  if (VIDEO_EXTENSIONS.has(ext) || mime.startsWith("video/")) {
    return "video";
  }

  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith("image/")) {
    return "image";
  }

  return null;
}

function shouldIgnoreImage(url, input) {
  if (/favicon|apple-touch-icon|\/icons?\//i.test(url)) {
    return true;
  }

  const width = Number(input.width) || 0;
  const height = Number(input.height) || 0;
  if (width > 0 && height > 0 && width < 90 && height < 90) {
    return true;
  }

  return false;
}

function groupLikelySegments(items) {
  const groups = new Map();
  const visible = [];

  for (const item of items) {
    if (!item.isLikelySegment || item.isProtected) {
      visible.push(item);
      continue;
    }

    const key = item.segmentGroup || item.url;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }

  for (const segments of groups.values()) {
    if (segments.length < 3) {
      visible.push(...segments);
      continue;
    }

    const sample = segments[0];
    const bytes = segments.reduce((total, item) => total + (Number(item.bytes) || 0), 0);
    visible.push({
      ...sample,
      id: `group-${stableId(sample.segmentGroup || sample.url)}`,
      fileName: `Segmentos de video (${segments.length})`,
      title: sample.title || "Segmentos de video",
      bytes,
      isSegmentGroup: true,
      isLikelySegment: false,
      segmentCount: segments.length,
      sources: Array.from(new Set(segments.flatMap((item) => item.sources || [item.source]).filter(Boolean))),
      firstSeen: Math.min(...segments.map((item) => item.firstSeen || Date.now())),
      lastSeen: Math.max(...segments.map((item) => item.lastSeen || Date.now()))
    });
  }

  return visible.sort((a, b) => b.lastSeen - a.lastSeen);
}

function isLikelyVideoSegment(url, contentType, extension) {
  if (contentType.includes("mpegurl") || contentType.includes("dash+xml")) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const path = parsed.pathname.toLowerCase();
  const file = path.split("/").pop() || "";
  const segmentExtensions = new Set(["ts", "m4s", "cmfv", "m2ts", "mp2t"]);

  if (!segmentExtensions.has(extension)) {
    return false;
  }

  if (/(^|[-_.])(seg|segment|chunk|frag|fragment|part|slice)[-_.]?\d+/i.test(file)) {
    return true;
  }

  if (/^\d{3,}\.(ts|m4s|cmfv|m2ts|mp2t)$/i.test(file)) {
    return true;
  }

  return /\/(hls|dash|segments?|chunks?|fragments?|video)\/.+\.(ts|m4s|cmfv|m2ts|mp2t)$/i.test(path);
}

function segmentGroupKey(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/");
    parts.pop();
    return `${parsed.origin}${parts.join("/")}`;
  } catch {
    return url;
  }
}

function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "";
  }

  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function getHeader(headers, name) {
  const wanted = name.toLowerCase();
  return headers.find((header) => header.name?.toLowerCase() === wanted)?.value || "";
}

function getExtension(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const last = path.split("/").pop() || "";
    const match = last.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function getHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function guessFileName(url, kind) {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (name && name.includes(".")) {
      return sanitizeFileName(name);
    }
  } catch {
    // fall through
  }

  const extension = kind === "image" ? "jpg" : kind === "hls" ? "ts" : kind === "dash" ? "mpd" : "mp4";
  return `media-${Date.now()}.${extension}`;
}

function buildFilename(item) {
  const folder = item.kind === "image" ? "Deep Media Downloader/Images" : "Deep Media Downloader/Videos";
  return `${folder}/${sanitizeFileName(item.fileName || guessFileName(item.url, item.kind))}`;
}

function sanitizeFileName(value) {
  return cleanText(value)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || `media-${Date.now()}`;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stableId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `m${(hash >>> 0).toString(16)}`;
}

function pruneRecent() {
  const now = Date.now();
  for (const [key, timestamp] of recentRequests) {
    if (now - timestamp > RECENT_TTL_MS) {
      recentRequests.delete(key);
    }
  }
}
