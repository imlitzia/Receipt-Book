/**
 * Receipt Book: Google Sheet sync.
 * Paste this whole file into Extensions → Apps Script of your Google Sheet, save,
 * reload the sheet, then use the "Receipt Book" menu → "Set up sync".
 * Full steps are in README.md.
 */

var TABLES = {
  exp: { name: 'Expenses', head: ['Date', 'Time', 'Shop', 'Category', 'Paid with', 'Total', 'Currency', 'In home currency', 'Tax', 'Items', 'Note', 'Photos', 'ID', 'Photo IDs', 'Updated', 'Synced'], user: 12 },
  note: { name: 'Memos', head: ['Date', 'Memo', 'Updated', 'Synced'], user: 2 },
  settings: { name: 'Settings', head: ['Home currency', 'Monthly budget', 'Updated', 'Synced'], user: 2 }
};
var DEL = { name: 'Deleted', head: ['ID', 'Kind', 'Updated', 'Synced'] };
var PH = { name: 'Photo files', head: ['Photo ID', 'File ID'] };
var EXP_ID = 12, EXP_PIDS = 13; // zero-based columns in Expenses

/* ---------- menu and one-time setup ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Receipt Book')
    .addItem('Set up sync', 'setup')
    .addItem('Show app key', 'showKey')
    .addItem('Make a new app key', 'newKey')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  [TABLES.exp, TABLES.note, TABLES.settings, DEL, PH].forEach(function (t) { sheetFor(ss, t); });
  var exp = ss.getSheetByName(TABLES.exp.name);
  var rows = Math.max(exp.getMaxRows() - 1, 1);
  exp.getRange(2, 1, rows, 1).setNumberFormat('yyyy-mm-dd');
  exp.getRange(2, 2, rows, 1).setNumberFormat('@');
  [3, 4, 5, 7, 10, 11, 13, 14].forEach(function (c) { exp.getRange(2, c, rows, 1).setNumberFormat('@'); });
  exp.getRange(2, 6, rows, 1).setNumberFormat('#,##0.##');
  exp.getRange(2, 8, rows, 2).setNumberFormat('#,##0.##');
  exp.getRange(1, 13, 1, 4).setFontColor('#999999');
  exp.setColumnWidth(10, 320); exp.setColumnWidth(12, 220);
  var memos = ss.getSheetByName(TABLES.note.name);
  memos.getRange(2, 1, Math.max(memos.getMaxRows() - 1, 1), 1).setNumberFormat('yyyy-mm-dd');
  memos.setColumnWidth(2, 480);
  memos.getRange(1, 3, 1, 2).setFontColor('#999999');
  ss.getSheetByName(DEL.name).hideSheet();
  ss.getSheetByName(PH.name).hideSheet();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', makeKey());
  photoFolder();
  var sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);
  SpreadsheetApp.getUi().alert('Receipt Book is set up',
    'Your app key is:\n\n' + props.getProperty('TOKEN') +
    '\n\nNext: Deploy → New deployment → Web app, with "Execute as: Me" and "Who has access: Anyone". ' +
    'Then paste the web app URL and this key into the app (Settings → Sync with Google Sheet).\n\n' +
    'You can see the key again any time from Receipt Book → Show app key.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function showKey() {
  var k = PropertiesService.getScriptProperties().getProperty('TOKEN');
  SpreadsheetApp.getUi().alert('App key', k ? k : 'Not set up yet. Use Receipt Book → Set up sync first.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function newKey() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Make a new app key?', 'Devices using the old key will stop syncing until you enter the new one.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var k = makeKey();
  PropertiesService.getScriptProperties().setProperty('TOKEN', k);
  ui.alert('New app key', k, ui.ButtonSet.OK);
}

function makeKey() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }

function sheetFor(ss, t) {
  var sh = ss.getSheetByName(t.name);
  if (!sh) sh = ss.insertSheet(t.name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, t.head.length).setValues([t.head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function photoFolder() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('FOLDER');
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var folder = DriveApp.createFolder('Receipt Book photos');
  props.setProperty('FOLDER', folder.getId());
  return folder;
}

/* ---------- web app ---------- */

function doGet() {
  return ContentService.createTextOutput('Receipt Book sync is running. Paste this URL into the app.');
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token) throw new Error('not_set_up');
    if (req.token !== token) throw new Error('bad_key');
    switch (req.action) {
      case 'ping': out = { ok: true, title: SpreadsheetApp.getActive().getName() }; break;
      case 'push': out = withLock(function () { return push(req.recs || []); }); break;
      case 'pull': out = pull(Number(req.since) || 0); break;
      case 'photo_put': out = withLock(function () { return photoPut(String(req.id), String(req.b64 || '')); }); break;
      case 'photo_get': out = photoGet(String(req.id)); break;
      case 'photo_del': out = withLock(function () { return photoDel(req.ids || []); }); break;
      default: throw new Error('unknown_action');
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- conversions between app records and sheet rows ---------- */

function tz() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone(); }
function str(v) { return v === null || v === undefined ? '' : String(v); }
function num(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
function txt(v) { var s = str(v); return /^[=+\-@']/.test(s) ? "'" + s : s; }
function fmtDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz(), 'yyyy-MM-dd');
  var s = str(v).trim().replace(/\//g, '-');
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
}
function fmtTime(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz(), 'HH:mm');
  var m = str(v).match(/(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
function itemsToText(items) {
  return (items || []).map(function (i) {
    var name = str(i.name).replace(/;/g, ','), q = num(i.qty) || 1;
    return name + (q !== 1 ? ' x' + q : '') + ' ' + num(i.price);
  }).join('; ');
}
function textToItems(s) {
  return str(s).split(/;\s*/).filter(function (x) { return x.trim(); }).map(function (x) {
    var m = x.trim().match(/^(.*?)(?:\s+x(\d+(?:\.\d+)?))?\s+(-?\d+(?:\.\d+)?)$/);
    return m ? { name: m[1], qty: m[2] ? num(m[2]) : 1, price: num(m[3]) } : { name: x.trim(), qty: 1, price: 0 };
  });
}

function recToRow(kind, rec, now, photoMap) {
  var d = rec.data || {};
  if (kind === 'exp') {
    var pids = (d.photos || []).map(String);
    var links = pids.map(function (p) { return photoMap[p] ? 'https://drive.google.com/file/d/' + photoMap[p] + '/view' : ''; }).filter(String).join('\n');
    return [d.date || '', txt(d.time), txt(d.merchant), txt(d.category), txt(d.payment), num(d.total), txt(d.currency),
      d.conv === '' || d.conv === undefined || d.conv === null ? '' : num(d.conv),
      d.tax === '' || d.tax === undefined || d.tax === null ? '' : num(d.tax),
      txt(itemsToText(d.items)), txt(d.note), links, rec.id, pids.join(','), Number(rec.updated), now];
  }
  if (kind === 'note') return [rec.id.slice(5), txt(d.text), Number(rec.updated), now];
  return [txt(d.currency), d.budget === undefined ? '' : num(d.budget), Number(rec.updated), now];
}

function rowToRec(kind, row) {
  var n = row.length;
  if (kind === 'exp') {
    return { id: str(row[EXP_ID]), kind: 'exp', deleted: false, updated: Number(row[n - 2]) || 0, data: {
      date: fmtDate(row[0]), time: fmtTime(row[1]), merchant: str(row[2]), category: str(row[3]) || 'Other', payment: str(row[4]),
      total: num(row[5]), currency: str(row[6]).toUpperCase().slice(0, 3),
      conv: row[7] === '' ? '' : num(row[7]), tax: row[8] === '' ? null : num(row[8]),
      items: textToItems(row[9]), note: str(row[10]),
      photos: str(row[EXP_PIDS]).split(',').filter(function (x) { return x; })
    } };
  }
  if (kind === 'note') return { id: 'note:' + fmtDate(row[0]), kind: 'note', deleted: !str(row[1]).trim(), updated: Number(row[n - 2]) || 0, data: { text: str(row[1]) } };
  return { id: 'settings', kind: 'settings', deleted: false, updated: Number(row[n - 2]) || 0,
    data: { currency: str(row[0]).toUpperCase() || 'JPY', budget: num(row[1]) } };
}

function idOf(kind, row) {
  if (kind === 'exp') return str(row[EXP_ID]);
  if (kind === 'note') { var d = fmtDate(row[0]); return d ? 'note:' + d : ''; }
  return 'settings';
}

/* ---------- table helper: read once, write in batches ---------- */

function Table(t, kind) {
  var ss = SpreadsheetApp.getActive();
  this.t = t; this.kind = kind; this.sh = sheetFor(ss, t);
  var last = this.sh.getLastRow();
  this.rows = last > 1 ? this.sh.getRange(2, 1, last - 1, t.head.length).getValues() : [];
  this.index = {};
  for (var i = 0; i < this.rows.length; i++) {
    var id = kind ? idOf(kind, this.rows[i]) : str(this.rows[i][0]);
    if (id) this.index[id] = i;
  }
  this.changed = {}; this.removed = []; this.added = [];
}
Table.prototype.get = function (id) { var i = this.index[id]; return i === undefined ? null : this.rows[i]; };
Table.prototype.put = function (id, row) {
  var i = this.index[id];
  if (i === undefined) { this.added.push(row); this.index[id] = -1; }
  else if (i === -1) { for (var k = 0; k < this.added.length; k++) if ((this.kind ? idOf(this.kind, this.added[k]) : str(this.added[k][0])) === id) this.added[k] = row; }
  else { this.rows[i] = row; this.changed[i] = true; }
};
Table.prototype.remove = function (id) {
  var i = this.index[id];
  if (i === undefined) return;
  if (i >= 0) { this.removed.push(i); delete this.changed[i]; }
  else this.added = this.added.filter(function (r) { return (this.kind ? idOf(this.kind, r) : str(r[0])) !== id; }, this);
  delete this.index[id];
};
Table.prototype.save = function () {
  var w = this.t.head.length, sh = this.sh, self = this;
  Object.keys(this.changed).forEach(function (i) { sh.getRange(Number(i) + 2, 1, 1, w).setValues([self.rows[i]]); });
  this.removed.sort(function (a, b) { return b - a; }).forEach(function (i) { sh.deleteRow(i + 2); });
  if (this.added.length) sh.getRange(sh.getLastRow() + 1, 1, this.added.length, w).setValues(this.added);
};

/* ---------- sync actions ---------- */

function push(recs) {
  var now = Date.now(), tables = {}, del = new Table(DEL, null), photos = photoMap(), applied = 0;
  Object.keys(TABLES).forEach(function (k) { tables[k] = new Table(TABLES[k], k); });
  recs.forEach(function (r) {
    var t = tables[r.kind];
    if (!t || !r.id || (r.kind === 'note' && !/^note:\d{4}-\d{2}-\d{2}$/.test(r.id))) return;
    var cur = t.get(r.id), tomb = del.get(r.id);
    var known = Math.max(cur ? Number(cur[cur.length - 2]) || 0 : 0, tomb ? Number(tomb[2]) || 0 : 0);
    if (Number(r.updated) < known) return;
    if (r.deleted) { t.remove(r.id); del.put(r.id, [r.id, r.kind, Number(r.updated), now]); }
    else { t.put(r.id, recToRow(r.kind, r, now, photos)); if (tomb) del.remove(r.id); }
    applied++;
  });
  Object.keys(tables).forEach(function (k) { tables[k].save(); });
  del.save();
  return { ok: true, applied: applied };
}

function pull(since) {
  var from = since - 120000, cursor = since, recs = [];
  Object.keys(TABLES).forEach(function (k) {
    var t = new Table(TABLES[k], k);
    t.rows.forEach(function (row) {
      var synced = Number(row[row.length - 1]) || 0;
      if (synced <= from || !idOf(k, row)) return;
      var r = rowToRec(k, row);
      if (k === 'exp' && !r.data.date) return;
      recs.push(r);
      if (synced > cursor) cursor = synced;
    });
  });
  new Table(DEL, null).rows.forEach(function (row) {
    var synced = Number(row[3]) || 0;
    if (synced <= from || !row[0]) return;
    recs.push({ id: str(row[0]), kind: str(row[1]), deleted: true, updated: Number(row[2]) || 0, data: {} });
    if (synced > cursor) cursor = synced;
  });
  return { ok: true, recs: recs, cursor: cursor };
}

function photoMap() {
  var m = {};
  new Table(PH, null).rows.forEach(function (r) { if (r[0]) m[str(r[0])] = str(r[1]); });
  return m;
}

function photoPut(id, b64) {
  if (!/^[a-z0-9]+$/i.test(id) || !b64) throw new Error('bad_photo');
  var t = new Table(PH, null), have = t.get(id);
  if (have) return { ok: true, fileId: str(have[1]) };
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', id + '.jpg');
  var file = photoFolder().createFile(blob);
  t.put(id, [id, file.getId()]);
  t.save();
  // Fill in the Photos link on any expense row already pointing at this photo.
  var exp = new Table(TABLES.exp, 'exp'), map = photoMap();
  exp.rows.forEach(function (row, i) {
    var pids = str(row[EXP_PIDS]).split(',').filter(String);
    if (pids.indexOf(id) < 0) return;
    row[11] = pids.map(function (p) { return map[p] ? 'https://drive.google.com/file/d/' + map[p] + '/view' : ''; }).filter(String).join('\n');
    exp.changed[i] = true;
  });
  exp.save();
  return { ok: true, fileId: file.getId() };
}

function photoGet(id) {
  var row = new Table(PH, null).get(id);
  if (!row) return { ok: false, error: 'no_photo' };
  var file = DriveApp.getFileById(str(row[1]));
  return { ok: true, b64: Utilities.base64Encode(file.getBlob().getBytes()) };
}

function photoDel(ids) {
  var t = new Table(PH, null), n = 0;
  ids.forEach(function (id) {
    var row = t.get(String(id));
    if (!row) return;
    try { DriveApp.getFileById(str(row[1])).setTrashed(true); } catch (e) {}
    t.remove(String(id)); n++;
  });
  t.save();
  return { ok: true, removed: n };
}

/* ---------- edits made directly in the sheet ---------- */

function onEdit(e) {
  try {
    var sh = e.range.getSheet(), name = sh.getName(), kind = null;
    Object.keys(TABLES).forEach(function (k) { if (TABLES[k].name === name) kind = k; });
    if (!kind) return;
    var t = TABLES[kind], w = t.head.length;
    if (e.range.getColumn() > t.user) return;
    var r0 = Math.max(2, e.range.getRow()), r1 = e.range.getRow() + e.range.getNumRows() - 1;
    if (r1 < 2) return;
    var now = Date.now(), vals = sh.getRange(r0, 1, r1 - r0 + 1, w).getValues(), tombs = [], toDelete = [];
    for (var i = 0; i < vals.length; i++) {
      var row = vals[i], r = r0 + i, empty = row.slice(0, kind === 'exp' ? 11 : t.user).every(function (v) { return v === '' || v === null; });
      if (kind === 'exp') {
        if (empty) { if (row[EXP_ID]) { tombs.push([str(row[EXP_ID]), 'exp', now, now]); toDelete.push(r); } continue; }
        if (!row[EXP_ID]) sh.getRange(r, EXP_ID + 1).setValue('g' + now.toString(36) + r.toString(36));
      } else if (empty) continue;
      sh.getRange(r, w - 1, 1, 2).setValues([[now, now]]);
    }
    if (tombs.length) {
      var del = new Table(DEL, null);
      tombs.forEach(function (tb) { del.put(tb[0], tb); });
      del.save();
      toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
    }
  } catch (err) { /* never block typing in the sheet */ }
}
