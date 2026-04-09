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

# ── Copy backend source (excludes frontend/node_modules via .dockerignore) ─
COPY dashboard/__init__.py dashboard/
COPY dashboard/api.py dashboard/
COPY tracker/ tracker/
COPY training/ training/
COPY models/ models/
COPY data/dataset_training_withclass_edited.csv data/

# ── Runtime dirs ──────────────────────────────────────────────────────────
RUN mkdir -p data/sessions

# ── Run ──────────────────────────────────────────────────────────────────
EXPOSE 8000
CMD ["python", "dashboard/api.py"]
