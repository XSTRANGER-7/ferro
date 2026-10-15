"""Loading and validating shipment records. Bad rows are quarantined with a reason, never silently dropped."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

REQUIRED_COLUMNS = [
    "shipment_id", "origin", "destination", "route_type", "quantity_tonnes",
    "distance_km", "freight_cost_inr", "shipment_date",
]
VALID_ROUTE_TYPES = {"Short", "Medium", "Long"}


@dataclass
class DataQuality:
    rows_read: int = 0
    rows_used: int = 0
    quarantined: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "rows_read": self.rows_read,
            "rows_used": self.rows_used,
            "rows_quarantined": len(self.quarantined),
            "quarantined": self.quarantined[:50],
            "warnings": self.warnings,
        }


def _clean_place(s: pd.Series) -> pd.Series:
    return s.astype("string").str.strip().str.replace(r"\s+", " ", regex=True).str.title()


def route_name(origin: str, destination: str) -> str:
    return f"{origin}-{destination}"


def load_shipments(path: Path | str) -> tuple[pd.DataFrame, DataQuality]:
    raw = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = [c for c in REQUIRED_COLUMNS if c not in raw.columns]
    if missing:
        raise ValueError(f"shipment file is missing required columns: {missing}")
    return validate_shipments(raw)


def validate_shipments(raw: pd.DataFrame) -> tuple[pd.DataFrame, DataQuality]:
    dq = DataQuality(rows_read=len(raw))
    df = raw.copy()
    df["origin"] = _clean_place(df["origin"])
    df["destination"] = _clean_place(df["destination"])
    df["route_type"] = df["route_type"].astype("string").str.strip().str.title()
    for col in ("quantity_tonnes", "distance_km", "freight_cost_inr"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["shipment_date"] = pd.to_datetime(df["shipment_date"].astype("string").str.strip(),
                                         errors="coerce", format="%Y-%m-%d")

    reasons = pd.Series("", index=df.index, dtype="object")

    def mark(mask: pd.Series, why: str) -> None:
        mask = mask.fillna(True) & (reasons == "")
        reasons.loc[mask] = why

    mark((df["origin"].fillna("") == "") | (df["destination"].fillna("") == ""), "missing origin/destination")
    mark(df["origin"] == df["destination"], "origin equals destination")
    mark(df["shipment_date"].isna(), "unparseable shipment_date")
    mark(~df["route_type"].isin(VALID_ROUTE_TYPES), "unknown route_type")
    mark(~(df["quantity_tonnes"] > 0), "non-positive or missing quantity_tonnes")
    mark(~(df["distance_km"] > 0), "non-positive or missing distance_km")
    mark(~(df["freight_cost_inr"] > 0), "non-positive or missing freight_cost_inr")
    dup = df["shipment_id"].duplicated(keep="first") & (df["shipment_id"] != "")
    mark(dup, "duplicate shipment_id")

    bad = reasons != ""
    for idx in df.index[bad]:
        dq.quarantined.append({"row": int(idx) + 2, "shipment_id": str(raw.at[idx, "shipment_id"]),
                               "reason": reasons.at[idx]})
    df = df.loc[~bad].copy()

    df["route"] = df["origin"] + "-" + df["destination"]
    df = _resolve_route_types(df, dq)
    df["tonne_km"] = df["quantity_tonnes"] * df["distance_km"]
    dq.rows_used = len(df)
    return df.reset_index(drop=True), dq


def _resolve_route_types(df: pd.DataFrame, dq: DataQuality) -> pd.DataFrame:
    """A route must have exactly one route_type; if the file disagrees, use the majority and warn."""
    counts = df.groupby(["route", "route_type"], sort=True).size().reset_index(name="n")
    for route, grp in counts.groupby("route", sort=True):
        if len(grp) > 1:
            winner = grp.sort_values(["n", "route_type"], ascending=[False, True]).iloc[0]["route_type"]
            detail = ", ".join(f"{r.route_type}={r.n}" for r in grp.itertuples())
            dq.warnings.append(f"{route}: conflicting route_type ({detail}); using {winner}")
            df.loc[df["route"] == route, "route_type"] = winner
    return df


def load_notes(path: Path | str) -> pd.DataFrame:
    notes = pd.read_csv(path, dtype=str, keep_default_na=False)
    for col in ("note_id", "date", "applies_to", "note"):
        if col not in notes.columns:
            raise ValueError(f"notes file is missing column {col}")
        notes[col] = notes[col].str.strip()
    notes["date"] = pd.to_datetime(notes["date"], format="%Y-%m-%d")
    return notes.sort_values("note_id").reset_index(drop=True)
