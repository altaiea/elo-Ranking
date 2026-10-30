"""Shows the leaderboard website inside the desktop app. Read-only.

A tiny web server runs on this computer only (127.0.0.1, random port). It
serves the website files (the elo-Ranking folder this app sits in) and answers the website's
data requests straight from the app's own Elo data folder:

    /current_stats.json   ->  <data root>/elo/stats.json
    /history/<name>.json  ->  <data root>/elo/history/<name>.json

So whatever the Elo importer writes shows up on the website the next time the
page is opened or refreshed. Nothing is ever written, nothing is sent over the
network, and no GitHub repository is involved.
"""
from __future__ import annotations

import mimetypes
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("video/mp4", ".mp4")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/json", ".json")

_SAFE_JSON_NAME = re.compile(r"^[A-Za-z0-9._-]+\.json$")


class SiteServer:
    """Local read-only file server for the website."""

    def __init__(self, site_root: Path, data_root: Path) -> None:
        self.site_root = Path(site_root).resolve()
        self.elo_root = Path(data_root).resolve() / "elo"
        self._server: ThreadingHTTPServer | None = None
        self.port = 0

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/index.html"

    def start(self) -> int:
        if self._server is not None:
            return self.port
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "CODStatsSite"

            def log_message(self, *_args) -> None:   # keep the console quiet
                pass

            def _resolve(self, request_path: str) -> tuple[Path | None, bool]:
                """Return (file, is_live_data)."""
                path = unquote(urlsplit(request_path).path)
                if path in ("", "/"):
                    path = "/index.html"
                if path == "/current_stats.json":
                    return outer.elo_root / "stats.json", True
                if path == "/previous_stats.json" and (outer.elo_root / "previous_stats.json").is_file():
                    return outer.elo_root / "previous_stats.json", True
                if path.startswith("/history/"):
                    name = path[len("/history/"):]
                    if _SAFE_JSON_NAME.fullmatch(name):
                        return outer.elo_root / "history" / name, True
                    return None, False
                candidate = (outer.site_root / path.lstrip("/")).resolve()
                try:
                    candidate.relative_to(outer.site_root)      # no ../ escapes
                except ValueError:
                    return None, False
                return candidate, False

            def _send_error_body(self, code: int, message: str) -> None:
                body = message.encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)

            def _serve(self, head_only: bool) -> None:
                try:
                    file, live = self._resolve(self.path)
                    if file is None or not file.is_file():
                        self._send_error_body(404, "Not found")
                        return
                    size = file.stat().st_size
                    start, end, status = 0, size - 1, 200
                    range_header = self.headers.get("Range", "")
                    match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
                    if match and (match.group(1) or match.group(2)):
                        if match.group(1):
                            start = int(match.group(1))
                            end = int(match.group(2)) if match.group(2) else size - 1
                        else:                                   # last N bytes
                            start = max(0, size - int(match.group(2)))
                        end = min(end, size - 1)
                        if start > end or start >= size:
                            self.send_response(416)
                            self.send_header("Content-Range", f"bytes */{size}")
                            self.send_header("Content-Length", "0")
                            self.end_headers()
                            return
                        status = 206
                    length = end - start + 1
                    content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                    self.send_response(status)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(length))
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Cache-Control", "no-store" if live else "no-cache")
                    if status == 206:
                        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.end_headers()
                    if head_only:
                        return
                    with file.open("rb") as handle:
                        handle.seek(start)
                        remaining = length
                        while remaining > 0:
                            chunk = handle.read(min(65536, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass                                         # the page moved on

            def do_GET(self) -> None:
                self._serve(False)

            def do_HEAD(self) -> None:
                self._serve(True)

            def _refuse(self) -> None:
                self._send_error_body(405, "Read-only")

            do_POST = do_PUT = do_DELETE = do_PATCH = _refuse

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self.port = self._server.server_address[1]
        threading.Thread(target=self._server.serve_forever, name="codstats-site", daemon=True).start()
        return self.port

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None


# ----------------------------------------------------------------------
# Qt page (imported lazily so the server above can be tested without Qt)
# ----------------------------------------------------------------------
def make_website_page(site_root: Path, data_root: Path, header, button):
    """Build the 'Website' page widget for the desktop app."""
    from PySide6.QtCore import QUrl
    from PySide6.QtGui import QColor, QDesktopServices
    from PySide6.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

    try:
        from PySide6.QtWebEngineCore import QWebEngineSettings
        from PySide6.QtWebEngineWidgets import QWebEngineView
    except Exception:                                            # WebEngine not installed
        QWebEngineView = None
        QWebEngineSettings = None

    class WebsitePage(QWidget):
        def __init__(self) -> None:
            super().__init__()
            self.setObjectName("page")
            self.server = SiteServer(site_root, data_root)
            self.view = None
            self.loaded = False
            outer = QVBoxLayout(self)
            outer.setContentsMargins(30, 25, 30, 25)
            outer.setSpacing(14)
            outer.addLayout(header("Leaderboard", "The league website, running from your own Elo data on this computer."))
            if not (Path(site_root) / "index.html").is_file():
                self._message(outer, f"The website files were not found in:\n{site_root}\n\nKeep this app inside your elo-Ranking folder, or reinstall it.")
            elif QWebEngineView is None:
                self._message(outer, "Qt WebEngine is not installed. Run setup.ps1 again (it installs PySide6 with WebEngine).")
            else:
                self.view = QWebEngineView()
                self.view.page().setBackgroundColor(QColor("#0d0d0f"))   # no white flash while loading
                settings = self.view.settings()
                settings.setAttribute(QWebEngineSettings.WebAttribute.PlaybackRequiresUserGesture, False)
                outer.addWidget(self.view, 1)
                actions = QHBoxLayout()
                refresh = button("Refresh data")
                browser = button("Open in browser", secondary=True)
                refresh.clicked.connect(self.refresh)
                browser.clicked.connect(self._open_in_browser)
                actions.addStretch()
                actions.addWidget(browser)
                actions.addWidget(refresh)
                outer.addLayout(actions)

        def _message(self, layout, text: str) -> None:
            label = QLabel(text)
            label.setWordWrap(True)
            layout.addWidget(label)
            layout.addStretch()

        def refresh(self) -> None:
            """Load (first time) or reload (afterwards) so new Elo data shows."""
            if self.view is None:
                return
            if not self.loaded:
                self.server.start()
                self.view.setUrl(QUrl(self.server.url))
                self.loaded = True
            else:
                self.view.reload()

        def _open_in_browser(self) -> None:
            self.server.start()
            QDesktopServices.openUrl(QUrl(self.server.url))

        def shutdown(self) -> None:
            self.server.stop()

    return WebsitePage()
