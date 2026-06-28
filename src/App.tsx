import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Folder,
  Globe,
  Image as ImageIcon,
  Link,
  Loader2,
  Play,
  Settings,
  Trash2,
  Video,
} from "lucide-react";

type MediaType = "video" | "hls" | "image";

interface MediaCapture {
  url: string;
  pageUrl?: string;
  pageTitle?: string;
  type: MediaType;
  headers?: Record<string, string>;
  detectedAt: number;
}

interface RuntimeInfo {
  bridgeAddr: string;
  ffmpegPath?: string | null;
}

function mediaLabel(type: MediaType) {
  if (type === "hls") return "STREAM";
  if (type === "image") return "IMAGE";
  return "VIDEO";
}

function shortHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "URL manual";
  }
}

function MediaItem({ capture, downloadPath }: { capture: MediaCapture; downloadPath: string | null }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [quality, setQuality] = useState("high");
  const [downloading, setDownloading] = useState(false);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingPreview(true);
    invoke<string>("get_preview", { capture })
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setLoadingPreview(false));
  }, [capture]);

  const onDownload = async () => {
    setDownloading(true);
    setError(null);
    setDownloadedPath(null);

    try {
      const path = await invoke<string>("start_download", {
        options: {
          capture,
          quality,
          customPath: downloadPath,
        },
      });
      setDownloadedPath(path);
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <article className="media-card">
      <div className="preview-container">
        {loadingPreview ? (
          <Loader2 className="spinner" size={24} />
        ) : preview ? (
          <img src={preview} className="preview-img" alt="" />
        ) : (
          <div className="preview-placeholder">
            {capture.type === "image" ? <ImageIcon size={32} /> : <Video size={32} />}
          </div>
        )}
      </div>

      <div className="content">
        <div className="meta">
          <span className={`badge ${capture.type}`}>{mediaLabel(capture.type)}</span>
          <span className="timestamp">{new Date(capture.detectedAt).toLocaleTimeString()}</span>
          <span className="host">{shortHost(capture.url)}</span>
        </div>

        <div className="title" title={capture.url}>
          {capture.url}
        </div>
        <div className="source" title={capture.pageUrl || ""}>
          {capture.pageTitle || capture.pageUrl || "Origem desconhecida"}
        </div>

        {capture.type === "hls" && (
          <div className="quality-selector">
            <select value={quality} onChange={(event) => setQuality(event.target.value)}>
              <option value="high">Melhor qualidade</option>
              <option value="low">Menor arquivo</option>
            </select>
          </div>
        )}

        {downloadedPath && (
          <div className="result success" title={downloadedPath}>
            <CheckCircle2 size={14} />
            <span>{downloadedPath}</span>
          </div>
        )}
        {error && (
          <div className="result error" title={error}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="actions">
        <button onClick={onDownload} disabled={downloading} className="btn-download">
          {downloading ? <Loader2 className="spinner" size={18} /> : <Download size={18} />}
          {downloading ? "Baixando" : "Baixar"}
        </button>
      </div>
    </article>
  );
}

function App() {
  const [captures, setCaptures] = useState<MediaCapture[]>([]);
  const [downloadPath, setDownloadPath] = useState<string | null>(localStorage.getItem("downloadPath"));
  const [showSettings, setShowSettings] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [manualType, setManualType] = useState<MediaType>("video");

  useEffect(() => {
    invoke<RuntimeInfo>("get_runtime_info")
      .then(setRuntime)
      .catch(() => setRuntime(null));

    const unlistenCapture = listen<MediaCapture>("media-capture", (event) => {
      addCapture(event.payload);
    });
    const unlistenBridge = listen<string>("bridge-error", (event) => {
      setBridgeError(event.payload);
    });

    return () => {
      unlistenCapture.then((dispose) => dispose());
      unlistenBridge.then((dispose) => dispose());
    };
  }, []);

  const stats = useMemo(
    () => ({
      total: captures.length,
      videos: captures.filter((capture) => capture.type !== "image").length,
      images: captures.filter((capture) => capture.type === "image").length,
    }),
    [captures]
  );

  function addCapture(capture: MediaCapture) {
    if (!capture.url) return;
    setCaptures((prev) => {
      if (prev.some((item) => item.url === capture.url && item.type === capture.type)) {
        return prev;
      }
      return [{ ...capture, detectedAt: capture.detectedAt || Date.now() }, ...prev].slice(0, 100);
    });
  }

  function changePath() {
    const path = prompt("Pasta de downloads:", downloadPath || "");
    if (path !== null) {
      const value = path.trim();
      setDownloadPath(value || null);
      if (value) localStorage.setItem("downloadPath", value);
      else localStorage.removeItem("downloadPath");
    }
  }

  function addManualUrl(event: React.FormEvent) {
    event.preventDefault();
    const url = manualUrl.trim();
    if (!url) return;

    addCapture({
      url,
      pageTitle: "URL manual",
      pageUrl: url,
      type: manualType,
      detectedAt: Date.now(),
    });
    setManualUrl("");
  }

  return (
    <div className="app-container">
      <header className="navbar">
        <div className="logo">
          <div className="logo-icon">
            <Download size={20} />
          </div>
          <span>
            Universal Media Downloader <b>V2</b>
          </span>
        </div>
        <div className="nav-actions">
          <button className="nav-btn" onClick={() => setShowSettings((value) => !value)} title="Configuracoes">
            <Settings size={20} />
          </button>
          <button className="nav-btn danger" onClick={() => setCaptures([])} title="Limpar lista">
            <Trash2 size={20} />
          </button>
        </div>
      </header>

      {showSettings && (
        <section className="settings-panel">
          <div className="setting-item">
            <label>Pasta de destino</label>
            <div className="path-display">
              <Folder size={16} />
              <span>{downloadPath || "Downloads do sistema"}</span>
              <button onClick={changePath}>Alterar</button>
            </div>
          </div>
          <div className="setting-item compact">
            <label>FFmpeg</label>
            <span>{runtime?.ffmpegPath || "nao localizado ainda"}</span>
          </div>
        </section>
      )}

      <main className="main-content">
        <section className="capture-bar">
          <form onSubmit={addManualUrl} className="manual-form">
            <Link size={18} />
            <input
              value={manualUrl}
              onChange={(event) => setManualUrl(event.target.value)}
              placeholder="Cole uma URL direta de video, stream .m3u8/.mpd ou imagem"
            />
            <select value={manualType} onChange={(event) => setManualType(event.target.value as MediaType)}>
              <option value="video">Video</option>
              <option value="hls">Stream</option>
              <option value="image">Imagem</option>
            </select>
            <button type="submit">
              <Play size={16} />
              Adicionar
            </button>
          </form>

          <div className="stats">
            <span>{stats.total} itens</span>
            <span>{stats.videos} videos</span>
            <span>{stats.images} imagens</span>
          </div>
        </section>

        {captures.length === 0 ? (
          <section className="empty-state">
            <div className="empty-icon">
              <Globe size={64} />
            </div>
            <h2>Pronto para capturar</h2>
            <p>
              Carregue a extensao da pasta extension no navegador e abra sites com videos,
              streams ou imagens. Links detectados aparecem aqui automaticamente.
            </p>
          </section>
        ) : (
          <section className="media-grid">
            {captures.map((capture) => (
              <MediaItem key={`${capture.type}-${capture.url}`} capture={capture} downloadPath={downloadPath} />
            ))}
          </section>
        )}
      </main>

      <footer className="status-bar">
        <div className="status-item">
          <div className={bridgeError ? "pulse-red" : "pulse-green"} />
          {bridgeError ? `Bridge com erro: ${bridgeError}` : `Bridge: ${runtime?.bridgeAddr || "127.0.0.1:43188"}`}
        </div>
        <div className="status-item">Extensao MV3 + Tauri</div>
      </footer>

      <style>{`
        :root {
          --bg: #11110f;
          --panel: #1b1b18;
          --panel-2: #23231f;
          --line: #33342e;
          --accent: #0f9f8f;
          --accent-2: #e85d3f;
          --text: #f2f1ec;
          --text-dim: #aaa79e;
          --danger: #e5484d;
          --success: #30a46c;
        }

        * { box-sizing: border-box; }
        body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; }
        button, input, select { font: inherit; }

        .app-container { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; }

        .navbar { height: 64px; background: var(--panel); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
        .logo { display: flex; align-items: center; gap: 12px; font-size: 1.05rem; min-width: 0; }
        .logo span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .logo b { color: var(--accent); }
        .logo-icon { background: var(--accent); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; flex: 0 0 auto; }
        .nav-actions { display: flex; gap: 8px; }
        .nav-btn { background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 8px; border-radius: 6px; transition: 0.2s; }
        .nav-btn:hover { background: var(--panel-2); color: var(--text); }
        .nav-btn.danger:hover { background: rgba(229, 72, 77, 0.12); color: var(--danger); }

        .settings-panel { background: #171714; padding: 18px 24px; border-bottom: 1px solid var(--line); display: grid; gap: 14px; }
        .setting-item label { display: block; margin-bottom: 8px; font-size: 0.82rem; color: var(--text-dim); }
        .setting-item.compact span { color: var(--text-dim); font-size: 0.8rem; overflow-wrap: anywhere; }
        .path-display { background: var(--bg); padding: 10px 14px; border-radius: 8px; display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); }
        .path-display span { flex: 1; min-width: 0; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .path-display button, .manual-form button { background: var(--accent); border: none; color: white; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 8px; }

        .main-content { flex: 1; overflow-y: auto; padding: 20px 24px 24px; }
        .capture-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; margin-bottom: 18px; }
        .manual-form { display: grid; grid-template-columns: auto minmax(180px, 1fr) 110px auto; gap: 10px; align-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
        .manual-form input, .manual-form select, .quality-selector select { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; min-width: 0; }
        .stats { display: flex; gap: 8px; color: var(--text-dim); font-size: 0.78rem; white-space: nowrap; }
        .stats span { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; }

        .empty-state { height: calc(100vh - 210px); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: var(--text-dim); max-width: 560px; margin: 0 auto; }
        .empty-icon { margin-bottom: 24px; color: #4a4a42; }
        .empty-state h2 { color: var(--text); margin: 0 0 12px; }
        .empty-state p { line-height: 1.6; margin: 0; }

        .media-grid { display: flex; flex-direction: column; gap: 14px; }
        .media-card { background: var(--panel); border-radius: 8px; padding: 14px; display: flex; gap: 18px; border: 1px solid var(--line); transition: 0.2s; }
        .media-card:hover { border-color: rgba(15, 159, 143, 0.8); transform: translateY(-1px); }

        .preview-container { width: 210px; aspect-ratio: 16 / 9; background: #050505; border-radius: 8px; overflow: hidden; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; position: relative; }
        .preview-img { width: 100%; height: 100%; object-fit: cover; }
        .preview-placeholder { color: #55554d; }

        .content { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
        .meta { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .badge { font-size: 0.68rem; font-weight: 800; padding: 3px 8px; border-radius: 5px; letter-spacing: 0; }
        .badge.hls { background: rgba(15, 159, 143, 0.16); color: #3dd6c6; }
        .badge.image { background: rgba(48, 164, 108, 0.16); color: #4cc38a; }
        .badge.video { background: rgba(232, 93, 63, 0.16); color: #ff8a70; }
        .timestamp, .host { font-size: 0.78rem; color: var(--text-dim); min-width: 0; }
        .host { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .title { font-weight: 650; font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .source { font-size: 0.8rem; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .quality-selector { margin-top: 6px; }
        .quality-selector select { padding: 5px 8px; font-size: 0.8rem; }
        .result { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 0.78rem; }
        .result span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .result.success { color: #4cc38a; }
        .result.error { color: #ff8a70; }

        .actions { display: flex; align-items: center; padding-left: 12px; }
        .btn-download { background: var(--accent); color: white; border: none; min-width: 118px; padding: 11px 18px; border-radius: 8px; cursor: pointer; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 9px; transition: 0.2s; }
        .btn-download:hover { filter: brightness(1.12); }
        .btn-download:disabled { opacity: 0.65; cursor: not-allowed; }

        .status-bar { min-height: 34px; background: #0c0c0b; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 24px; font-size: 0.75rem; color: var(--text-dim); flex: 0 0 auto; }
        .status-item { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pulse-green, .pulse-red { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
        .pulse-green { background: var(--success); box-shadow: 0 0 0 4px rgba(48, 164, 108, 0.14); }
        .pulse-red { background: var(--danger); box-shadow: 0 0 0 4px rgba(229, 72, 77, 0.14); }

        .spinner { animation: rotate 1s linear infinite; }
        @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: var(--bg); }
        ::-webkit-scrollbar-thumb { background: #3b3b34; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #4a4a42; }

        @media (max-width: 760px) {
          .navbar { padding: 0 14px; }
          .main-content { padding: 14px; }
          .capture-bar { grid-template-columns: 1fr; }
          .manual-form { grid-template-columns: auto minmax(0, 1fr); }
          .manual-form select, .manual-form button { grid-column: span 2; width: 100%; justify-content: center; }
          .stats { overflow-x: auto; }
          .media-card { flex-direction: column; }
          .preview-container { width: 100%; }
          .actions { padding-left: 0; }
          .btn-download { width: 100%; }
          .status-bar { padding: 0 14px; }
        }
      `}</style>
    </div>
  );
}

export default App;
