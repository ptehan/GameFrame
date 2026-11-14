"""Conservative hosted media-write admission, including newly generated blobs.

Checks happen at the database write boundary as well as HTTP upload admission.
Temporary render files can use processing headroom; they cannot bypass the saved
library allowance. Existing libraries remain readable when over their new limit.
"""
import os
from pathlib import Path
import re
import sqlite3

def _bytes(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        return len(value)
    if isinstance(value, str):
        return len(value.encode('utf-8'))
    if isinstance(value, dict):
        return sum(_bytes(v) for v in value.values())
    if isinstance(value, (tuple, list)):
        return sum(_bytes(v) for v in value)
    return 0

def check_write(sql, values):
    root, limit = os.environ.get('GAMEFRAME_WORKSPACE'), os.environ.get('GAMEFRAME_STORAGE_LIMIT')
    if not root or not limit or not re.match(r'^\s*(INSERT|UPDATE|REPLACE)\b', sql, re.I):
        return
    incoming = _bytes(values)
    if not incoming:
        return
    used = 0
    for folder, directories, files in os.walk(root):
        for name in directories + files:
            file = Path(folder) / name
            if file.is_symlink():
                raise ValueError('Workspace symbolic links are forbidden')
            if file.is_file():
                used += file.stat().st_size
    if used + incoming + 65536 > int(limit):
        raise ValueError('Workspace storage allowance reached. Delete clips or unused uploads before saving.')

class QuotaCursor(sqlite3.Cursor):
    def execute(self, sql, parameters=()):
        check_write(sql, parameters)
        return super().execute(sql, parameters)

    def executemany(self, sql, parameters):
        values = list(parameters)
        check_write(sql, values)
        return super().executemany(sql, values)

class QuotaConnection(sqlite3.Connection):
    def cursor(self, factory=QuotaCursor):
        return super().cursor(factory)

    def execute(self, sql, parameters=()):
        return self.cursor().execute(sql, parameters)

    def executemany(self, sql, parameters):
        return self.cursor().executemany(sql, parameters)

def connect(database, **kwargs):
    if os.environ.get('GAMEFRAME_WORKSPACE'):
        kwargs['factory'] = QuotaConnection
    return sqlite3.connect(database, **kwargs)
