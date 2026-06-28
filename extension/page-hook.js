(() => {
  if (window.__deepMediaDownloaderPageHookLoaded) {
    return;
  }
  window.__deepMediaDownloaderPageHookLoaded = true;

  const MEDIA_RE = /\.(?:m3u8|mpd|mp4|m4v|m4s|webm|mov|mkv|avi|ogv|ts|m2ts|mp2t|cmfv|jpg|jpeg|png|webp|gif|avif|heic|heif|bmp|svg)(?:$|[?#])/i;

  function notify(rawUrl, hint) {
    if (!rawUrl || typeof rawUrl !== "string" || !MEDIA_RE.test(rawUrl)) {
      return;
    }

    try {
      const url = new URL(rawUrl, window.location.href).href;
      window.postMessage({
        source: "DEEP_MEDIA_DOWNLOADER_PAGE",
        url,
        kind: detectKind(url),
        hint
      }, "*");
    } catch {
      // Ignore invalid URLs from page scripts.
    }
  }

  function detectKind(url) {
    const clean = url.split("?")[0].split("#")[0].toLowerCase();
    if (clean.endsWith(".m3u8")) return "hls";
    if (clean.endsWith(".mpd")) return "dash";
    if (/\.(jpg|jpeg|png|webp|gif|avif|heic|heif|bmp|svg)$/i.test(clean)) return "image";
    return "video";
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function patchedFetch(input, init) {
      const url = typeof input === "string" ? input : input?.url;
      notify(url, "fetch");
      return originalFetch.call(this, input, init);
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    notify(String(url || ""), "xhr");
    return originalOpen.call(this, method, url, ...rest);
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function patchedSetAttribute(name, value) {
    if (/^(src|srcset|href|poster|data-src|data-video|data-background|data-bg)$/i.test(name)) {
      notify(String(value || ""), `setAttribute:${name}`);
    }
    return originalSetAttribute.call(this, name, value);
  };
})();
