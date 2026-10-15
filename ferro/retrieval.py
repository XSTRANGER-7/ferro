"""RAG retrieval over context notes.

`VectorIndex` is a small, dependency-free vector store: TF-IDF embeddings (sublinear tf,
smoothed idf, L2-normalised) held in a numpy matrix and searched by cosine similarity.
With ten notes a hosted vector DB would add latency and nondeterminism and buy nothing;
the same interface (`add`, `search`) can be backed by Chroma/FAISS + sentence embeddings
if the note corpus grows.

`retrieve()` is a hybrid ranker: semantic similarity is combined with metadata signals
(does the note's scope cover this route? how close is its window in time?). Retrieval
only *ranks evidence*; whether a note justifies anything is decided in verdict.py.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date

import numpy as np

from .notes import NoteFact

STOPWORDS = set("""a an the and or of to in on at by for from with was were is are be been this that these
those as it its into after before than over about due but not no new which while""".split())
MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august",
               "september", "october", "november", "december"]


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > 4 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokenize(text: str) -> list[str]:
    words = re.findall(r"[a-z]+", text.lower())
    return [_stem(w) for w in words if w not in STOPWORDS and len(w) > 1]


class VectorIndex:
    """Deterministic TF-IDF vector store with cosine search."""

    def __init__(self) -> None:
        self.ids: list[str] = []
        self.docs: list[str] = []
        self.vocab: dict[str, int] = {}
        self.idf: np.ndarray | None = None
        self.matrix: np.ndarray | None = None

    def add(self, ids: list[str], docs: list[str]) -> "VectorIndex":
        self.ids, self.docs = list(ids), list(docs)
        tokenized = [tokenize(d) for d in self.docs]
        self.vocab = {t: i for i, t in enumerate(sorted({t for toks in tokenized for t in toks}))}
        n = len(self.docs)
        df = np.zeros(len(self.vocab))
        for toks in tokenized:
            for t in set(toks):
                df[self.vocab[t]] += 1
        self.idf = np.log((1 + n) / (1 + df)) + 1.0
        self.matrix = np.vstack([self._embed_tokens(toks) for toks in tokenized]) if n else np.zeros((0, 0))
        return self

    def _embed_tokens(self, toks: list[str]) -> np.ndarray:
        vec = np.zeros(len(self.vocab))
        for t, c in Counter(toks).items():
            if t in self.vocab:
                vec[self.vocab[t]] = 1.0 + math.log(c)
        vec *= self.idf
        norm = np.linalg.norm(vec)
        return vec / norm if norm else vec

    def embed(self, text: str) -> np.ndarray:
        return self._embed_tokens(tokenize(text))

    def search(self, query: str, top_k: int | None = None) -> list[tuple[str, float]]:
        if self.matrix is None or not len(self.ids):
            return []
        scores = self.matrix @ self.embed(query)
        order = sorted(range(len(self.ids)), key=lambda i: (-round(float(scores[i]), 12), self.ids[i]))
        if top_k:
            order = order[:top_k]
        return [(self.ids[i], float(scores[i])) for i in order]


def note_document(fact: NoteFact) -> str:
    """Text that gets embedded: the note plus its metadata, spelled out in words."""
    d = date.fromisoformat(fact.date)
    return f"{fact.applies_to} {fact.text} {MONTH_NAMES[d.month - 1]} {d.year}"


@dataclass
class Retrieved:
    note_id: str
    score: float
    semantic: float
    scope: float
    time: float

    def to_dict(self) -> dict:
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


class NoteRetriever:
    W_SEMANTIC, W_SCOPE, W_TIME = 0.4, 0.3, 0.3

    def __init__(self, facts: list[NoteFact]) -> None:
        self.facts = {f.note_id: f for f in facts}
        self.index = VectorIndex().add([f.note_id for f in facts], [note_document(f) for f in facts])

    @staticmethod
    def query_for(route: str, week: date) -> str:
        a, b = route.split("-", 1)
        return (f"{route} {a} {b} corridor freight cost rise increase surcharge disruption "
                f"{MONTH_NAMES[week.month - 1]} {week.year}")

    def retrieve(self, route: str, week: date, top_k: int = 4) -> list[Retrieved]:
        semantic = dict(self.index.search(self.query_for(route, week)))
        hits = []
        for nid, fact in self.facts.items():
            if fact.scope_kind == "corridor" and fact.applies_to_route(route):
                scope = 1.0
            elif fact.scope_kind == "all":
                scope = 0.6
            else:
                scope = 0.0
            time_score = math.exp(-fact.days_from(week) / 21.0)
            sem = semantic.get(nid, 0.0)
            total = self.W_SEMANTIC * sem + self.W_SCOPE * scope + self.W_TIME * time_score
            hits.append(Retrieved(nid, total, sem, scope, time_score))
        hits.sort(key=lambda h: (-round(h.score, 12), h.note_id))
        return hits[:top_k]

    def search_text(self, text: str, top_k: int = 3) -> list[tuple[str, float]]:
        return self.index.search(text, top_k)
