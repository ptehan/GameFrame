import sqlite3

DB_PATH = "app.db"

def db():
    """Return a new SQLite connection."""
    return sqlite3.connect(DB_PATH, check_same_thread=False)
