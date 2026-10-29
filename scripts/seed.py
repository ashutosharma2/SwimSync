"""Reset the local database and add six fictional sessions for tomorrow.

Warning: this drops every SwimSync table in the target database. Local development only.

Run: .venv/bin/python scripts/seed.py
"""

import os
import pathlib
from datetime import datetime, timedelta

import psycopg

SCHEMA = pathlib.Path(__file__).resolve().parent.parent / "db" / "schema.sql"
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql:///swimsync")

# (name, start hour, start minute, capacity). Fictional pool, fictional sessions.
SESSIONS = [
    ("Early lanes", 6, 30, 24),
    ("Morning lane swim", 7, 0, 20),
    ("Aqua fit", 10, 0, 12),
    ("Lunchtime swim", 12, 30, 10),
    ("Evening family swim", 18, 0, 5),
    ("Late lanes", 20, 30, 16),
]


def main():
    tomorrow = (datetime.now().astimezone() + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
    with psycopg.connect(DATABASE_URL) as conn:
        conn.execute(SCHEMA.read_text())
        for name, hour, minute, capacity in SESSIONS:
            conn.execute(
                "INSERT INTO sessions (name, starts_at, capacity) VALUES (%s, %s, %s)",
                (name, tomorrow.replace(hour=hour, minute=minute), capacity),
            )
    print(f"Reset {DATABASE_URL} and added {len(SESSIONS)} sessions for {tomorrow.date()}.")


if __name__ == "__main__":
    main()
