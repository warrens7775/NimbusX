import json
import os
import re
import sqlite3
import hashlib
import hmac
import base64
import binascii
import struct
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, quote, urlencode, urlparse
import xml.etree.ElementTree as ET


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "nimbus.db")
ADMIN_SESSION_COOKIE = "nimbus_admin_session"
ADMIN_SESSION_TTL = 60 * 60 * 12
ADMIN_SESSION_SECRET = os.environ.get("NIMBUS_ADMIN_SECRET", "nimbusx-admin-session-secret")
S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "").rstrip("/")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY", "")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
S3_PROVIDER = os.environ.get("S3_PROVIDER", "minio").lower()
S3_BUCKET_RE = re.compile(r"^(?![0-9]+(?:\.[0-9]+){3}$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
ADMIN_PERMISSION_CATALOG = [
    ("access_admin_console", "Access admin console"),
    ("view_dashboard", "View overview"),
    ("view_users", "View users"),
    ("manage_users", "Manage users"),
    ("impersonate_users", "Login as user"),
    ("view_projects", "View projects"),
    ("manage_projects", "Manage projects"),
    ("view_resources", "View resources"),
    ("manage_resources", "Manage resources"),
    ("view_leads", "View leads"),
    ("manage_leads", "Manage leads"),
    ("view_billing", "View billing"),
    ("manage_billing", "Manage billing"),
    ("view_content", "View content"),
    ("manage_content", "Manage content"),
    ("view_roles", "View groups"),
    ("manage_roles", "Create and edit groups"),
    ("manage_permissions", "Edit group permissions"),
    ("view_audit_logs", "View audit logs"),
    ("restart_service", "Restart service"),
]
ROLE_SEEDS = {
    "owner": {
        "description": "Full platform control",
        "is_system": 1,
        "permissions": [key for key, _label in ADMIN_PERMISSION_CATALOG],
    },
    "admin": {
        "description": "Manage users, projects, billing, and support tasks",
        "is_system": 1,
        "permissions": [
            "access_admin_console",
            "view_dashboard",
            "view_users",
            "manage_users",
            "impersonate_users",
            "view_projects",
            "manage_projects",
            "view_resources",
            "manage_resources",
            "view_leads",
            "manage_leads",
            "view_billing",
            "manage_billing",
            "view_content",
            "manage_content",
            "view_audit_logs",
        ],
    },
    "support": {
        "description": "Read-only support operations",
        "is_system": 1,
        "permissions": [
            "access_admin_console",
            "view_dashboard",
            "view_users",
            "view_projects",
            "view_resources",
            "view_leads",
            "view_billing",
            "view_content",
            "view_audit_logs",
        ],
    },
    "user": {
        "description": "Standard user access",
        "is_system": 1,
        "permissions": ["view_dashboard"],
    },
}


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role_id INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1,
            active_project_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    user_columns = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "role_id" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN role_id INTEGER")
    if "is_active" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
    if "active_project_id" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN active_project_id INTEGER")
    if "twofa_secret" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN twofa_secret TEXT")
    if "twofa_enabled" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN twofa_enabled INTEGER NOT NULL DEFAULT 0")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL DEFAULT '',
            is_system INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS role_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_id INTEGER NOT NULL,
            permission_key TEXT NOT NULL,
            UNIQUE(role_id, permission_key),
            FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_user_id INTEGER,
            target_role_id INTEGER,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(admin_user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, name),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS vms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            region TEXT NOT NULL DEFAULT 'All Regions',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, project_id, name),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            resource_type TEXT NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'available',
            region TEXT NOT NULL DEFAULT 'All Regions',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, project_id, resource_type, name),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            company TEXT NOT NULL,
            phone TEXT,
            service TEXT,
            workload TEXT,
            budget TEXT,
            message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    role_ids = {}
    for role_name, role_meta in ROLE_SEEDS.items():
        conn.execute(
            """
            INSERT OR IGNORE INTO roles (name, description, is_system)
            VALUES (?, ?, ?)
            """,
            (role_name, role_meta["description"], role_meta["is_system"]),
        )
    role_rows = conn.execute("SELECT id, name FROM roles").fetchall()
    role_ids = {row["name"]: row["id"] for row in role_rows}
    for role_name, role_meta in ROLE_SEEDS.items():
        role_id = role_ids.get(role_name)
        if not role_id:
            continue
        for permission_key in role_meta["permissions"]:
            conn.execute(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)",
                (role_id, permission_key),
            )

    owner_role_id = role_ids.get("owner")
    user_role_id = role_ids.get("user")
    if owner_role_id:
        owner_exists = conn.execute(
            "SELECT id FROM users WHERE role_id = ? LIMIT 1",
            (owner_role_id,),
        ).fetchone()
        first_user = conn.execute("SELECT id FROM users ORDER BY id ASC LIMIT 1").fetchone()
        if first_user and not owner_exists:
            conn.execute("UPDATE users SET role_id = ? WHERE id = ?", (owner_role_id, first_user["id"]))
        if user_role_id:
            conn.execute("UPDATE users SET role_id = ? WHERE role_id IS NULL", (user_role_id,))

    conn.commit()
    conn.close()


def _admin_secret_bytes() -> bytes:
    return ADMIN_SESSION_SECRET.encode("utf-8")


def _make_admin_session(user_id: int, expires_at: int) -> str:
    payload = f"{user_id}:{expires_at}"
    sig = hmac.new(_admin_secret_bytes(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _verify_admin_session(token: str):
    try:
        user_id_raw, expires_raw, sig = token.split(":", 2)
        payload = f"{user_id_raw}:{expires_raw}"
        expected = hmac.new(_admin_secret_bytes(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None
        expires_at = int(expires_raw)
        if expires_at < int(time.time()):
            return None
        return int(user_id_raw)
    except Exception:
        return None


def _parse_cookie(header: str, key: str) -> str:
    for part in (header or "").split(";"):
        name, sep, value = part.strip().partition("=")
        if sep and name == key:
            return value
    return ""


def _role_permission_map(conn, role_id: int) -> set[str]:
    rows = conn.execute(
        "SELECT permission_key FROM role_permissions WHERE role_id = ?",
        (role_id,),
    ).fetchall()
    return {row["permission_key"] for row in rows}


def _load_admin_user(conn, token: str):
    user_id = _verify_admin_session(token)
    if not user_id:
        return None, None, None
    conn.row_factory = sqlite3.Row
    user = conn.execute(
        """
        SELECT users.id, users.full_name, users.email, users.role_id, users.is_active,
               roles.name AS role_name, roles.description AS role_description, roles.is_system
        FROM users
        LEFT JOIN roles ON roles.id = users.role_id
        WHERE users.id = ?
        """,
        (user_id,),
    ).fetchone()
    if not user or user["is_active"] != 1:
        return None, None, None
    permissions = set()
    if user["role_id"]:
        permissions = _role_permission_map(conn, user["role_id"])
    return user, permissions, user["role_name"]


def _admin_payload(user, permissions: set[str]):
    return {
        "id": user["id"],
        "fullName": user["full_name"],
        "email": user["email"],
        "roleId": user["role_id"],
        "roleName": user["role_name"],
        "roleDescription": user["role_description"],
        "isSystemRole": bool(user["is_system"]),
        "permissions": sorted(permissions),
    }


def _role_permissions_catalog():
    return [{"key": key, "label": label} for key, label in ADMIN_PERMISSION_CATALOG]


def _record_admin_action(conn, admin_user_id: int, action: str, target_user_id: int | None = None, target_role_id: int | None = None, details=None):
    details_json = None
    if details is not None:
        try:
            details_json = json.dumps(details)
        except TypeError:
            details_json = json.dumps(str(details))
    conn.execute(
        """
        INSERT INTO admin_audit_logs (admin_user_id, action, target_user_id, target_role_id, details)
        VALUES (?, ?, ?, ?, ?)
        """,
        (admin_user_id, action, target_user_id, target_role_id, details_json),
    )


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, digest_hex = stored_hash.split("$", 1)
    except ValueError:
        return False
    salt = bytes.fromhex(salt_hex)
    expected = bytes.fromhex(digest_hex)
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return hmac.compare_digest(candidate, expected)


def generate_totp_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def _decode_totp_secret(secret: str) -> bytes:
    normalized = "".join((secret or "").strip().upper().split())
    padding = "=" * ((8 - len(normalized) % 8) % 8)
    return base64.b32decode(normalized + padding)


def generate_totp_code(secret: str, timestep: int | None = None) -> str:
    if timestep is None:
        timestep = int(time.time() // 30)
    key = _decode_totp_secret(secret)
    digest = hmac.new(key, struct.pack(">Q", timestep), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1000000:06d}"


def verify_totp_code(secret: str, code: str) -> bool:
    normalized_code = "".join((code or "").split())
    if not normalized_code.isdigit() or len(normalized_code) != 6:
        return False
    current_step = int(time.time() // 30)
    for drift in (-1, 0, 1):
        if hmac.compare_digest(generate_totp_code(secret, current_step + drift), normalized_code):
            return True
    return False


def build_totp_uri(email: str, secret: str) -> str:
    issuer = "NimbusX"
    label = f"{issuer}:{email}"
    return (
        f"otpauth://totp/{quote(label)}"
        f"?secret={quote(secret)}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"
    )


def ensure_seed_projects(conn, user_id: int):
    count = conn.execute("SELECT COUNT(*) AS c FROM projects WHERE user_id = ?", (user_id,)).fetchone()[0]
    if count > 0:
        return

    conn.execute(
        "INSERT INTO projects (user_id, name, description, is_default) VALUES (?, ?, ?, 1)",
        (user_id, "Default", "Default project"),
    )
    test_id = conn.execute(
        "INSERT INTO projects (user_id, name, description, is_default) VALUES (?, ?, ?, 0) RETURNING id",
        (user_id, "Test Project", "Test Project"),
    ).fetchone()[0]
    conn.execute("UPDATE users SET active_project_id = ? WHERE id = ?", (test_id, user_id))
    conn.commit()


def get_user_by_email(conn, email: str):
    conn.row_factory = sqlite3.Row
    return conn.execute(
        """
        SELECT users.id, users.full_name, users.email, users.password_hash, users.role_id, users.is_active,
               users.active_project_id, users.twofa_secret, users.twofa_enabled,
               roles.name AS role_name, roles.description AS role_description, roles.is_system
        FROM users
        LEFT JOIN roles ON roles.id = users.role_id
        WHERE email = ?
        """,
        (email,),
    ).fetchone()


def get_user_by_id(conn, user_id: int):
    conn.row_factory = sqlite3.Row
    return conn.execute(
        """
        SELECT users.id, users.full_name, users.email, users.password_hash, users.role_id, users.is_active,
               users.active_project_id, users.twofa_secret, users.twofa_enabled,
               roles.name AS role_name, roles.description AS role_description, roles.is_system
        FROM users
        LEFT JOIN roles ON roles.id = users.role_id
        WHERE users.id = ?
        """,
        (user_id,),
    ).fetchone()


def serialize_projects(conn, user_id: int, active_project_id: int | None):
    conn.row_factory = sqlite3.Row
    projects = conn.execute(
        "SELECT id, name, description, is_default FROM projects WHERE user_id = ? ORDER BY id ASC",
        (user_id,),
    ).fetchall()
    if not projects:
        return {"projects": [], "activeProjectId": None}

    if not active_project_id or not any(project["id"] == active_project_id for project in projects):
        default_project = next((project for project in projects if project["is_default"] == 1), projects[0])
        active_project_id = default_project["id"]
        conn.execute("UPDATE users SET active_project_id = ? WHERE id = ?", (active_project_id, user_id))
        conn.commit()

    return {
        "projects": [
            {
                "id": project["id"],
                "name": project["name"],
                "description": project["description"],
                "isDefault": bool(project["is_default"]),
            }
            for project in projects
        ],
        "activeProjectId": active_project_id,
    }


def serialize_vms(conn, user_id: int, project_id: int):
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, name, status, region, created_at FROM vms WHERE user_id = ? AND project_id = ? ORDER BY id ASC",
        (user_id, project_id),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "region": row["region"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def serialize_resources(conn, user_id: int, project_id: int, resource_type: str):
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT id, name, status, region, created_at
        FROM resources
        WHERE user_id = ? AND project_id = ? AND resource_type = ?
        ORDER BY id ASC
        """,
        (user_id, project_id, resource_type),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "region": row["region"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def validate_s3_bucket_name(name: str):
    if not S3_BUCKET_RE.match(name) or ".." in name or ".-" in name or "-." in name:
        return "Bucket names must be 3-63 characters using lowercase letters, numbers, dots, and hyphens."
    return ""


def _s3_signing_key(secret_key: str, date_stamp: str, region: str):
    date_key = hmac.new(("AWS4" + secret_key).encode("utf-8"), date_stamp.encode("utf-8"), hashlib.sha256).digest()
    region_key = hmac.new(date_key, region.encode("utf-8"), hashlib.sha256).digest()
    service_key = hmac.new(region_key, b"s3", hashlib.sha256).digest()
    return hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()


def _s3_request(
    method: str,
    bucket_name: str,
    object_key: str = "",
    query_params: dict | None = None,
    body: bytes = b"",
    content_type: str = "",
):
    if not S3_ENDPOINT or not S3_ACCESS_KEY or not S3_SECRET_KEY:
        raise RuntimeError("S3 backend is not configured")

    parsed = urlparse(S3_ENDPOINT)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise RuntimeError("S3 endpoint must be a valid http or https URL")

    now = time.gmtime()
    amz_date = time.strftime("%Y%m%dT%H%M%SZ", now)
    date_stamp = time.strftime("%Y%m%d", now)
    canonical_uri = "/" + quote(bucket_name, safe="")
    if object_key:
        canonical_uri = f"{canonical_uri}/{quote(object_key, safe='/')}"
    canonical_query = ""
    if query_params:
        canonical_query = urlencode(sorted(query_params.items()), doseq=True, quote_via=quote)
    payload_hash = hashlib.sha256(body).hexdigest()
    host = parsed.netloc
    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if content_type:
        headers["content-type"] = content_type
    canonical_headers = "".join(f"{key}:{headers[key]}\n" for key in sorted(headers))
    signed_headers = ";".join(sorted(headers))
    canonical_request = "\n".join(
        [method, canonical_uri, canonical_query, canonical_headers, signed_headers, payload_hash]
    )
    credential_scope = f"{date_stamp}/{S3_REGION}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = _s3_signing_key(S3_SECRET_KEY, date_stamp, S3_REGION)
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    auth_header = (
        "AWS4-HMAC-SHA256 "
        f"Credential={S3_ACCESS_KEY}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )
    request_headers = {
        "Authorization": auth_header,
        "Host": host,
        "X-Amz-Content-Sha256": payload_hash,
        "X-Amz-Date": amz_date,
    }
    if content_type:
        request_headers["Content-Type"] = content_type
    url = f"{S3_ENDPOINT}{canonical_uri}"
    if canonical_query:
        url = f"{url}?{canonical_query}"
    request_data = body if method in ("POST", "PUT") else None
    request = urllib.request.Request(url, data=request_data, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"S3 request failed with HTTP {error.code}: {error_body or error.reason}")
    except urllib.error.URLError as error:
        raise RuntimeError(f"S3 request failed: {error.reason}")


def create_s3_bucket(bucket_name: str):
    body = b""
    if S3_PROVIDER not in ("minio", "wasabi") and S3_REGION != "us-east-1":
        body = (
            '<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
            f"<LocationConstraint>{S3_REGION}</LocationConstraint>"
            "</CreateBucketConfiguration>"
        ).encode("utf-8")
    try:
        _s3_request("PUT", bucket_name, body=body)
        return ""
    except RuntimeError as error:
        message = str(error)
        if "BucketAlreadyOwnedByYou" in message or "Your previous request to create the named bucket succeeded" in message:
            return ""
        return message


def _s3_tagging_body(tags: dict[str, str]):
    tagging = ET.Element("Tagging")
    tag_set = ET.SubElement(tagging, "TagSet")
    for key, value in tags.items():
        tag = ET.SubElement(tag_set, "Tag")
        ET.SubElement(tag, "Key").text = str(key)
        ET.SubElement(tag, "Value").text = str(value)
    return ET.tostring(tagging, encoding="utf-8", xml_declaration=True)


def put_s3_bucket_tags(bucket_name: str, tags: dict[str, str]):
    _s3_request(
        "PUT",
        bucket_name,
        query_params={"tagging": ""},
        body=_s3_tagging_body(tags),
        content_type="application/xml",
    )


def put_s3_object_tags(bucket_name: str, object_key: str, tags: dict[str, str]):
    _s3_request(
        "PUT",
        bucket_name,
        object_key=object_key,
        query_params={"tagging": ""},
        body=_s3_tagging_body(tags),
        content_type="application/xml",
    )


def list_s3_objects(bucket_name: str, prefix: str = ""):
    _status, _headers, body = _s3_request(
        "GET",
        bucket_name,
        query_params={"list-type": "2", "prefix": prefix},
    )
    root = ET.fromstring(body)
    namespace = ""
    if root.tag.startswith("{"):
        namespace = root.tag.split("}", 1)[0] + "}"
    objects = []
    for item in root.findall(f"{namespace}Contents"):
        key = item.findtext(f"{namespace}Key", "")
        objects.append(
            {
                "key": key,
                "size": int(item.findtext(f"{namespace}Size", "0") or "0"),
                "lastModified": item.findtext(f"{namespace}LastModified", ""),
                "etag": (item.findtext(f"{namespace}ETag", "") or "").strip('"'),
            }
        )
    return objects


def put_s3_object(bucket_name: str, object_key: str, content: bytes, content_type: str):
    _s3_request("PUT", bucket_name, object_key=object_key, body=content, content_type=content_type)


def get_s3_object(bucket_name: str, object_key: str):
    return _s3_request("GET", bucket_name, object_key=object_key)


def delete_s3_object(bucket_name: str, object_key: str):
    _s3_request("DELETE", bucket_name, object_key=object_key)


def delete_s3_bucket(bucket_name: str):
    _s3_request("DELETE", bucket_name)


class NimbusHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _clean_static_path(self, parsed):
        path = parsed.path
        if path.startswith("/api/"):
            return False

        if path.endswith((".html", ".php")):
            clean_path = path.rsplit(".", 1)[0] or "/"
            if clean_path == "/index":
                clean_path = "/"
            if parsed.query:
                clean_path = f"{clean_path}?{parsed.query}"
            self.send_response(301)
            self.send_header("Location", clean_path)
            self.end_headers()
            return True

        if path == "/" or "." in os.path.basename(path):
            return False

        page_name = path.strip("/")
        if not page_name:
            return False

        candidate = os.path.join(BASE_DIR, f"{page_name}.html")
        if os.path.isfile(candidate):
            self.path = f"/{page_name}.html"
            if parsed.query:
                self.path = f"{self.path}?{parsed.query}"
            return False

        return False

    def _send_json(self, payload: dict, status: int = 200, headers: list[tuple[str, str]] | None = None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for key, value in headers or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_binary(self, body: bytes, content_type: str, headers: list[tuple[str, str]] | None = None):
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        for key, value in headers or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None

    def _with_user(self, email: str):
        normalized_email = (email or "").strip().lower()
        if not normalized_email:
            return None, None, {"ok": False, "message": "User email is required"}
        conn = sqlite3.connect(DB_PATH)
        user = get_user_by_email(conn, normalized_email)
        if not user:
            conn.close()
            return None, None, {"ok": False, "message": "User not found"}
        if user["is_active"] != 1:
            conn.close()
            return None, None, {"ok": False, "message": "User account is disabled", "status": 403}
        return conn, user, None

    def _with_bucket_resource(self, email: str, project_id, bucket_name: str):
        if not project_id:
            return None, None, None, {"ok": False, "message": "Project is required", "status": 400}
        if not bucket_name:
            return None, None, None, {"ok": False, "message": "Bucket is required", "status": 400}
        conn, user, error = self._with_user(email)
        if error:
            return None, None, None, error
        resource = conn.execute(
            """
            SELECT id, name FROM resources
            WHERE user_id = ? AND project_id = ? AND resource_type = 'object-storage' AND name = ?
            """,
            (user["id"], project_id, bucket_name),
        ).fetchone()
        if not resource:
            conn.close()
            return None, None, None, {"ok": False, "message": "Bucket not found in this project", "status": 404}
        return conn, user, resource, None

    def _require_admin(self, permission: str | None = None):
        token = _parse_cookie(self.headers.get("Cookie", ""), ADMIN_SESSION_COOKIE)
        conn = sqlite3.connect(DB_PATH)
        user, permissions, _role_name = _load_admin_user(conn, token)
        if not user:
            conn.close()
            return None, None, {"ok": False, "message": "Admin authentication required", "status": 401}
        if permission and permission not in permissions:
            conn.close()
            return None, None, {"ok": False, "message": "Permission denied", "status": 403}
        return conn, (user, permissions), None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/admin/me":
            conn, payload, error = self._require_admin()
            if error:
                self._send_json(error, error.get("status", 401))
                return
            user, permissions = payload
            self._send_json({"ok": True, "admin": _admin_payload(user, permissions)})
            conn.close()
            return
        if parsed.path == "/api/admin/overview":
            conn, payload, error = self._require_admin("access_admin_console")
            if error:
                self._send_json(error, error.get("status", 401))
                return
            admin_user, permissions = payload
            self.handle_admin_overview(conn, admin_user, permissions)
            conn.close()
            return
        if parsed.path == "/api/admin/users":
            conn, payload, error = self._require_admin("view_users")
            if error:
                self._send_json(error, error.get("status", 401))
                return
            admin_user, permissions = payload
            self.handle_admin_users(conn, admin_user, permissions)
            conn.close()
            return
        if parsed.path == "/api/admin/roles":
            conn, payload, error = self._require_admin("view_roles")
            if error:
                self._send_json(error, error.get("status", 401))
                return
            admin_user, permissions = payload
            self.handle_admin_roles(conn, admin_user, permissions)
            conn.close()
            return
        if parsed.path == "/api/admin/audit":
            conn, payload, error = self._require_admin("view_audit_logs")
            if error:
                self._send_json(error, error.get("status", 401))
                return
            admin_user, permissions = payload
            self.handle_admin_audit(conn, admin_user, permissions)
            conn.close()
            return
        if parsed.path == "/api/projects":
            params = parse_qs(parsed.query)
            email = (params.get("email") or [""])[0]
            conn, user, error = self._with_user(email)
            if error:
                self._send_json(error, error.get("status", 400))
                return
            ensure_seed_projects(conn, user["id"])
            state = serialize_projects(conn, user["id"], user["active_project_id"])
            conn.close()
            self._send_json({"ok": True, "state": state})
            return
        if parsed.path == "/api/vms":
            params = parse_qs(parsed.query)
            email = (params.get("email") or [""])[0]
            project_id = (params.get("projectId") or [""])[0]
            conn, user, error = self._with_user(email)
            if error:
                self._send_json(error, error.get("status", 400))
                return
            if not project_id:
                conn.close()
                self._send_json({"ok": False, "message": "Project is required"}, 400)
                return
            project = conn.execute(
                "SELECT id FROM projects WHERE id = ? AND user_id = ?",
                (project_id, user["id"]),
            ).fetchone()
            if not project:
                conn.close()
                self._send_json({"ok": False, "message": "Project not found"}, 404)
                return
            vms = serialize_vms(conn, user["id"], int(project_id))
            conn.close()
            self._send_json({"ok": True, "vms": vms})
            return
        if parsed.path == "/api/resources":
            params = parse_qs(parsed.query)
            email = (params.get("email") or [""])[0]
            project_id = (params.get("projectId") or [""])[0]
            resource_type = (params.get("type") or ["vm"])[0].strip().lower()
            if resource_type not in ("vm", "volume", "network", "object-storage"):
                self._send_json({"ok": False, "message": "Unsupported resource type"}, 400)
                return
            conn, user, error = self._with_user(email)
            if error:
                self._send_json(error, error.get("status", 400))
                return
            if not project_id:
                conn.close()
                self._send_json({"ok": False, "message": "Project is required"}, 400)
                return
            project = conn.execute(
                "SELECT id FROM projects WHERE id = ? AND user_id = ?",
                (project_id, user["id"]),
            ).fetchone()
            if not project:
                conn.close()
                self._send_json({"ok": False, "message": "Project not found"}, 404)
                return
            resources = serialize_resources(conn, user["id"], int(project_id), resource_type)
            conn.close()
            self._send_json({"ok": True, "resources": resources})
            return
        if parsed.path == "/api/s3/objects":
            params = parse_qs(parsed.query)
            email = (params.get("email") or [""])[0]
            project_id = (params.get("projectId") or [""])[0]
            bucket_name = (params.get("bucketName") or [""])[0].strip()
            prefix = (params.get("prefix") or [""])[0]
            conn, _user, _resource, error = self._with_bucket_resource(email, project_id, bucket_name)
            if error:
                self._send_json(error, error.get("status", 400))
                return
            conn.close()
            try:
                objects = list_s3_objects(bucket_name, prefix)
            except RuntimeError as s3_error:
                self._send_json({"ok": False, "message": str(s3_error)}, 502)
                return
            self._send_json({"ok": True, "objects": objects})
            return
        if parsed.path == "/api/s3/objects/download":
            params = parse_qs(parsed.query)
            email = (params.get("email") or [""])[0]
            project_id = (params.get("projectId") or [""])[0]
            bucket_name = (params.get("bucketName") or [""])[0].strip()
            object_key = (params.get("key") or [""])[0]
            if not object_key:
                self._send_json({"ok": False, "message": "Object key is required"}, 400)
                return
            conn, _user, _resource, error = self._with_bucket_resource(email, project_id, bucket_name)
            if error:
                self._send_json(error, error.get("status", 400))
                return
            conn.close()
            try:
                _status, headers, body = get_s3_object(bucket_name, object_key)
            except RuntimeError as s3_error:
                self._send_json({"ok": False, "message": str(s3_error)}, 502)
                return
            filename = os.path.basename(object_key.rstrip("/")) or "object"
            self._send_binary(
                body,
                headers.get("Content-Type", "application/octet-stream"),
                [("Content-Disposition", f'attachment; filename="{filename}"')],
            )
            return

        if self._clean_static_path(parsed):
            return
        super().do_GET()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if self._clean_static_path(parsed):
            return
        super().do_HEAD()

    def do_POST(self):
        routes = {
            "/api/admin/login": self.handle_admin_login,
            "/api/admin/logout": self.handle_admin_logout,
            "/api/admin/users/assign-role": self.handle_admin_user_assign_role,
            "/api/admin/users/toggle-active": self.handle_admin_user_toggle_active,
            "/api/admin/users/impersonate": self.handle_admin_user_impersonate,
            "/api/admin/roles/create": self.handle_admin_role_create,
            "/api/admin/roles/update": self.handle_admin_role_update,
            "/api/admin/roles/delete": self.handle_admin_role_delete,
            "/api/admin/roles/permissions": self.handle_admin_role_permissions,
            "/api/register": self.handle_register,
            "/api/login": self.handle_login,
            "/api/projects/create": self.handle_project_create,
            "/api/projects/set-active": self.handle_project_set_active,
            "/api/projects/set-default": self.handle_project_set_default,
            "/api/projects/delete": self.handle_project_delete,
            "/api/projects/edit": self.handle_project_edit,
            "/api/vms/create": self.handle_vm_create,
            "/api/resources/create": self.handle_resource_create,
            "/api/s3/objects/upload": self.handle_s3_object_upload,
            "/api/s3/objects/delete": self.handle_s3_object_delete,
            "/api/s3/buckets/delete": self.handle_s3_bucket_delete,
            "/api/account/status": self.handle_account_status,
            "/api/account/update-profile": self.handle_account_update_profile,
            "/api/account/change-password": self.handle_account_change_password,
            "/api/2fa/status": self.handle_2fa_status,
            "/api/2fa/setup": self.handle_2fa_setup,
            "/api/2fa/verify": self.handle_2fa_verify,
            "/api/2fa/disable": self.handle_2fa_disable,
            "/api/leads": self.handle_lead_create,
        }
        handler = routes.get(self.path)
        if not handler:
            self._send_json({"ok": False, "message": "Not found"}, 404)
            return

        data = self._read_json()
        if data is None:
            self._send_json({"ok": False, "message": "Invalid JSON"}, 400)
            return
        handler(data)

    def handle_register(self, data: dict):
        full_name = (data.get("fullName") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = (data.get("password") or "").strip()

        if not full_name or not email or not password:
            self._send_json({"ok": False, "message": "All fields are required"}, 400)
            return
        if len(password) < 8:
            self._send_json({"ok": False, "message": "Password must be at least 8 characters"}, 400)
            return

        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        user_role = conn.execute("SELECT id FROM roles WHERE name = 'user'").fetchone()
        user_role_id = user_role["id"] if user_role else None
        try:
            user_id = conn.execute(
                "INSERT INTO users (full_name, email, password_hash, role_id, is_active) VALUES (?, ?, ?, ?, 1) RETURNING id",
                (full_name, email, hash_password(password), user_role_id),
            ).fetchone()["id"]
            ensure_seed_projects(conn, user_id)
        except sqlite3.IntegrityError:
            conn.close()
            self._send_json({"ok": False, "message": "Email already registered"}, 409)
            return

        user = conn.execute("SELECT id, full_name, email FROM users WHERE id = ?", (user_id,)).fetchone()
        conn.close()
        self._send_json(
            {
                "ok": True,
                "message": "Account created successfully",
                "user": {"id": user["id"], "fullName": user["full_name"], "email": user["email"]},
            }
        )

    def handle_login(self, data: dict):
        email = (data.get("email") or "").strip().lower()
        password = (data.get("password") or "").strip()
        twofa_code = (data.get("twoFactorCode") or "").strip()
        if not email or not password:
            self._send_json({"ok": False, "message": "Email and password are required"}, 400)
            return

        conn = sqlite3.connect(DB_PATH)
        user = get_user_by_email(conn, email)
        if not user or not verify_password(password, user["password_hash"]):
            conn.close()
            self._send_json({"ok": False, "message": "Invalid email or password"}, 401)
            return
        if user["is_active"] != 1:
            conn.close()
            self._send_json({"ok": False, "message": "Account is disabled"}, 403)
            return
        if user["twofa_enabled"] == 1:
            if not twofa_code:
                conn.close()
                self._send_json(
                    {
                        "ok": False,
                        "requires2FA": True,
                        "message": "Enter the 6-digit code from your authenticator app",
                    },
                    401,
                )
                return
            if not verify_totp_code(user["twofa_secret"], twofa_code):
                conn.close()
                self._send_json({"ok": False, "message": "Invalid authenticator code"}, 401)
                return
        ensure_seed_projects(conn, user["id"])
        conn.close()
        self._send_json(
            {
                "ok": True,
                "message": "Login successful",
                "user": {
                    "id": user["id"],
                    "fullName": user["full_name"],
                    "email": user["email"],
                    "roleName": user["role_name"],
                },
            }
        )

    def handle_admin_login(self, data: dict):
        email = (data.get("email") or "").strip().lower()
        password = (data.get("password") or "").strip()
        if not email or not password:
            self._send_json({"ok": False, "message": "Email and password are required"}, 400)
            return

        conn = sqlite3.connect(DB_PATH)
        user = get_user_by_email(conn, email)
        if not user or not verify_password(password, user["password_hash"]):
            conn.close()
            self._send_json({"ok": False, "message": "Invalid email or password"}, 401)
            return
        if user["is_active"] != 1:
            conn.close()
            self._send_json({"ok": False, "message": "Account is disabled"}, 403)
            return

        permissions = _role_permission_map(conn, user["role_id"]) if user["role_id"] else set()
        if "access_admin_console" not in permissions:
            conn.close()
            self._send_json({"ok": False, "message": "This account cannot access the admin console"}, 403)
            return

        expires_at = int(time.time()) + ADMIN_SESSION_TTL
        token = _make_admin_session(user["id"], expires_at)
        headers = [
            (
                "Set-Cookie",
                f"{ADMIN_SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={ADMIN_SESSION_TTL}; SameSite=Lax",
            )
        ]
        self._send_json(
            {
                "ok": True,
                "message": "Admin login successful",
                "admin": _admin_payload(user, permissions),
            },
            headers=headers,
        )
        conn.close()

    def handle_admin_logout(self, _data: dict):
        self._send_json(
            {"ok": True, "message": "Logged out"},
            headers=[("Set-Cookie", f"{ADMIN_SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax")],
        )

    def handle_admin_overview(self, conn, admin_user, permissions: set[str]):
        conn.row_factory = sqlite3.Row
        counts = {
            "users": conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"],
            "activeUsers": conn.execute("SELECT COUNT(*) AS c FROM users WHERE is_active = 1").fetchone()["c"],
            "projects": conn.execute("SELECT COUNT(*) AS c FROM projects").fetchone()["c"],
            "resources": conn.execute("SELECT COUNT(*) AS c FROM resources").fetchone()["c"],
            "vms": conn.execute("SELECT COUNT(*) AS c FROM vms").fetchone()["c"],
            "leads": conn.execute("SELECT COUNT(*) AS c FROM leads").fetchone()["c"],
            "roles": conn.execute("SELECT COUNT(*) AS c FROM roles").fetchone()["c"],
        }
        recent_users = conn.execute(
            """
            SELECT users.id, users.full_name, users.email, users.is_active, users.created_at,
                   roles.name AS role_name
            FROM users
            LEFT JOIN roles ON roles.id = users.role_id
            ORDER BY users.id DESC
            LIMIT 6
            """
        ).fetchall()
        recent_leads = conn.execute(
            "SELECT id, email, company, service, created_at FROM leads ORDER BY id DESC LIMIT 6"
        ).fetchall()
        recent_audit = conn.execute(
            """
            SELECT logs.id, logs.action, logs.details, logs.created_at,
                   admin.full_name AS admin_name,
                   target.full_name AS target_name,
                   role.name AS target_role_name
            FROM admin_audit_logs logs
            LEFT JOIN users admin ON admin.id = logs.admin_user_id
            LEFT JOIN users target ON target.id = logs.target_user_id
            LEFT JOIN roles role ON role.id = logs.target_role_id
            ORDER BY logs.id DESC
            LIMIT 8
            """
        ).fetchall()
        self._send_json(
            {
                "ok": True,
                "overview": {
                    "counts": counts,
                    "recentUsers": [
                        {
                            "id": row["id"],
                            "fullName": row["full_name"],
                            "email": row["email"],
                            "roleName": row["role_name"] or "unassigned",
                            "isActive": row["is_active"] == 1,
                            "createdAt": row["created_at"],
                        }
                        for row in recent_users
                    ],
                    "recentLeads": [
                        {
                            "id": row["id"],
                            "email": row["email"],
                            "company": row["company"],
                            "service": row["service"],
                            "createdAt": row["created_at"],
                        }
                        for row in recent_leads
                    ],
                    "recentAudit": [
                        {
                            "id": row["id"],
                            "action": row["action"],
                            "details": row["details"],
                            "createdAt": row["created_at"],
                            "adminName": row["admin_name"],
                            "targetName": row["target_name"],
                            "targetRoleName": row["target_role_name"],
                        }
                        for row in recent_audit
                    ],
                    "permissions": sorted(permissions),
                    "admin": {
                        "id": admin_user["id"],
                        "fullName": admin_user["full_name"],
                        "email": admin_user["email"],
                        "roleName": admin_user["role_name"],
                    },
                },
            }
        )

    def handle_admin_users(self, conn, admin_user, permissions: set[str]):
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT users.id, users.full_name, users.email, users.is_active, users.created_at,
                   users.role_id, roles.name AS role_name, roles.description AS role_description,
                   roles.is_system
            FROM users
            LEFT JOIN roles ON roles.id = users.role_id
            ORDER BY users.id ASC
            """
        ).fetchall()
        users = []
        for row in rows:
            user_permissions = _role_permission_map(conn, row["role_id"]) if row["role_id"] else set()
            users.append(
                {
                    "id": row["id"],
                    "fullName": row["full_name"],
                    "email": row["email"],
                    "isActive": row["is_active"] == 1,
                    "roleId": row["role_id"],
                    "roleName": row["role_name"] or "unassigned",
                    "roleDescription": row["role_description"] or "",
                    "isSystemRole": bool(row["is_system"]) if row["is_system"] is not None else False,
                    "createdAt": row["created_at"],
                    "permissions": sorted(user_permissions),
                }
            )
        self._send_json({"ok": True, "users": users, "permissions": sorted(permissions)})

    def handle_admin_roles(self, conn, admin_user, permissions: set[str]):
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT id, name, description, is_system, created_at FROM roles ORDER BY id ASC").fetchall()
        roles = []
        for row in rows:
            role_permissions = sorted(_role_permission_map(conn, row["id"]))
            user_count = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role_id = ?", (row["id"],)).fetchone()["c"]
            roles.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "description": row["description"],
                    "isSystem": row["is_system"] == 1,
                    "createdAt": row["created_at"],
                    "userCount": user_count,
                    "permissions": role_permissions,
                }
            )
        self._send_json({"ok": True, "roles": roles, "catalog": _role_permissions_catalog(), "permissions": sorted(permissions)})

    def handle_admin_audit(self, conn, admin_user, permissions: set[str]):
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT logs.id, logs.action, logs.details, logs.created_at,
                   admin.full_name AS admin_name, admin.email AS admin_email,
                   target.full_name AS target_name, target.email AS target_email,
                   role.name AS target_role_name
            FROM admin_audit_logs logs
            LEFT JOIN users admin ON admin.id = logs.admin_user_id
            LEFT JOIN users target ON target.id = logs.target_user_id
            LEFT JOIN roles role ON role.id = logs.target_role_id
            ORDER BY logs.id DESC
            LIMIT 100
            """
        ).fetchall()
        self._send_json(
            {
                "ok": True,
                "logs": [
                    {
                        "id": row["id"],
                        "action": row["action"],
                        "details": row["details"],
                        "createdAt": row["created_at"],
                        "adminName": row["admin_name"],
                        "adminEmail": row["admin_email"],
                        "targetName": row["target_name"],
                        "targetEmail": row["target_email"],
                        "targetRoleName": row["target_role_name"],
                    }
                    for row in rows
                ],
            }
        )

    def handle_admin_user_assign_role(self, data: dict):
        conn, payload, error = self._require_admin("manage_roles")
        if error:
            self._send_json(error, error.get("status", 401))
            return
        admin_user, _permissions = payload
        user_id = int(data.get("userId") or 0)
        role_id = int(data.get("roleId") or 0)
        if not user_id or not role_id:
            conn.close()
            self._send_json({"ok": False, "message": "User and role are required"}, 400)
            return
        user = get_user_by_id(conn, user_id)
        role = conn.execute("SELECT id, name, is_system FROM roles WHERE id = ?", (role_id,)).fetchone()
        if not user or not role:
            conn.close()
            self._send_json({"ok": False, "message": "User or role not found"}, 404)
            return
        conn.execute("UPDATE users SET role_id = ? WHERE id = ?", (role_id, user_id))
        _record_admin_action(conn, admin_user["id"], "assign_role", user_id, role_id, {"roleName": role["name"]})
        conn.commit()
        self._send_json({"ok": True, "message": "Role updated"})
        conn.close()

    def handle_admin_user_toggle_active(self, data: dict):
        conn, payload, error = self._require_admin("manage_users")
        if error:
            self._send_json(error, error.get("status", 401))
            return
        admin_user, _permissions = payload
        user_id = int(data.get("userId") or 0)
        is_active = 1 if bool(data.get("isActive")) else 0
        if not user_id:
            conn.close()
            self._send_json({"ok": False, "message": "User is required"}, 400)
            return
        if user_id == admin_user["id"]:
            conn.close()
            self._send_json({"ok": False, "message": "You cannot disable your own session"}, 400)
            return
        user = get_user_by_id(conn, user_id)
        if not user:
            conn.close()
            self._send_json({"ok": False, "message": "User not found"}, 404)
            return
        conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (is_active, user_id))
        _record_admin_action(conn, admin_user["id"], "toggle_active", user_id, user["role_id"], {"isActive": bool(is_active)})
        conn.commit()
        self._send_json({"ok": True, "message": "User status updated"})
        conn.close()

    def handle_admin_user_impersonate(self, data: dict):
        conn, payload, error = self._require_admin("impersonate_users")
        if error:
            self._send_json(error, error.get("status", 401))
            return
        admin_user, _permissions = payload
        user_id = int(data.get("userId") or 0)
        if not user_id:
            conn.close()
            self._send_json({"ok": False, "message": "User is required"}, 400)
            return
        target = get_user_by_id(conn, user_id)
        if not target:
            conn.close()
            self._send_json({"ok": False, "message": "User not found"}, 404)
            return
        if target["is_active"] != 1:
            conn.close()
            self._send_json({"ok": False, "message": "User account is disabled"}, 400)
            return
        projects = serialize_projects(conn, target["id"], target["active_project_id"])
        _record_admin_action(
            conn,
            admin_user["id"],
            "impersonate_user",
            target["id"],
            target["role_id"],
            {"email": target["email"]},
        )
        conn.commit()
        self._send_json(
            {
                "ok": True,
                "message": "Impersonation data ready",
                "user": {
                    "id": target["id"],
                    "fullName": target["full_name"],
                    "email": target["email"],
                    "activeProjectId": projects["activeProjectId"],
                    "projects": projects["projects"],
                    "roleName": target["role_name"],
                    "roleId": target["role_id"],
                },
            }
        )
        conn.close()

    def handle_admin_role_create(self, data: dict):
        conn, payload, error = self._require_admin("manage_roles")
        if error:
            self._send_json(error, error.get("status", 401))
            return
        admin_user, _permissions = payload
        name = (data.get("name") or "").strip().lower()
        description = (data.get("description") or "").strip()
        permission_keys = [str(item).strip() for item in (data.get("permissions") or []) if str(item).strip()]
        if not name:
            conn.close()
            self._send_json({"ok": False, "message": "Group name is required"}, 400)
            return
        if conn.execute("SELECT 1 FROM roles WHERE name = ?", (name,)).fetchone():
            conn.close()
            self._send_json({"ok": False, "message": "Group already exists"}, 409)
            return
        conn.execute(
            "INSERT INTO roles (name, description, is_system) VALUES (?, ?, 0)",
            (name, description),
        )
        role_id = conn.execute("SELECT id FROM roles WHERE name = ?", (name,)).fetchone()["id"]
        for permission_key in permission_keys:
            conn.execute(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)",
                (role_id, permission_key),
            )
        _record_admin_action(conn, admin_user["id"], "create_role", target_role_id=role_id, details={"name": name})
        conn.commit()
        self._send_json({"ok": True, "message": "Group created", "roleId": role_id})
        conn.close()

    def handle_admin_role_update(self, data: dict):
        conn, payload, error = self._require_admin("manage_roles")
        if error:
            self._send_json(error, error.get("status", 401))
            return
        admin_user, _permissions = payload
        role_id = int(data.get("roleId") or 0)
        name = (data.get("name") or "").strip().lower()
        description = (data.get("description") or "").strip()
        if not role_id or not name:
            conn.close()
            self._send_json({"ok": False, "message": "Role and name are required"}, 400)
            return
        role = conn.execute("SELECT id, name, is_system FROM roles WHERE id = ?", (role_id,)).fetchone()
        if not role:
            conn.close()
            self._send_json({"ok": False, "message": "Group not found"}, 404)
            return
        if role["name"] in ROLE_SEEDS and role["name"] != name:
            conn.close()
            self._send_json({"ok": False, "message": "System groups cannot be renamed"}, 400)
            return
        conn.execute("UPDATE roles SET name = ?, description = ? WHERE id = ?", (name, description, role_id))
        _record_admin_action(conn, admin_user["id"], "update_role", target_role_id=role_id, details={"name": name})
        conn.commit()
        self._send_json({"ok": True, "message": "Group updated"})
        conn.close()

    def handle_admin_role_delete(self, data: dict):
        conn, payload, error = self._require_admin("manage_roles")
        if error:
            self._send_json(error, error.get("status", 401))
            return
        admin_user, _permissions = payload
        role_id = int(data.get("roleId") or 0)
        if not role_id:
            conn.close()
            self._send_json({"ok": False, "message": "Role is required"}, 400)
            return
        role = conn.execute("SELECT id, name, is_system FROM roles WHERE id = ?", (role_id,)).fetchone()
        if not role:
            conn.close()
            self._send_json({"ok": False, "message": "Group not found"}, 404)
            return
        if role["is_system"] == 1:
            conn.close()
            self._send_json({"ok": False, "message": "System groups cannot be deleted"}, 400)
            return
        user_count = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role_id = ?", (role_id,)).fetchone()["c"]
        if user_count:
            conn.close()
            self._send_json({"ok": False, "message": "Reassign users before deleting this group"}, 400)
            return
        conn.execute("DELETE FROM roles WHERE id = ?", (role_id,))
        _record_admin_action(conn, admin_user["id"], "delete_role", target_role_id=role_id, details={"name": role["name"]})
        conn.commit()
        self._send_json({"ok": True, "message": "Group deleted"})
        conn.close()

    def handle_admin_role_permissions(self, data: dict):
        conn, payload, error = self._require_admin("manage_permissions")
        if error:
            self._send_json(error, error.get("status", 401))
            return
        admin_user, _permissions = payload
        role_id = int(data.get("roleId") or 0)
        permissions = [str(item).strip() for item in (data.get("permissions") or []) if str(item).strip()]
        if not role_id:
            conn.close()
            self._send_json({"ok": False, "message": "Role is required"}, 400)
            return
        role = conn.execute("SELECT id, name, is_system FROM roles WHERE id = ?", (role_id,)).fetchone()
        if not role:
            conn.close()
            self._send_json({"ok": False, "message": "Group not found"}, 404)
            return
        conn.execute("DELETE FROM role_permissions WHERE role_id = ?", (role_id,))
        for permission_key in permissions:
            conn.execute(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)",
                (role_id, permission_key),
            )
        _record_admin_action(conn, admin_user["id"], "update_role_permissions", target_role_id=role_id, details={"permissions": permissions})
        conn.commit()
        self._send_json({"ok": True, "message": "Permissions updated"})
        conn.close()

    def handle_account_status(self, data: dict):
        email = data.get("email")
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        payload = {
            "id": user["id"],
            "fullName": user["full_name"],
            "email": user["email"],
            "activeProjectId": user["active_project_id"],
            "twoFactorEnabled": user["twofa_enabled"] == 1,
            "roleName": user["role_name"],
            "isActive": user["is_active"] == 1,
        }
        conn.close()
        self._send_json({"ok": True, "account": payload})

    def handle_account_update_profile(self, data: dict):
        email = data.get("email")
        full_name = (data.get("fullName") or "").strip()
        if not full_name:
            self._send_json({"ok": False, "message": "Full name is required"}, 400)
            return
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        conn.execute("UPDATE users SET full_name = ? WHERE id = ?", (full_name, user["id"]))
        conn.commit()
        conn.close()
        self._send_json(
            {
                "ok": True,
                "message": "Account profile updated",
                "user": {"id": user["id"], "fullName": full_name, "email": user["email"]},
            }
        )

    def handle_account_change_password(self, data: dict):
        email = data.get("email")
        current_password = (data.get("currentPassword") or "").strip()
        new_password = (data.get("newPassword") or "").strip()
        if not current_password or not new_password:
            self._send_json({"ok": False, "message": "Current and new password are required"}, 400)
            return
        if len(new_password) < 8:
            self._send_json({"ok": False, "message": "New password must be at least 8 characters"}, 400)
            return
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        if not verify_password(current_password, user["password_hash"]):
            conn.close()
            self._send_json({"ok": False, "message": "Current password is incorrect"}, 401)
            return
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user["id"]))
        conn.commit()
        conn.close()
        self._send_json({"ok": True, "message": "Password changed"})

    def handle_2fa_status(self, data: dict):
        email = data.get("email")
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        enabled = user["twofa_enabled"] == 1
        conn.close()
        self._send_json({"ok": True, "enabled": enabled})

    def handle_2fa_setup(self, data: dict):
        email = data.get("email")
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        secret = user["twofa_secret"] if user["twofa_secret"] else generate_totp_secret()
        conn.execute("UPDATE users SET twofa_secret = ? WHERE id = ?", (secret, user["id"]))
        conn.commit()
        conn.close()
        normalized_email = (email or "").strip().lower()
        self._send_json(
            {
                "ok": True,
                "secret": secret,
                "otpauthUri": build_totp_uri(normalized_email, secret),
            }
        )

    def handle_2fa_verify(self, data: dict):
        email = data.get("email")
        code = (data.get("code") or "").strip()
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        if not user["twofa_secret"] or not verify_totp_code(user["twofa_secret"], code):
            conn.close()
            self._send_json({"ok": False, "message": "Invalid authenticator code"}, 400)
            return
        conn.execute("UPDATE users SET twofa_enabled = 1 WHERE id = ?", (user["id"],))
        conn.commit()
        conn.close()
        self._send_json({"ok": True, "message": "Two-factor authentication enabled"})

    def handle_2fa_disable(self, data: dict):
        email = data.get("email")
        code = (data.get("code") or "").strip()
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        if user["twofa_enabled"] == 1 and not verify_totp_code(user["twofa_secret"], code):
            conn.close()
            self._send_json({"ok": False, "message": "Invalid authenticator code"}, 400)
            return
        conn.execute("UPDATE users SET twofa_enabled = 0, twofa_secret = NULL WHERE id = ?", (user["id"],))
        conn.commit()
        conn.close()
        self._send_json({"ok": True, "message": "Two-factor authentication disabled"})

    def handle_project_create(self, data: dict):
        email = data.get("email")
        name = (data.get("name") or "").strip()
        if not name:
            self._send_json({"ok": False, "message": "Project name is required"}, 400)
            return

        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        ensure_seed_projects(conn, user["id"])
        try:
            project_id = conn.execute(
                "INSERT INTO projects (user_id, name, description, is_default) VALUES (?, ?, ?, 0) RETURNING id",
                (user["id"], name, name),
            ).fetchone()[0]
            conn.execute("UPDATE users SET active_project_id = ? WHERE id = ?", (project_id, user["id"]))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            self._send_json({"ok": False, "message": "Project already exists"}, 409)
            return

        state = serialize_projects(conn, user["id"], project_id)
        conn.close()
        self._send_json({"ok": True, "state": state})

    def handle_project_set_active(self, data: dict):
        email = data.get("email")
        project_id = data.get("projectId")
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return

        exists = conn.execute(
            "SELECT id FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
        if not exists:
            conn.close()
            self._send_json({"ok": False, "message": "Project not found"}, 404)
            return

        conn.execute("UPDATE users SET active_project_id = ? WHERE id = ?", (project_id, user["id"]))
        conn.commit()
        state = serialize_projects(conn, user["id"], project_id)
        conn.close()
        self._send_json({"ok": True, "state": state})

    def handle_project_set_default(self, data: dict):
        email = data.get("email")
        project_id = data.get("projectId")
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return

        exists = conn.execute(
            "SELECT id FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
        if not exists:
            conn.close()
            self._send_json({"ok": False, "message": "Project not found"}, 404)
            return

        conn.execute("UPDATE projects SET is_default = 0 WHERE user_id = ?", (user["id"],))
        conn.execute("UPDATE projects SET is_default = 1 WHERE id = ? AND user_id = ?", (project_id, user["id"]))
        conn.commit()
        state = serialize_projects(conn, user["id"], user["active_project_id"])
        conn.close()
        self._send_json({"ok": True, "state": state})

    def handle_project_delete(self, data: dict):
        email = data.get("email")
        project_id = data.get("projectId")
        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return

        conn.row_factory = sqlite3.Row
        project = conn.execute(
            "SELECT id, is_default FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
        if not project:
            conn.close()
            self._send_json({"ok": False, "message": "Project not found"}, 404)
            return
        if project["is_default"] == 1:
            conn.close()
            self._send_json({"ok": False, "message": "Default project cannot be deleted"}, 400)
            return

        total = conn.execute("SELECT COUNT(*) FROM projects WHERE user_id = ?", (user["id"],)).fetchone()[0]
        if total <= 1:
            conn.close()
            self._send_json({"ok": False, "message": "At least one project must remain"}, 400)
            return

        conn.execute("DELETE FROM projects WHERE id = ? AND user_id = ?", (project_id, user["id"]))
        if user["active_project_id"] == project_id:
            default_project = conn.execute(
                "SELECT id FROM projects WHERE user_id = ? AND is_default = 1 LIMIT 1",
                (user["id"],),
            ).fetchone()
            next_active = default_project[0] if default_project else conn.execute(
                "SELECT id FROM projects WHERE user_id = ? ORDER BY id ASC LIMIT 1",
                (user["id"],),
            ).fetchone()[0]
            conn.execute("UPDATE users SET active_project_id = ? WHERE id = ?", (next_active, user["id"]))
            user_active = next_active
        else:
            user_active = user["active_project_id"]
        conn.commit()
        state = serialize_projects(conn, user["id"], user_active)
        conn.close()
        self._send_json({"ok": True, "state": state})

    def handle_project_edit(self, data: dict):
        email = data.get("email")
        project_id = data.get("projectId")
        name = (data.get("name") or "").strip()
        if not name:
            self._send_json({"ok": False, "message": "Project name is required"}, 400)
            return

        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return

        try:
            updated = conn.execute(
                "UPDATE projects SET name = ?, description = ? WHERE id = ? AND user_id = ?",
                (name, name, project_id, user["id"]),
            )
            if updated.rowcount == 0:
                conn.close()
                self._send_json({"ok": False, "message": "Project not found"}, 404)
                return
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            self._send_json({"ok": False, "message": "Project name already exists"}, 409)
            return

        state = serialize_projects(conn, user["id"], user["active_project_id"])
        conn.close()
        self._send_json({"ok": True, "state": state})

    def handle_vm_create(self, data: dict):
        email = data.get("email")
        project_id = data.get("projectId")
        name = (data.get("name") or "").strip()
        region = (data.get("region") or "All Regions").strip() or "All Regions"
        if not project_id:
            self._send_json({"ok": False, "message": "Project is required"}, 400)
            return
        if not name:
            self._send_json({"ok": False, "message": "VM name is required"}, 400)
            return

        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        project = conn.execute(
            "SELECT id FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
        if not project:
            conn.close()
            self._send_json({"ok": False, "message": "Project not found"}, 404)
            return
        try:
            conn.execute(
                "INSERT INTO vms (user_id, project_id, name, status, region) VALUES (?, ?, ?, 'running', ?)",
                (user["id"], project_id, name, region),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            self._send_json({"ok": False, "message": "VM with this name already exists in selected project"}, 409)
            return
        vms = serialize_vms(conn, user["id"], int(project_id))
        conn.close()
        self._send_json({"ok": True, "vms": vms})

    def handle_s3_object_upload(self, data: dict):
        email = data.get("email")
        project_id = data.get("projectId")
        bucket_name = (data.get("bucketName") or "").strip()
        object_key = (data.get("key") or "").strip().lstrip("/")
        content_type = (data.get("contentType") or "application/octet-stream").strip() or "application/octet-stream"
        encoded_content = data.get("contentBase64") or ""

        if not object_key:
            self._send_json({"ok": False, "message": "Object key is required"}, 400)
            return
        if object_key.endswith("/"):
            self._send_json({"ok": False, "message": "Object key must include a file name"}, 400)
            return
        if not encoded_content:
            self._send_json({"ok": False, "message": "File content is required"}, 400)
            return
        if "," in encoded_content:
            encoded_content = encoded_content.split(",", 1)[1]
        try:
            content = base64.b64decode(encoded_content, validate=True)
        except (ValueError, binascii.Error):
            self._send_json({"ok": False, "message": "Invalid file content"}, 400)
            return
        if len(content) > 25 * 1024 * 1024:
            self._send_json({"ok": False, "message": "Upload limit is 25 MB per object from the dashboard"}, 413)
            return

        conn, user, _resource, error = self._with_bucket_resource(email, project_id, bucket_name)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        conn.close()
        try:
            put_s3_object(bucket_name, object_key, content, content_type)
            put_s3_object_tags(
                bucket_name,
                object_key,
                {
                    "owner": user["email"],
                    "project": str(project_id),
                    "bucket": bucket_name,
                    "nimbus_owner_email": user["email"],
                    "nimbus_project_id": str(project_id),
                    "nimbus_bucket": bucket_name,
                },
            )
            objects = list_s3_objects(bucket_name)
        except RuntimeError as s3_error:
            self._send_json({"ok": False, "message": str(s3_error)}, 502)
            return
        self._send_json({"ok": True, "objects": objects})

    def handle_s3_object_delete(self, data: dict):
        email = data.get("email")
        project_id = data.get("projectId")
        bucket_name = (data.get("bucketName") or "").strip()
        object_key = (data.get("key") or "").strip()
        if not object_key:
            self._send_json({"ok": False, "message": "Object key is required"}, 400)
            return

        conn, _user, _resource, error = self._with_bucket_resource(email, project_id, bucket_name)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        conn.close()
        try:
            delete_s3_object(bucket_name, object_key)
            objects = list_s3_objects(bucket_name)
        except RuntimeError as s3_error:
            self._send_json({"ok": False, "message": str(s3_error)}, 502)
            return
        self._send_json({"ok": True, "objects": objects})

    def handle_s3_bucket_delete(self, data: dict):
        email = data.get("email")
        project_id = data.get("projectId")
        bucket_name = (data.get("bucketName") or "").strip()

        conn, user, _resource, error = self._with_bucket_resource(email, project_id, bucket_name)
        if error:
            self._send_json(error, error.get("status", 400))
            return
        try:
            delete_s3_bucket(bucket_name)
        except RuntimeError as s3_error:
            conn.close()
            self._send_json({"ok": False, "message": str(s3_error)}, 502)
            return
        conn.execute(
            """
            DELETE FROM resources
            WHERE user_id = ? AND project_id = ? AND resource_type = 'object-storage' AND name = ?
            """,
            (user["id"], project_id, bucket_name),
        )
        conn.commit()
        resources = serialize_resources(conn, user["id"], int(project_id), "object-storage")
        conn.close()
        self._send_json({"ok": True, "resources": resources})

    def handle_resource_create(self, data: dict):
        email = data.get("email")
        project_id = data.get("projectId")
        name = (data.get("name") or "").strip()
        region = (data.get("region") or "All Regions").strip() or "All Regions"
        resource_type = (data.get("type") or "vm").strip().lower()
        if resource_type not in ("vm", "volume", "network", "object-storage"):
            self._send_json({"ok": False, "message": "Unsupported resource type"}, 400)
            return
        if not project_id:
            self._send_json({"ok": False, "message": "Project is required"}, 400)
            return
        if not name:
            self._send_json({"ok": False, "message": "Resource name is required"}, 400)
            return

        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, 400)
            return
        project = conn.execute(
            "SELECT id FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
        if not project:
            conn.close()
            self._send_json({"ok": False, "message": "Project not found"}, 404)
            return
        existing_resource = conn.execute(
            """
            SELECT id FROM resources
            WHERE user_id = ? AND project_id = ? AND resource_type = ? AND name = ?
            """,
            (user["id"], project_id, resource_type, name),
        ).fetchone()
        if existing_resource:
            conn.close()
            self._send_json({"ok": False, "message": "Resource with this name already exists in selected project"}, 409)
            return
        if resource_type == "object-storage":
            bucket_error = validate_s3_bucket_name(name)
            if bucket_error:
                conn.close()
                self._send_json({"ok": False, "message": bucket_error}, 400)
                return
            bucket_error = create_s3_bucket(name)
            if bucket_error:
                conn.close()
                self._send_json({"ok": False, "message": bucket_error}, 502)
                return
            try:
                put_s3_bucket_tags(
                    name,
                    {
                        "owner": user["email"],
                        "project": str(project_id),
                        "bucket": name,
                        "nimbus_owner_email": user["email"],
                        "nimbus_project_id": str(project_id),
                    },
                )
            except RuntimeError as s3_error:
                try:
                    delete_s3_bucket(name)
                except RuntimeError:
                    pass
                conn.close()
                self._send_json({"ok": False, "message": str(s3_error)}, 502)
                return
        try:
            conn.execute(
                """
                INSERT INTO resources (user_id, project_id, resource_type, name, status, region)
                VALUES (?, ?, ?, ?, 'available', ?)
                """,
                (user["id"], project_id, resource_type, name, region),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            self._send_json({"ok": False, "message": "Resource with this name already exists in selected project"}, 409)
            return
        resources = serialize_resources(conn, user["id"], int(project_id), resource_type)
        conn.close()
        self._send_json({"ok": True, "resources": resources})

    def handle_lead_create(self, data: dict):
        email = (data.get("email") or "").strip().lower()
        company = (data.get("company") or "").strip()
        phone = (data.get("phone") or "").strip()
        service = (data.get("service") or "").strip()
        workload = (data.get("workload") or "").strip()
        budget = (data.get("budget") or "").strip()
        message = (data.get("message") or "").strip()

        if not email or not company:
            self._send_json({"ok": False, "message": "Work email and company are required"}, 400)
            return

        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            """
            INSERT INTO leads (email, company, phone, service, workload, budget, message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (email, company, phone, service, workload, budget, message),
        )
        conn.commit()
        conn.close()
        self._send_json({"ok": True, "message": "Consultation request saved"})


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), NimbusHandler)
    print(f"Nimbus server running at http://0.0.0.0:{port}")
    server.serve_forever()
