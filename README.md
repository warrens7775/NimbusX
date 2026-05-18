# NimbusX

Business website and cloud platform prototype for NimbusX.

The public website is served from `index.html` with styles in `site.css`.
Service pages include `compute.html`, `storage.html`, `networking.html`, `pricing.html`, and `contact.html`.
Existing app pages such as login, dashboard, projects, teams, and billing remain in the repo.

Run the local app server with:

```bash
python3 app.py
```

The Python server serves the website and enables JSON APIs such as `/api/leads`.

## Run with containers

The container stack runs:

- `nimbus-app`: the Python web/API server on `http://localhost:8000`.
- `minio`: local S3-compatible object storage on API port `9000` and console port `9001`.
- `minio-init`: one-time setup that creates the NimbusX app S3 user and attaches read/write access.

Start everything:

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
NimbusX app:    http://localhost:8000
MinIO console:  http://localhost:9001
```

The app stores SQLite data in the `nimbus-db` Docker volume at `/data/nimbus.db`.
On the first container run, the bundled `nimbus.db` is copied into that volume if it exists.
MinIO object data is stored in the `minio-data` Docker volume.

For detached mode:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f nimbus-app
```

Stop the stack:

```bash
docker compose down
```

To create dashboard S3 buckets on a real S3-compatible backend such as MinIO,
start the server with these environment variables:

```bash
S3_ENDPOINT=http://43.242.224.100:9000
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_REGION=us-east-1
S3_PROVIDER=minio
python3 app.py
```

Full rebuild and operations runbook:

```text
docs/minio-storage-server-kb.md
```
