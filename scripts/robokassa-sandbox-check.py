"""Billing diagnostics through a selected Windows interface, VPN unchanged.

Robokassa support confirmed recurring payments cannot be tested in TEST mode.
This helper creates no invoices and never switches to LIVE. It may inspect or
cancel the historical TEST subscription; stdout contains no credentials.
"""
import argparse
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import struct

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "credentials/robokassa-qa/session.json"
HOST = "slova.193.160.208.95.nip.io"
PROTOCOL = "robokassa-v3"


def save(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(state, handle)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(STATE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["catalog", "status", "cancel"])
    parser.add_argument("--interface-index", type=int, required=True)
    parser.add_argument("--source-address", required=True)
    args = parser.parse_args()

    def request(path, method="GET", body=None, token=None, protocol=True):
        raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        raw.settimeout(15)
        raw.setsockopt(socket.IPPROTO_IP, 31, struct.pack("!I", args.interface_index))
        raw.bind((args.source_address, 0))
        try:
            raw.connect(("193.160.208.95", 443))
            with ssl.create_default_context().wrap_socket(raw, server_hostname=HOST) as tls:
                data = json.dumps(body).encode() if body is not None else b""
                headers = {"Host": HOST, "Connection": "close", "Content-Type": "application/json",
                           "Content-Length": str(len(data))}
                if protocol:
                    headers["X-Slova-Billing-Protocol"] = PROTOCOL
                if token:
                    headers["Authorization"] = "Bearer " + token
                head = f"{method} {path} HTTP/1.1\r\n" + "".join(f"{key}: {value}\r\n" for key, value in headers.items()) + "\r\n"
                tls.sendall(head.encode() + data)
                response = http.client.HTTPResponse(tls)
                response.begin()
                result = json.loads(response.read(128 * 1024).decode())
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}: {result.get('error', 'request_failed')}")
                return result
        finally:
            raw.close()

    catalog = request("/api/billing/catalog")
    if args.action == "catalog":
        old = request("/api/billing/catalog", protocol=False)
        print(json.dumps({"provider": catalog.get("provider"), "mode": catalog.get("mode"),
                          "available": catalog.get("available"), "oldClientAvailable": old.get("available"),
                          "tlsVerified": True}))
        return
    if catalog.get("provider") != "robokassa" or catalog.get("merchantLogin") != "slova" or catalog.get("mode") != "test":
        raise RuntimeError("This script only operates on the Slova TEST backend")
    state = json.loads(STATE.read_text()) if STATE.exists() else None
    if not state or state.get("mode") != "test":
        raise RuntimeError("No saved TEST checkout")
    path = "/api/billing/subscription" + ("/cancel" if args.action == "cancel" else "")
    result = request(path, "POST" if args.action == "cancel" else "GET",
                     {} if args.action == "cancel" else None, state["account"]["authToken"])
    state["lastStatus"] = result
    save(state)
    print(json.dumps({key: result.get(key) for key in
                     ("active", "activeUntil", "autoRenew", "nextPaymentAt", "pendingPaymentId", "serverTime")}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never dump response bodies, tokens, keys or saved checkout URLs.
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({"ok": False, "reason": message}))
        raise SystemExit(1)
