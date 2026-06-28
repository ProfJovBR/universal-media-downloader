(() => {
  if (window.__deepMediaDownloaderContentLoaded) {
    return;
  }
  window.__deepMediaDownloaderContentLoaded = true;

  const seen = new Set();
  const QUICK_BUTTONS_VISIBLE_KEY = "quickButtonsVisible";
  const MEDIA_URL_RE = /https?:\/\/[^\s"'<>\\)]+?\.(?:m3u8|mpd|mp4|m4v|m4s|webm|mov|mkv|avi|ogv|ts|m2ts|mp2t|cmfv|jpg|jpeg|png|webp|gif|avif|heic|heif|bmp|svg)(?:\?[^\s"'<>\\)]*)?/gi;
  const CSS_URL_RE = /url\((['"]?)(.*?)\1\)/gi;
  const quickButtons = new WeakMap();
  const quickMediaUrls = new WeakMap();
  const quickButtonElements = new Set();
  const quickRecentMedia = [];
  let quickButtonsVisible = true;
  let quickUpdateFrame = 0;

  injectPageHook();
  installMessageBridge();
  installQuickDownloadButtons();
  window.__deepMediaDownloaderRunDeepScan = deepScan;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RUN_DEEP_SCAN") {
      deepScan();
      sendResponse({ ok: true });
    }
    if (message?.type === "SET_QUICK_BUTTONS_VISIBLE") {
      setQuickButtonsVisible(Boolean(message.visible));
      sendResponse({ ok: true });
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[QUICK_BUTTONS_VISIBLE_KEY]) {
      setQuickButtonsVisible(Boolean(changes[QUICK_BUTTONS_VISIBLE_KEY].newValue ?? true));
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", deepScan, { once: true });
  } else {
    queueMicrotask(deepScan);
  }

  const observer = new MutationObserver(() => debounceScan());
  observer.observe(document.documentElement || document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "src",
      "srcset",
      "poster",
      "href",
      "style",
      "data-src",
      "data-srcset",
      "data-poster",
      "data-background",
      "data-bg"
    ]
  });

  setInterval(scanPerformanceEntries, 4000);

  let scanTimer = 0;
  function debounceScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(deepScan, 300);
  }

  function deepScan() {
    scanMediaElements();
    scanLinks();
    scanInlineStyles();
    scanComputedBackgrounds();
    scanScripts();
    scanMetaAndStructuredData();
    scanPerformanceEntries();
    scanQuickDownloadTargets();
  }

  function scanMediaElements() {
    document.querySelectorAll("img, picture source").forEach((element) => {
      const width = element.naturalWidth || element.width || 0;
      const height = element.naturalHeight || element.height || 0;
      collectCandidate(element.currentSrc || element.src || element.getAttribute("src"), "image", { width, height, source: "dom" });
      collectSrcset(element.getAttribute("srcset"), "image", { source: "srcset" });
      collectSrcset(element.getAttribute("data-srcset"), "image", { source: "data-srcset" });
      collectCandidate(element.getAttribute("data-src"), "image", { source: "data-src" });
    });

    document.querySelectorAll("video, audio").forEach((element) => {
      collectCandidate(element.currentSrc || element.src || element.getAttribute("src"), "video", {
        source: element.tagName.toLowerCase(),
        width: element.videoWidth || element.clientWidth || 0,
        height: element.videoHeight || element.clientHeight || 0
      });
      collectCandidate(element.poster || element.getAttribute("poster"), "image", { source: "poster" });
      collectCandidate(element.getAttribute("data-poster"), "image", { source: "data-poster" });
      element.querySelectorAll("source, track").forEach((source) => {
        collectCandidate(source.src || source.getAttribute("src"), detectKind(source.src || source.getAttribute("src")), { source: "source" });
      });
    });

    document.querySelectorAll("embed, object, iframe").forEach((element) => {
      collectCandidate(element.src || element.data || element.getAttribute("src") || element.getAttribute("data"), detectKind(element.src || element.data), { source: element.tagName.toLowerCase() });
    });
  }

  function scanLinks() {
    document.querySelectorAll("a[href], link[href]").forEach((element) => {
      const raw = element.href || element.getAttribute("href");
      collectCandidate(raw, detectKind(raw), { source: element.tagName.toLowerCase() });
    });
  }

  function scanInlineStyles() {
    document.querySelectorAll("[style]").forEach((element) => {
      collectCssUrls(element.getAttribute("style"), "inline-style");
    });

    document.querySelectorAll("style").forEach((element) => {
      collectCssUrls(element.textContent || "", "style-tag");
    });
  }

  function scanComputedBackgrounds() {
    const elements = Array.from(document.querySelectorAll("body, main, section, article, div, a, button, span"));
    for (const element of elements.slice(0, 2500)) {
      const style = getComputedStyle(element);
      collectCssUrls(style.backgroundImage, "computed-background");
      collectCssUrls(style.listStyleImage, "computed-list");
      collectCssUrls(style.content, "computed-content");
    }
  }

  function scanScripts() {
    document.querySelectorAll("script").forEach((script) => {
      const text = script.textContent || "";
      collectRegexUrls(text, "script");
    });
  }

  function scanMetaAndStructuredData() {
    document.querySelectorAll("meta[content]").forEach((meta) => {
      const content = meta.getAttribute("content") || "";
      collectCandidate(content, detectKind(content), { source: "meta" });
      collectRegexUrls(content, "meta");
    });

    document.querySelectorAll("[data-src], [data-srcset], [data-background], [data-bg], [data-video], [data-url]").forEach((element) => {
      for (const attribute of element.getAttributeNames()) {
        if (attribute.startsWith("data-")) {
          const value = element.getAttribute(attribute) || "";
          collectCandidate(value, detectKind(value), { source: attribute });
          collectSrcset(value, detectKind(value), { source: attribute });
          collectRegexUrls(value, attribute);
        }
      }
    });
  }

  function scanPerformanceEntries() {
    performance.getEntriesByType("resource").forEach((entry) => {
      collectCandidate(entry.name, detectKind(entry.name), {
        source: "performance",
        bytes: Math.round(entry.transferSize || entry.encodedBodySize || 0)
      });
    });
  }

  function collectSrcset(srcset, kind, extras = {}) {
    if (!srcset) {
      return;
    }

    srcset
      .split(",")
      .map((entry) => entry.trim().split(/\s+/)[0])
      .filter(Boolean)
      .forEach((url) => collectCandidate(url, kind || detectKind(url), extras));
  }

  function collectCssUrls(text, source) {
    if (!text) {
      return;
    }

    let match;
    CSS_URL_RE.lastIndex = 0;
    while ((match = CSS_URL_RE.exec(text))) {
      collectCandidate(match[2], detectKind(match[2]) || "image", { source });
    }
    collectRegexUrls(text, source);
  }

  function collectRegexUrls(text, source) {
    if (!text) {
      return;
    }

    let match;
    MEDIA_URL_RE.lastIndex = 0;
    while ((match = MEDIA_URL_RE.exec(text))) {
      collectCandidate(match[0], detectKind(match[0]), { source });
    }
  }

  function collectCandidate(rawUrl, kind, extras = {}) {
    if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) {
      return;
    }

    let url;
    try {
      url = new URL(rawUrl, window.location.href).href;
    } catch {
      return;
    }

    if (!/^https?:/i.test(url)) {
      return;
    }

    const detectedKind = kind || detectKind(url);
    if (!detectedKind) {
      return;
    }

    rememberQuickMedia(url, detectedKind);

    const key = `${detectedKind}:${url}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    chrome.runtime.sendMessage({
      type: "MEDIA_FOUND",
      item: {
        url,
        kind: detectedKind,
        pageUrl: window.location.href,
        title: document.title,
        width: extras.width || 0,
        height: extras.height || 0,
        bytes: extras.bytes || 0,
        source: extras.source || "page"
      }
    });
  }

  function detectKind(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") {
      return "";
    }

    const clean = rawUrl.split("?")[0].split("#")[0].toLowerCase();
    if (clean.endsWith(".m3u8")) {
      return "hls";
    }
    if (clean.endsWith(".mpd")) {
      return "dash";
    }
    if (/\.(mp4|m4v|m4s|webm|mov|mkv|avi|ogv|mpeg|mpg|3gp|ts|m2ts|mp2t|cmfv)$/i.test(clean)) {
      return "video";
    }
    if (/\.(jpg|jpeg|png|webp|gif|avif|heic|heif|bmp|svg)$/i.test(clean)) {
      return "image";
    }
    return "";
  }

  function installMessageBridge() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.source !== "DEEP_MEDIA_DOWNLOADER_PAGE") {
        return;
      }
      collectCandidate(event.data.url, event.data.kind || detectKind(event.data.url), { source: event.data.hint || "page-hook" });
    });
  }

  function injectPageHook() {
    const target = document.documentElement || document.head;
    if (!target) {
      document.addEventListener("readystatechange", injectPageHook, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-hook.js");
    script.onload = () => script.remove();
    target.appendChild(script);
  }

  function installQuickDownloadButtons() {
    const style = document.createElement("style");
    style.textContent = `
      .deep-media-download-button {
        all: initial;
        position: fixed;
        z-index: 2147483647;
        left: 0;
        top: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 82px;
        height: 34px;
        padding: 0 11px;
        border: 1px solid rgba(255, 255, 255, 0.42);
        border-radius: 999px;
        background: rgba(17, 24, 39, 0.82);
        backdrop-filter: blur(10px);
        color: #fff;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.26);
        cursor: pointer;
        font: 750 12px/34px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        text-align: center;
        user-select: none;
        pointer-events: auto;
        transform: translate3d(-9999px, -9999px, 0);
        transition: background 140ms ease, opacity 140ms ease, box-shadow 140ms ease;
        will-change: transform;
      }

      .deep-media-download-button::before {
        content: "";
        width: 14px;
        height: 14px;
        background: currentColor;
        clip-path: polygon(43% 0, 57% 0, 57% 52%, 78% 31%, 88% 42%, 50% 80%, 12% 42%, 22% 31%, 43% 52%);
      }

      .deep-media-download-button:hover {
        background: rgba(23, 107, 135, 0.94);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.34);
      }

      .deep-media-download-button:disabled {
        cursor: wait;
        opacity: 0.72;
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    chrome.storage.local.get({ [QUICK_BUTTONS_VISIBLE_KEY]: true }, (result) => {
      setQuickButtonsVisible(Boolean(result[QUICK_BUTTONS_VISIBLE_KEY]));
    });
    window.addEventListener("scroll", scheduleQuickButtonUpdate, true);
    window.addEventListener("resize", scheduleQuickButtonUpdate, { passive: true });
    document.addEventListener("play", handleMediaPlaybackChange, true);
    document.addEventListener("playing", handleMediaPlaybackChange, true);
    document.addEventListener("loadedmetadata", handleMediaPlaybackChange, true);
    setInterval(scanQuickDownloadTargets, 1000);
  }

  function scanQuickDownloadTargets() {
    if (!quickButtonsVisible) {
      updateQuickButtons();
      return;
    }

    document.querySelectorAll("video, audio, img").forEach((element) => {
      const url = mediaUrlForElement(element) || inferQuickUrlForElement(element);
      if (quickButtons.has(element) || !isQuickDownloadCandidate(element, url)) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "deep-media-download-button";
      button.textContent = "Baixar";
      button.title = "Baixar esta midia";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        quickDownloadElement(element, button);
      });

      document.documentElement.appendChild(button);
      quickButtons.set(element, button);
      quickMediaUrls.set(element, url);
      rememberQuickMedia(url, detectKind(url) || (element.tagName.toLowerCase() === "img" ? "image" : "video"));
      quickButtonElements.add({ element, button });
    });

    scheduleQuickButtonUpdate();
  }

  function isQuickDownloadCandidate(element, url = mediaUrlForElement(element)) {
    if (!element.isConnected || element.closest("[data-deep-media-ignore]")) {
      return false;
    }

    if (!url || !/^https?:/i.test(url)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 110 || rect.height < 64) {
      return false;
    }

    return true;
  }

  function scheduleQuickButtonUpdate() {
    if (quickUpdateFrame) {
      return;
    }
    quickUpdateFrame = requestAnimationFrame(() => {
      quickUpdateFrame = 0;
      updateQuickButtons();
    });
  }

  function updateQuickButtons() {
    for (const entry of Array.from(quickButtonElements)) {
      const { element, button } = entry;
      if (!element.isConnected) {
        button.remove();
        quickButtonElements.delete(entry);
        continue;
      }

      if (!quickButtonsVisible) {
        button.style.display = "none";
        continue;
      }

      const rect = element.getBoundingClientRect();
      const visible = isElementVisible(rect) && Boolean(quickMediaUrls.get(element) || mediaUrlForElement(element) || inferQuickUrlForElement(element));
      button.style.display = visible ? "inline-flex" : "none";

      if (!visible) {
        continue;
      }

      const buttonWidth = button.offsetWidth || 82;
      const x = Math.max(8, Math.min(window.innerWidth - buttonWidth - 8, rect.right - buttonWidth - 10));
      const y = Math.max(8, Math.min(window.innerHeight - 42, rect.top + 10));
      button.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }
  }

  async function quickDownloadElement(element, button) {
    const url = quickMediaUrls.get(element) || mediaUrlForElement(element) || inferQuickUrlForElement(element);
    const kind = detectKind(url) || (element.tagName.toLowerCase() === "img" ? "image" : "video");
    if (!url || !kind) {
      flashQuickButton(button, "Sem URL");
      return;
    }

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "QUICK_DOWNLOAD_MEDIA",
        pageUrl: window.location.href,
        item: {
          url,
          kind,
          title: document.title,
          width: mediaWidth(element),
          height: mediaHeight(element),
          source: "quick-button"
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Falha");
      }

      flashQuickButton(button, kind === "hls" ? "Abrindo" : "OK");
    } catch {
      flashQuickButton(button, "Erro");
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = originalText;
      }, 1200);
    }
  }

  function flashQuickButton(button, text) {
    button.textContent = text;
  }

  function mediaUrlForElement(element) {
    const tag = element.tagName.toLowerCase();
    const candidates = [
      element.currentSrc ||
      "",
      element.src || "",
      element.getAttribute("src") || "",
      element.getAttribute("data-src") || "",
      element.getAttribute("data-video") || "",
      element.getAttribute("data-url") || ""
    ];

    if (tag === "video" || tag === "audio") {
      const source = element.querySelector("source[src]");
      candidates.push(source?.src || "");
      candidates.push(source?.getAttribute("src") || "");
    }

    for (const candidate of candidates) {
      if (candidate && !candidate.startsWith("blob:") && !candidate.startsWith("data:")) {
        const url = resolvePageUrl(candidate);
        if (/^https?:/i.test(url)) {
          return url;
        }
      }
    }

    return quickMediaUrls.get(element) || "";
  }

  function rememberQuickMedia(url, kind) {
    if (!url || !/^https?:/i.test(url)) {
      return;
    }
    quickRecentMedia.unshift({
      url,
      kind,
      time: Date.now()
    });
    if (quickRecentMedia.length > 80) {
      quickRecentMedia.length = 80;
    }
  }

  function inferQuickUrlForElement(element) {
    const tag = element.tagName.toLowerCase();
    const wanted = tag === "img" ? "image" : "video";
    const now = Date.now();
    const recent = quickRecentMedia.find((item) => {
      if (now - item.time > 45_000) {
        return false;
      }
      if (wanted === "image") {
        return item.kind === "image";
      }
      return item.kind === "video" || item.kind === "hls" || item.kind === "dash";
    });

    return recent?.url || "";
  }

  function handleMediaPlaybackChange(event) {
    const element = event.target;
    if (element instanceof HTMLMediaElement) {
      const url = mediaUrlForElement(element) || inferQuickUrlForElement(element);
      if (url) {
        quickMediaUrls.set(element, url);
      }
    }
    scanQuickDownloadTargets();
    scheduleQuickButtonUpdate();
  }

  function setQuickButtonsVisible(visible) {
    quickButtonsVisible = visible;
    if (quickButtonsVisible) {
      scanQuickDownloadTargets();
      return;
    }
    updateQuickButtons();
  }

  function resolvePageUrl(rawUrl) {
    try {
      return new URL(rawUrl, window.location.href).href;
    } catch {
      return "";
    }
  }

  function isElementVisible(rect) {
    return rect.width >= 110 &&
      rect.height >= 64 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
  }

  function mediaWidth(element) {
    return element.videoWidth || element.naturalWidth || element.clientWidth || 0;
  }

  function mediaHeight(element) {
    return element.videoHeight || element.naturalHeight || element.clientHeight || 0;
  }
})();
