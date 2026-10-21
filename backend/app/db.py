import os

import psycopg
from psycopg.rows import dict_row

DEFAULT_URL = "postgresql:///swimsync"


def url():
    return os.environ.get("DATABASE_URL", DEFAULT_URL)


def connect():
    """Open a connection with rows returned as dicts.

    Use it as `with connect() as conn:`. psycopg commits when the block ends and rolls
    back if it raises, so the API only answers after the transaction has committed.
    """
    return psycopg.connect(url(), row_factory=dict_row)
