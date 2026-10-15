"""Central configuration. Every tunable lives here so a reviewer can see all knobs in one place."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value not in (None, "") else default


@dataclass(frozen=True)
class Thresholds:
    # Flag when cost is above its own trailing average by more than this (percent).
    own_history_pct: float = 15.0
    # Flag when cost is above the same-type peer average by more than this (percent),
    # provided it is also above its own history (i.e. actually rising).
    peer_pct: float = 20.0
    # Trailing window length (weeks) for the own-history baseline. Fixed by the brief.
    history_weeks: int = 8
    # Tolerance (percentage points) when a note states a magnitude, e.g. "5-7%".
    magnitude_tolerance_pp: float = 3.0
    # How long a "starting this week" level-shift note stays active: the length of the
    # trailing window, i.e. until the baseline has absorbed the new level.
    level_shift_active_weeks: int = 8


@dataclass(frozen=True)
class LLMSettings:
    """Optional LLM used only to *phrase* explanations / answers. Never decides verdicts."""
    mode: str = field(default_factory=lambda: os.environ.get("FERRO_LLM_MODE", "auto"))  # auto | off | on
    base_url: str = field(default_factory=lambda: os.environ.get(
        "FERRO_LLM_BASE_URL", "https://api.groq.com/openai/v1"))
    api_key: str = field(default_factory=lambda: os.environ.get(
        "FERRO_LLM_API_KEY", os.environ.get("GROQ_API_KEY", "")))
    model: str = field(default_factory=lambda: os.environ.get("FERRO_LLM_MODEL", "llama-3.1-8b-instant"))
    temperature: float = 0.0
    seed: int = 7
    max_tokens: int = 160
    timeout_s: float = 20.0
    # Published Groq on-demand price for llama-3.1-8b-instant (USD per 1M tokens).
    price_in_per_m: float = field(default_factory=lambda: _env_float("FERRO_LLM_PRICE_IN", 0.05))
    price_out_per_m: float = field(default_factory=lambda: _env_float("FERRO_LLM_PRICE_OUT", 0.08))

    @property
    def enabled(self) -> bool:
        if self.mode == "off":
            return False
        if self.mode == "on":
            return True
        is_local = "localhost" in self.base_url or "127.0.0.1" in self.base_url
        return bool(self.api_key) or is_local


@dataclass(frozen=True)
class Paths:
    shipments: Path = ROOT / "shipment_records.csv"
    notes: Path = ROOT / "context_notes.csv"
    sample_format: Path = ROOT / "sample_output_format_v2.csv"
    output_dir: Path = ROOT / "output"
    cache_dir: Path = ROOT / ".cache"
    web_dir: Path = ROOT / "web"
    eval_dir: Path = ROOT / "eval"


@dataclass(frozen=True)
class Config:
    thresholds: Thresholds = field(default_factory=Thresholds)
    llm: LLMSettings = field(default_factory=LLMSettings)
    paths: Paths = field(default_factory=Paths)
    retrieval_top_k: int = 4


CONTRACT_COLUMNS = [
    "route", "week_of", "cost_per_tonne_km", "vs_own_history",
    "vs_similar_routes", "flagged", "matched_note_id", "reason",
]

FLAG_YES = "Yes"
FLAG_JUSTIFIED = "No (justified)"
FLAG_NO = "No"
