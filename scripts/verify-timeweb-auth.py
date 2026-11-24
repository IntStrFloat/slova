"""Authenticate the configured Timeweb mailbox over verified TLS; sends no mail."""

import json
import shlex
import smtplib
import ssl
import sys
from pathlib import Path


def main():
    values = {}
    env_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/slova/backend.env")
    for line in env_path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() in {"TIMEWEB_MAIL_USERNAME", "TIMEWEB_MAIL_PASSWORD"}:
            parts = shlex.split(value, comments=True)
            if len(parts) != 1:
                raise ValueError("invalid_mail_configuration")
            values[key.strip()] = parts[0]
    if values.get("TIMEWEB_MAIL_USERNAME") != "sales@strsoft.ru":
        raise ValueError("unexpected_mailbox")
    with smtplib.SMTP_SSL("smtp.timeweb.ru", 465, timeout=15,
                          context=ssl.create_default_context()) as client:
        code, _ = client.login(values["TIMEWEB_MAIL_USERNAME"], values["TIMEWEB_MAIL_PASSWORD"])
        if code != 235:
            raise ValueError("smtp_authentication_failed")
    print(json.dumps({"tlsVerified": True, "smtpAuthenticationCode": code, "messagesSent": 0}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Provider errors and environment contents must not enter the audit log.
        print(json.dumps({"smtpAuthenticationVerified": False, "messagesSent": 0}))
        sys.exit(1)
