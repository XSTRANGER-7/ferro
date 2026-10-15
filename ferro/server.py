"""Dependency-free web server: JSON API + static dashboard (web/). Run: python -m ferro serve"""
from __future__ import annotations

import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .config import Config
from .data import load_shipments
from .insights import simulate, week_drilldown
from .llm import LLMClient
from .pipeline import run
from .qa import Assistant
from .report import run_payload, write_outputs

# Windows can map .js to text/plain via the registry; ES modules need a JS MIME type.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")


class AppState:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.lock = threading.Lock()
        self.result = run(cfg)
        write_outputs(self.result, cfg.paths.output_dir)
        self.payload = run_payload(self.result)
        self.rows_by_key = {(r["route"], r["week_of"]): r for r in self.result.rows}
        self.shipments, _ = load_shipments(cfg.paths.shipments)
        self.assistant = Assistant(self.result.rows, self.result.notes, cfg.thresholds,
                                   LLMClient(cfg.llm, cfg.paths.cache_dir, self.result.ledger))
        self.eval_report: dict | None = None
        self.sim_cache: dict[tuple, dict] = {}

    def evaluation(self) -> dict:
        path = self.cfg.paths.output_dir / "eval_report.json"
        if self.eval_report is None:
            if path.exists():
                self.eval_report = json.loads(path.read_text(encoding="utf-8"))
            else:
                from .evaluation import run_all
                self.eval_report = run_all(self.cfg, with_sensitivity=False)
        repro_path = self.cfg.paths.output_dir / "repro_report.json"
        return {"eval": self.eval_report,
                "repro": json.loads(repro_path.read_text(encoding="utf-8")) if repro_path.exists() else None,
                "token_log": self.result.ledger.summary(),
                "data_quality": self.result.data_quality.to_dict()}

    def simulate(self, own: float, peer: float) -> dict:
        key = (round(own, 1), round(peer, 1))
        if key not in self.sim_cache:
            self.sim_cache[key] = simulate(self.cfg, key[0], key[1], self.result.rows)
        return self.sim_cache[key]


def make_handler(state: AppState):
    web_dir: Path = state.cfg.paths.web_dir.resolve()
    out_dir: Path = state.cfg.paths.output_dir.resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = "Ferro/1.1"

        def log_message(self, fmt, *args):  # keep the console quiet
            pass

        def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, code: int = 200) -> None:
            self._send(code, json.dumps(obj, default=str).encode(), "application/json; charset=utf-8")

        def _file(self, root: Path, rel: str, download: bool = False) -> None:
            target = (root / rel).resolve()
            if (root not in target.parents and target != root) or not target.is_file():
                return self._json({"error": "not found"}, 404)
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "image/svg+xml"):
                ctype += "; charset=utf-8"
            extra = {"Content-Disposition": f'attachment; filename="{target.name}"'} if download else None
            self._send(200, target.read_bytes(), ctype, extra)

        def do_GET(self) -> None:
            url = urlparse(self.path)
            path, q = url.path, {k: v[0] for k, v in parse_qs(url.query).items()}
            if path == "/api/bootstrap":
                return self._json(state.payload)
            if path == "/api/trust":
                with state.lock:
                    return self._json(state.evaluation())
            if path == "/api/week":
                row = state.rows_by_key.get((q.get("route", ""), q.get("week", "")))
                if not row:
                    return self._json({"error": "unknown route-week"}, 404)
                return self._json(week_drilldown(state.shipments, row))
            if path == "/api/simulate":
                try:
                    own, peer = float(q.get("own", 15)), float(q.get("peer", 20))
                except ValueError:
                    return self._json({"error": "bad thresholds"}, 400)
                with state.lock:
                    return self._json(state.simulate(own, peer))
            if path.startswith("/download/"):
                return self._file(out_dir, path[len("/download/"):], download=True)
            if path in ("/", "", "/home"):
                path = "/landing.html"          # marketing / explainer page
            elif path in ("/app", "/app/"):
                path = "/index.html"            # the dashboard
            return self._file(web_dir, path.lstrip("/"))

        def do_POST(self) -> None:
            if urlparse(self.path).path != "/api/ask":
                return self._json({"error": "not found"}, 404)
            try:
                length = min(int(self.headers.get("Content-Length", 0)), 10_000)
                question = str(json.loads(self.rfile.read(length) or b"{}").get("question", "")).strip()[:500]
            except (ValueError, json.JSONDecodeError):
                return self._json({"error": "bad request"}, 400)
            if not question:
                return self._json({"error": "empty question"}, 400)
            with state.lock:
                return self._json(state.assistant.ask(question).to_dict())

    return Handler


def serve(cfg: Config, host: str = "127.0.0.1", port: int = 8765) -> None:
    state = AppState(cfg)
    httpd = ThreadingHTTPServer((host, port), make_handler(state))
    fc = state.result.meta["flag_counts"]
    print(f"Ferro → http://{host}:{port}  (landing)   http://{host}:{port}/app  (dashboard)   "
          f"({fc['Yes']} unexplained, {fc['No (justified)']} justified)   Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
