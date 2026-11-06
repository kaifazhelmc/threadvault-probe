/**
 * 脆藏 iPhone 分享收件匣
 * @OnlyCurrentDoc
 * 只能存取這份試算表。設定步驟：執行 setup 一次，再部署為網頁應用程式。
 */
const MAX_BODY = 8192;
const MAX_ROWS = 5000;
const HEADERS = ['id', 'receivedAt', 'url', 'note', 'status', 'category', 'postUrl', 'handle', 'name', 'text'];
const THREADS = /^https:\/\/(www\.)?threads\.(com|net)\/[^\s]+$/i;
const INSTAGRAM = /^https:\/\/(www\.|m\.)?instagram\.com\/[^\s]+$/i;
const INSTAGRAM_POST = /^https:\/\/[^/]+\/(?:[A-Za-z0-9._]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;
const POST = /^https:\/\/[^/]+\/@([^/?#]+)\/post\/([A-Za-z0-9_-]+)/;
const MEDIA = /https:\/\/[^"'\s<>\\]*(?:cdninstagram\.com|fbcdn\.net)[^"'\s<>\\]*/g;
const IMAGE_HOST = /^https:\/\/[a-z0-9.-]+\.(?:cdninstagram\.com|fbcdn\.net)\//i;
const CHUNK = 4 * 1024 * 1024;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';

/** 在編輯器執行一次：完成授權，並確認 Google 伺服器讀得到 Threads 公開頁面。 */
function testResolve() {
  Logger.log(JSON.stringify(resolve_('https://www.threads.com/share/BAWaSF787o')));
}

/** 在編輯器執行：把引號內換成有圖、有影片的貼文連結，確認 Google 伺服器抓得到圖片與影片。 */
function testEmbed() {
  ['把這裡換成一篇有圖貼文的分享連結', '把這裡換成一篇有影片貼文的分享連結'].forEach(function (link) {
    const post = resolve_(link);
    if (!post) return Logger.log('resolve 失敗：' + link.slice(0, 40));
    const res = UrlFetchApp.fetch(post.postUrl + '/embed', { muteHttpExceptions: true, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
    const html = res.getContentText();
    const clean = html.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
    const found = embedImages_(html);
    Logger.log(JSON.stringify({
      post: post.postUrl, hasText: !!post.text, code: res.getResponseCode(), size: html.length,
      rendered: found.rendered, images: found.images.length,
      videoTags: (html.match(/<video/gi) || []).length,
      videos: (clean.match(/https:[^"'\s<>\\]*\.mp4[^"'\s<>\\]*/gi) || []).length,
      sample: (html.match(MEDIA) || []).slice(0, 3).map(function (s) { return s.slice(0, 110); }),
    }));
  });
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

/** 影片網址。同一支影片有多種畫質，頁面通常先列最高畫質。 */
function embedVideos_(html) {
  const clean = html.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const seen = {};
  const urls = (clean.match(MEDIA) || []).filter(function (u) {
    if (!/\.mp4/i.test(u) || seen[u]) return false;
    seen[u] = true;
    return true;
  });
  return urls.slice(0, Math.max(1, (html.match(/<video/gi) || []).length));
}

function readChunk_(target, start) {
  if (!IMAGE_HOST.test(target)) return { ok: false, error: 'bad_target' };
  const res = UrlFetchApp.fetch(target, { muteHttpExceptions: true, headers: { 'User-Agent': UA, Range: 'bytes=' + start + '-' + (start + CHUNK - 1) } });
  const code = res.getResponseCode();
  if (code !== 200 && code !== 206) return { ok: false, error: 'video_' + code };
  const headers = res.getAllHeaders();
  const range = String(headers['Content-Range'] || headers['content-range'] || '').match(/\/(\d+)$/);
  const blob = res.getBlob();
  const bytes = blob.getBytes();
  return { ok: true, type: blob.getContentType(), total: range ? Number(range[1]) : bytes.length, data: Utilities.base64Encode(bytes) };
}

function readToken_() {
  const token = ScriptApp.getOAuthToken();
  const info = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  const left = info.getResponseCode() === 200 ? Number(JSON.parse(info.getContentText()).expires_in) || 0 : 0;
  return { ok: true, token: token, expiresIn: left };
}

function readPost_(target) {
  if (INSTAGRAM.test(target)) {
    const shared = resolveInstagram_(target);
    if (!shared || (!shared.text && !shared.handle)) return { ok: false, error: 'unreadable' };
    return { ok: true, postUrl: shared.postUrl, handle: shared.handle, name: shared.name, text: shared.text, rendered: false, images: [], videos: [], poster: shared.poster };
  }
  if (!THREADS.test(target)) return { ok: false, error: 'bad_target' };
  const post = resolve_(target);
  if (!post) return { ok: false, error: 'unreadable' };
  let found = { rendered: false, images: [] };
  let videos = [];
  try {
    const res = UrlFetchApp.fetch(post.postUrl + '/embed', { muteHttpExceptions: true, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
    if (res.getResponseCode() === 200) {
      found = embedImages_(res.getContentText());
      videos = embedVideos_(res.getContentText());
    }
  } catch (err) { /* 文字仍可使用 */ }
  return { ok: true, postUrl: post.postUrl, handle: post.handle, name: post.name, text: post.text, rendered: found.rendered, images: found.images, videos: videos, poster: post.poster };
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
        poster: /-15\//.test(meta_(html, 'og:image')) ? meta_(html, 'og:image') : '',
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
    // 手機網頁不能自己續期 Google 授權，由腳本代領；同一個 Cloud 專案，看得到脆藏的專屬空間。
    if (body.action === 'readToken') return reply_(readToken_());
    if (body.action === 'readPost') return reply_(readPost_(String(body.target || '')));
    if (body.action === 'readImage') return reply_(readImage_(String(body.target || '')));
    if (body.action === 'readChunk') return reply_(readChunk_(String(body.target || ''), Math.max(0, Number(body.start) || 0)));
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

/** 貼文頁會導向登入頁，但官方嵌入頁是公開的。讀不到時回傳 null 或只有網址，收藏仍保留。 */
function resolveInstagram_(url) {
  try {
    const post = instagramPost_(url);
    if (!post) return null;
    const res = UrlFetchApp.fetch(post + 'embed/captioned/', { muteHttpExceptions: true, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9' } });
    const found = res.getResponseCode() === 200 ? parseInstagramEmbed_(res.getContentText()) : { handle: '', text: '', poster: '' };
    return { postUrl: post, handle: found.handle, name: '', text: found.text, poster: found.poster };
  } catch (err) {
    return null;
  }
}

/** 短連結轉址後取得貼文網址；登入頁的 next 參數裡也有。 */
function instagramPost_(url) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const next = current.match(/[?&]next=([^&]+)/);
    if (next) current = decodeURIComponent(next[1]);
    if (current.charAt(0) === '/') current = 'https://www.instagram.com' + current;
    const m = current.match(INSTAGRAM_POST);
    if (m) return 'https://www.instagram.com/' + (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2] + '/';
    if (!INSTAGRAM.test(current)) return null;
    const res = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true, headers: { 'User-Agent': UA } });
    const headers = res.getAllHeaders();
    const location = headers.Location || headers.location;
    if (!location) return null;
    current = location;
  }
  return null;
}

function parseInstagramEmbed_(html) {
  const author = html.match(/class="CaptionUsername"[^>]*>([^<]+)<\/a>([\s\S]*?)<\/div>/);
  const fallback = html.match(/class="Username"[^>]*>(?:<[^>]+>)*([A-Za-z0-9._]+)/);
  const text = author ? decode_(author[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\s*(查看所有\s*[\d,]+\s*則留言|view all [\d,]+ comments)\s*$/i, '').replace(/\s*(更多|more)\s*$/i, '').trim() : '';
  const image = html.match(/<img[^>]*class="EmbeddedMediaImage"[^>]*>/);
  const src = image && image[0].match(/\ssrc="([^"]+)"/);
  return {
    handle: author ? decode_(author[1]).trim() : fallback ? fallback[1] : '',
    text: text.slice(0, 5000), poster: src ? decode_(src[1]) : '',
  };
}

function add_(body) {
  const url = String(body.url || '').trim();
  const instagram = INSTAGRAM.test(url);
  if (!THREADS.test(url) && !instagram) return reply_payload_('not_threads');
  const sheet = inbox_();
  if (sheet.getLastRow() > MAX_ROWS) return reply_payload_('inbox_full');
  const id = Utilities.getUuid();
  const receivedAt = new Date().toISOString();
  // safe_ 在開頭加單引號，避免內容被試算表當成公式執行。
  const post = (instagram ? resolveInstagram_(url) : resolve_(url)) || {};
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
