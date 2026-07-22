"""Loopback-only review server for one validated preview bundle."""

from __future__ import annotations

import mimetypes
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ALLOWED_PATHS = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/theme.css": "theme.css",
    "/app.js": "app.js",
    "/preview.json": "preview.json",
    "/provenance.json": "provenance.json",
    "/gaps.md": "gaps.md",
}

CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; "
    "connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; "
    "form-action 'none'; frame-ancestors 'none'"
)


def handler_for(bundle: Path) -> type[BaseHTTPRequestHandler]:
    resolved_bundle = bundle.resolve(strict=True)

    class PreviewHandler(BaseHTTPRequestHandler):
        server_version = "preview/0.1"

        def do_GET(self) -> None:
            self._serve(include_body=True)

        def do_HEAD(self) -> None:
            self._serve(include_body=False)

        def _serve(self, *, include_body: bool) -> None:
            raw_path = unquote(urlsplit(self.path).path)
            filename = ALLOWED_PATHS.get(raw_path)
            if filename is None:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            candidate = resolved_bundle / filename
            try:
                if candidate.is_symlink() or not candidate.is_file():
                    raise FileNotFoundError(candidate)
                data = candidate.read_bytes()
            except OSError:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            if filename.endswith((".json", ".md")):
                content_type += "; charset=utf-8"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.end_headers()
            if include_body:
                self.wfile.write(data)

        def log_message(self, format: str, *args: object) -> None:
            return

    return PreviewHandler


def serve(bundle: Path, port: int, *, open_browser: bool = False) -> None:
    """Serve one bundle on loopback until interrupted."""
    if not 0 <= port <= 65535:
        raise ValueError("port must be between 0 and 65535")
    server = ThreadingHTTPServer(("127.0.0.1", port), handler_for(bundle))
    host, actual_port = server.server_address[:2]
    url = f"http://{host}:{actual_port}/"
    print(f"serving {bundle} at {url}", flush=True)
    if open_browser:
        threading.Timer(0.1, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
