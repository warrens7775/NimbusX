# Lago billing setup

NimbusX runs on port `8000`, so this local Lago setup maps:

- Lago UI: `http://localhost:8080`
- Lago API: `http://localhost:8080/api/v1` from NimbusX
- Lago Rails API port: `http://localhost:3000`

## Requirements

Install Docker and Docker Compose:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"
```

After adding your user to the `docker` group, log out and back in, or run Docker commands with `sudo`.

## Start Lago

From the NimbusX project directory:

```bash
docker compose -f docker-compose.lago.yml up -d
```

Open `http://localhost:8080` and create the first Lago account.

## Connect NimbusX to Lago

1. In Lago, create an API key from the developer/API key settings.
2. Restart NimbusX with the key:

```bash
LAGO_API_URL=http://localhost:8080/api/v1 \
LAGO_FRONT_URL=http://localhost:8080 \
LAGO_API_KEY=replace_with_lago_api_key \
python3 app.py
```

NimbusX uses the default plan code `nimbusx-standard`. On sync, NimbusX creates that zero-dollar monthly plan in Lago if it does not already exist, creates a Lago customer for each NimbusX user, and creates a Lago subscription for each NimbusX project.

The NimbusX Billing History page at `http://localhost:8000/billing-history` shows Lago connection status, project subscription sync status, and invoices from Lago.

## Stop Lago

```bash
docker compose -f docker-compose.lago.yml down
```
