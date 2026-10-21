"""Reset the local database and add three fictional sessions for tomorrow.

Warning: this drops every SwimSync table in the target database. Local development only.

Run: .venv/bin/python scripts/seed.py
"""

import os
import pathlib
from datetime import datetime, timedelta

import psycopg

SCHEMA = pathlib.Path(__file__).resolve().parent.parent / "db" / "schema.sql"
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql:///swimsync")

# (name, start hour, capacity). Fictional pool, fictional sessions.
SESSIONS = [
    ("Morning lane swim", 7, 20),
    ("Lunchtime swim", 13, 10),
    ("Evening family swim", 18, 5),
]


def main():
    tomorrow = (datetime.now().astimezone() + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
    with psycopg.connect(DATABASE_URL) as conn:
        conn.execute(SCHEMA.read_text())
        for name, hour, capacity in SESSIONS:
            conn.execute(
                "INSERT INTO sessions (name, starts_at, capacity) VALUES (%s, %s, %s)",
                (name, tomorrow.replace(hour=hour), capacity),
            )
    print(f"Reset {DATABASE_URL} and added {len(SESSIONS)} sessions for {tomorrow.date()}.")


if __name__ == "__main__":
    main()
