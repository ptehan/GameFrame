"""Export metadata without media/accounts, or restore it into a NEW database.

  python scripts/database-transfer.py export app.db database/metadata.sql.gz
  python scripts/database-transfer.py restore database/metadata.sql.gz restored.db

IDs and relationships are preserved. Media BLOBs become empty bytes; this
snapshot cannot play videos. Keep original media separately for future imports.
Restore refuses to overwrite an existing database.
"""
import argparse
import gzip
from pathlib import Path
import sqlite3


def transfer(mode, source, destination):
    destination = Path(destination)
    if destination.exists():
        raise SystemExit(f'Refusing to overwrite {destination}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if mode == 'export':
        with sqlite3.connect(Path(source).resolve().as_uri() + '?mode=ro', uri=True) as original:
            copy = sqlite3.connect(':memory:')
            original.backup(copy)
        private = {'auth_accounts', 'auth_codes', 'auth_sessions',
                   'registered_devices', 'licenses', 'usage_events', 'app_settings'}
        quote = lambda value: '"' + value.replace('"', '""') + '"'
        for (table,) in copy.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            if table in private or table.startswith('hosted_'):
                copy.execute(f'DELETE FROM {quote(table)}')
                continue
            for column in copy.execute(f'PRAGMA table_info({quote(table)})').fetchall():
                if 'BLOB' in column[2].upper():
                    name = quote(column[1])
                    copy.execute(f"UPDATE {quote(table)} SET {name}=X'' WHERE {name} IS NOT NULL")
        copy.commit()
        with gzip.open(destination, 'wt', encoding='utf-8') as output:
            for line in copy.iterdump():
                output.write(line + '\n')
        copy.close()
    else:
        with gzip.open(source, 'rt', encoding='utf-8') as input_file:
            sql = input_file.read()
        with sqlite3.connect(destination) as target:
            target.executescript(sql)
            result = target.execute('PRAGMA integrity_check').fetchone()[0]
            if result != 'ok':
                raise RuntimeError(result)
    print(f'{mode}: {destination} ({destination.stat().st_size:,} bytes)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['export', 'restore'])
    parser.add_argument('source')
    parser.add_argument('destination')
    args = parser.parse_args()
    transfer(args.mode, args.source, args.destination)
