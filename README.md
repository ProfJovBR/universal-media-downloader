# Deep Media Downloader

Chrome extension for detecting accessible media on web pages, previewing videos/streams, and downloading direct media links.

## Features

- Detects images, direct videos, HLS playlists, DASH manifests, posters, links, styles, scripts, and network requests.
- Popup with filters, search, preview, open, copy, and download actions.
- Large internal preview page with HLS/DASH playback support.
- Floating quick-download buttons on media elements, with an on/off switch.
- HLS downloader page for unencrypted playlists.

## Manual Install

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `extension` folder.

## Notes

This extension does not remove DRM, decrypt protected streams, or bypass access controls. Some media may fail to preview or download when the site requires specific cookies, referers, temporary tokens, CORS access, or DRM.
