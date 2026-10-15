"""Optional LLM client (OpenAI-compatible chat API) with an on-disk cache and an honest token ledger.

Works with Groq (default; free tier, open-source Llama 3.1 8B), a local Ollama
(`FERRO_LLM_BASE_URL=http://localhost:11434/v1`), OpenRouter, or OpenAI. Uses only urllib.

Determinism: temperature 0 + fixed seed + a response cache keyed on sha256(model+messages).
A second run over the same input never calls the API again. Even on a cache miss, the LLM
only *rephrases* text whose verdict, note id and numbers are fixed by code, and the result is
validated (see explain.validate_explanation), so provider nondeterminism cannot move a verdict.
"""
from __future__ import annotations

import hashlib
import json
import math
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from .config import LLMSettings


def estimate_tokens(text: str) -> int:
    """~4 characters per token for English (used only when the provider reports no usage)."""
    return max(1, math.ceil(len(text) / 4))


@dataclass
class LedgerEntry:
    purpose: str
    status: str          # "api" | "cache" | "fallback" | "dry_run" | "error"
    input_tokens: int
    output_tokens: int
    latency_ms: int = 0
    note: str = ""


@dataclass
class TokenLedger:
    settings: LLMSettings
    entries: list[LedgerEntry] = field(default_factory=list)

    def add(self, entry: LedgerEntry) -> None:
        self.entries.append(entry)

    def summary(self) -> dict:
        def agg(statuses: set[str]) -> dict:
            sel = [e for e in self.entries if e.status in statuses]
            tin = sum(e.input_tokens for e in sel)
            tout = sum(e.output_tokens for e in sel)
            return {
                "calls": len(sel),
                "input_tokens": tin,
                "output_tokens": tout,
                "cost_usd": round(tin / 1e6 * self.settings.price_in_per_m + tout / 1e6 * self.settings.price_out_per_m, 6),
            }

        by_purpose: dict[str, int] = {}
        for e in self.entries:
            by_purpose[e.purpose] = by_purpose.get(e.purpose, 0) + 1
        return {
            "llm_enabled": self.settings.enabled,
            "model": self.settings.model,
            "base_url": self.settings.base_url,
            "temperature": self.settings.temperature,
            "seed": self.settings.seed,
            "pricing_usd_per_1m": {"input": self.settings.price_in_per_m, "output": self.settings.price_out_per_m},
            "billable_api_calls": agg({"api"}),
            "served_from_cache": agg({"cache"}),
            "fell_back_to_template": agg({"fallback", "error"}),
            "projected_if_llm_enabled": agg({"dry_run"}) if not self.settings.enabled else None,
            "calls_by_purpose": dict(sorted(by_purpose.items())),
        }


class LLMClient:
    def __init__(self, settings: LLMSettings, cache_dir: Path, ledger: TokenLedger) -> None:
        self.s = settings
        self.cache_dir = cache_dir / "llm"
        self.ledger = ledger

    @property
    def enabled(self) -> bool:
        return self.s.enabled

    def _key(self, messages: list[dict]) -> str:
        blob = json.dumps({"model": self.s.model, "messages": messages, "t": self.s.temperature,
                           "seed": self.s.seed, "max": self.s.max_tokens}, sort_keys=True)
        return hashlib.sha256(blob.encode()).hexdigest()

    def complete(self, messages: list[dict], purpose: str) -> str | None:
        """Return the model text, or None if disabled/unavailable (caller falls back)."""
        prompt_text = "\n".join(m["content"] for m in messages)
        if not self.enabled:
            # Record what this call *would* cost so the token log can project LLM-mode spend.
            self.ledger.add(LedgerEntry(purpose, "dry_run", estimate_tokens(prompt_text) + 8 * len(messages),
                                        self.s.max_tokens // 2, note="LLM disabled; estimated"))
            return None

        key = self._key(messages)
        path = self.cache_dir / f"{key}.json"
        if path.exists():
            cached = json.loads(path.read_text(encoding="utf-8"))
            self.ledger.add(LedgerEntry(purpose, "cache", cached["input_tokens"], cached["output_tokens"]))
            return cached["text"].strip()

        body = json.dumps({
            "model": self.s.model, "messages": messages, "temperature": self.s.temperature,
            "seed": self.s.seed, "max_tokens": self.s.max_tokens,
        }).encode()
        req = urllib.request.Request(
            self.s.base_url.rstrip("/") + "/chat/completions", data=body, method="POST",
            headers={"Content-Type": "application/json",
                     **({"Authorization": f"Bearer {self.s.api_key}"} if self.s.api_key else {})})
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=self.s.timeout_s) as resp:
                data = json.loads(resp.read().decode())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            self.ledger.add(LedgerEntry(purpose, "error", 0, 0, note=str(exc)[:200]))
            return None
        latency = int((time.perf_counter() - t0) * 1000)
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
        usage = data.get("usage") or {}
        tin = int(usage.get("prompt_tokens") or estimate_tokens(prompt_text))
        tout = int(usage.get("completion_tokens") or estimate_tokens(text))
        self.ledger.add(LedgerEntry(purpose, "api", tin, tout, latency))
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"text": text, "input_tokens": tin, "output_tokens": tout}), encoding="utf-8")
        return text.strip()
