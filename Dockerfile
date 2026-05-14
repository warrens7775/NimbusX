FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

COPY . .

RUN mkdir -p /data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/' % os.environ.get('PORT', '8000'), timeout=3).read()"

CMD ["sh", "-c", "if [ -n \"$DB_PATH\" ] && [ ! -f \"$DB_PATH\" ] && [ -f /app/nimbus.db ]; then mkdir -p \"$(dirname \"$DB_PATH\")\" && cp /app/nimbus.db \"$DB_PATH\"; fi; exec python app.py"]
