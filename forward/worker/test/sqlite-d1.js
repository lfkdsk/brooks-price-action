// A D1-compatible shim over a real SQLite file, executed through python3's sqlite3 module
// (Node 20 has no built-in SQLite). Each statement is one short python3 process: slow, but it runs
// the Worker's exact SQL (json_each upserts, ON CONFLICT, migrations) instead of a hand-written fake.
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const RUNNER = `
import json, sqlite3, sys
req = json.load(sys.stdin)
db = sqlite3.connect(req['path'])
db.row_factory = sqlite3.Row
try:
    if req.get('script'):
        db.executescript(req['script'])
        out = {'results': []}
    else:
        cur = db.execute(req['sql'], req['args'])
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        db.commit()
        out = {'results': rows, 'changes': db.total_changes}
except sqlite3.Error as e:
    out = {'error': str(e)}
print(json.dumps(out))
`;

export const python3Available = (() => {
 try { return spawnSync('python3', ['-c', 'import sqlite3'], {stdio: 'ignore'}).status === 0; } catch { return false; }
})();

export class SqliteD1 {
 constructor(files = []) {
  this.path = join(mkdtempSync(join(tmpdir(), 'brooks-d1-')), 'test.db');
  this.statements = [];
  for (const file of files) this.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
 }
 call(req) {
  const out = JSON.parse(execFileSync('python3', ['-c', RUNNER], {input: JSON.stringify({path: this.path, ...req})}).toString());
  if (out.error) throw new Error('D1_ERROR: ' + out.error);
  return out;
 }
 exec(script) { return this.call({script}); }
 prepare(sql) {
  const db = this;
  let args = [];
  const stmt = {
   bind(...a) {
    if (a.some(v => v === undefined)) throw new Error('D1_TYPE_ERROR: undefined bind');
    args = a.map(v => typeof v === 'boolean' ? +v : v);
    return stmt;
   },
   async all() { db.statements.push(sql); return {results: db.call({sql, args}).results, success: true}; },
   async run() { db.statements.push(sql); db.call({sql, args}); return {success: true}; },
   async first() { return (await stmt.all()).results[0] ?? null; }
  };
  return stmt;
 }
}

export const MIGRATIONS = ['../schema.sql', '../migrations/0002_intraday.sql', '../migrations/0003_archive.sql', '../migrations/0004_levels_ok.sql',
 '../migrations/0005_protocol_v2.sql'];
