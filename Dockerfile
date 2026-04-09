FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

# ── Python dependencies ───────────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Node / frontend build ─────────────────────────────────────────────────
RUN apt-get update && apt-get install -y nodejs npm && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY dashboard/frontend/package*.json dashboard/frontend/
RUN cd dashboard/frontend && npm install

COPY dashboard/frontend/ dashboard/frontend/
RUN cd dashboard/frontend && npm run build

# ── Copy rest of the project ──────────────────────────────────────────────
COPY . .

# ── Run ──────────────────────────────────────────────────────────────────
EXPOSE 8000
CMD ["sh", "-c", "uvicorn dashboard.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
