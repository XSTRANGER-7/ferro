"""Flag rules: is this route-week's cost rising *and* out of the ordinary?

A row is a *candidate* when:
  own  trigger: own_pct  > own_history_pct                       (sharp rise vs its own past), or
  peer trigger: peer_pct > peer_pct threshold AND own_pct > 0    (out of line with similar routes
                                                                  while still rising vs its own past)
The `own_pct > 0` guard keeps a route that is structurally pricier than its peers but *falling*
from being called "rising". A route's first week has no history, so a rise cannot be shown.
Candidates then go to the note check (verdict.py), which marks them "Yes" or "No (justified)".
"""
from __future__ import annotations

import math

from .config import Thresholds


def trigger_for(own_pct: float, peer_pct: float, t: Thresholds) -> str | None:
    if own_pct is None or math.isnan(own_pct):
        return None  # no history -> cannot establish a rise
    own_hit = own_pct > t.own_history_pct
    peer_hit = (peer_pct is not None and not math.isnan(peer_pct)
                and peer_pct > t.peer_pct and own_pct > 0)
    if own_hit and peer_hit:
        return "both"
    if own_hit:
        return "own"
    if peer_hit:
        return "peer"
    return None
