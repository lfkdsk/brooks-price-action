// 1-minute bars for protocol v2. Only symbol/sessions that have decisions are read, through the
// (symbol,session,minute) index, and only minutes after the first decision bar (bar 3) has closed.
export async function loadMinutes(all, db, {from = null, to = null, symbol = null} = {}) {
 const c = ["condition<>'missed'"], a = [];
 for (const [k, v] of [['session>=?', from], ['session<=?', to], ['symbol=?', symbol]]) if (v) { c.push(k); a.push(v); }
 try {
  return await all(db, `SELECT m.symbol,m.session,m.ts,m.open,m.high,m.low,m.close
   FROM (SELECT DISTINCT symbol,session FROM ipredictions WHERE ${c.join(' AND ')}) d
   CROSS JOIN ibars1m m ON m.symbol=d.symbol AND m.session=d.session AND m.minute>15`, a);
 } catch (e) {
  if (/no such table/i.test(String(e?.message))) return []; // before migration 0003: 5-minute fallback
  throw e;
 }
}
