# One image for the API, the outbox worker and the seed step: the same code and dependencies,
# started with different commands (see compose.yaml). Build from the repository root.
FROM python:3.14.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# Dependencies first, so a code change doesn't reinstall them.
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY scripts scripts
COPY db db

# Run as an unprivileged user, not root.
RUN useradd --create-home --uid 10001 swimsync
USER swimsync

EXPOSE 8000
CMD ["uvicorn", "--app-dir", "backend", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
