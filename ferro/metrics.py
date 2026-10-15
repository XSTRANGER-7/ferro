"""Weekly cost per tonne-km and the two comparison baselines, implemented exactly as the brief defines them."""
from __future__ import annotations

import numpy as np
import pandas as pd


def monday_of(dates: pd.Series) -> pd.Series:
    """Weeks run Monday→Sunday; week_of is that week's Monday."""
    d = pd.to_datetime(dates).dt.normalize()
    return d - pd.to_timedelta(d.dt.weekday, unit="D")


def weekly_costs(shipments: pd.DataFrame) -> pd.DataFrame:
    """One row per (route, route_type, week_of).

    cost_per_tonne_km = total freight cost / total (tonnes x km) for the week. This is the
    shipment-weighted ratio; it reproduces the official sample rows (e.g. Delhi-Jaipur
    2024-11-11 = 4.17), whereas a plain mean of per-shipment ratios gives 4.16.
    """
    df = shipments.copy()
    df["week_of"] = monday_of(df["shipment_date"])
    weekly = (
        df.groupby(["route", "route_type", "week_of"], sort=True)
        .agg(shipments=("shipment_id", "size"),
             total_cost=("freight_cost_inr", "sum"),
             total_tkm=("tonne_km", "sum"))
        .reset_index()
    )
    weekly["cost_per_tonne_km"] = weekly["total_cost"] / weekly["total_tkm"]
    return weekly


def add_baselines(weekly: pd.DataFrame, history_weeks: int = 8) -> pd.DataFrame:
    """Add own-history and peer baselines plus percentage deltas.

    own_baseline: mean of the route's most recent `history_weeks` weekly values strictly
        before this week (no look-ahead). Fewer available -> use all of them; none -> NaN.
    peer_baseline: mean weekly cost/tkm in the same week across all *other* routes of
        the same route_type. No other route that week -> NaN.
    """
    out = weekly.sort_values(["route", "week_of"]).reset_index(drop=True).copy()

    own_base = np.full(len(out), np.nan)
    own_used = np.zeros(len(out), dtype=int)
    for _, idx in out.groupby("route", sort=True).groups.items():
        values = out.loc[idx, "cost_per_tonne_km"].to_numpy()
        positions = list(idx)
        for i, pos in enumerate(positions):
            prior = values[max(0, i - history_weeks):i]  # strictly before the current week
            own_used[pos] = len(prior)
            if len(prior):
                own_base[pos] = prior.mean()
    out["own_baseline"] = own_base
    out["own_weeks_used"] = own_used

    # Peer average with self-exclusion: (sum of type-week - own) / (count - 1)
    grp = out.groupby(["route_type", "week_of"], sort=True)["cost_per_tonne_km"]
    type_sum = grp.transform("sum")
    type_cnt = grp.transform("count")
    peer_cnt = type_cnt - 1
    out["peer_baseline"] = np.where(peer_cnt > 0, (type_sum - out["cost_per_tonne_km"]) / peer_cnt.replace(0, 1),
                                    np.nan)
    out["peer_count"] = peer_cnt.astype(int)
    peers_by_key = (out.groupby(["route_type", "week_of"], sort=True)["route"]
                    .apply(lambda s: sorted(s.tolist())).to_dict())
    out["peer_routes"] = [
        [r for r in peers_by_key[(rt, wk)] if r != route]
        for route, rt, wk in zip(out["route"], out["route_type"], out["week_of"])
    ]

    out["own_pct"] = (out["cost_per_tonne_km"] / out["own_baseline"] - 1.0) * 100.0
    out["peer_pct"] = (out["cost_per_tonne_km"] / out["peer_baseline"] - 1.0) * 100.0
    return out
