"""
Development TLS certificate for serving the edge camera app to phones on the LAN.

Browsers only expose the camera (getUserMedia) on secure origins, and ``http://192.168.x.x`` is not one.
``ensure_dev_cert()`` creates a self-signed certificate under ``backend/data/certs/`` whose Subject
Alternative Names cover localhost, 127.0.0.1 and every IPv4 address of this machine, and regenerates it
whenever the address list changes. The phone accepts the certificate warning once per device.
"""
import os
import json
import socket
import ipaddress
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from app.config import get_data_path

CERT_DIR = get_data_path("certs")
CERT_FILE = os.path.join(CERT_DIR, "tracenet-dev.crt")
KEY_FILE = os.path.join(CERT_DIR, "tracenet-dev.key")
META_FILE = os.path.join(CERT_DIR, "tracenet-dev.json")


def lan_ipv4_addresses() -> List[str]:
    """Every non-loopback IPv4 of this host, most likely LAN address first."""
    found: List[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))  # no packets are sent; picks the default-route interface
            found.append(s.getsockname()[0])
        finally:
            s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in found and not ip.startswith("127."):
                found.append(ip)
    except OSError:
        pass
    return found


def ensure_dev_cert(extra_hosts: Optional[List[str]] = None) -> Tuple[Optional[str], Optional[str]]:
    """Returns (cert_path, key_path); (None, None) when the ``cryptography`` package is unavailable."""
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
    except ImportError:
        return None, None

    ips = ["127.0.0.1"] + lan_ipv4_addresses()
    dns_names = ["localhost"] + [h for h in (extra_hosts or []) if h and not _is_ip(h)]
    for h in extra_hosts or []:
        if _is_ip(h) and h not in ips:
            ips.append(h)
    wanted = {"ips": sorted(set(ips)), "dns": sorted(set(dns_names))}

    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE) and os.path.exists(META_FILE):
        try:
            with open(META_FILE, "r", encoding="utf-8") as f:
                meta = json.load(f)
            not_after = datetime.fromisoformat(meta.get("not_after"))
            if meta.get("sans") == wanted and not_after > datetime.now(timezone.utc) + timedelta(days=7):
                return CERT_FILE, KEY_FILE
        except Exception:
            pass  # fall through and regenerate

    os.makedirs(CERT_DIR, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "TraceNet DRISHTI (dev)"),
        x509.NameAttribute(NameOID.COMMON_NAME, "TraceNet backend"),
    ])
    san = x509.SubjectAlternativeName(
        [x509.DNSName(d) for d in wanted["dns"]] + [x509.IPAddress(ipaddress.ip_address(i)) for i in wanted["ips"]]
    )
    now = datetime.now(timezone.utc)
    not_after = now + timedelta(days=825)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(not_after)
        .add_extension(san, critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    with open(KEY_FILE, "wb") as f:
        f.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ))
    with open(CERT_FILE, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump({"sans": wanted, "not_after": not_after.isoformat(), "generated_at": now.isoformat()}, f, indent=2)
    return CERT_FILE, KEY_FILE


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False
