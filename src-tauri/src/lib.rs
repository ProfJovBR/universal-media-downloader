use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

const BRIDGE_ADDR: &str = "127.0.0.1:43188";

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaCapture {
    pub url: String,
    pub page_url: Option<String>,
    pub page_title: Option<String>,
    pub r#type: String,
    pub headers: Option<HashMap<String, String>>,
    pub detected_at: u128,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub capture: MediaCapture,
    pub quality: Option<String>,
    pub custom_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    bridge_addr: String,
    ffmpeg_path: Option<String>,
}

#[tauri::command]
async fn get_runtime_info(app: AppHandle) -> RuntimeInfo {
    RuntimeInfo {
        bridge_addr: BRIDGE_ADDR.to_string(),
        ffmpeg_path: find_ffmpeg(&app).map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
async fn start_download(app: AppHandle, options: DownloadOptions) -> Result<String, String> {
    let capture = options.capture;
    let base_dir = if let Some(path) = options.custom_path.filter(|p| !p.trim().is_empty()) {
        PathBuf::from(path)
    } else {
        app.path()
            .download_dir()
            .unwrap_or_else(|_| PathBuf::from("downloads"))
    };

    fs::create_dir_all(&base_dir)
        .map_err(|e| format!("Nao foi possivel criar a pasta de destino: {e}"))?;

    let extension = extension_for_capture(&capture, None);
    let file_name = build_file_name(&capture, &extension);
    let output_path = base_dir.join(file_name);

    if capture.r#type == "hls" {
        download_with_ffmpeg(&app, &capture, options.quality.as_deref(), &output_path).await?;
    } else {
        download_direct(&capture, &output_path).await?;
    }

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_preview(app: AppHandle, capture: MediaCapture) -> Result<String, String> {
    if capture.r#type == "image" {
        let client = client_for_capture(&capture)?;
        let response = client
            .get(&capture.url)
            .send()
            .await
            .map_err(|e| format!("Preview da imagem falhou: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Preview da imagem falhou: {e}"))?;

        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/jpeg")
            .split(';')
            .next()
            .unwrap_or("image/jpeg")
            .to_string();
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Preview da imagem falhou: {e}"))?;
        let base64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(format!("data:{mime};base64,{base64}"));
    }

    let ffmpeg_path = find_ffmpeg(&app).ok_or_else(|| {
        "FFmpeg nao encontrado. Defina FFMPEG_PATH ou deixe ffmpeg.exe em uma pasta bin proxima ao app."
            .to_string()
    })?;
    let preview_path = env::temp_dir().join(format!("umd_preview_{}.jpg", capture.detected_at));

    let mut args = vec!["-y".to_string()];
    append_ffmpeg_headers(&mut args, &capture);
    args.extend([
        "-ss".to_string(),
        "00:00:01".to_string(),
        "-i".to_string(),
        capture.url.clone(),
        "-frames:v".to_string(),
        "1".to_string(),
        "-vf".to_string(),
        "scale=320:-1".to_string(),
        preview_path.to_string_lossy().to_string(),
    ]);

    let ffmpeg_result = tokio::task::spawn_blocking(move || Command::new(ffmpeg_path).args(args).output())
        .await
        .map_err(|e| format!("Preview cancelado: {e}"))?
        .map_err(|e| format!("Nao foi possivel iniciar o FFmpeg: {e}"))?;

    if !ffmpeg_result.status.success() {
        return Err("FFmpeg nao conseguiu gerar preview".to_string());
    }

    let bytes = fs::read(&preview_path).map_err(|e| format!("Preview nao foi criado: {e}"))?;
    let _ = fs::remove_file(&preview_path);
    let base64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/jpeg;base64,{base64}"))
}

async fn download_direct(capture: &MediaCapture, output_path: &Path) -> Result<(), String> {
    let client = client_for_capture(capture)?;
    let response = client
        .get(&capture.url)
        .send()
        .await
        .map_err(|e| format!("Download falhou: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Download falhou: {e}"))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Download falhou ao ler resposta: {e}"))?;
    fs::write(output_path, bytes).map_err(|e| format!("Nao foi possivel salvar o arquivo: {e}"))
}

async fn download_with_ffmpeg(
    app: &AppHandle,
    capture: &MediaCapture,
    quality: Option<&str>,
    output_path: &Path,
) -> Result<(), String> {
    let ffmpeg_path = find_ffmpeg(app).ok_or_else(|| {
        "FFmpeg nao encontrado. Defina FFMPEG_PATH ou deixe ffmpeg.exe em uma pasta bin proxima ao app."
            .to_string()
    })?;

    let mut args = vec!["-y".to_string()];
    append_ffmpeg_headers(&mut args, capture);
    args.extend(["-i".to_string(), capture.url.clone()]);

    match quality {
        Some("low") => args.extend(["-map".to_string(), "0:p:last?".to_string()]),
        _ => args.extend(["-map".to_string(), "0:p:0?".to_string()]),
    }

    args.extend([
        "-c".to_string(),
        "copy".to_string(),
        "-bsf:a".to_string(),
        "aac_adtstoasc".to_string(),
        output_path.to_string_lossy().to_string(),
    ]);

    let output = tokio::task::spawn_blocking(move || Command::new(ffmpeg_path).args(args).output())
        .await
        .map_err(|e| format!("Download cancelado: {e}"))?
        .map_err(|e| format!("Nao foi possivel iniciar o FFmpeg: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "FFmpeg falhou: {}",
        stderr.lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" ")
    ))
}

fn client_for_capture(capture: &MediaCapture) -> Result<reqwest::Client, String> {
    let mut header_map = reqwest::header::HeaderMap::new();

    if let Some(headers) = &capture.headers {
        for (key, value) in headers {
            if value.trim().is_empty() {
                continue;
            }
            if let Ok(name) = reqwest::header::HeaderName::from_bytes(key.as_bytes()) {
                if let Ok(header_value) = reqwest::header::HeaderValue::from_str(value) {
                    header_map.insert(name, header_value);
                }
            }
        }
    }

    reqwest::Client::builder()
        .default_headers(header_map)
        .build()
        .map_err(|e| format!("Nao foi possivel criar cliente HTTP: {e}"))
}

fn append_ffmpeg_headers(args: &mut Vec<String>, capture: &MediaCapture) {
    if let Some(headers) = &capture.headers {
        let mut header_str = String::new();
        for (key, value) in headers {
            if !value.trim().is_empty() {
                header_str.push_str(&format!("{key}: {value}\r\n"));
            }
        }
        if !header_str.is_empty() {
            args.push("-headers".to_string());
            args.push(header_str);
        }
    }
}

fn find_ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(path) = env::var("FFMPEG_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }

    let mut roots = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    if let Ok(current_dir) = env::current_dir() {
        roots.push(current_dir);
    }

    for root in roots {
        for ancestor in root.ancestors().take(6) {
            let direct_candidates = [
                ancestor.join("ffmpeg.exe"),
                ancestor.join("bin").join("ffmpeg.exe"),
            ];
            for candidate in direct_candidates {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }

            if let Ok(children) = fs::read_dir(ancestor) {
                for child in children.flatten() {
                    let path = child.path();
                    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                        continue;
                    };
                    if !name.to_ascii_lowercase().contains("ffmpeg") {
                        continue;
                    }
                    let candidate = path.join("bin").join("ffmpeg.exe");
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    if Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
    {
        Some(PathBuf::from("ffmpeg"))
    } else {
        None
    }
}

fn extension_for_capture(capture: &MediaCapture, content_type: Option<&str>) -> String {
    if capture.r#type == "hls" {
        return "mp4".to_string();
    }

    if let Some(ext) = extension_from_url(&capture.url) {
        return ext;
    }

    match content_type.unwrap_or_default().split(';').next().unwrap_or_default() {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "video/webm" => "webm",
        "video/mp4" => "mp4",
        _ if capture.r#type == "image" => "jpg",
        _ => "mp4",
    }
    .to_string()
}

fn extension_from_url(raw_url: &str) -> Option<String> {
    let path = raw_url.split('?').next().unwrap_or(raw_url);
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "mp4" | "webm" | "mov" | "m4v" => Some(ext),
        _ => None,
    }
}

fn build_file_name(capture: &MediaCapture, extension: &str) -> String {
    let source = capture
        .page_title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
        .unwrap_or("media");
    let mut safe = source
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    safe.truncate(48);
    format!("{}_{}.{}", safe.trim_matches('_'), capture.detected_at, extension)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = start_bridge(handle.clone()).await {
                    let _ = handle.emit("bridge-error", error.to_string());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_download,
            get_preview,
            get_runtime_info
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar");
}

async fn start_bridge(app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind(BRIDGE_ADDR).await?;

    loop {
        let (mut socket, _) = listener.accept().await?;
        let handle = app_handle.clone();
        tokio::spawn(async move {
            let request = read_http_request(&mut socket).await;

            match request {
                Ok(HttpRequest { method, body: _ }) if method == "OPTIONS" => {
                    let _ = write_response(&mut socket, 204, "").await;
                }
                Ok(HttpRequest { method, body }) if method == "POST" => {
                    if let Ok(capture) = serde_json::from_slice::<MediaCapture>(&body) {
                        let _ = handle.emit("media-capture", capture);
                    }
                    let _ = write_response(&mut socket, 200, "{\"ok\":true}").await;
                }
                _ => {
                    let _ = write_response(&mut socket, 404, "{\"ok\":false}").await;
                }
            }
        });
    }
}

struct HttpRequest {
    method: String,
    body: Vec<u8>,
}

async fn read_http_request(socket: &mut tokio::net::TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::new();
    let mut tmp = [0u8; 8192];

    let header_end = loop {
        let n = socket
            .read(&mut tmp)
            .await
            .map_err(|e| format!("Falha ao ler bridge: {e}"))?;
        if n == 0 {
            return Err("Conexao fechada antes dos headers".to_string());
        }
        buffer.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_header_end(&buffer) {
            break pos;
        }
        if buffer.len() > 64 * 1024 {
            return Err("Headers muito grandes".to_string());
        }
    };

    let headers = String::from_utf8_lossy(&buffer[..header_end]);
    let method = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().next())
        .unwrap_or("")
        .to_string();
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);

    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let n = socket
            .read(&mut tmp)
            .await
            .map_err(|e| format!("Falha ao ler corpo do bridge: {e}"))?;
        if n == 0 {
            break;
        }
        buffer.extend_from_slice(&tmp[..n]);
    }

    let body_end = buffer.len().min(body_start + content_length);
    Ok(HttpRequest {
        method,
        body: buffer[body_start..body_end].to_vec(),
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

async fn write_response(socket: &mut tokio::net::TcpStream, status: u16, body: &str) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        404 => "Not Found",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    socket
        .write_all(response.as_bytes())
        .await
        .map_err(|e| format!("Falha ao responder bridge: {e}"))
}
