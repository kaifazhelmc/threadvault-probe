/**
 * 脆藏 iPhone 分享收件匣
 * @OnlyCurrentDoc
 * 只能存取這份試算表。設定步驟：執行 setup 一次，再部署為網頁應用程式。
 */
const MAX_BODY = 8192;
const MAX_ROWS = 5000;
const HEADERS = ['id', 'receivedAt', 'url', 'note', 'status', 'category', 'postUrl', 'handle', 'name', 'text'];
const THREADS = /^https:\/\/(www\.)?threads\.(com|net)\/[^\s]+$/i;
const POST = /^https:\/\/[^/]+\/@([^/?#]+)\/post\/([A-Za-z0-9_-]+)/;
const MEDIA = /https:\/\/[^"'\s<>\\]*(?:cdninstagram\.com|fbcdn\.net)[^"'\s<>\\]*/g;
const IMAGE_HOST = /^https:\/\/[a-z0-9.-]+\.(?:cdninstagram\.com|fbcdn\.net)\//i;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';

/** 在編輯器執行一次：完成授權，並確認 Google 伺服器讀得到 Threads 公開頁面。 */
function testResolve() {
  Logger.log(JSON.stringify(resolve_('https://www.threads.com/share/BAWaSF787o')));
}

/** 在編輯器執行：把引號內換成一篇有圖貼文的連結，確認 Google 伺服器抓得到圖片。 */
function testEmbed() {
  const post = resolve_('把這裡換成一篇有圖貼文的分享連結');
  if (!post) return Logger.log('resolve 失敗');
  const res = UrlFetchApp.fetch(post.postUrl + '/embed', { muteHttpExceptions: true, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
  const html = res.getContentText();
  const found = embedImages_(html);
  Logger.log(JSON.stringify({
    post: post.postUrl, hasText: !!post.text, code: res.getResponseCode(), size: html.length,
    rendered: found.rendered, images: found.images.length,
    sample: (html.match(MEDIA) || []).slice(0, 4).map(function (s) { return s.slice(0, 110); }),
  }));
}

/** 嵌入頁的圖片網址。-19 是大頭貼，-15 是貼文圖片；同一張圖有多種尺寸，留最大的。 */
function embedImages_(html) {
  const clean = html.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const all = clean.match(MEDIA) || [];
  const best = {};
  const order = [];
  all.forEach(function (raw) {
    const url = raw.replace(/[,;)]+$/, '');
    if (!/\/t\d+\.\d+-15\//.test(url)) return;
    const key = url.split('?')[0].split('/').pop();
    const size = url.match(/[?_&](?:stp=[^&]*_)?[sp](\d+)x\d+/);
    const width = size ? Number(size[1]) : 99999;
    if (!best[key]) order.push(key);
    if (!best[key] || width > best[key].width) best[key] = { url: url, width: width };
  });
  return { rendered: all.length > 0, images: order.slice(0, 20).map(function (k) { return best[k].url; }) };
}

function readPost_(target) {
  if (!THREADS.test(target)) return { ok: false, error: 'bad_target' };
  const post = resolve_(target);
  if (!post) return { ok: false, error: 'unreadable' };
  let found = { rendered: false, images: [] };
  try {
    const res = UrlFetchApp.fetch(post.postUrl + '/embed', { muteHttpExceptions: true, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
    if (res.getResponseCode() === 200) found = embedImages_(res.getContentText());
  } catch (err) { /* 文字仍可使用 */ }
  return { ok: true, postUrl: post.postUrl, handle: post.handle, name: post.name, text: post.text, rendered: found.rendered, images: found.images };
}

function readImage_(target) {
  if (!IMAGE_HOST.test(target)) return { ok: false, error: 'bad_target' };
  const res = UrlFetchApp.fetch(target, { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'image_' + res.getResponseCode() };
  const blob = res.getBlob();
  return { ok: true, type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function decode_(text) {
  return text.replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(Number(d)); })
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function meta_(html, property) {
  const tag = html.match(new RegExp('<meta[^>]+property="' + property + '"[^>]*>', 'i'));
  const content = tag && tag[0].match(/content="([^"]*)"/i);
  return content ? decode_(content[1]).replace(/\u2593/g, '').trim() : '';
}

/** 一篇公開貼文的短連結解析，只跟隨 Threads 網域內的轉址。失敗時回傳 null，收藏仍保留短連結。 */
function resolve_(url) {
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const res = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
      const code = res.getResponseCode();
      if (code >= 300 && code < 400) {
        const headers = res.getAllHeaders();
        const next = headers.Location || headers.location;
        if (!next) return null;
        const target = next.charAt(0) === '/' ? 'https://www.threads.com' + next : next;
        if (!THREADS.test(target)) return null;
        current = target;
        continue;
      }
      if (code !== 200) return null;
      const html = res.getContentText();
      const postUrl = meta_(html, 'og:url') || current;
      const m = postUrl.match(POST);
      if (!m) return null;
      const handle = decodeURIComponent(m[1]);
      const title = meta_(html, 'og:title').match(/^(?:Threads\s*上的\s*)?(.+?)\s*[（(]@([^）)]+)[）)]/);
      return {
        postUrl: 'https://www.threads.com/@' + m[1] + '/post/' + m[2], handle: handle,
        name: title && title[2] === handle ? title[1] : '', text: meta_(html, 'og:description').slice(0, 5000),
      };
    }
  } catch (err) { /* 保留短連結 */ }
  return null;
}

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
    // 這兩項只讀 Threads，不動試算表，不需要排隊。
    if (body.action === 'readPost') return reply_(readPost_(String(body.target || '')));
    if (body.action === 'readImage') return reply_(readImage_(String(body.target || '')));
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
  // safe_ 在開頭加單引號，避免內容被試算表當成公式執行。
  const post = resolve_(url) || {};
  sheet.appendRow([id, receivedAt, safe_(url), safe_(String(body.note || '').slice(0, 2000)), 'pending',
    safe_(String(body.category || '').slice(0, 100)), safe_(post.postUrl || ''), safe_(post.handle || ''), safe_(post.name || ''), safe_(post.text || '')]);
  return { ok: true, id: id, receivedAt: receivedAt, resolved: !!post.postUrl };
}

function safe_(value) {
  return value ? "'" + value : '';
}

function reply_payload_(error) {
  return { ok: false, error: error };
}

function list_() {
  const rows = inbox_().getDataRange().getDisplayValues().slice(1);
  const items = rows.filter(function (r) { return r[4] === 'pending'; })
    .map(function (r) { return { id: r[0], receivedAt: r[1], url: r[2], note: r[3], category: r[5] || '', postUrl: r[6] || '', handle: r[7] || '', name: r[8] || '', text: r[9] || '' }; });
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
