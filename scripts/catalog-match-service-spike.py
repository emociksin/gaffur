"""Faz 8 Scrapy/Python servis siniri icin JSONL sozlesme spike'i.

Bu dosya crawler degildir ve veritabanina yazmaz. Her stdin satirinda tek istek alir,
normalize edilmis adaylari tek stdout satiri olarak dondurur. Yalniz standard library kullanir.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from urllib.parse import urlparse

CONTRACT_VERSION = "phase8-spike-v1"
MAX_ITEMS = 50

TRANSLATE = str.maketrans({
    "ç": "c", "Ç": "c", "ğ": "g", "Ğ": "g", "ı": "i", "İ": "i",
    "ö": "o", "Ö": "o", "ş": "s", "Ş": "s", "ü": "u", "Ü": "u",
})


def fold_text(value: object) -> str:
    text = str(value or "").translate(TRANSLATE)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text)).strip()


def normalize_item(raw: object) -> dict[str, object] | None:
    if not isinstance(raw, dict):
        return None
    url = str(raw.get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    title = str(raw.get("title") or "").strip()[:500]
    if not title:
        return None
    price = raw.get("price")
    if price is not None and (not isinstance(price, (int, float)) or price <= 0):
        price = None
    return {
        "url": url,
        "title": title,
        "normalized_title": fold_text(title),
        "price": price,
        "currency": str(raw.get("currency") or "TRY").upper()[:3],
        "site": str(raw.get("site") or parsed.hostname).lower()[:100],
        "brand": str(raw.get("brand") or "").strip()[:128] or None,
        "gtin": re.sub(r"\D", "", str(raw.get("gtin") or ""))[:14] or None,
        "mpn": str(raw.get("mpn") or "").strip()[:128] or None,
    }


def handle(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict) or payload.get("contract_version") != CONTRACT_VERSION:
        return {"ok": False, "contract_version": CONTRACT_VERSION, "error": "unsupported_contract"}
    query = str(payload.get("query") or "").strip()[:200]
    if not query:
        return {"ok": False, "contract_version": CONTRACT_VERSION, "error": "query_required"}
    items = payload.get("items")
    if not isinstance(items, list):
        return {"ok": False, "contract_version": CONTRACT_VERSION, "error": "items_required"}
    normalized = [item for item in (normalize_item(raw) for raw in items[:MAX_ITEMS]) if item]
    return {
        "ok": True,
        "contract_version": CONTRACT_VERSION,
        "query": query,
        "items": normalized,
        "rejected_count": min(len(items), MAX_ITEMS) - len(normalized),
    }


def main() -> int:
    for line in sys.stdin:
        try:
            payload = json.loads(line)
            result = handle(payload)
        except Exception as exc:  # JSON sinirinda tek is bozuksa servis kapanmaz.
            result = {"ok": False, "contract_version": CONTRACT_VERSION, "error": type(exc).__name__}
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
