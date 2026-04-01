#!/usr/bin/env python3

from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765
USER_AGENT = "Mozilla/5.0"
CACHE_LOCK = threading.Lock()
CACHE: Dict[str, Tuple[float, Any]] = {}


def main() -> None:
    requested_port = PORT
    if len(sys.argv) > 1:
        try:
            requested_port = int(sys.argv[1])
        except ValueError:
            print("Invalid port, using default 8765.")
    server = None
    chosen_port = requested_port
    for candidate in range(requested_port, requested_port + 20):
        try:
            server = ThreadingHTTPServer((HOST, candidate), DashboardHandler)
            chosen_port = candidate
            break
        except OSError:
            continue
    if server is None:
        raise RuntimeError(f"Unable to bind any port between {requested_port} and {requested_port + 19}.")

    print(f"NASDAQ dashboard available at http://{HOST}:{chosen_port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path in {"/", "/index.html"}:
            return self._serve_index()
        if parsed.path == "/api/health":
            return self._send_json({"ok": True, "provider": "Yahoo Finance bridge"})
        if parsed.path == "/api/chart":
            return self._handle_chart(parsed.query)
        if parsed.path == "/api/news":
            return self._handle_news(parsed.query)
        return super().do_GET()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def log_message(self, fmt: str, *args: Any) -> None:
        message = fmt % args
        sys.stdout.write(f"[{self.log_date_time_string()}] {message}\n")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def _serve_index(self) -> None:
        index_path = ROOT / "index.html"
        content = index_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _handle_chart(self, query_string: str) -> None:
        params = urllib.parse.parse_qs(query_string)
        symbol = (params.get("symbol") or [""])[0].strip()
        range_value = (params.get("range") or ["6mo"])[0].strip()
        interval = (params.get("interval") or ["1d"])[0].strip()

        if not symbol:
            return self._send_json({"error": "Missing symbol"}, status=HTTPStatus.BAD_REQUEST)

        try:
            payload = fetch_chart_payload(symbol, range_value, interval)
        except Exception as exc:  # noqa: BLE001
            return self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

        return self._send_json(payload)

    def _handle_news(self, query_string: str) -> None:
        params = urllib.parse.parse_qs(query_string)
        symbol = (params.get("symbol") or [""])[0].strip()
        raw_limit = (params.get("limit") or ["8"])[0].strip()

        if not symbol:
            return self._send_json({"error": "Missing symbol"}, status=HTTPStatus.BAD_REQUEST)

        try:
            limit = max(3, min(20, int(raw_limit)))
        except ValueError:
            limit = 8

        try:
            payload = fetch_news_payload(symbol, limit)
        except Exception as exc:  # noqa: BLE001
            return self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

        return self._send_json(payload)

    def _send_json(self, payload: Dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def fetch_chart_payload(symbol: str, range_value: str, interval: str) -> Dict[str, Any]:
    safe_range = range_value if range_value in {"1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"} else "6mo"
    safe_interval = interval if interval in {"1d", "1wk", "1mo"} else "1d"
    cache_key = f"chart:{symbol}:{safe_range}:{safe_interval}"
    cached = get_cache(cache_key, ttl=120)
    if cached is not None:
        return cached

    last_error = "Yahoo Finance chart request failed."
    for candidate in build_symbol_candidates(symbol):
        encoded = urllib.parse.quote(candidate, safe="")
        for host in ("query2.finance.yahoo.com", "query1.finance.yahoo.com"):
            url = (
                f"https://{host}/v8/finance/chart/{encoded}"
                f"?range={urllib.parse.quote(safe_range)}"
                f"&interval={urllib.parse.quote(safe_interval)}"
                "&includeAdjustedClose=true"
                "&lang=en-US&region=US"
            )
            try:
                response = fetch_json(url)
                result = (response.get("chart") or {}).get("result") or []
                if not result:
                    error = (response.get("chart") or {}).get("error") or {}
                    last_error = error.get("description") or error.get("code") or last_error
                    continue
                data = result[0]
                payload = normalize_chart_payload(symbol, candidate, data)
                set_cache(cache_key, payload, ttl=120)
                return payload
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                continue
    raise RuntimeError(last_error)


def fetch_news_payload(symbol: str, limit: int) -> Dict[str, Any]:
    cache_key = f"news:{symbol}:{limit}"
    cached = get_cache(cache_key, ttl=300)
    if cached is not None:
        return cached

    last_error = "Yahoo Finance news request failed."
    for candidate in build_symbol_candidates(symbol):
        encoded = urllib.parse.quote(candidate, safe="")
        url = (
            "https://query1.finance.yahoo.com/v1/finance/search"
            f"?q={encoded}"
            "&quotesCount=1"
            f"&newsCount={limit}"
            "&enableFuzzyQuery=false"
            "&lang=en-US&region=US"
        )
        try:
            payload = fetch_json(url)
            items = normalize_news_items(payload.get("news") or [], limit)

            if items:
                payload_out = {
                    "provider": "Yahoo Finance",
                    "transport": "bridge:yahoo",
                    "requestedSymbol": symbol,
                    "resolvedSymbol": candidate,
                    "items": items,
                }
                set_cache(cache_key, payload_out, ttl=300)
                return payload_out
            last_error = "No news items found."
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            continue
    raise RuntimeError(last_error)


def normalize_chart_payload(requested_symbol: str, resolved_symbol: str, data: Dict[str, Any]) -> Dict[str, Any]:
    meta = data.get("meta") or {}
    timestamps = data.get("timestamp") or []
    quote = ((data.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    rows = []

    for index, timestamp in enumerate(timestamps):
        close = safe_list_value(closes, index)
        if close is None:
            continue
        open_value = coalesce_number(safe_list_value(opens, index), close)
        high_value = coalesce_number(safe_list_value(highs, index), max(open_value, close))
        low_value = coalesce_number(safe_list_value(lows, index), min(open_value, close))
        volume_value = coalesce_number(safe_list_value(volumes, index), 0)
        rows.append({
            "date": dt.datetime.fromtimestamp(timestamp, tz=dt.timezone.utc).isoformat(),
            "open": open_value,
            "high": max(high_value, open_value, close),
            "low": min(low_value, open_value, close),
            "close": close,
            "volume": volume_value,
            "symbol": resolved_symbol,
        })

    if len(rows) < 30:
        raise RuntimeError("Yahoo Finance returned too few data points.")

    return {
        "provider": "Yahoo Finance",
        "requestedSymbol": requested_symbol,
        "resolvedSymbol": meta.get("symbol") or resolved_symbol,
        "longName": meta.get("longName") or meta.get("shortName") or requested_symbol,
        "instrumentType": meta.get("instrumentType") or "UNKNOWN",
        "currency": meta.get("currency") or "",
        "rows": rows,
    }


def normalize_news_items(entries: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    seen_urls = set()
    for entry in entries:
        title = entry.get("title")
        url_value = (
            entry.get("link")
            or ((entry.get("clickThroughUrl") or {}).get("url"))
            or ((entry.get("canonicalUrl") or {}).get("url"))
        )
        if not title or not url_value or url_value in seen_urls:
            continue
        seen_urls.add(url_value)
        published_ts = entry.get("providerPublishTime")
        published_at = ""
        if isinstance(published_ts, (int, float)):
            published_at = dt.datetime.fromtimestamp(published_ts, tz=dt.timezone.utc).isoformat()
        items.append({
            "title": title,
            "summary": (entry.get("summary") or entry.get("description") or "").strip(),
            "provider": entry.get("publisher") or "Yahoo Finance",
            "publishedAt": published_at,
            "publishedAtLabel": format_news_timestamp(published_at),
            "url": url_value,
        })
        if len(items) >= limit:
            break
    return items


def build_symbol_candidates(symbol: str) -> Iterable[str]:
    normalized = symbol.strip().upper()
    if not normalized:
        return []
    if normalized.startswith("^"):
        return [normalized, normalized.lstrip("^")]
    if normalized.isalnum() and len(normalized) <= 8:
        return [normalized, "^" + normalized]
    return [normalized]


def fetch_json(url: str) -> Dict[str, Any]:
    return json.loads(fetch_text(url))


def fetch_text(url: str) -> str:
    try:
        result = subprocess.run(
            [
                "curl",
                "-k",
                "--compressed",
                "-A",
                USER_AGENT,
                "-s",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Yahoo request timed out.") from exc

    if result.returncode != 0:
        message = (result.stderr or result.stdout or "curl failed").strip()
        raise RuntimeError(f"Yahoo request failed: {message[:200]}")

    body = result.stdout
    if "Too Many Requests" in body:
        raise RuntimeError("Yahoo Finance rate limit reached. Retry in a minute.")
    if "<title>Yahoo</title>" in body and "sad-panda" in body:
        raise RuntimeError("Yahoo Finance returned an error page.")
    return body


def get_cache(key: str, ttl: int) -> Any:
    now = time.time()
    with CACHE_LOCK:
        value = CACHE.get(key)
        if not value:
            return None
        expires_at, payload = value
        if expires_at < now:
            CACHE.pop(key, None)
            return None
        return payload


def set_cache(key: str, payload: Any, ttl: int) -> None:
    with CACHE_LOCK:
        CACHE[key] = (time.time() + ttl, payload)


def safe_list_value(values: List[Any], index: int) -> Any:
    if index >= len(values):
        return None
    return values[index]


def coalesce_number(value: Any, fallback: float) -> float:
    if value is None:
        return float(fallback)
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def format_news_timestamp(value: str) -> str:
    if not value:
        return "-"
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    return parsed.astimezone(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


if __name__ == "__main__":
    main()
