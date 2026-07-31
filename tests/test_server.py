from __future__ import annotations

import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from preview_tool.server import CSP, handler_for


class ServerTests(unittest.TestCase):
    def test_allowlist_headers_and_traversal_rejection(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            bundle = Path(temporary)
            (bundle / "index.html").write_text("ok", encoding="utf-8")
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(bundle))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_address[1]}"
            try:
                with urllib.request.urlopen(f"{base}/?lang=en", timeout=2) as response:
                    self.assertEqual(response.read(), b"ok")
                    self.assertEqual(response.headers["Content-Security-Policy"], CSP)
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
                for path in ("/.git/config", "/../index.html", "/missing"):
                    with (
                        self.subTest(path=path),
                        self.assertRaises(urllib.error.HTTPError) as caught,
                    ):
                        urllib.request.urlopen(f"{base}{path}", timeout=2)
                    error = caught.exception
                    try:
                        self.assertEqual(error.code, 404)
                    finally:
                        error.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
