import json
import os
import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


DEFAULT_LABELS = [
    "NAME",
    "COMPANY",
    "DESIGNATION",
    "ADDRESS",
    "PHONE",
    "EMAIL",
    "WEBSITE",
    "OTHER",
]


def _safe_float(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return default


def _extract_card_key(path_or_name: str) -> str:
    name = Path(path_or_name).name.lower()
    m = re.search(r"card\d+", name)
    return m.group(0) if m else Path(name).stem


def resolve_annotation_path(explicit_path: Optional[str] = None) -> Optional[Path]:
    candidates: List[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path))

    env_path = os.getenv("OCR_ANNOTATIONS_PATH", "").strip()
    if env_path:
        candidates.append(Path(env_path))

    candidates.extend(
        [
            Path("data/annotations/1annotations.json"),
            Path("data/annotations/annotations.json"),
        ]
    )

    for p in candidates:
        if p.exists() and p.is_file():
            return p
    return None


def _iter_rect_results(task: Dict) -> Iterable[Tuple[str, float, float, float, float]]:
    annotations = task.get("annotations") or []
    for ann in annotations:
        if ann.get("was_cancelled"):
            continue
        for r in ann.get("result") or []:
            if r.get("type") != "rectanglelabels":
                continue
            val = r.get("value") or {}
            labels = val.get("rectanglelabels") or []
            if not labels:
                continue
            label = str(labels[0]).upper().strip()
            x = _safe_float(val.get("x")) / 100.0
            y = _safe_float(val.get("y")) / 100.0
            w = _safe_float(val.get("width")) / 100.0
            h = _safe_float(val.get("height")) / 100.0
            if w <= 0 or h <= 0:
                continue
            yield label, x, y, w, h


def _finalize_stats(rows: List[Tuple[float, float, float, float]]) -> Dict:
    n = len(rows)
    if n == 0:
        return {
            "count": 0,
            "mean_cx": 0.5,
            "mean_cy": 0.5,
            "mean_w": 0.2,
            "mean_h": 0.05,
            "std_cx": 0.25,
            "std_cy": 0.25,
            "std_w": 0.2,
            "std_h": 0.08,
        }

    cxs = [r[0] for r in rows]
    cys = [r[1] for r in rows]
    ws = [r[2] for r in rows]
    hs = [r[3] for r in rows]

    def mean(vs):
        return sum(vs) / len(vs)

    def stdev(vs, m):
        if len(vs) < 2:
            return 0.15
        var = sum((x - m) ** 2 for x in vs) / (len(vs) - 1)
        return max(var ** 0.5, 0.03)

    mcx = mean(cxs)
    mcy = mean(cys)
    mw = mean(ws)
    mh = mean(hs)

    return {
        "count": n,
        "mean_cx": mcx,
        "mean_cy": mcy,
        "mean_w": mw,
        "mean_h": mh,
        "std_cx": stdev(cxs, mcx),
        "std_cy": stdev(cys, mcy),
        "std_w": stdev(ws, mw),
        "std_h": stdev(hs, mh),
    }


def build_layout_profile(annotation_path: Path, out_profile_path: Optional[Path] = None) -> Dict:
    data = json.loads(annotation_path.read_text(encoding="utf-8"))

    by_label: Dict[str, List[Tuple[float, float, float, float]]] = {}
    task_count = 0

    for task in data:
        task_count += 1
        for label, x, y, w, h in _iter_rect_results(task):
            cx = x + (w / 2.0)
            cy = y + (h / 2.0)
            by_label.setdefault(label, []).append((cx, cy, w, h))

    labels_stats = {lbl: _finalize_stats(rows) for lbl, rows in by_label.items()}

    for lbl in DEFAULT_LABELS:
        labels_stats.setdefault(lbl, _finalize_stats([]))

    profile = {
        "source": str(annotation_path),
        "source_mtime": annotation_path.stat().st_mtime,
        "task_count": task_count,
        "labels": labels_stats,
    }

    if out_profile_path:
        out_profile_path.parent.mkdir(parents=True, exist_ok=True)
        out_profile_path.write_text(json.dumps(profile, indent=2), encoding="utf-8")

    return profile


def load_or_build_layout_profile(
    annotation_path: Optional[Path],
    cache_path: Path,
) -> Dict:
    if annotation_path is None or (not annotation_path.exists()):
        return {
            "source": "",
            "source_mtime": 0,
            "task_count": 0,
            "labels": {lbl: _finalize_stats([]) for lbl in DEFAULT_LABELS},
        }

    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            src = Path(cached.get("source", ""))
            src_mtime = float(cached.get("source_mtime", 0))
            if src.resolve() == annotation_path.resolve() and src_mtime == annotation_path.stat().st_mtime:
                return cached
        except Exception:
            pass

    return build_layout_profile(annotation_path, out_profile_path=cache_path)


def build_task_card_map(annotation_path: Path) -> Dict[str, Dict]:
    data = json.loads(annotation_path.read_text(encoding="utf-8"))
    mapping: Dict[str, Dict] = {}

    for task in data:
        img = (task.get("data") or {}).get("img", "")
        file_upload = task.get("file_upload", "")
        key_src = file_upload or img
        card_key = _extract_card_key(str(key_src))
        mapping[card_key] = task

    return mapping
