/**
 * 脆藏 iPhone 分享收件匣
 * @OnlyCurrentDoc
 * 只能存取這份試算表。設定步驟：執行 setup 一次，再部署為網頁應用程式。
 */
const MAX_BODY = 8192;
const MAX_ROWS = 5000;
const HEADERS = ['id', 'receivedAt', 'url', 'note', 'status'];
const THREADS = /^https:\/\/(www\.)?threads\.(com|net)\/[^\s]+$/i;

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  }
  const sheet = inbox_();
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  Logger.log('個人密鑰：' + props.getProperty('SECRET'));
}

function inbox_() {
  const book = SpreadsheetApp.getActive();
  return book.getSheetByName('inbox') || book.insertSheet('inbox');
}

function reply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return reply_({ ok: false, error: 'POST only' });
}

function doPost(e) {
  try {
    const raw = e && e.postData ? e.postData.contents : '';
    if (!raw || raw.length > MAX_BODY) return reply_({ ok: false, error: 'bad_request' });
    const body = JSON.parse(raw);
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || body.secret !== secret) return reply_({ ok: false, error: 'forbidden' });
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (body.action === 'list') return reply_(list_());
      if (body.action === 'ack') return reply_(ack_(body.ids));
      return reply_(add_(body));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return reply_({ ok: false, error: 'server_error' });
  }
}

function add_(body) {
  const url = String(body.url || '').trim();
  if (!THREADS.test(url)) return reply_payload_('not_threads');
  const sheet = inbox_();
  if (sheet.getLastRow() > MAX_ROWS) return reply_payload_('inbox_full');
  const id = Utilities.getUuid();
  const receivedAt = new Date().toISOString();
  // 開頭加單引號，避免內容被試算表當成公式執行。
  sheet.appendRow([id, receivedAt, "'" + url, "'" + String(body.note || '').slice(0, 2000), 'pending']);
  return { ok: true, id: id, receivedAt: receivedAt };
}

function reply_payload_(error) {
  return { ok: false, error: error };
}

function list_() {
  const rows = inbox_().getDataRange().getDisplayValues().slice(1);
  const items = rows.filter(function (r) { return r[4] === 'pending'; })
    .map(function (r) { return { id: r[0], receivedAt: r[1], url: r[2], note: r[3] }; });
  return { ok: true, items: items };
}

function ack_(ids) {
  if (!Array.isArray(ids)) return reply_payload_('bad_request');
  const wanted = {};
  ids.forEach(function (id) { wanted[id] = true; });
  const sheet = inbox_();
  const rows = sheet.getDataRange().getDisplayValues();
  let done = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (wanted[rows[i][0]]) { sheet.deleteRow(i + 1); done++; }
  }
  return { ok: true, done: done };
}
