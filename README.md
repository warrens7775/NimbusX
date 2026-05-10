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
