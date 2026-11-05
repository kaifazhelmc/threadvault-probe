"use strict";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FILE = "probe.txt";
const $ = (id) => document.getElementById(id);
const clientId = window.TV_CLIENT_ID;
const standalone = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
let token = null;
const entries = [];

function log(name, ok, detail = "") {
  entries.push({ name, ok, detail });
  const li = document.createElement("li");
  const mark = document.createElement("span");
  mark.className = ok === null ? "" : ok ? "ok" : "ng";
  mark.textContent = ok === null ? "資訊" : ok ? "通過" : "失敗";
  li.append(mark, ` ${name}${detail ? `：${detail}` : ""}`);
  $("log").append(li);
}

function setToken(value, how) {
  token = value;
  log(`取得授權（${how}）`, true);
  $("drive").disabled = false;
  $("silent").disabled = false;
}

function randomState() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function redirectUri() { return location.origin + location.pathname; }

/** 方法 B：整頁跳轉，Google 把 token 放在網址片段帶回來。 */
function startRedirect() {
  const state = randomState();
  sessionStorage.setItem("tv.state", state);
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri(), response_type: "token", scope: SCOPE,
    include_granted_scopes: "false", prompt: "consent", state,
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}

function readRedirect() {
  if (!location.hash.includes("access_token") && !location.hash.includes("error=")) return;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
  const expected = sessionStorage.getItem("tv.state");
  sessionStorage.removeItem("tv.state");
  if (p.get("error")) return log("轉址登入", false, p.get("error"));
  if (!expected || p.get("state") !== expected) {
    return log("轉址登入", false, `state 不符，回來的 App 環境可能不同（${standalone ? "主畫面 App" : "瀏覽器分頁"}）`);
  }
  setToken(p.get("access_token"), "方法 B");
  log("Token 期限", null, `${p.get("expires_in")} 秒`);
}

let tokenClient = null;
function gis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    s.onerror = () => reject(new Error("無法載入 Google 登入程式"));
    document.head.append(s);
  });
}
function makeClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId, scope: SCOPE, callback: () => {},
    error_callback: (e) => { log(pending || "登入", false, e.type || e.message || "未知錯誤"); pending = null; },
  });
}
let pending = null;
function request(prompt, label, how) {
  pending = label;
  tokenClient.callback = (r) => {
    pending = null;
    if (r.error) return log(label, false, r.error);
    setToken(r.access_token, how);
    log("Token 期限", null, `${r.expires_in} 秒`);
  };
  tokenClient.requestAccessToken({ prompt });
}

async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  return res;
}
function createBody(id, text) {
  const b = "tvprobe";
  return {
    headers: { "Content-Type": `multipart/related; boundary=${b}` },
    body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ id, name: FILE, parents: ["appDataFolder"] })}\r\n--${b}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${b}--`,
  };
}
async function runDrive() {
  const text = `脆藏測試 ${new Date().toISOString()}`;
  let id = null;
  try {
    const gen = await api(`${API}/files/generateIds?count=1&space=appDataFolder`);
    if (!gen.ok) return log("預先產生檔案 ID", false, `HTTP ${gen.status}`);
    id = (await gen.json()).ids[0];
    log("預先產生檔案 ID", true);
    const made = await api(`${UPLOAD}/files?uploadType=multipart`, { method: "POST", ...createBody(id, text) });
    log("建立檔案", made.ok, made.ok ? "" : `HTTP ${made.status}`);
    if (!made.ok) return;
    const again = await api(`${UPLOAD}/files?uploadType=multipart`, { method: "POST", ...createBody(id, text) });
    log("重複上傳不產生新檔", again.status === 409, `HTTP ${again.status}`);
    const list = await api(`${API}/files?spaces=appDataFolder&fields=files(id,name)&q=${encodeURIComponent(`name='${FILE}'`)}`);
    const found = list.ok ? (await list.json()).files.filter((f) => f.id === id).length : -1;
    log("列出檔案", found === 1, `找到 ${found} 筆`);
    const read = await api(`${API}/files/${id}?alt=media`);
    log("讀回內容", read.ok && (await read.text()).trim() === text);
  } catch (e) {
    log("Drive 連線", false, e.message);
  } finally {
    if (id) {
      const del = await api(`${API}/files/${id}`, { method: "DELETE" }).catch(() => null);
      log("刪除測試檔", !!del && (del.ok || del.status === 404));
    }
  }
}

async function environment() {
  log("開啟方式", null, standalone ? "主畫面 App" : "瀏覽器分頁");
  log("裝置", null, navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 90));
  const persisted = await navigator.storage?.persist?.().catch(() => null);
  log("持久儲存", null, String(persisted ?? "不支援"));
  if (!clientId) { $("warn").hidden = false; $("warn").textContent = "尚未設定 Client ID，登入按鈕暫時無法使用。"; }
  if (!standalone) { $("warn").hidden = false; $("warn").textContent ||= ""; $("warn").textContent += " 請先從 Safari 分享選單「加入主畫面」，再從主畫面開啟測試。"; }
}

$("popup").onclick = async () => {
  if (!clientId) return log("方法 A", false, "尚未設定 Client ID");
  // 彈窗必須在使用者點擊的同一輪開啟，Google 程式需要事先載入。
  if (!tokenClient) return log("方法 A", false, "Google 登入程式尚未載入，請稍候再按一次");
  request("consent", "方法 A", "方法 A");
};
$("redirect").onclick = () => (clientId ? startRedirect() : log("方法 B", false, "尚未設定 Client ID"));
$("drive").onclick = runDrive;
$("silent").onclick = () => {
  if (!tokenClient) return log("免按同意續期", false, "Google 登入程式尚未載入");
  request("", "免按同意續期", "免按同意續期");
};
$("copy").onclick = async () => {
  const text = entries.map((e) => `${e.ok === null ? "資訊" : e.ok ? "通過" : "失敗"} ${e.name} ${e.detail}`.trim()).join("\n");
  try { await navigator.clipboard.writeText(text); log("已複製結果", null); }
  catch { log("無法自動複製，請截圖", null); }
};

environment().then(() => {
  readRedirect();
  if (clientId) gis().then(makeClient).catch((e) => log("載入 Google 登入程式", false, e.message));
});
