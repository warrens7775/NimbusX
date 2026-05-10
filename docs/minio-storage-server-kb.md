# NimbusX Storage Server Knowledge Base

This runbook documents the MinIO S3-compatible storage setup used by NimbusX. Use it to rebuild a clean Ubuntu storage server, connect it to NimbusX, verify bucket/object operations, and restore the owner tagging behavior.

## Current Architecture

- Storage backend: MinIO running in Docker on Ubuntu.
- S3 API port: `9000`.
- MinIO Console port: `9001`.
- Persistent data directory: `/data/minio`.
- MinIO root credential file: `/etc/minio/minio.env`.
- NimbusX app S3 credential file: `/etc/minio/nimbusx-app.env`.
- NimbusX local app reads S3 settings from environment variables.
- NimbusX creates buckets and stores bucket ownership in `nimbus.db`.
- NimbusX also writes MinIO bucket/object tags so ownership is visible in MinIO.

Current test endpoint:

```text
S3 API:         http://43.242.224.100:9000
MinIO Console: http://43.242.224.100:9001
```

Do not commit real access keys or passwords to the repo.

## Server Requirements

Minimum test server:

```text
OS: Ubuntu 22.04 LTS or newer
CPU: 2 cores+
RAM: 4 GB+
Disk: 100 GB+
Network: static public IP
Ports: 22, 9000, 9001
```

Production notes:

- Use HTTPS and domain names before real users use it.
- Use backups or replication. One server and one disk is not durable.
- Avoid NFS/Samba/shared network mounts for MinIO data.
- Use dedicated app users, not the MinIO root account, for NimbusX.

## 1. SSH Into The Server

From your local machine:

```bash
ssh root@SERVER_IP
```

If SSH host keys changed because the server was rebuilt:

```bash
ssh-keygen -f ~/.ssh/known_hosts -R SERVER_IP
ssh -o StrictHostKeyChecking=accept-new root@SERVER_IP
```

Confirm OS and disk:

```bash
hostnamectl
df -h
```

## 2. Install Docker

On the server:

```bash
apt-get update
apt-get install -y docker.io
systemctl enable --now docker
docker --version
```

## 3. Create MinIO Directories

```bash
install -d -m 700 /etc/minio /data/minio
ls -ld /etc/minio /data/minio
```

## 4. Create MinIO Root Credentials

Generate and store the MinIO root credentials:

```bash
ACCESS_KEY="nimbusxadmin"
SECRET_KEY="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"

printf 'MINIO_ROOT_USER=%s\nMINIO_ROOT_PASSWORD=%s\n' \
  "$ACCESS_KEY" "$SECRET_KEY" > /etc/minio/minio.env

chmod 600 /etc/minio/minio.env
cat /etc/minio/minio.env
```

Use this root credential only for MinIO administration.

## 5. Start MinIO

```bash
docker run -d \
  --name minio \
  --restart unless-stopped \
  --env-file /etc/minio/minio.env \
  -p 9000:9000 \
  -p 9001:9001 \
  -v /data/minio:/data \
  minio/minio server /data --console-address :9001
```

Check container:

```bash
docker ps --filter name=minio
docker logs --tail 80 minio
```

## 6. Configure Firewall

```bash
ufw allow OpenSSH
ufw allow 9000/tcp
ufw allow 9001/tcp
ufw --force enable
ufw status verbose
```

For production, restrict `9001` to trusted IPs or put it behind VPN/SSO.

## 7. Verify MinIO Health

From your local machine:

```bash
curl -I http://SERVER_IP:9000/minio/health/live
curl -I http://SERVER_IP:9001
```

Expected:

```text
HTTP/1.1 200 OK
```

Open the Console:

```text
http://SERVER_IP:9001
```

Login with:

```bash
ssh root@SERVER_IP 'cat /etc/minio/minio.env'
```

## 8. Create NimbusX App S3 User

Do not use MinIO root credentials inside NimbusX. Create a dedicated user:

```bash
APP_ACCESS_KEY="nimbusx-app"
APP_SECRET_KEY="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"

cat > /etc/minio/nimbusx-app.env <<EOF
S3_ENDPOINT=http://SERVER_IP:9000
S3_ACCESS_KEY=${APP_ACCESS_KEY}
S3_SECRET_KEY=${APP_SECRET_KEY}
S3_REGION=us-east-1
S3_PROVIDER=minio
EOF

chmod 600 /etc/minio/nimbusx-app.env
```

Create the MinIO user and attach read/write policy:

```bash
docker run --rm --network host \
  --env-file /etc/minio/minio.env \
  --env-file /etc/minio/nimbusx-app.env \
  --entrypoint /bin/sh minio/mc \
  -c 'mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null &&
      mc admin user add local "$S3_ACCESS_KEY" "$S3_SECRET_KEY" &&
      mc admin policy attach local readwrite --user "$S3_ACCESS_KEY"'
```

Verify:

```bash
docker run --rm --network host \
  --env-file /etc/minio/nimbusx-app.env \
  --entrypoint /bin/sh minio/mc \
  -c 'mc alias set app http://127.0.0.1:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null &&
      mc ls app'
```

## 9. Smoke Test S3

```bash
docker run --rm --network host \
  --env-file /etc/minio/nimbusx-app.env \
  --entrypoint /bin/sh minio/mc \
  -c 'mc alias set app http://127.0.0.1:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null &&
      mc mb --ignore-existing app/nimbusx-smoke-test &&
      printf ok > /tmp/nimbusx-smoke.txt &&
      mc cp /tmp/nimbusx-smoke.txt app/nimbusx-smoke-test/nimbusx-smoke.txt &&
      mc ls app/nimbusx-smoke-test &&
      mc rm --recursive --force app/nimbusx-smoke-test &&
      mc rb app/nimbusx-smoke-test'
```

Expected:

```text
Bucket created successfully
nimbusx-smoke.txt
Removed app/nimbusx-smoke-test successfully
```

## 10. Connect NimbusX To MinIO

NimbusX expects these environment variables:

```bash
S3_ENDPOINT=http://SERVER_IP:9000
S3_ACCESS_KEY=nimbusx-app
S3_SECRET_KEY=...
S3_REGION=us-east-1
S3_PROVIDER=minio
```

To run NimbusX locally using the server env file:

```bash
scp root@SERVER_IP:/etc/minio/nimbusx-app.env /tmp/nimbusx-app.env
cd /home/leap/NimbusX
set -a
. /tmp/nimbusx-app.env
set +a
python3 app.py
```

Remove the temporary local credential file after the server is running:

```bash
rm /tmp/nimbusx-app.env
```

NimbusX app URL:

```text
http://localhost:8000
```

S3 dashboard:

```text
http://localhost:8000/dashboard#s3-buckets
```

## 11. NimbusX S3 Behavior

NimbusX supports:

- Create S3 bucket.
- List buckets per NimbusX project.
- Open/close bucket object browser.
- Upload one or many objects.
- Upload progress.
- List objects.
- Download object.
- Delete single object.
- Select all objects.
- Delete multiple selected objects.
- Delete empty bucket.
- Tag buckets and objects with owner metadata.

Current dashboard upload limit:

```text
25 MB per object
```

Reason: the simple Python server receives object uploads as JSON/base64. For larger files, implement presigned direct browser uploads to MinIO.

## 12. Ownership Tags

NimbusX writes these tags to buckets:

```text
owner               = user email
project             = NimbusX project ID
bucket              = bucket name
nimbus_owner_email  = user email
nimbus_project_id   = NimbusX project ID
```

NimbusX writes these tags to objects:

```text
owner               = user email
project             = NimbusX project ID
bucket              = bucket name
nimbus_owner_email  = user email
nimbus_project_id   = NimbusX project ID
nimbus_bucket       = bucket name
```

The short tags `owner`, `project`, and `bucket` are included because MinIO Console can truncate long tag names/values in the sidebar.

Verify bucket tags:

```bash
docker run --rm --network host \
  --env-file /etc/minio/nimbusx-app.env \
  --entrypoint /bin/sh minio/mc \
  -c 'mc alias set app http://127.0.0.1:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null &&
      mc tag list app/BUCKET_NAME'
```

Verify object tags:

```bash
docker run --rm --network host \
  --env-file /etc/minio/nimbusx-app.env \
  --entrypoint /bin/sh minio/mc \
  -c 'mc alias set app http://127.0.0.1:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null &&
      mc tag list "app/BUCKET_NAME/path/to/object.ext"'
```

## 13. Retag Existing Buckets And Objects

Use this if a server was migrated or tags were added after objects already existed.

Run from the NimbusX repo with MinIO env loaded:

```bash
cd /home/leap/NimbusX
scp root@SERVER_IP:/etc/minio/nimbusx-app.env /tmp/nimbusx-app.env
set -a
. /tmp/nimbusx-app.env
set +a

python3 - <<'PY'
import sqlite3
from app import DB_PATH, list_s3_objects, put_s3_bucket_tags, put_s3_object_tags

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
rows = conn.execute("""
SELECT r.name AS bucket_name, u.email AS email, r.project_id AS project_id
FROM resources r
JOIN users u ON u.id = r.user_id
WHERE r.resource_type = 'object-storage'
ORDER BY r.id ASC
""").fetchall()

for row in rows:
    bucket_tags = {
        "owner": row["email"],
        "project": str(row["project_id"]),
        "bucket": row["bucket_name"],
        "nimbus_owner_email": row["email"],
        "nimbus_project_id": str(row["project_id"]),
    }
    put_s3_bucket_tags(row["bucket_name"], bucket_tags)
    print(f"tagged bucket {row['bucket_name']} -> {row['email']}")

    for obj in list_s3_objects(row["bucket_name"]):
        put_s3_object_tags(row["bucket_name"], obj["key"], {
            **bucket_tags,
            "nimbus_bucket": row["bucket_name"],
        })
        print(f"tagged object {row['bucket_name']}/{obj['key']} -> {row['email']}")

conn.close()
PY

rm /tmp/nimbusx-app.env
```

## 14. Find Bucket Owner From NimbusX Database

NimbusX database is the source of truth for ownership.

```bash
cd /home/leap/NimbusX
python3 - <<'PY'
import sqlite3

conn = sqlite3.connect("nimbus.db")
conn.row_factory = sqlite3.Row
rows = conn.execute("""
SELECT
  r.name AS bucket,
  u.email AS owner_email,
  p.name AS project,
  r.created_at
FROM resources r
JOIN users u ON u.id = r.user_id
JOIN projects p ON p.id = r.project_id
WHERE r.resource_type = 'object-storage'
ORDER BY r.created_at DESC
""").fetchall()

for row in rows:
    print(dict(row))

conn.close()
PY
```

## 15. Filter By Owner Email

MinIO Console cannot filter buckets by custom tag/email. Its filter box filters bucket names.

Options:

- Use NimbusX Admin/S3 page to filter buckets by email from `nimbus.db`.
- Use a bucket naming convention that includes the user/email slug.
- Use scripts with `mc tag list` to filter by tag.
- Create separate MinIO users per NimbusX user so each user only sees their own buckets.

Quick script to list buckets by owner tag:

```bash
docker run --rm --network host \
  --env-file /etc/minio/nimbusx-app.env \
  --entrypoint /bin/sh minio/mc \
  -c '
    mc alias set app http://127.0.0.1:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
    for bucket in $(mc ls app | awk "{print \$5}" | sed "s#/##"); do
      tags=$(mc tag list "app/$bucket" 2>/dev/null || true)
      echo "$tags" | grep -q "owner              : warrens7775@gmail.com" && echo "$bucket"
    done
  '
```

## 16. Useful MinIO Commands

List buckets:

```bash
mc ls app
```

List objects:

```bash
mc ls app/BUCKET_NAME
```

Create bucket:

```bash
mc mb app/BUCKET_NAME
```

Upload object:

```bash
mc cp ./file.txt app/BUCKET_NAME/file.txt
```

Download object:

```bash
mc cp app/BUCKET_NAME/file.txt ./file.txt
```

Delete object:

```bash
mc rm app/BUCKET_NAME/file.txt
```

Delete empty bucket:

```bash
mc rb app/BUCKET_NAME
```

Force delete bucket and all objects:

```bash
mc rm --recursive --force app/BUCKET_NAME
mc rb app/BUCKET_NAME
```

## 17. Backup And Restore

Basic backup options:

- Backup `/data/minio`.
- Backup `/etc/minio/minio.env`.
- Backup `/etc/minio/nimbusx-app.env`.
- Backup NimbusX `nimbus.db`.

Example local archive on the server:

```bash
tar -czf /root/minio-config-backup.tgz /etc/minio
tar -czf /root/minio-data-backup.tgz /data/minio
```

For production, prefer off-server backup:

```bash
rsync -aHAX /data/minio/ BACKUP_HOST:/backups/minio-data/
rsync -aHAX /etc/minio/ BACKUP_HOST:/backups/minio-config/
```

MinIO data and NimbusX DB must be backed up consistently if the UI ownership records matter.

## 18. HTTPS Production Setup

For public production use, put MinIO behind a reverse proxy with TLS.

Recommended domains:

```text
s3.example.com
console-s3.example.com
```

Typical target mapping:

```text
s3.example.com        -> localhost:9000
console-s3.example.com -> localhost:9001
```

After HTTPS is configured, update NimbusX env:

```bash
S3_ENDPOINT=https://s3.example.com
```

Then restart NimbusX.

## 19. Restart And Maintenance

Restart MinIO:

```bash
docker restart minio
```

Stop MinIO:

```bash
docker stop minio
```

Remove and recreate container without deleting data:

```bash
docker rm -f minio
docker run -d \
  --name minio \
  --restart unless-stopped \
  --env-file /etc/minio/minio.env \
  -p 9000:9000 \
  -p 9001:9001 \
  -v /data/minio:/data \
  minio/minio server /data --console-address :9001
```

Logs:

```bash
docker logs --tail 200 minio
```

Disk usage:

```bash
df -h
du -sh /data/minio
```

## 20. Troubleshooting

### MinIO Console does not open

Check:

```bash
docker ps --filter name=minio
docker logs --tail 100 minio
ufw status verbose
curl -I http://127.0.0.1:9001
```

### S3 API not responding

Check:

```bash
curl -I http://127.0.0.1:9000/minio/health/live
curl -I http://SERVER_IP:9000/minio/health/live
```

If local works but public fails, check firewall/security group.

### NimbusX says S3 backend is not configured

The app is missing env vars. Start NimbusX with:

```bash
set -a
. /tmp/nimbusx-app.env
set +a
python3 app.py
```

### Bucket creates in NimbusX but not in MinIO

Check:

```bash
docker logs --tail 100 minio
cat /etc/minio/nimbusx-app.env
```

Then verify credentials:

```bash
docker run --rm --network host \
  --env-file /etc/minio/nimbusx-app.env \
  --entrypoint /bin/sh minio/mc \
  -c 'mc alias set app http://127.0.0.1:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null &&
      mc ls app'
```

### MinIO shows object tags as truncated

Use the short tags:

```text
owner
project
bucket
```

Full tags are still present:

```text
nimbus_owner_email
nimbus_project_id
nimbus_bucket
```

### Cannot delete bucket

MinIO only deletes empty buckets unless you force delete all objects first.

In NimbusX:

1. Open bucket.
2. Select all objects.
3. Delete selected.
4. Delete bucket.

CLI:

```bash
mc rm --recursive --force app/BUCKET_NAME
mc rb app/BUCKET_NAME
```

## 21. Files Changed In NimbusX

Main backend:

```text
app.py
```

Important backend functions:

- S3 signing/client helper.
- Bucket creation.
- Bucket tagging.
- Object upload.
- Object tagging.
- Object list/download/delete.
- Bucket delete.

Dashboard UI:

```text
dashboard.html
auth.css
```

Important UI features:

- S3 overview vs bucket list state.
- Bucket list.
- Bucket object browser.
- Back to buckets.
- Multi-file upload.
- Upload/delete progress bar.
- Select all objects.
- Bulk delete selected objects.

Project docs:

```text
README.md
docs/minio-storage-server-kb.md
```

