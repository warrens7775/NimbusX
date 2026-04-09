import json
import os
import sqlite3
import hashlib
import hmac
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "nimbus.db")


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            active_project_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    user_columns = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "active_project_id" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN active_project_id INTEGER")

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
    conn.commit()
    conn.close()


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
        "SELECT id, full_name, email, password_hash, active_project_id FROM users WHERE email = ?",
        (email,),
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


class NimbusHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
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
        return conn, user, None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/projects":
            params = parse_qs(parsed.query)
            email = (params.get("email") or [""])[0]
            conn, user, error = self._with_user(email)
            if error:
                self._send_json(error, 400)
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
                self._send_json(error, 400)
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
                self._send_json(error, 400)
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

        super().do_GET()

    def do_POST(self):
        routes = {
            "/api/register": self.handle_register,
            "/api/login": self.handle_login,
            "/api/projects/create": self.handle_project_create,
            "/api/projects/set-active": self.handle_project_set_active,
            "/api/projects/set-default": self.handle_project_set_default,
            "/api/projects/delete": self.handle_project_delete,
            "/api/projects/edit": self.handle_project_edit,
            "/api/vms/create": self.handle_vm_create,
            "/api/resources/create": self.handle_resource_create,
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
        try:
            user_id = conn.execute(
                "INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?) RETURNING id",
                (full_name, email, hash_password(password)),
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
        if not email or not password:
            self._send_json({"ok": False, "message": "Email and password are required"}, 400)
            return

        conn = sqlite3.connect(DB_PATH)
        user = get_user_by_email(conn, email)
        if not user or not verify_password(password, user["password_hash"]):
            conn.close()
            self._send_json({"ok": False, "message": "Invalid email or password"}, 401)
            return
        ensure_seed_projects(conn, user["id"])
        conn.close()
        self._send_json(
            {
                "ok": True,
                "message": "Login successful",
                "user": {"id": user["id"], "fullName": user["full_name"], "email": user["email"]},
            }
        )

    def handle_project_create(self, data: dict):
        email = data.get("email")
        name = (data.get("name") or "").strip()
        if not name:
            self._send_json({"ok": False, "message": "Project name is required"}, 400)
            return

        conn, user, error = self._with_user(email)
        if error:
            self._send_json(error, 400)
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
            self._send_json(error, 400)
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
            self._send_json(error, 400)
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
            self._send_json(error, 400)
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
            self._send_json(error, 400)
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


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", 8000), NimbusHandler)
    print("Nimbus server running at http://localhost:8000")
    server.serve_forever()
