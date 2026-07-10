"use strict";

const express         = require("express");
const fetch           = require("node-fetch");
const FormData        = require("form-data");
const { MongoClient } = require("mongodb");
const http            = require("http");
const https           = require("https");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── CONFIG ──────────────────────────────────
const BOT_TOKEN   = process.env.BOT_TOKEN   || "";
const MONGO_URI   = process.env.MONGO_URI   || "";
const PORT        = process.env.PORT        || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const OWNER       = "@RTFGAMMING";

// ── API URLs (dynamic — admin se change ho sakti hain) ──────────────────────
const DEFAULT_API_URLS = {
  num:     "https://movements-invoice-amanda-victoria.trycloudflare.com/search/number?number={query}&key=mysecretkey123",
  deep:    "https://leakapi.suryajasoos.workers.dev/?query=91{query}",
  tg:      "https://username2num.suryajasoos.workers.dev/?id={query}",
  adhar:   "https://aadharinfo.suryahacker.workers.dev/?aadhar={query}",
  upi:     "https://krish-osintoy.lovable.app/api/v1/upi?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&upi={query}",
  vehicle: "https://vehicle.suryahacker.workers.dev/fetch?query={query}",
};

// Runtime mein yahi use hoga (DB se override hoga)
let apiUrls = { ...DEFAULT_API_URLS };

// API response display config — kaunsa field user ko dikhana hai
// "raw" = pura response dikhao (default formatters use karo)
// "field:xyz" = response ka xyz field dikhao
const DEFAULT_API_RESPONSE_CONFIG = {
  num:     "raw",
  deep:    "raw",
  tg:      "raw",
  adhar:   "raw",
  upi:     "raw",
  vehicle: "raw",
};
let apiResponseConfig = { ...DEFAULT_API_RESPONSE_CONFIG };

// ── CHANNELS (dynamic, DB se load hoga) ───────
let CHANNELS = [
  { name: "🔥 RTF GAMING",  username: "RTFGAMING1",     id: null },
  { name: "🎁 GIVEAWAY",    username: "RTFGAMINGHACK0", id: null },
  { name: "🎁 BACKUP",      username: "USERX1NFO",      id: null },
];

const JOINED_STATUSES = new Set(["member","administrator","creator","restricted"]);

let admins          = ["@rtfgamming"];
const userState     = new Map();
const customTgData  = new Map();
const customNumData = new Map();

// ══════════════════════════════════════════════
//  COIN & REFERRAL SYSTEM
// ══════════════════════════════════════════════
const referralCooldown = new Map();

async function getUserCoins(userId) {
  if (!usersCol) return 0;
  try {
    const user = await usersCol.findOne({ user_id: userId });
    return user?.coins || 0;
  } catch { return 0; }
}

async function addUserCoins(userId, amount) {
  if (!usersCol) return;
  try {
    await usersCol.updateOne(
      { user_id: userId },
      { $inc: { coins: amount } },
      { upsert: true }
    );
  } catch (e) { console.error("[ADD COINS]", e.message); }
}

async function deductUserCoins(userId, amount) {
  if (!usersCol) return false;
  try {
    const user = await usersCol.findOne({ user_id: userId });
    if (!user || (user.coins || 0) < amount) return false;
    await usersCol.updateOne(
      { user_id: userId },
      { $inc: { coins: -amount } }
    );
    return true;
  } catch (e) { console.error("[DEDUCT COINS]", e.message); return false; }
}

function canRefer(userId) {
  const now = Date.now();
  const data = referralCooldown.get(userId);
  if (!data) {
    referralCooldown.set(userId, { count: 1, timestamp: now });
    return true;
  }
  if (now - data.timestamp > 60000) {
    referralCooldown.set(userId, { count: 1, timestamp: now });
    return true;
  }
  if (data.count < 2) {
    data.count++;
    return true;
  }
  return false;
}

// ── REQUEST SYSTEM ──────────────────────────────
async function createRequest(userId, type, query, coinsUsed) {
  if (!dataCol) return null;
  const req = {
    user_id: userId,
    type: type,
    query: query,
    status: 'pending',
    coins_used: coinsUsed,
    created_at: new Date().toISOString(),
    result: null
  };
  try {
    const result = await dataCol.insertOne({
      key: `request_${Date.now()}_${userId}`,
      value: req,
      created_at: new Date().toISOString()
    });
    return { ...req, _id: result.insertedId };
  } catch (e) {
    console.error("[CREATE REQUEST]", e.message);
    return null;
  }
}

async function getPendingRequests() {
  if (!dataCol) return [];
  try {
    const docs = await dataCol.find({ 
      "value.status": "pending",
      key: { $regex: /^request_/ }
    }).toArray();
    return docs.map(d => ({ ...d.value, _id: d._id }));
  } catch (e) {
    console.error("[GET PENDING REQUESTS]", e.message);
    return [];
  }
}

async function updateRequestStatus(requestId, status, result = null) {
  if (!dataCol) return;
  try {
    await dataCol.updateOne(
      { _id: requestId },
      { $set: { "value.status": status, "value.result": result } }
    );
  } catch (e) {
    console.error("[UPDATE REQUEST]", e.message);
  }
}

async function getUserRequests(userId) {
  if (!dataCol) return [];
  try {
    const docs = await dataCol.find({
      "value.user_id": userId,
      key: { $regex: /^request_/ }
    }).sort({ created_at: -1 }).toArray();
    return docs.map(d => ({ ...d.value, _id: d._id }));
  } catch (e) {
    console.error("[GET USER REQUESTS]", e.message);
    return [];
  }
}

// ══════════════════════════════════════════════
//  API TOGGLE SYSTEM
// ══════════════════════════════════════════════
const apiToggle = {
  num:     { enabled: true, label: "📞 Number API",    offMsg: "❌ Number lookup abhi available nahi hai." },
  deep:    { enabled: true, label: "🔬 Deep Intel API", offMsg: "❌ Deep data lookup abhi available nahi hai." },
  tg:      { enabled: true, label: "🔎 TG Lookup API",  offMsg: "❌ TG lookup abhi available nahi hai. Thodi der baad try karo." },
  adhar:   { enabled: true, label: "🪪 Aadhaar API",    offMsg: "❌ Aadhaar lookup abhi available nahi hai." },
  upi:     { enabled: true, label: "💳 UPI API",        offMsg: "❌ UPI lookup abhi available nahi hai." },
  vehicle: { enabled: true, label: "🚗 Vehicle API",    offMsg: "❌ Vehicle lookup abhi available nahi hai." },
};

const API_KEYS = ["num","deep","tg","adhar","upi","vehicle"];
const API_LABELS = {
  num:     "📞 Number API",
  deep:    "🔬 Deep Intel API",
  tg:      "🔎 TG Lookup API",
  adhar:   "🪪 Aadhaar API",
  upi:     "💳 UPI API",
  vehicle: "🚗 Vehicle API",
};

// ── CONCURRENCY CONTROL ───────────────────────
const userQueue = new Map();
function queueForUser(userId, taskFn) {
  const prev = userQueue.get(userId) || Promise.resolve();
  const next = prev.then(() => taskFn()).catch(e => console.error(`[QUEUE] uid=${userId}, ${e.message}`));
  userQueue.set(userId, next);
  next.finally(() => { if (userQueue.get(userId) === next) userQueue.delete(userId); });
  return next;
}

// ── MongoDB ──────────────────────────────────
let mongoClient, db, usersCol, dataCol;

async function initDb() {
  if (!MONGO_URI) { console.warn("[DB] MONGO_URI not set"); return; }
  try {
    mongoClient = new MongoClient(MONGO_URI, {
      maxPoolSize: 100, minPoolSize: 10,
      serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 30000,
    });
    await mongoClient.connect();
    db       = mongoClient.db("rtfbot");
    usersCol = db.collection("users");
    dataCol  = db.collection("saved_data");
    await usersCol.createIndex({ user_id: 1 }, { unique: true });
    await dataCol.createIndex({ key: 1 });
    console.log("[DB] MongoDB connected ✅");
  } catch (e) { console.error("[DB ERROR]", e.message); mongoClient = null; }
}

// ── DB SAVE/LOAD ──────────────────────────────
async function dbSaveChannels() {
  if (!dataCol) return;
  try {
    await dataCol.updateOne({ key: "channels" }, { $set: { key: "channels", value: CHANNELS, updated_at: new Date().toISOString() } }, { upsert: true });
  } catch (e) { console.error("[DB SAVE CHANNELS]", e.message); }
}

async function dbLoadChannels() {
  if (!dataCol) return;
  try {
    const doc = await dataCol.findOne({ key: "channels" });
    if (doc && Array.isArray(doc.value) && doc.value.length > 0) {
      CHANNELS = doc.value;
      console.log(`[DB] Loaded ${CHANNELS.length} channels ✅`);
    }
  } catch (e) { console.error("[DB LOAD CHANNELS]", e.message); }
}

async function dbSaveApiUrls() {
  if (!dataCol) return;
  try {
    await dataCol.updateOne(
      { key: "api_urls" },
      { $set: { key: "api_urls", value: apiUrls, updated_at: new Date().toISOString() } },
      { upsert: true }
    );
    await dataCol.updateOne(
      { key: "api_response_config" },
      { $set: { key: "api_response_config", value: apiResponseConfig, updated_at: new Date().toISOString() } },
      { upsert: true }
    );
  } catch (e) { console.error("[DB SAVE API URLS]", e.message); }
}

async function dbLoadApiUrls() {
  if (!dataCol) return;
  try {
    const doc = await dataCol.findOne({ key: "api_urls" });
    if (doc && doc.value && typeof doc.value === "object") {
      apiUrls = { ...DEFAULT_API_URLS, ...doc.value };
      console.log("[DB] Loaded API URLs ✅");
    }
    const cfgDoc = await dataCol.findOne({ key: "api_response_config" });
    if (cfgDoc && cfgDoc.value && typeof cfgDoc.value === "object") {
      apiResponseConfig = { ...DEFAULT_API_RESPONSE_CONFIG, ...cfgDoc.value };
      console.log("[DB] Loaded API response config ✅");
    }
  } catch (e) { console.error("[DB LOAD API URLS]", e.message); }
}

function dbSaveUser(from) {
  if (!usersCol) return;
  const now = new Date().toISOString();
  usersCol.updateOne(
    { user_id: from.id },
    {
      $set: { 
        user_id: from.id, 
        username: from.username || "", 
        name: [from.first_name, from.last_name].filter(Boolean).join(" "), 
        first_name: from.first_name || "", 
        last_name: from.last_name || "", 
        last_seen: now 
      },
      $setOnInsert: { first_seen: now, total_searches: 0, coins: 0 }
    },
    { upsert: true }
  ).catch(e => console.error("[DB SAVE USER]", e.message));
}

function dbIncrSearch(userId) {
  if (!usersCol) return;
  usersCol.updateOne({ user_id: userId }, { $inc: { total_searches: 1 } })
    .catch(e => console.error("[DB INCR SEARCH]", e.message));
}

async function dbSaveData(key, value) {
  if (!dataCol) return;
  dataCol.updateOne({ key }, { $set: { key, value, updated_at: new Date().toISOString() } }, { upsert: true })
    .catch(e => console.error("[DB SAVE DATA]", e.message));
}

async function dbGetAllUsers() {
  if (!usersCol) return [];
  try { return await usersCol.find({}, { projection: { _id: 0 } }).toArray(); }
  catch (e) { console.error("[DB GET USERS]", e.message); return []; }
}

async function dbUserCount() {
  if (!usersCol) return 0;
  try { return await usersCol.countDocuments(); } catch { return 0; }
}

// ── TELEGRAM API ─────────────────────────────
const TG_BASE    = `https://api.telegram.org/bot${BOT_TOKEN}`;
const httpAgent  = new http.Agent ({ keepAlive: true, maxSockets: 200 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 200 });
function agentForTelegram(url) { return url.startsWith("https") ? { agent: httpsAgent } : { agent: httpAgent }; }

const httpsAgentExternal = new https.Agent({ keepAlive: false, timeout: 60000 });
const httpAgentExternal  = new http.Agent ({ keepAlive: false, timeout: 60000 });
function agentForExternal(url) { return url.startsWith("https") ? { agent: httpsAgentExternal } : { agent: httpAgentExternal }; }

async function tgApi(method, body = {}) {
  try {
    const res  = await fetch(`${TG_BASE}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000), ...agentForTelegram(TG_BASE) });
    const json = await res.json();
    if (!json.ok) { console.error(`[TG ${method}]`, json.description); return null; }
    return json.result;
  } catch (e) { console.error(`[TG ${method}]`, e.message); return null; }
}

async function tgApiGet(method, params = {}) {
  try {
    const url = new URL(`${TG_BASE}/${method}`);
    Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), ...agentForTelegram(TG_BASE) });
    const json = await res.json();
    if (!json.ok) { console.error(`[TG ${method}]`, json.description); return null; }
    return json.result;
  } catch (e) { console.error(`[TG ${method}]`, e.message); return null; }
}

function escMd(text) {
  if (text == null) return "";
  return String(text).replace(/[_*[\]()~>#+=|{}.!\\\-]/g, "\\$&");
}
function cbMd(label, value) {
  const v = (value != null ? String(value).trim() : "");
  if (v && !["N/A","","None","null","nan","undefined","Not Available"].includes(v))
    return `${escMd(label)}: ${escMd(v)}`;
  return `${escMd(label)}: ❌ N/A`;
}

function escHtml(text) {
  if (text == null) return "";
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function htmlBold(text) { return `<b>${escHtml(text)}</b>`; }
function htmlCode(text) { return `<code>${escHtml(text)}</code>`; }

const sendMessage     = (chat_id, text, extra = {}) => tgApi("sendMessage",     { chat_id, text, parse_mode: "MarkdownV2", disable_web_page_preview: true, ...extra });
const sendMessageHtml = (chat_id, text, extra = {}) => tgApi("sendMessage",     { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
const deleteMessage   = (chat_id, message_id) => tgApi("deleteMessage", { chat_id, message_id });
const answerCallback  = (callback_query_id, text = "", show_alert = false) => tgApi("answerCallbackQuery", { callback_query_id, text, show_alert });
const getChatMember   = (chat_id, user_id) => tgApi("getChatMember", { chat_id, user_id });
const setMyCommands   = (commands) => tgApi("setMyCommands", { commands });
const setWebhook      = (url)      => tgApi("setWebhook",    { url, drop_pending_updates: true });
const sendPlain = (chat_id, text, extra = {}) => tgApi("sendMessage", { chat_id, text, disable_web_page_preview: true, ...extra });

async function sendDataNotFound(chatId, userMsgId, notFoundText) {
  const extra = userMsgId ? { reply_to_message_id: userMsgId } : {};
  const notFoundMsg = await sendPlain(chatId, notFoundText, extra);
  setTimeout(() => {
    if (notFoundMsg) deleteMessage(chatId, notFoundMsg.message_id);
    if (userMsgId)   deleteMessage(chatId, userMsgId);
  }, 15000);
}

async function sendDataFound(chatId, userMsgId, text) {
  const extra = userMsgId ? { reply_to_message_id: userMsgId } : {};
  const res = await sendMessage(chatId, text, extra);
  if (!res) {
    const plain = text.replace(/[_*[\]()~>#+=|{}.!\\\-]/g, "");
    await sendPlain(chatId, plain, extra);
  }
  return res;
}

// ── JOIN CHECK ────────────────────────────────
const joinCache = new Map();
const JOIN_CACHE_TTL = 60_000;

function resolveChannelId(ch) {
  if (ch.id) return ch.id;
  if (ch.username) return `@${ch.username}`;
  return null;
}

async function getNotJoinedChannels(userId) {
  const missing = [];
  for (const ch of CHANNELS) {
    const cid = resolveChannelId(ch);
    if (!cid) continue;
    try {
      const m = await getChatMember(cid, userId);
      if (!m || !JOINED_STATUSES.has(m.status)) missing.push(ch);
    } catch { missing.push(ch); }
  }
  return missing;
}

async function checkJoin(userId) {
  const cached = joinCache.get(userId);
  if (cached && Date.now() - cached.ts < JOIN_CACHE_TTL) return cached.ok;
  const missing = await getNotJoinedChannels(userId);
  const ok = missing.length === 0;
  joinCache.set(userId, { ok, ts: Date.now() });
  if (joinCache.size > 5000) { const c = Date.now() - JOIN_CACHE_TTL; for (const [k,v] of joinCache) { if (v.ts < c) joinCache.delete(k); } }
  return ok;
}

function isAdmin(username) {
  return admins.map(a => a.toLowerCase()).includes(`@${(username||"").toLowerCase()}`);
}

async function sendJoinPrompt(chatId) {
  const missing = await getNotJoinedChannels(chatId);
  if (!missing.length) return false;
  const buttons = missing.map(ch => {
    const url = ch.invite_link ? ch.invite_link : ch.username ? `https://t.me/${ch.username}` : null;
    if (!url) return null;
    return [{ text: `➕ ${ch.name}`, url }];
  }).filter(Boolean);
  buttons.push([{ text: "✅ VERIFY JOIN", callback_data: "verify" }]);
  await sendPlain(chatId, "╔════════════════════════╗\n║  🔒  ACCESS LOCKED  🔒  ║\n╠════════════════════════╣\n📢  Sabhi channels JOIN karo\n⚡  Phir ✅ VERIFY dabao\n╚════════════════════════╝", { reply_markup: { inline_keyboard: buttons } });
  return true;
}

// ── MENUS ─────────────────────────────────────
const MAIN_MENU_TEXT =
  "╔══════════════════════════╗\n║  ⚡️  R T F   B O T  ⚡️   ║\n╠══════════════════════════╣\n" +
  "🛡  Status  : ONLINE\n👑  Owner   : @RTFGAMMING\n🔥  Version : v3.5\n" +
  "╠══════════════════════════╣\n📌  Neeche se option chuno:\n╚══════════════════════════╝";

const HELP_TEXT =
  "╔══════════════════════════╗\n║  📖  B O T   H E L P    ║\n╠══════════════════════════╣\n" +
  "📞  /num <number>\n   Example: /num 9876543210\n\n" +
  "🔎  /tg <username ya userid>\n   Example: /tg rtfgamming\n   Example: /tg 8518042438\n\n" +
  "🪪  /adhar <aadhaar_no>\n   Example: /adhar 598229659586\n\n" +
  "💳  /upi <upi_id>\n   Example: /upi 70497398@axl\n\n" +
  "🚗  /vehicle <reg_number>\n   Example: /vehicle MH02FZ0555\n\n" +
  "💰  /coins - Check your coins\n" +
  "🔗  /refer - Get referral link\n" +
  "📝  /request <type> <query> - Request data using coins\n" +
  "📋  /myrequests - Check your requests\n\n" +
  "🏠 /start  ❓ /help\n╠══════════════════════════╣\n👑  Owner : @RTFGAMMING\n╚══════════════════════════╝";

function mainMenuKb() {
  return { inline_keyboard: [
    [{ text: "📞 Number Lookup", callback_data: "menu_number" }, { text: "🔎 TG Lookup", callback_data: "menu_tg" }],
    [{ text: "🪪 Aadhaar Lookup", callback_data: "menu_adhar" }],
    [{ text: "💳 UPI Lookup", callback_data: "menu_upi" }],
    [{ text: "🚗 Vehicle Lookup", callback_data: "menu_vehicle" }],
    [{ text: "💰 Coins", callback_data: "menu_coins" }, { text: "🔗 Refer", callback_data: "menu_refer" }],
    [{ text: "❓ Help", callback_data: "menu_help" }, { text: "👑 Owner", callback_data: "menu_owner" }],
  ]};
}

function adminMenuKb() {
  return { inline_keyboard: [
    [{ text: "📞 Number Lookup", callback_data: "menu_number" }, { text: "🔎 TG Lookup", callback_data: "menu_tg" }],
    [{ text: "🪪 Aadhaar Lookup", callback_data: "menu_adhar" }],
    [{ text: "💳 UPI Lookup", callback_data: "menu_upi" }],
    [{ text: "🚗 Vehicle Lookup", callback_data: "menu_vehicle" }],
    [{ text: "💰 Coins", callback_data: "menu_coins" }, { text: "🔗 Refer", callback_data: "menu_refer" }],
    [{ text: "❓ Help", callback_data: "menu_help" }, { text: "👑 Owner", callback_data: "menu_owner" }],
    [{ text: "📢 Broadcast", callback_data: "menu_broadcast" }, { text: "👥 Users Count", callback_data: "menu_users" }],
    [{ text: "📋 Admin List", callback_data: "menu_adminlist" }, { text: "⚙️ Admin Panel", callback_data: "menu_adminpanel" }],
    [{ text: "✏️ Set Custom TG", callback_data: "menu_setcustomtg" }],
    [{ text: "✏️ Set Custom Num", callback_data: "menu_setcustomnum" }],
    [{ text: "🗄️ DB Backup", callback_data: "menu_dbbackup" }],
    [{ text: "🔌 API Manager", callback_data: "menu_api" }],
    [{ text: "🔗 API URL Manager", callback_data: "menu_apiurl" }],
    [{ text: "📢 Channel Manager", callback_data: "menu_channels" }],
    [{ text: "📝 Pending Requests", callback_data: "menu_pending_requests" }],
  ]};
}

// ══════════════════════════════════════════════
//  API URL MANAGER — TEXT + KEYBOARD (HTML VERSION)
// ══════════════════════════════════════════════

function apiUrlManagerTextHtml() {
  let text = "🔗 <b>API URL MANAGER</b>\n";
  text += "━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
  for (const k of API_KEYS) {
    const url = apiUrls[k] || DEFAULT_API_URLS[k];
    const isDefault = url === DEFAULT_API_URLS[k];
    const cfg = apiResponseConfig[k] || "raw";
    const cfgLabel = cfg === "raw" ? "🟢 Default Format" : `🔵 Custom Field: <code>${escHtml(cfg.replace("field:", ""))}</code>`;
    text += `<b>${escHtml(API_LABELS[k])}</b>\n`;
    text += `Status: ${isDefault ? "🟢 Default URL" : "🔵 Custom URL"}\n`;
    text += `Response: ${cfgLabel}\n`;
    const shortUrl = url.length > 50 ? url.slice(0, 50) + "..." : url;
    text += `URL: <code>${escHtml(shortUrl)}</code>\n\n`;
  }
  text += "<i>✏️ = URL change  |  🔄 = Default reset</i>";
  return text;
}

function apiUrlManagerKb() {
  const rows = API_KEYS.map(k => [
    { text: `✏️ ${API_LABELS[k]}`, callback_data: `apiurl_edit_${k}` },
    { text: "🔄 Reset", callback_data: `apiurl_reset_${k}` },
  ]);
  rows.push([{ text: "🔙 Back", callback_data: "menu_adminpanel" }]);
  return { inline_keyboard: rows };
}

// ══════════════════════════════════════════════
//  CHANNEL MANAGER
// ══════════════════════════════════════════════

function channelManagerText() {
  let text = "╔══════════════════════════╗\n║  📢  CHANNEL MANAGER     ║\n╠══════════════════════════╣\n\n";
  if (!CHANNELS.length) {
    text += "❌  Koi channel nahi hai abhi.\n\n";
  } else {
    CHANNELS.forEach((ch, i) => {
      const type = ch.username ? "🌐 Public" : "🔒 Private";
      const ref  = ch.username ? `@${ch.username}` : `ID: ${ch.id}`;
      text += `${i + 1}\\. ${escMd(ch.name)}\n`;
      text += `   ${type} \\| ${escMd(ref)}\n`;
      if (ch.invite_link) text += `   🔗 Invite link set ✅\n`;
      text += "\n";
    });
  }
  text += "🗑️ = Remove  \\|  ➕ = Naya Add\n╚══════════════════════════╝";
  return text;
}

function channelManagerKb() {
  const rows = CHANNELS.map((ch, i) => {
    const label = ch.username ? `@${ch.username}` : `ID:${ch.id}`;
    return [{ text: `🗑️ Remove — ${ch.name} (${label})`, callback_data: `ch_del_${i}` }];
  });
  rows.push([{ text: "➕ Channel Add Karo", callback_data: "ch_add" }]);
  rows.push([{ text: "🔙 Back", callback_data: "menu_adminpanel" }]);
  return { inline_keyboard: rows };
}

// ── API MANAGER ───────────────────────────────
function apiManagerKb() {
  const rows = API_KEYS.map(k => {
    const api = apiToggle[k];
    const st  = api.enabled ? "🟢 ON" : "🔴 OFF";
    return [
      { text: `${st}  ${api.label}`, callback_data: `api_tog_${k}` },
      { text: "✏️ Msg", callback_data: `api_msg_${k}` },
    ];
  });
  rows.push([{ text: "🔙 Back", callback_data: "menu_adminpanel" }]);
  return { inline_keyboard: rows };
}

function apiManagerText() {
  let text = "╔══════════════════════════╗\n║  🔌  API MANAGER          ║\n╠══════════════════════════╣\n\n";
  for (const k of API_KEYS) {
    const api = apiToggle[k];
    const st  = api.enabled ? "🟢 ON " : "🔴 OFF";
    text += `${st}  ${api.label}\n`;
    if (!api.enabled) text += `       💬 "${api.offMsg.slice(0,40)}..."\n`;
    text += "\n";
  }
  text += "Toggle = ON/OFF  |  ✏️ = Custom off msg\n╚══════════════════════════╝";
  return text;
}

// ══════════════════════════════════════════════
//  FORMAT HELPERS
// ══════════════════════════════════════════════

function extractRecords(data) {
  const records = [];
  try {
    const results = (data && typeof data === "object" && !Array.isArray(data)) ? (data.result || []) : (data || []);
    for (const r of (Array.isArray(results) ? results : [])) {
      records.push({
        name:    (r.name    || "N/A").trim(),
        fname:   (r.fname   || "N/A").trim(),
        address: (r.address || "N/A").trim(),
        circle:  (r.circle  || "N/A").trim(),
        alt:     String(r.alt    || "N/A"),
        aadhar:  String(r.aadhar || "N/A"),
        email:   (r.email   || "N/A"),
      });
    }
  } catch (e) { console.error("[extractRecords]", e.message); }
  return records;
}

// ── FIXED formatNumResult ──
function formatNumResult(records, number) {
  const colors = ["🔴","🟠","🟡","🟢","🔵"];
  let out =
    `┌─────────────────────────┐\n│  📞  NUMBER INFO         │\n├─────────────────────────┤\n` +
    `📱  Number  : ${escMd(number)}\n📊  Records : ${Math.min(records.length,5)} found\n\n`;
  records.slice(0,5).forEach((r,i) => {
    const dot = colors[i % colors.length];
    out +=
      `${dot}━━━ RECORD ${i+1} ━━━${dot}\n` +
      `${cbMd("👤 Name   ",r.name)}\n${cbMd("👨 Father ",r.fname)}\n` +
      `${cbMd("📍 Address",r.address)}\n${cbMd("📡 Circle ",r.circle)}\n` +
      `${cbMd("☎️  Alt Num",r.alt)}\n${cbMd("🪪 Aadhar ",r.aadhar)}\n` +
      `${cbMd("✉️  Email  ",r.email)}\n\n`;
  });
  out += `└─────────────────────────┘\n👑  ${escMd(OWNER)}  \\|  ⚡ ACTIVE`;
  return out;
}

// ── FIXED parseDeepApiResponse ──
function parseDeepApiResponse(data) {
  try {
    if (!data || !data.status || !data.data) return null;
    
    const records = [];
    const sources = data.data || {};
    
    // Process source1 records
    if (sources.source1 && Array.isArray(sources.source1.records)) {
      for (const item of sources.source1.records) {
        // Collect all phone numbers
        const phones = [];
        for (let i = 1; i <= 10; i++) {
          const phone = item[`Phone${i}`];
          if (phone) phones.push(String(phone).trim());
        }
        if (item.Phone) phones.push(String(item.Phone).trim());
        
        // Remove duplicates and filter
        const uniquePhones = [...new Set(phones)].filter(p => p && p.length > 5);
        
        records.push({
          name:    String(item.FullName || item.Name || "").trim(),
          fname:   String(item.FatherName || "").trim(),
          address: String(item.Adres || item.Adres2 || item.Adres3 || "").trim(),
          circle:  String(item.Region || "").trim(),
          alt:     uniquePhones.length > 0 ? uniquePhones.join(", ") : "N/A",
          aadhar:  String(item.DocumentNumber || "").trim(),
          email:   String(item.Email || "").trim(),
          age:     String(item.Age || "").trim(),
          gender:  String(item.Gender || "").trim(),
          dob:     String(item.DateOfBirth || "").trim(),
          education: String(item.Education || "").trim(),
          lastActivity: String(item.LastActivity || "").trim(),
          registrationDate: String(item.RegistrationDate || "").trim(),
          source: "source1"
        });
      }
    }
    
    // Process source2 records
    if (sources.source2 && Array.isArray(sources.source2.records)) {
      for (const item of sources.source2.records) {
        const phones = [];
        if (item.Phone) phones.push(String(item.Phone).trim());
        const uniquePhones = [...new Set(phones)].filter(p => p && p.length > 5);
        
        records.push({
          name:    String(item.Name || "").trim(),
          fname:   "N/A",
          address: "N/A",
          circle:  "N/A",
          alt:     uniquePhones.length > 0 ? uniquePhones.join(", ") : "N/A",
          aadhar:  "N/A",
          email:   "N/A",
          age:     String(item.Age || "").trim(),
          gender:  String(item.Gender || "").trim(),
          dob:     String(item.DateOfBirth || "").trim(),
          education: String(item.Education || "").trim(),
          lastActivity: String(item.LastActivity || "").trim(),
          registrationDate: String(item.RegistrationDate || "").trim(),
          source: "source2"
        });
      }
    }
    
    return records.length ? records : null;
  } catch (e) { 
    console.error("[parseDeepApiResponse]", e.message); 
    return null; 
  }
}

// ── FIXED formatDeepResult ──
function formatDeepResult(records, queryNumber) {
  if (!records || !records.length) return null;
  const colors = ["🔴","🟠","🟡","🟢","🔵","🟣"];
  let text =
    `\n\n🔬━━━━━━━━━━━━━━━━━━━━━🔬\n` +
    `│  🕵️  D E E P   I N T E L   │\n` +
    `🔬━━━━━━━━━━━━━━━━━━━━━🔬\n` +
    `🔢  Query : ${escMd(queryNumber)}\n\n`;
  
  records.forEach((rec, i) => {
    const dot = colors[i % colors.length];
    text += `${dot}━━━ RECORD ${i+1} ━━━${dot}\n`;
    if (rec.name)    text += `${cbMd("👤 Name   ", rec.name)}\n`;
    if (rec.fname && rec.fname !== "N/A")   text += `${cbMd("👨 Father ", rec.fname)}\n`;
    if (rec.alt && rec.alt !== "N/A")     text += `${cbMd("☎️  Alt Num", rec.alt)}\n`;
    if (rec.address && rec.address !== "N/A") text += `${cbMd("📍 Address", rec.address)}\n`;
    if (rec.circle && rec.circle !== "N/A")  text += `${cbMd("📡 Circle ", rec.circle)}\n`;
    if (rec.aadhar && rec.aadhar !== "N/A")  text += `${cbMd("🪪 Aadhar ", rec.aadhar)}\n`;
    if (rec.age && rec.age !== "N/A")    text += `${cbMd("🎂 Age    ", rec.age)}\n`;
    if (rec.gender && rec.gender !== "N/A") text += `${cbMd("⚧ Gender ", rec.gender)}\n`;
    if (rec.dob && rec.dob !== "N/A")    text += `${cbMd("📅 DOB    ", rec.dob)}\n`;
    if (rec.education && rec.education !== "N/A") text += `${cbMd("🎓 Education", rec.education)}\n`;
    if (rec.lastActivity && rec.lastActivity !== "N/A") text += `${cbMd("🕐 Last Activity", rec.lastActivity)}\n`;
    if (rec.registrationDate && rec.registrationDate !== "N/A") text += `${cbMd("📋 Registered", rec.registrationDate)}\n`;
    text += "\n";
  });
  text += `👑  ${escMd(OWNER)}  \\|  ⚡ DEEP INTEL`;
  return text;
}

// ── FIXED formatAdharResult ──
function formatAdharResult(data, adharNumber) {
  try {
    if (!data || !data[0]) return null;
    
    // Skip developer field and get all records
    const records = [];
    for (const key of Object.keys(data)) {
      if (key === "developer" || key === "timestamp" || key === "owner" || key === "credit") continue;
      const item = data[key];
      if (item && typeof item === "object" && item.aadhar) {
        records.push(item);
      }
    }
    
    if (!records.length) return null;
    
    let out =
      `┌─────────────────────────┐\n│  🪪  AADHAAR INTEL       │\n├─────────────────────────┤\n` +
      `🔢  Aadhaar : ${escMd(adharNumber)}\n📊  Records : ${records.length} found\n\n`;
    
    const colors = ["🔴","🟠","🟡","🟢","🔵","🟣"];
    records.forEach((rec, i) => {
      const dot = colors[i % colors.length];
      out += `${dot}━━━ RECORD ${i+1} ━━━${dot}\n`;
      if (rec.name)    out += `${cbMd("👤 Name   ", rec.name)}\n`;
      if (rec.fname)   out += `${cbMd("👨 Father ", rec.fname)}\n`;
      if (rec.num)     out += `${cbMd("📞 Number ", rec.num)}\n`;
      if (rec.alt)     out += `${cbMd("☎️  Alt Num", rec.alt)}\n`;
      if (rec.address) out += `${cbMd("📍 Address", rec.address)}\n`;
      if (rec.circle)  out += `${cbMd("📡 Circle ", rec.circle)}\n`;
      if (rec.email && rec.email !== "null")   out += `${cbMd("✉️  Email  ", rec.email)}\n`;
      out += "\n";
    });
    
    out += `└─────────────────────────┘\n👑  ${escMd(OWNER)}  \\|  ⚡ ACTIVE`;
    return out;
  } catch (e) { 
    console.error("[formatAdhar]", e.message); 
    return null; 
  }
}

function formatUpiResult(data, upiId) {
  const val = v => { const s = String(v||"").trim(); return s && !["None","null","nan","false","False",""].includes(s) ? s : null; };
  const tick = v => v ? "✅" : "❌";
  const name = val(data.name); const username = val(data.username); const valid = data.valid;
  const accType = val(data.account_type); const isMerchant = data.merchant; const merchantVer = data.merchant_verified;
  const bank = val(data.bank); const bankType = val(data.bank_type); const ifsc = val(data.ifsc);
  const ifscD = data.ifsc_details || {};
  const branch = val(ifscD.BRANCH); const address = val(ifscD.ADDRESS); const city = val(ifscD.CITY);
  const district = val(ifscD.DISTRICT); const state = val(ifscD.STATE); const contact = val(ifscD.CONTACT);
  const rtgs = ifscD.RTGS; const neft = ifscD.NEFT; const imps = ifscD.IMPS; const upiSup = ifscD.UPI;
  let lines = ["┌─────────────────────────┐","│  💳  UPI LOOKUP          │","├─────────────────────────┤", cbMd("💳 UPI ID      ",upiId)];
  if (name)     lines.push(cbMd("👤 Name        ",name));
  if (username) lines.push(cbMd("🔖 Username    ",username));
  lines.push(`✅ Valid        : ${valid ? "✅ YES" : "❌ NO"}`);
  if (accType)  lines.push(cbMd("🏦 Account Type",accType));
  if (bank)     lines.push(cbMd("🏛️  Bank        ",bank));
  if (bankType) lines.push(cbMd("📂 Bank Type   ",bankType));
  if (ifsc)     lines.push(cbMd("🔢 IFSC        ",ifsc));
  if (isMerchant  != null) lines.push(`🏪 Merchant    : ${tick(isMerchant)}`);
  if (merchantVer != null) lines.push(`✔️  Merch\\.Verif : ${tick(merchantVer)}`);
  if ([branch,address,city,district,state,contact].some(Boolean)) {
    lines.push("├─────────────────────────┤","│  🏦  IFSC DETAILS        │","├─────────────────────────┤");
    if (branch)   lines.push(cbMd("🏢 Branch      ",branch));
    if (address)  lines.push(cbMd("📍 Address     ",address));
    if (city)     lines.push(cbMd("🏙️  City        ",city));
    if (district) lines.push(cbMd("📍 District    ",district));
    if (state)    lines.push(cbMd("🗺️  State       ",state));
    if (contact)  lines.push(cbMd("📞 Contact     ",contact));
  }
  if ([rtgs,neft,imps,upiSup].some(v => v != null)) {
    lines.push("├─────────────────────────┤","│  💸  PAYMENT MODES       │","├─────────────────────────┤");
    if (rtgs   != null) lines.push(`⚡ RTGS        : ${tick(rtgs)}`);
    if (neft   != null) lines.push(`🔄 NEFT        : ${tick(neft)}`);
    if (imps   != null) lines.push(`📲 IMPS        : ${tick(imps)}`);
    if (upiSup != null) lines.push(`💳 UPI         : ${tick(upiSup)}`);
  }
  lines.push("└─────────────────────────┘", `👑  ${escMd(OWNER)}  \\|  ⚡ ACTIVE`);
  return lines.join("\n");
}

function formatVehicleResult(data) {
  const v = val => {
    const s = String(val||"").trim();
    return s && !["None","null","","nan","0","false","False","Not Available","undefined"].includes(s) ? s : null;
  };
  const tick = val => val ? "✅" : "❌";
  const vd         = (typeof data.vehicle_data === "object" && data.vehicle_data) || {};
  const rtoData    = (typeof vd.rtoData === "object" && vd.rtoData) || {};
  const regNo      = v(data.vehicle_number) || v(vd.regNo);
  const engNum     = v(data.engine_number)  || v(vd.engine);
  const chassisNum = v(data.chassis_number) || v(vd.chassis);
  const mobile     = v(data.mobile_number);
  const last5      = v(data.last_5_chassis);
  const rtoName    = v(rtoData.rtoName);
  const rtoCode    = v(rtoData.rtoCode) || v(vd.rtoCode);
  const stateName  = v(rtoData.statename);
  const regAuth    = v(vd.regAuthority);
  const regDate    = v(vd.regDate);
  const owner      = v(vd.owner);
  const fatherName = v(vd.ownerFatherName);
  const pincode    = v(vd.pincode);
  const address    = v(vd.presentAddress) || v(vd.permAddress);
  const mfr        = v(vd.manufacturer);
  const model      = v(vd.vehicle);
  const variant    = v(vd.variant);
  const fuelType   = v(vd.fuelType);
  const vehClass   = v(vd.vehicleClass);
  const vehType    = v(vd.vehicleType);
  const mfrYear    = v(vd.manufacturerYear);
  const cc         = v(vd.cubicCapacity);
  const seats      = v(vd.seatCapacity);
  const isComm     = vd.isCommercial;
  const financer   = v(vd.financerName);
  const insComp    = v(vd.insuranceCompanyName);
  const insPolicy  = v(vd.insurancePolicyNumber);
  const insUpto    = v(vd.insuranceUpto);
  const insExpired = vd.insuranceExpired;
  const puccValid  = v(vd.puccValidUpto);
  const puccNo     = v(vd.puccNumber);
  const vehicleAge = v(vd.vehicleAge);
  const status     = v(vd.statusDesc) || v(vd.status);
  const transKey   = v(vd.transKey);
  const eDate      = v(vd.eDate);
  const lmDate     = v(vd.lmDate);
  const lines = ["┌────────────────────────────┐","│  🚗  VEHICLE INFO           │","└────────────────────────────┘","🔷━━━ REGISTRATION ━━━🔷"];
  if (regNo)   lines.push(`🚘  Reg No       : ${escMd(regNo)}`);
  if (regAuth) lines.push(`🏛️   Reg Auth     : ${escMd(regAuth)}`);
  if (regDate) lines.push(`📅  Reg Date     : ${escMd(regDate)}`);
  if (rtoCode) lines.push(`🗂️   RTO Code     : ${escMd(rtoCode)}`);
  if (rtoName) lines.push(`🏢  RTO Name     : ${escMd(rtoName)}`);
  if (stateName) lines.push(`🗺️   State        : ${escMd(stateName)}`);
  if ([owner, fatherName, mobile, address, pincode].some(Boolean)) {
    lines.push("\n🔶━━━ OWNER DETAILS ━━━🔶");
    if (owner)      lines.push(`👤  Owner        : ${escMd(owner)}`);
    if (fatherName) lines.push(`👨  Father       : ${escMd(fatherName)}`);
    if (mobile)     lines.push(`📞  Mobile       : ${escMd(mobile)}`);
    if (address)    lines.push(`📍  Address      : ${escMd(address)}`);
    if (pincode)    lines.push(`📮  Pincode      : ${escMd(pincode)}`);
  }
  if ([mfr, model, variant, fuelType, vehClass, cc, seats, mfrYear, vehicleAge].some(Boolean)) {
    lines.push("\n🟢━━━ VEHICLE SPECS ━━━🟢");
    if (mfr)      lines.push(`🏭  Manufacturer : ${escMd(mfr)}`);
    if (model)    lines.push(`🚗  Model        : ${escMd(model)}`);
    if (variant)  lines.push(`⚙️   Variant      : ${escMd(variant)}`);
    if (fuelType) lines.push(`⛽  Fuel Type    : ${escMd(fuelType)}`);
    if (vehClass) lines.push(`📋  Class        : ${escMd(vehClass)}`);
    if (vehType)  lines.push(`🔖  Type         : ${escMd(vehType)}`);
    if (mfrYear)  lines.push(`📆  Mfr Year     : ${escMd(mfrYear)}`);
    if (vehicleAge) lines.push(`⏳  Vehicle Age  : ${escMd(vehicleAge)}`);
    if (cc)       lines.push(`🔩  Cubic Cap    : ${escMd(cc)} cc`);
    if (seats)    lines.push(`💺  Seats        : ${escMd(String(seats))}`);
    if (isComm != null) lines.push(`🏪  Commercial   : ${tick(isComm)}`);
  }
  if ([engNum, chassisNum, last5].some(Boolean)) {
    lines.push("\n🔵━━━ TECHNICAL ━━━🔵");
    if (engNum)     lines.push(`🔧  Engine No    : ${escMd(engNum)}`);
    if (chassisNum) lines.push(`🔩  Chassis No   : ${escMd(chassisNum)}`);
    if (last5)      lines.push(`🔢  Last 5 Chass : ${escMd(last5)}`);
  }
  if ([financer, insComp, insPolicy, insUpto, puccValid, puccNo].some(Boolean)) {
    lines.push("\n🟣━━━ FINANCE & INSURANCE ━━━🟣");
    if (financer)  lines.push(`💰  Financer     : ${escMd(financer)}`);
    if (insComp)   lines.push(`🛡️   Insurance    : ${escMd(insComp)}`);
    if (insPolicy) lines.push(`📄  Policy No    : ${escMd(insPolicy)}`);
    if (insUpto)   lines.push(`📅  Ins Upto     : ${escMd(insUpto)}${insExpired ? " ❌ EXPIRED" : " ✅ VALID"}`);
    if (puccValid) lines.push(`🌿  PUCC Valid   : ${escMd(puccValid)}`);
    if (puccNo)    lines.push(`📋  PUCC No      : ${escMd(puccNo)}`);
  }
  if (status || transKey || eDate || lmDate) {
    lines.push("\n📌━━━ ADDITIONAL INFO ━━━📌");
    if (status)    lines.push(`📊  Status       : ${escMd(status)}`);
    if (transKey)  lines.push(`🔑  Trans Key    : ${escMd(transKey)}`);
    if (eDate)     lines.push(`📅  Entry Date   : ${escMd(eDate)}`);
    if (lmDate)    lines.push(`🔄  Last Modified: ${escMd(lmDate)}`);
  }
  lines.push(`\n┌────────────────────────────┐`, `│  👑 ${escMd(OWNER)}  \\|  ⚡ ACTIVE  │`, `└────────────────────────────┘`);
  return lines.join("\n");
}

// ══════════════════════════════════════════════
//  CUSTOM RESPONSE FORMATTER
// ══════════════════════════════════════════════
function applyResponseConfig(key, rawData, query) {
  const cfg = apiResponseConfig[key] || "raw";
  if (cfg === "raw") return null;
  if (cfg.startsWith("field:")) {
    const fieldName = cfg.replace("field:", "");
    let value = null;
    if (rawData && typeof rawData === "object") {
      const parts = fieldName.split(".");
      let cur = rawData;
      for (const p of parts) {
        if (cur && typeof cur === "object") cur = cur[p];
        else { cur = null; break; }
      }
      if (cur != null) {
        if (typeof cur === "object") {
          value = JSON.stringify(cur, null, 2);
        } else {
          value = String(cur).trim();
        }
      }
    } else if (typeof rawData === "string") {
      value = rawData.trim();
    }
    if (!value || ["null","undefined","None","N/A",""].includes(value)) {
      return null;
    }
    const isJson = value.startsWith("{") || value.startsWith("[");
    let resultText;
    if (isJson) {
      resultText = `\`\`\`json\n${value}\n\`\`\``;
    } else {
      resultText = `${escMd(value)}`;
    }
    return (
      `┌─────────────────────────┐\n│  📋  RESULT              │\n├─────────────────────────┤\n` +
      `🔍  Query  : ${escMd(query)}\n` +
      `📄  Result :\n${resultText}\n` +
      `└─────────────────────────┘\n` +
      `👑  ${escMd(OWNER)}  \\|  ⚡ ACTIVE`
    );
  }
  return null;
}

// ── DB BACKUP ─────────────────────────────────
async function sendDbBackup(chatId) {
  if (!usersCol) { await sendPlain(chatId, "❌  MongoDB connected nahi hai."); return; }
  const statusMsg = await sendPlain(chatId, "🗄️  Database se data fetch ho raha hai...");
  try {
    const allUsers = await dbGetAllUsers();
    const total    = allUsers.length;
    if (!total) { await tgApi("editMessageText", { chat_id: chatId, message_id: statusMsg.message_id, text: "📭  Database empty hai." }); return; }
    const now    = new Date().toISOString().slice(0,16).replace("T"," ");
    const sorted = [...allUsers].sort((a,b) => (b.total_searches || 0) - (a.total_searches || 0));
    const totalSearches = allUsers.reduce((s,u) => s + (u.total_searches||0), 0);
    const lines = [
      "╔════════════════════════════════╗",
      "║  🗄️  DATABASE BACKUP REPORT     ║",
      "╠════════════════════════════════╣",
      `📊  Total Users    : ${total}`,
      `🔍  Total Searches : ${totalSearches}`,
      `🕐  Generated      : ${now} UTC`,
      "╠════════════════════════════════╣",
    ];
    if (sorted[0]) lines.push(`🏆  Top Searcher: ${sorted[0].name || sorted[0].username || sorted[0].user_id} — ${sorted[0].total_searches||0} searches`);
    lines.push("────────────────────────────────");
    sorted.forEach((u, i) => {
      lines.push(`${i+1}. ${u.name || "no name"} | ${u.username ? "@"+u.username : "no username"} | ID: ${u.user_id || "N/A"} | 🔍 ${u.total_searches||0} | 🪙 ${u.coins||0}`);
      lines.push(`   📅 First: ${(u.first_seen || "").slice(0,10) || "N/A"}  |  Last: ${(u.last_seen || "").slice(0,10) || "N/A"}`);
    });
    lines.push("╚════════════════════════════════╝");
    const fullText = lines.join("\n");
    if (fullText.length > 4000) {
      const buf  = Buffer.from(fullText, "utf8");
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("caption", `🗄️ RTF Bot DB — ${total} users | 🔍 ${totalSearches} searches | ${now} UTC`);
      form.append("document", buf, { filename: `rtfbot_${new Date().toISOString().slice(0,10)}.txt`, contentType: "text/plain" });
      await fetch(`${TG_BASE}/sendDocument`, { method: "POST", body: form, ...agentForTelegram(TG_BASE) });
      deleteMessage(chatId, statusMsg.message_id);
    } else {
      await tgApi("editMessageText", { chat_id: chatId, message_id: statusMsg.message_id, text: fullText });
    }
  } catch (e) {
    console.error("[DB BACKUP]", e);
    tgApi("editMessageText", { chat_id: chatId, message_id: statusMsg.message_id, text: `❌  Backup failed: ${e.message}` });
  }
}

// ── ENHANCED API FETCH ──────────────────────
async function apiFetch(url, timeout = 25000) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      ...agentForExternal(url),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "close"
      }
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    console.error(`[apiFetch] Error fetching ${url}:`, e.message);
    throw e;
  }
}

function buildUrl(key, query) {
  return (apiUrls[key] || DEFAULT_API_URLS[key]).replace("{query}", encodeURIComponent(query));
}

// ── API WRAPPERS ─────────────────────────────
async function fetchNumApi(cleanPhone) {
  if (!apiToggle.num.enabled) return [];
  try {
    const data = await apiFetch(buildUrl("num", cleanPhone));
    return extractRecords(data);
  } catch (e) { console.error("[NUM API]", e.message); return []; }
}

// ── UPDATED fetchDeepApi with 91 handling ──
async function fetchDeepApi(number) {
  if (!apiToggle.deep.enabled) return null;
  let clean = String(number).replace(/[+\s]/g, "").replace(/^\+91/, "");
  if (!clean.startsWith("91")) {
    clean = "91" + clean;
  }
  console.log(`[DEEP API] Querying: ${clean}`);
  try {
    const data = await apiFetch(buildUrl("deep", clean), 30000);
    return data || null;
  } catch (e) { console.error("[DEEP API]", e.message); return null; }
}

async function fetchTgApi(term) {
  try {
    const data = await apiFetch(buildUrl("tg", term), 30000);
    if (!data || data.success === false) return null;
    const phone = data.number ? String(data.number).trim() : null;
    if (!phone || ["","N/A","null","None","undefined","0"].includes(phone)) return null;
    return {
      tgId:        String(data.tg_id        || "N/A").trim(),
      phone:       phone,
      country:     String(data.country      || "N/A").trim(),
      countryCode: String(data.country_code || "N/A").trim(),
    };
  } catch (e) { console.error("[TG API]", e.message); return null; }
}

// ══════════════════════════════════════════════
//  LOOKUP HANDLERS
// ══════════════════════════════════════════════

async function handleNumber(chatId, number, userMsgId = null, userId = null) {
  const numKey = number.trim().replace(/[+\s]/g,"").replace(/^91/,"");
  if (customNumData.has(numKey)) {
    if (userId) dbIncrSearch(userId);
    await sendDataFound(chatId, userMsgId, customNumData.get(numKey));
    return;
  }
  if (!apiToggle.num.enabled && !apiToggle.deep.enabled) {
    await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ⚠️  API OFFLINE   ║\n╚══════════════════╝\n${apiToggle.num.offMsg}`);
    return;
  }
  const statusMsg = await sendPlain(chatId, `🔍  Searching: ${number} ...`);
  try {
    let clean = number.trim().replace(/\s/g,"").replace("+91","");
    if (clean.startsWith("91") && clean.length > 10) clean = clean.slice(2);

    const [records, deepApiRaw] = await Promise.all([
      fetchNumApi(clean),
      fetchDeepApi(clean),
    ]);
    deleteMessage(chatId, statusMsg.message_id);

    const deepRecords = parseDeepApiResponse(deepApiRaw);
    const deepFmt     = formatDeepResult(deepRecords, clean);

    if (!records.length && !deepFmt) {
      await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n📱  Number: ${clean}\n⚠️  Koi record nahi mila`);
      return;
    }
    if (userId) dbIncrSearch(userId);
    let full = "";
    if (records.length && apiToggle.num.enabled) {
      const customFmt = applyResponseConfig("num", { result: records }, clean);
      full += customFmt || formatNumResult(records, clean);
    }
    if (deepFmt) full += deepFmt;
    await sendDataFound(chatId, userMsgId, full);
  } catch (e) {
    console.error("[NUM LOOKUP]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  API Error / Timeout.");
  }
}

async function handleTg(chatId, term, userMsgId = null, userId = null) {
  const rawInput = term.trim();
  term = rawInput.replace(/^@/, "");
  if (!term) {
    await sendDataNotFound(chatId, userMsgId, "❌  Kuch toh bhejo!\n✅ /tg rtfgamming\n✅ /tg 8518042438");
    return;
  }
  const termKey = term.toLowerCase();
  if (customTgData.has(termKey)) {
    if (userId) dbIncrSearch(userId);
    await sendDataFound(chatId, userMsgId, customTgData.get(termKey));
    return;
  }
  if (!apiToggle.tg.enabled) {
    await sendDataNotFound(chatId, userMsgId,
      `╔══════════════════════╗\n║  ⚠️  API OFFLINE      ║\n╠══════════════════════╣\n${apiToggle.tg.offMsg}\n╚══════════════════════╝`
    );
    return;
  }
  const statusMsg = await sendPlain(chatId, `🔍  Searching TG: ${term} ...`);
  try {
    const rawData = await apiFetch(buildUrl("tg", term), 30000);
    deleteMessage(chatId, statusMsg.message_id);

    const customFmt = applyResponseConfig("tg", rawData, term);
    if (customFmt) {
      if (userId) dbIncrSearch(userId);
      await sendDataFound(chatId, userMsgId, customFmt);
      return;
    }

    let tgId = null, phone = null, country = null, countryCode = null;
    if (rawData && rawData.result && typeof rawData.result === "object") {
      const res = rawData.result;
      tgId = String(res.tg_id || res.id || "").trim();
      phone = String(res.number || res.phone || "").trim();
      country = String(res.country || "").trim();
      countryCode = String(res.country_code || "").trim();
    } else {
      tgId = String(rawData.id || rawData.tg_id || "").trim();
      phone = String(rawData.number || rawData.phone || "").trim();
      country = String(rawData.country || "").trim();
      countryCode = String(rawData.country_code || "").trim();
    }

    if (!phone && !tgId) {
      await sendDataNotFound(chatId, userMsgId,
        `╔══════════════════════╗\n║  ❌ DATA NOT FOUND    ║\n╠══════════════════════╣\n🔎  Input : ${term}\n⚠️  Koi information nahi mili\n╚══════════════════════╝`
      );
      return;
    }

    if (userId) dbIncrSearch(userId);

    const isUserId = /^\d{5,}$/.test(term);
    let tgBlock =
      `┌─────────────────────────┐\n│  🔎  TG LOOKUP           │\n├─────────────────────────┤\n`;
    if (!isUserId) {
      const displayUsername = rawInput.startsWith("@") ? rawInput : `@${term}`;
      tgBlock += `${cbMd("💻 Username    ", displayUsername)}\n`;
    }
    tgBlock +=
      `${cbMd("🆔 Telegram ID ", tgId || "N/A")}\n` +
      `${cbMd("📞 Number      ", phone || "N/A")}\n` +
      `${cbMd("🌍 Country     ", country || "N/A")}\n` +
      `${cbMd("📱 Country Code", countryCode || "N/A")}\n` +
      `└─────────────────────────┘\n`;

    if (phone && !["N/A",""].includes(phone)) {
      let cleanPhone = phone.replace(/[+\s]/g, "").replace(/^91/, "");
      if (cleanPhone.length > 10) cleanPhone = cleanPhone.slice(-10);
      if (cleanPhone.length >= 10) {
        const [numRes, deepApiRaw] = await Promise.all([
          fetchNumApi(cleanPhone),
          fetchDeepApi(cleanPhone),
        ]);
        if (numRes.length && apiToggle.num.enabled) {
          tgBlock += "\n" + formatNumResult(numRes, cleanPhone);
        }
        const deepRecords = parseDeepApiResponse(deepApiRaw);
        const df = formatDeepResult(deepRecords, cleanPhone);
        if (df) tgBlock += df;
      }
    }
    await sendDataFound(chatId, userMsgId, tgBlock);
  } catch (e) {
    console.error("[TG LOOKUP]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  Kuch gadbad ho gayi.");
  }
}

// ── UPDATED handleAdhar ──
async function handleAdhar(chatId, adharRaw, userMsgId = null, userId = null) {
  if (!apiToggle.adhar.enabled) {
    await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ⚠️  API OFFLINE   ║\n╚══════════════════╝\n${apiToggle.adhar.offMsg}`);
    return;
  }
  const statusMsg = await sendPlain(chatId, `🔍  Searching Aadhaar: ${adharRaw} ...`);
  try {
    const data = await apiFetch(buildUrl("adhar", adharRaw.trim()), 30000);
    deleteMessage(chatId, statusMsg.message_id);

    const customFmt = applyResponseConfig("adhar", data, adharRaw);
    if (customFmt) {
      if (userId) dbIncrSearch(userId);
      await sendDataFound(chatId, userMsgId, customFmt);
      return;
    }

    if (!data || !data[0]) {
      await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n🪪  Aadhaar: ${adharRaw}`);
      return;
    }
    const formatted = formatAdharResult(data, adharRaw);
    if (!formatted) { await sendDataNotFound(chatId, userMsgId, `❌  Data format error — Aadhaar: ${adharRaw}`); return; }
    if (userId) dbIncrSearch(userId);
    await sendDataFound(chatId, userMsgId, formatted);
  } catch (e) {
    console.error("[ADHAR]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  API Error / Timeout.");
  }
}

async function handleUpi(chatId, upiId, userMsgId = null, userId = null) {
  if (!apiToggle.upi.enabled) { await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ⚠️  API OFFLINE   ║\n╚══════════════════╝\n${apiToggle.upi.offMsg}`); return; }
  const statusMsg = await sendPlain(chatId, `🔍  Searching UPI: ${upiId} ...`);
  try {
    const data = await apiFetch(buildUrl("upi", upiId.trim()));
    deleteMessage(chatId, statusMsg.message_id);

    const customFmt = applyResponseConfig("upi", data, upiId);
    if (customFmt) {
      if (userId) dbIncrSearch(userId);
      await sendDataFound(chatId, userMsgId, customFmt);
      return;
    }

    if (!data || !data.success) { await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ❌ UPI NOT FOUND   ║\n╚══════════════════╝\n💳  UPI: ${upiId}`); return; }
    if (userId) dbIncrSearch(userId);
    await sendDataFound(chatId, userMsgId, formatUpiResult(data, upiId));
  } catch (e) { console.error("[UPI]", e.message); deleteMessage(chatId, statusMsg.message_id); await sendPlain(chatId, "❌  API Error / Timeout."); }
}

async function handleVehicle(chatId, vehicleNo, userMsgId = null, userId = null) {
  if (!apiToggle.vehicle.enabled) { await sendDataNotFound(chatId, userMsgId, `╔══════════════════════╗\n║  ⚠️  API OFFLINE       ║\n╚══════════════════════╝\n${apiToggle.vehicle.offMsg}`); return; }
  vehicleNo = vehicleNo.trim().toUpperCase().replace(/\s/g,"");
  const statusMsg = await sendPlain(chatId, `🔍  Searching Vehicle: ${vehicleNo} ...`);
  try {
    const data = await apiFetch(buildUrl("vehicle", vehicleNo), 25000);
    deleteMessage(chatId, statusMsg.message_id);

    const customFmt = applyResponseConfig("vehicle", data, vehicleNo);
    if (customFmt) {
      if (userId) dbIncrSearch(userId);
      await sendDataFound(chatId, userMsgId, customFmt);
      return;
    }

    if (!data || !data.success) {
      await sendDataNotFound(chatId, userMsgId, `╔══════════════════════╗\n║  ❌ VEHICLE NOT FOUND  ║\n╚══════════════════════╝\n🚗  Vehicle: ${vehicleNo}`);
      return;
    }
    if (userId) dbIncrSearch(userId);
    await sendDataFound(chatId, userMsgId, formatVehicleResult(data));
  } catch (e) { console.error("[VEHICLE]", e.message); deleteMessage(chatId, statusMsg.message_id); await sendPlain(chatId, "❌  API Error / Timeout."); }
}

// ══════════════════════════════════════════════
//  COIN & REFERRAL HANDLERS
// ══════════════════════════════════════════════

async function handleCoins(chatId, userId) {
  const coins = await getUserCoins(userId);
  await sendPlain(chatId,
    `╔══════════════════════════╗\n║  💰  YOUR COINS          ║\n╠══════════════════════════╣\n` +
    `🪙  Total Coins : ${coins}\n\n` +
    `📝  Use /request <type> <query> to request data\n` +
    `   Types: num, tg, adhar, upi, vehicle\n` +
    `   Cost: 5 coins per request\n\n` +
    `🔗  Use /refer to get your referral link\n` +
    `   Each referral = 1 coin\n` +
    `   (Max 2 referrals per minute)\n` +
    `╚══════════════════════════╝`
  );
}

async function handleRefer(chatId, from) {
  const userId = from.id;
  const botUsername = (await tgApiGet("getMe"))?.username || "RTF_Bot";
  const link = `https://t.me/${botUsername}?start=ref_${userId}`;
  const coins = await getUserCoins(userId);
  
  await sendPlain(chatId,
    `╔══════════════════════════╗\n║  🔗  REFERRAL SYSTEM      ║\n╠══════════════════════════╣\n` +
    `📤  Apna referral link share karo:\n\n${link}\n\n` +
    `🪙  Current Coins : ${coins}\n` +
    `✅  Per referral = 1 coin\n` +
    `⚡  Limit: 2 referrals per minute\n\n` +
    `📌  Naye user ko start karna hai bot se\n` +
    `╚══════════════════════════╝`
  );
}

async function handleReferralStart(userId, referrerId) {
  if (userId === referrerId) return;
  if (!canRefer(referrerId)) {
    console.log(`[REFERRAL] ${referrerId} rate limited`);
    return;
  }
  await addUserCoins(referrerId, 1);
  const user = await tgApiGet("getChat", { chat_id: userId });
  const name = user?.first_name || "Someone";
  await sendPlain(referrerId, `🎉  ${name} ne aapka referral use kiya!\n🪙  +1 coin mil gaya!`);
}

async function handleRequest(chatId, text, from, userMsgId = null) {
  const parts = text.trim().split(/\s+/, 3);
  if (parts.length < 3) {
    await sendPlain(chatId, 
      `❌  Usage: /request <type> <query>\n\n` +
      `Types: num, tg, adhar, upi, vehicle\n` +
      `Example: /request num 9876543210\n` +
      `Example: /request tg rtfgamming\n\n` +
      `Cost: 5 coins per request`
    );
    return;
  }
  
  const type = parts[1].toLowerCase();
  const query = parts.slice(2).join(" ");
  const validTypes = ["num", "tg", "adhar", "upi", "vehicle"];
  if (!validTypes.includes(type)) {
    await sendPlain(chatId, `❌  Invalid type! Valid: ${validTypes.join(", ")}`);
    return;
  }
  
  const coins = await getUserCoins(from.id);
  if (coins < 5) {
    await sendPlain(chatId,
      `╔══════════════════════════╗\n║  ❌  INSUFFICIENT COINS   ║\n╠══════════════════════════╣\n` +
      `🪙  Required: 5 coins\n🪙  You have: ${coins} coins\n\n` +
      `🔗  Use /refer to earn more coins!\n` +
      `╚══════════════════════════╝`
    );
    return;
  }
  
  if (!await deductUserCoins(from.id, 5)) {
    await sendPlain(chatId, "❌  Coin deduction failed. Try again.");
    return;
  }
  
  const request = await createRequest(from.id, type, query, 5);
  if (!request) {
    await addUserCoins(from.id, 5);
    await sendPlain(chatId, "❌  Request create nahi ho paya. Coins return kar diye.");
    return;
  }
  
  await sendPlain(chatId,
    `╔══════════════════════════╗\n║  ✅  REQUEST SENT         ║\n╠══════════════════════════╣\n` +
    `📝  Type  : ${type}\n🔍  Query : ${query}\n🪙  Cost  : 5 coins\n` +
    `📊  Status: PENDING\n\n` +
    `⏳  Admin approve karega\n📋  /myrequests se check karo\n` +
    `╚══════════════════════════╝`
  );
  
  const adminMsg = 
    `╔══════════════════════════╗\n║  📝  NEW REQUEST          ║\n╠══════════════════════════╣\n` +
    `👤  User  : ${from.first_name || "Unknown"} (@${from.username || "no username"})\n` +
    `🆔  ID    : ${from.id}\n` +
    `📝  Type  : ${type}\n🔍  Query : ${query}\n🪙  Coins : 5\n` +
    `📊  Status: PENDING\n` +
    `╠══════════════════════════╣\n` +
    `/approve ${request._id.toString()} - Approve\n` +
    `/reject ${request._id.toString()} - Reject\n` +
    `╚══════════════════════════╝`;
  
  for (const admin of admins) {
    const adminUsername = admin.replace("@", "");
    const adminChat = await tgApiGet("getChat", { chat_id: admin });
    if (adminChat) {
      await sendPlain(adminChat.id, adminMsg);
    } else {
      await sendPlain(`@${adminUsername}`, adminMsg);
    }
  }
}

async function handleMyRequests(chatId, userId) {
  const requests = await getUserRequests(userId);
  if (!requests.length) {
    await sendPlain(chatId, "📋  Aapki koi request nahi hai.");
    return;
  }
  
  let text = `╔══════════════════════════╗\n║  📋  YOUR REQUESTS       ║\n╠══════════════════════════╣\n\n`;
  requests.forEach((req, i) => {
    const statusEmoji = req.status === 'pending' ? '⏳' : req.status === 'approved' ? '✅' : '❌';
    text += `${i+1}. ${statusEmoji} ${req.type} - ${req.query}\n`;
    text += `   Status: ${req.status.toUpperCase()}\n`;
    text += `   Date: ${(req.created_at || "").slice(0,10)}\n`;
    if (req.status === 'approved' && req.result) {
      text += `   📄 Result: ${req.result.slice(0, 50)}${req.result.length > 50 ? "..." : ""}\n`;
    }
    text += "\n";
  });
  text += `╚══════════════════════════╝`;
  await sendPlain(chatId, text);
}

// ══════════════════════════════════════════════
//  CHANNEL ADD FLOW HANDLER
// ══════════════════════════════════════════════
async function handleChannelAddFlow(chatId, from, text, choice) {
  if (choice === "ch_add_step1") {
    const raw = text.trim();
    let ref = raw.replace(/^@/, "");
    let isPrivate = false;
    if (raw.startsWith("-100") || /^-\d+$/.test(raw)) { isPrivate = true; ref = raw; }
    const statusMsg = await sendPlain(chatId, `🔍 Channel verify ho raha hai: ${raw} ...`);
    const testResult = await tgApi("getChat", { chat_id: isPrivate ? parseInt(ref) : `@${ref}` });
    deleteMessage(chatId, statusMsg.message_id);
    if (!testResult) {
      await sendPlain(chatId, `╔══════════════════════════╗\n║  ❌  CHANNEL NOT FOUND   ║\n╠══════════════════════════╣\n❌  Bot is channel ka member nahi hai\n   ya channel exist nahi karta.\n\n✅  Bot ko channel admin banao pehle!\n╚══════════════════════════╝`);
      userState.delete(from.id);
      return;
    }
    const autoName = testResult.title || "";
    userState.set(from.id, `ch_add_step2::${isPrivate ? "id:" + ref : "user:" + ref}::${autoName}`);
    await sendPlain(chatId,
      `╔══════════════════════════╗\n║  ✅  CHANNEL FOUND        ║\n╠══════════════════════════╣\n` +
      `📢  Title   : ${testResult.title || "N/A"}\n🔗  Type    : ${isPrivate ? "🔒 Private" : "🌐 Public"}\n` +
      `╠══════════════════════════╣\n📥  Channel ka display name bhejo\n   Ya "skip" karo auto title ke liye:\n╚══════════════════════════╝`
    );
    return;
  }
  if (typeof choice === "string" && choice.startsWith("ch_add_step2::")) {
    const parts = choice.split("::");
    const refPart = parts[1];
    const autoName = parts.slice(2).join("::") || "";
    const displayName = text.trim().toLowerCase() === "skip" ? (autoName || "📢 Channel") : text.trim();
    const isPrivate = refPart.startsWith("id:");
    const refValue  = refPart.replace(/^(id:|user:)/, "");
    if (isPrivate) {
      userState.set(from.id, `ch_add_step3::${refPart}::${displayName}`);
      await sendPlain(chatId, `╔══════════════════════════╗\n║  🔒  PRIVATE CHANNEL      ║\n╠══════════════════════════╣\n📥  Invite link bhejo (optional):\n   Example: https://t.me/+xxxxxx\n\n   Ya "skip" karo bina invite link ke:\n╚══════════════════════════╝`);
      return;
    }
    CHANNELS.push({ name: displayName, username: refValue, id: null, invite_link: null });
    await dbSaveChannels();
    joinCache.clear();
    userState.delete(from.id);
    await sendPlain(chatId, `╔══════════════════════════╗\n║  ✅  CHANNEL ADDED        ║\n╠══════════════════════════╣\n📢  Name     : ${displayName}\n🌐  Username : @${refValue}\n📊  Total    : ${CHANNELS.length} channels\n╚══════════════════════════╝`);
    return;
  }
  if (typeof choice === "string" && choice.startsWith("ch_add_step3::")) {
    const parts = choice.split("::");
    const refPart = parts[1];
    const displayName = parts.slice(2).join("::");
    const refValue = refPart.replace(/^id:/, "");
    const inviteLink = text.trim().toLowerCase() === "skip" ? null : text.trim();
    CHANNELS.push({ name: displayName, username: null, id: parseInt(refValue) || refValue, invite_link: inviteLink });
    await dbSaveChannels();
    joinCache.clear();
    userState.delete(from.id);
    await sendPlain(chatId, `╔══════════════════════════╗\n║  ✅  CHANNEL ADDED        ║\n╠══════════════════════════╣\n📢  Name     : ${displayName}\n🔒  ID       : ${refValue}\n🔗  Invite   : ${inviteLink || "❌ None"}\n📊  Total    : ${CHANNELS.length} channels\n╚══════════════════════════╝`);
    return;
  }
}

// ══════════════════════════════════════════════
//  CALLBACKS
// ══════════════════════════════════════════════
async function handleCallback(cb) {
  const from     = cb.from;
  const chatId   = cb.message.chat.id;
  const msgId    = cb.message.message_id;
  const data     = cb.data;
  const _isAdmin = isAdmin(from.username);

  if (data === "verify") {
    joinCache.delete(from.id);
    const missing = await getNotJoinedChannels(from.id);
    if (missing.length) {
      await answerCallback(cb.id, `❌ Abhi bhi join karo: ${missing.map(c=>c.name).join(", ")}`, true);
      const btns = missing.map(c => {
        const url = c.invite_link ? c.invite_link : c.username ? `https://t.me/${c.username}` : null;
        if (!url) return null;
        return [{ text: `➕ ${c.name}`, url }];
      }).filter(Boolean);
      btns.push([{ text: "✅ VERIFY JOIN", callback_data: "verify" }]);
      await tgApi("editMessageReplyMarkup", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: btns } });
    } else {
      joinCache.set(from.id, { ok: true, ts: Date.now() });
      await answerCallback(cb.id);
      const kb = _isAdmin ? adminMenuKb() : mainMenuKb();
      await tgApi("editMessageText", { chat_id: chatId, message_id: msgId, text: MAIN_MENU_TEXT, reply_markup: kb });
    }
    return;
  }

  if (data.startsWith("api_tog_") && _isAdmin) {
    const key = data.replace("api_tog_", "");
    if (apiToggle[key]) {
      apiToggle[key].enabled = !apiToggle[key].enabled;
      const st = apiToggle[key].enabled ? "🟢 ON" : "🔴 OFF";
      await answerCallback(cb.id, `${apiToggle[key].label} ${st}`, true);
      await tgApi("editMessageText", { chat_id: chatId, message_id: msgId, text: apiManagerText(), reply_markup: apiManagerKb() });
    }
    return;
  }

  if (data.startsWith("api_msg_") && _isAdmin) {
    const key = data.replace("api_msg_", "");
    if (apiToggle[key]) {
      userState.set(from.id, `api_offmsg::${key}`);
      await answerCallback(cb.id);
      await sendPlain(chatId, `✏️  ${apiToggle[key].label} ka off message set karo:\n\nCurrent: "${apiToggle[key].offMsg}"\n\nNaya message type karo (ya "cancel" bhejo):`);
    }
    return;
  }

  if (data === "menu_apiurl" && _isAdmin) {
    await answerCallback(cb.id);
    const text = apiUrlManagerTextHtml();
    const kb   = apiUrlManagerKb();
    const editResult = await tgApi("editMessageText", {
      chat_id: chatId,
      message_id: msgId,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: kb,
    });
    if (!editResult) {
      await sendMessageHtml(chatId, text, { reply_markup: kb });
    }
    return;
  }

  if (data.startsWith("apiurl_edit_") && _isAdmin) {
    const key = data.replace("apiurl_edit_", "");
    if (DEFAULT_API_URLS[key] !== undefined) {
      await answerCallback(cb.id);
      userState.set(from.id, `apiurl_set_url::${key}`);
      const currentUrl = apiUrls[key] || DEFAULT_API_URLS[key];
      const currentCfg = apiResponseConfig[key] || "raw";
      const cfgLabel = currentCfg === "raw" ? "Default (pura format)" : `Field: ${currentCfg.replace("field:", "")}`;
      await sendPlain(chatId,
        `╔══════════════════════════╗\n║  🔗  API URL CHANGE       ║\n╠══════════════════════════╣\n` +
        `API         : ${API_LABELS[key]}\n\n` +
        `📌 Current URL:\n${currentUrl}\n\n` +
        `📋 Current Response Config:\n${cfgLabel}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📥 STEP 1: Naya URL bhejo\n` +
        `⚠️  URL mein {query} hona ZAROORI hai\n` +
        `    Example: https://api.example.com/search?q={query}&key=abc\n\n` +
        `Ya "cancel" type karo:\n╚══════════════════════════╝`
      );
    }
    return;
  }

  if (data.startsWith("apiurl_reset_") && _isAdmin) {
    const key = data.replace("apiurl_reset_", "");
    if (DEFAULT_API_URLS[key]) {
      apiUrls[key] = DEFAULT_API_URLS[key];
      apiResponseConfig[key] = "raw";
      await dbSaveApiUrls();
      await answerCallback(cb.id, `🔄 ${API_LABELS[key]} reset ho gaya!`, true);
      const text = apiUrlManagerTextHtml();
      const kb   = apiUrlManagerKb();
      const editResult = await tgApi("editMessageText", {
        chat_id: chatId,
        message_id: msgId,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: kb,
      });
      if (!editResult) {
        await sendMessageHtml(chatId, text, { reply_markup: kb });
      }
    }
    return;
  }

  if (data === "menu_channels" && _isAdmin) {
    await answerCallback(cb.id);
    await tgApi("editMessageText", {
      chat_id: chatId, message_id: msgId,
      text: channelManagerText(), parse_mode: "MarkdownV2",
      reply_markup: channelManagerKb(),
    });
    return;
  }

  if (data === "ch_add" && _isAdmin) {
    await answerCallback(cb.id);
    userState.set(from.id, "ch_add_step1");
    await sendPlain(chatId, `╔══════════════════════════╗\n║  ➕  CHANNEL ADD          ║\n╠══════════════════════════╣\n📥  Channel username ya ID bhejo:\n\n🌐 Public  : RTFGAMING1 ya @RTFGAMING1\n🔒 Private : -1001234567890\n\n⚠️  Bot ko pehle channel admin\n   banana zaroori hai!\n╚══════════════════════════╝`);
    return;
  }

  if (data.startsWith("ch_del_") && _isAdmin) {
    const idx = parseInt(data.replace("ch_del_", ""));
    await answerCallback(cb.id);
    if (!isNaN(idx) && CHANNELS[idx]) {
      const removed = CHANNELS.splice(idx, 1)[0];
      await dbSaveChannels();
      joinCache.clear();
      await tgApi("editMessageText", {
        chat_id: chatId, message_id: msgId,
        text: channelManagerText(), parse_mode: "MarkdownV2",
        reply_markup: channelManagerKb(),
      });
      await sendPlain(chatId, `╔══════════════════════════╗\n║  🗑️  CHANNEL REMOVED      ║\n╠══════════════════════════╣\n📢  Removed : ${removed.name}\n📊  Total   : ${CHANNELS.length} channels\n╚══════════════════════════╝`);
    } else {
      await sendPlain(chatId, "❌  Channel nahi mila.");
    }
    return;
  }

  await answerCallback(cb.id);
  if (!_isAdmin && !(await checkJoin(from.id))) { await sendJoinPrompt(chatId); return; }

  const prompts = {
    menu_number:  "╔════════════════════╗\n║  📞 NUMBER LOOKUP  ║\n╚════════════════════╝\n📥  Number bhejo:\n📌 Format: 9876543210",
    menu_tg:      "╔═══════════════════════╗\n║   🔎  TG LOOKUP       ║\n╠═══════════════════════╣\n📥  Username YA numeric ID\n✅  rtfgamming / @rtfgamming / 8518042438\n╚═══════════════════════╝",
    menu_adhar:   "╔══════════════════════╗\n║  🪪  AADHAAR LOOKUP  ║\n╚══════════════════════╝\n📥  Aadhaar number bhejo:\n📌 Example: 598229659586",
    menu_upi:     "╔══════════════════════╗\n║  💳  UPI LOOKUP      ║\n╚══════════════════════╝\n📥  UPI ID bhejo:\n📌 Example: 70497398@axl",
    menu_vehicle: "╔══════════════════════╗\n║  🚗  VEHICLE LOOKUP  ║\n╚══════════════════════╝\n📥  Vehicle number bhejo:\n📌 Example: MH02FZ0555",
    menu_coins:   "💰  /coins se check karo",
    menu_refer:   "🔗  /refer se referral link lo",
  };
  const stateMap = { menu_number:"number", menu_tg:"tg", menu_adhar:"adhar", menu_upi:"upi", menu_vehicle:"vehicle", menu_coins:"coins", menu_refer:"refer" };

  if (stateMap[data]) { 
    userState.set(from.id, stateMap[data]); 
    if (stateMap[data] === "coins") {
      await handleCoins(chatId, from.id);
    } else if (stateMap[data] === "refer") {
      await handleRefer(chatId, from);
    } else {
      await sendPlain(chatId, prompts[data]); 
    }
    return; 
  }
  if (data === "menu_help")  { await sendPlain(chatId, HELP_TEXT); return; }
  if (data === "menu_owner") { await sendPlain(chatId, "╔══════════════════╗\n║  👑  OWNER INFO   ║\n╚══════════════════╝\n🔗 https://t.me/RTFGAMMING"); return; }

  if (!_isAdmin) return;

  if (data === "menu_users")      { const c = await dbUserCount(); await sendPlain(chatId, `📊 Total Users: ${c}\n🗄️ Source: MongoDB`); return; }
  if (data === "menu_dbbackup")   { await sendDbBackup(chatId); return; }
  if (data === "menu_adminlist")  { await sendPlain(chatId, "╔══════════════════╗\n║  📋 ADMIN LIST   ║\n╚══════════════════╝\n" + admins.map(a=>`• ${a}`).join("\n")); return; }
  if (data === "menu_broadcast")  { userState.set(from.id, "broadcast"); await sendPlain(chatId, "📢  Broadcast message type karo:"); return; }
  if (data === "menu_setcustomtg")  { userState.set(from.id, "setcustomtg_step1");  await sendPlain(chatId, "📥  Username bhejo jiska data set karna hai\n📌  Example: rtfgamming"); return; }
  if (data === "menu_setcustomnum") { userState.set(from.id, "setcustomnum_step1"); await sendPlain(chatId, "📥  Number bhejo jiska data set karna hai\n📌  Example: 9876543210"); return; }

  if (data === "menu_pending_requests") {
    const requests = await getPendingRequests();
    if (!requests.length) {
      await sendPlain(chatId, "📋  Koi pending request nahi hai.");
      return;
    }
    let text = `╔══════════════════════════╗\n║  📝  PENDING REQUESTS    ║\n╠══════════════════════════╣\n\n`;
    requests.forEach((req, i) => {
      text += `${i+1}. ${req.type} - ${req.query}\n`;
      text += `   👤 User: ${req.user_id}\n`;
      text += `   🪙 Coins: ${req.coins_used}\n`;
      text += `   📅 ${(req.created_at || "").slice(0,10)}\n`;
      text += `   /approve_${req._id.toString().slice(0,8)} /reject_${req._id.toString().slice(0,8)}\n\n`;
    });
    text += `╚══════════════════════════╝`;
    await sendPlain(chatId, text);
    return;
  }

  if (data === "menu_api") {
    await tgApi("editMessageText", {
      chat_id: chatId, message_id: msgId,
      text: apiManagerText(),
      reply_markup: apiManagerKb(),
    });
    return;
  }

  if (data === "menu_adminpanel") {
    await sendPlain(chatId,
      "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n" +
      "📢 /broadcast  👥 /users\n➕ /addadmin  ➖ /removeadmin\n📋 /listadmins  🗄️ /dbbackup\n" +
      "✏️ /setcustomtg  🗑️ /delcustomtg\n✏️ /setcustomnum  🗑️ /delcustomnum\n📋 /listcustom  🔌 /apimanager\n" +
      "🔗 /apiurlmanager  📢 /channelmanager\n📝 /pending  - Check pending requests\n" +
      "╚══════════════════════════╝"
    );
    return;
  }
}

// ── MESSAGE ROUTER ────────────────────────────
async function handleUpdate(update) {
  try {
    if (update.callback_query) return await handleCallback(update.callback_query);
    const msg = update.message || update.edited_message;
    if (!msg) return;
    const from     = msg.from;
    if (!from || from.is_bot) return;
    const chatId   = msg.chat.id;
    const msgId    = msg.message_id;
    const text     = (msg.text || "").trim();
    const _isAdmin = isAdmin(from.username);

    dbSaveUser(from);
    if (!text) return;

    if (_isAdmin && ["/broadcast","/addadmin","/removeadmin","/users","/listadmins","/admin",
        "/setcustomtg","/delcustomtg","/setcustomnum","/delcustomnum","/listcustom","/dbbackup",
        "/apimanager","/apiurlmanager","/channelmanager","/pending","/approve_","/reject_"]
        .some(c => text.toLowerCase().startsWith(c))) {
      return await handleAdminText(chatId, from.id, text);
    }

    const choice = userState.get(from.id);
    if (!choice) return;

    if (!_isAdmin && !(await checkJoin(from.id))) { await sendJoinPrompt(chatId); return; }

    if (typeof choice === "string" && choice.startsWith("api_offmsg::") && _isAdmin) {
      const key = choice.split("::")[1];
      userState.delete(from.id);
      if (text.toLowerCase() === "cancel") { await sendPlain(chatId, "❌  Cancel ho gaya."); return; }
      if (apiToggle[key]) {
        apiToggle[key].offMsg = text.trim();
        await sendPlain(chatId, `✅  ${apiToggle[key].label} ka off message set ho gaya!\n\n"${text.trim()}"`);
      }
      return;
    }

    if (typeof choice === "string" && choice.startsWith("apiurl_set_url::") && _isAdmin) {
      const key = choice.split("::")[1];
      if (text.toLowerCase() === "cancel") {
        userState.delete(from.id);
        await sendPlain(chatId, "❌  Cancel ho gaya.");
        return;
      }
      if (!text.includes("{query}")) {
        await sendPlain(chatId,
          `❌  URL mein {query} nahi hai!\n\nExample: https://api.example.com/search?q={query}&key=abc\n\nDobara URL bhejo ya "cancel" karo:`
        );
        return;
      }
      if (!DEFAULT_API_URLS[key]) {
        userState.delete(from.id);
        await sendPlain(chatId, "❌  Invalid API key.");
        return;
      }
      apiUrls[key] = text.trim();
      userState.set(from.id, `apiurl_set_resp::${key}`);
      await sendPlain(chatId,
        `╔══════════════════════════╗\n║  ✅  URL SAVE HO GAYI     ║\n╠══════════════════════════╣\n` +
        `API : ${API_LABELS[key]}\n` +
        `URL : ${text.trim().slice(0, 60)}${text.length > 60 ? "..." : ""}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📥 STEP 2: Response format set karo\n\n` +
        `🟢 "raw"     — Default format (auto-detect)\n` +
        `🔵 field name — Sirf ek specific field dikhao\n` +
        `    Example: "number" ya "result.number"\n\n` +
        `"raw" type karo ya field name bhejo:\n╚══════════════════════════╝`
      );
      return;
    }

    if (typeof choice === "string" && choice.startsWith("apiurl_set_resp::") && _isAdmin) {
      const key = choice.split("::")[1];
      userState.delete(from.id);
      if (text.toLowerCase() === "cancel") {
        await dbSaveApiUrls();
        await sendPlain(chatId, `✅  URL save ho gayi. Response config unchanged.\nAPI: ${API_LABELS[key]}`);
        return;
      }
      const cfgValue = text.trim().toLowerCase() === "raw" ? "raw" : `field:${text.trim()}`;
      apiResponseConfig[key] = cfgValue;
      await dbSaveApiUrls();
      const cfgLabel = cfgValue === "raw" ? "Default format (auto-detect)" : `Sirf field: "${text.trim()}"`;
      await sendPlain(chatId,
        `╔══════════════════════════╗\n║  ✅  API FULLY CONFIGURED ║\n╠══════════════════════════╣\n` +
        `API      : ${API_LABELS[key]}\n` +
        `URL      : ${apiUrls[key].slice(0, 55)}${apiUrls[key].length > 55 ? "..." : ""}\n` +
        `Response : ${cfgLabel}\n` +
        `╠══════════════════════════╣\n` +
        `✅ Done. Ab /apiurlmanager se check karo.\n╚══════════════════════════╝`
      );
      return;
    }

    if (_isAdmin && (
      choice === "ch_add_step1" ||
      (typeof choice === "string" && choice.startsWith("ch_add_step2::")) ||
      (typeof choice === "string" && choice.startsWith("ch_add_step3::"))
    )) {
      await handleChannelAddFlow(chatId, from, text, choice);
      return;
    }

    if (choice === "broadcast" && _isAdmin) {
      const users = await dbGetAllUsers();
      const uids  = users.map(u => u.user_id);
      const status = await sendPlain(chatId, `📤  Broadcasting to ${uids.length} users...`);
      let ok = 0, fail = 0;
      
      const media = msg.photo || msg.video || msg.document || msg.audio || msg.animation || msg.sticker || msg.voice || msg.video_note;
      if (media) {
        for (const uid of uids) {
          try {
            const result = await tgApi("forwardMessage", {
              chat_id: uid,
              from_chat_id: chatId,
              message_id: msgId
            });
            if (result) ok++; else fail++;
          } catch (e) {
            fail++;
          }
          await new Promise(r => setTimeout(r, 100));
        }
      } else if (text) {
        for (const uid of uids) { 
          const r = await tgApi("sendMessage", { chat_id: uid, text }); 
          r ? ok++ : fail++; 
          await new Promise(r => setTimeout(r, 50)); 
        }
      } else {
        await sendPlain(chatId, "❌  Broadcast k liye message ya media bhejo.");
        return;
      }
      
      await tgApi("editMessageText", { 
        chat_id: chatId, 
        message_id: status.message_id,
        text: `╔══════════════════╗\n║  📢 BROADCAST DONE  ║\n╚══════════════════╝\n✅  Delivered : ${ok}\n❌  Failed    : ${fail}\n👥  Total     : ${uids.length}` 
      });
    }
    else if (choice === "number")  { await handleNumber(chatId, text, msgId, from.id); }
    else if (choice === "tg")      { await handleTg(chatId, text, msgId, from.id); }
    else if (choice === "adhar")   { await handleAdhar(chatId, text, msgId, from.id); }
    else if (choice === "upi")     { await handleUpi(chatId, text, msgId, from.id); }
    else if (choice === "vehicle") { await handleVehicle(chatId, text, msgId, from.id); }
    else if (choice === "coins")   { await handleCoins(chatId, from.id); }
    else if (choice === "refer")   { await handleRefer(chatId, from); }
    else if (choice === "setcustomtg_step1" && _isAdmin) {
      userState.set(from.id, `setcustomtg_step2::${text.trim().replace(/^@/,"").toLowerCase()}`);
      await sendPlain(chatId, `✅  Username: ${text.trim()}\n\n📥  Ab custom data bhejo:`);
      return;
    } else if (typeof choice === "string" && choice.startsWith("setcustomtg_step2::") && _isAdmin) {
      const targetKey = choice.split("::")[1];
      customTgData.set(targetKey, text.trim());
      dbSaveData(`customtg:${targetKey}`, { username: targetKey, data: text.trim() });
      await sendPlain(chatId, `✅  Custom TG data set!\n👤 Key: ${targetKey}`);
    } else if (choice === "setcustomnum_step1" && _isAdmin) {
      userState.set(from.id, `setcustomnum_step2::${text.trim().replace(/[+\s]/g,"").replace(/^91/,"")}`);
      await sendPlain(chatId, `✅  Number: ${text.trim()}\n\n📥  Ab custom data bhejo:`);
      return;
    } else if (typeof choice === "string" && choice.startsWith("setcustomnum_step2::") && _isAdmin) {
      const targetKey = choice.split("::")[1];
      customNumData.set(targetKey, text.trim());
      dbSaveData(`customnum:${targetKey}`, { number: targetKey, data: text.trim() });
      await sendPlain(chatId, `✅  Custom Number data set!\n📱 Key: ${targetKey}`);
    }

    userState.delete(from.id);
  } catch (e) { console.error("[handleUpdate]", e.message); }
}

async function handleAdminText(chatId, userId, text) {
  const lower = text.toLowerCase();

  if (lower === "/admin") {
    await sendPlain(chatId,
      "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n" +
      "📢 /broadcast  👥 /users\n➕ /addadmin  ➖ /removeadmin\n📋 /listadmins  🗄️ /dbbackup\n" +
      "✏️ /setcustomtg  🗑️ /delcustomtg\n✏️ /setcustomnum  🗑️ /delcustomnum\n" +
      "📋 /listcustom  🔌 /apimanager\n🔗 /apiurlmanager  📢 /channelmanager\n📝 /pending  - Pending requests\n" +
      "╚══════════════════════════╝"
    );
    return;
  }

  if (lower.startsWith("/approve_") || lower.startsWith("/reject_")) {
    const isApprove = lower.startsWith("/approve_");
    const idStr = lower.replace(isApprove ? "/approve_" : "/reject_", "").trim();
    try {
      const requestId = idStr;
      const requests = await getPendingRequests();
      const req = requests.find(r => r._id.toString() === requestId || r._id.toString().startsWith(requestId));
      if (!req) {
        await sendPlain(chatId, "❌  Request nahi mili.");
        return;
      }
      
      if (isApprove) {
        await updateRequestStatus(req._id, 'approved');
        await sendPlain(chatId, `✅  Request approved!`);
        
        let result = "Data fetch failed.";
        try {
          if (req.type === 'num') {
            const records = await fetchNumApi(req.query);
            if (records.length) result = formatNumResult(records, req.query);
          } else if (req.type === 'tg') {
            const data = await fetchTgApi(req.query);
            if (data) result = `TG ID: ${data.tgId}\nPhone: ${data.phone}`;
          } else if (req.type === 'adhar') {
            const data = await apiFetch(buildUrl("adhar", req.query));
            if (data) result = formatAdharResult(data, req.query) || "Data found but format error";
          } else if (req.type === 'upi') {
            const data = await apiFetch(buildUrl("upi", req.query));
            if (data) result = formatUpiResult(data, req.query);
          } else if (req.type === 'vehicle') {
            const data = await apiFetch(buildUrl("vehicle", req.query));
            if (data) result = formatVehicleResult(data);
          }
        } catch (e) {
          result = `Error: ${e.message}`;
        }
        
        await updateRequestStatus(req._id, 'approved', result);
        
        if (result && result !== "Data fetch failed.") {
          await sendPlain(req.user_id, 
            `╔══════════════════════════╗\n║  ✅  REQUEST APPROVED     ║\n╠══════════════════════════╣\n` +
            `📝  Type  : ${req.type}\n🔍  Query : ${req.query}\n\n` +
            `📄  Result:\n${result}\n` +
            `╚══════════════════════════╝`
          );
        } else {
          await sendPlain(req.user_id, 
            `╔══════════════════════════╗\n║  ❌  REQUEST FAILED       ║\n╠══════════════════════════╣\n` +
            `📝  Type  : ${req.type}\n🔍  Query : ${req.query}\n\n` +
            `⚠️  Data fetch failed. Coins return kar diye.\n` +
            `╚══════════════════════════╝`
          );
          await addUserCoins(req.user_id, 5);
        }
      } else {
        await updateRequestStatus(req._id, 'rejected');
        await addUserCoins(req.user_id, req.coins_used || 5);
        await sendPlain(chatId, `❌  Request rejected. Coins returned to user.`);
        await sendPlain(req.user_id,
          `╔══════════════════════════╗\n║  ❌  REQUEST REJECTED     ║\n╠══════════════════════════╣\n` +
          `📝  Type  : ${req.type}\n🔍  Query : ${req.query}\n\n` +
          `🪙  ${req.coins_used || 5} coins wapas aa gaye.\n` +
          `╚══════════════════════════╝`
        );
      }
    } catch (e) {
      console.error("[APPROVE/REJECT]", e.message);
      await sendPlain(chatId, `❌  Error: ${e.message}`);
    }
    return;
  }

  if (lower === "/pending") {
    const requests = await getPendingRequests();
    if (!requests.length) {
      await sendPlain(chatId, "📋  Koi pending request nahi hai.");
      return;
    }
    let text = `╔══════════════════════════╗\n║  📝  PENDING REQUESTS    ║\n╠══════════════════════════╣\n\n`;
    requests.forEach((req, i) => {
      text += `${i+1}. ${req.type} - ${req.query}\n`;
      text += `   👤 User: ${req.user_id}\n`;
      text += `   🪙 Coins: ${req.coins_used}\n`;
      text += `   📅 ${(req.created_at || "").slice(0,10)}\n`;
      text += `   /approve_${req._id.toString().slice(0,8)} /reject_${req._id.toString().slice(0,8)}\n\n`;
    });
    text += `╚══════════════════════════╝`;
    await sendPlain(chatId, text);
    return;
  }

  if (lower === "/apimanager") {
    await sendPlain(chatId, apiManagerText(), { reply_markup: apiManagerKb() });
    return;
  }

  if (lower === "/apiurlmanager") {
    const text = apiUrlManagerTextHtml();
    const kb   = apiUrlManagerKb();
    const result = await sendMessageHtml(chatId, text, { reply_markup: kb });
    if (!result) {
      await sendPlain(chatId, text, { reply_markup: kb });
    }
    return;
  }

  if (lower === "/channelmanager") {
    await tgApi("sendMessage", {
      chat_id: chatId,
      text: channelManagerText(),
      parse_mode: "MarkdownV2",
      reply_markup: channelManagerKb(),
    });
    return;
  }

  if (lower.startsWith("/broadcast")) {
    const msgText = text.slice("/broadcast".length).trim();
    if (!msgText) { await sendPlain(chatId, "❌  Usage: /broadcast <message>"); return; }
    const users = await dbGetAllUsers(); const uids = users.map(u => u.user_id);
    const status = await sendPlain(chatId, `📤  Broadcasting to ${uids.length} users...`);
    let ok = 0, fail = 0;
    for (const uid of uids) { const r = await tgApi("sendMessage", { chat_id: uid, text: msgText }); r ? ok++ : fail++; await new Promise(r => setTimeout(r, 50)); }
    await tgApi("editMessageText", { chat_id: chatId, message_id: status.message_id, text: `✅ Delivered: ${ok}\n❌ Failed: ${fail}\n👥 Total: ${uids.length}` });
    return;
  }
  if (lower === "/users")    { const c = await dbUserCount(); await sendPlain(chatId, `📊  Total Users: ${c}\n🗄️ Source: MongoDB`); return; }
  if (lower === "/dbbackup") { await sendDbBackup(chatId); return; }
  if (lower.startsWith("/addadmin")) {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) { await sendPlain(chatId, "❌  Usage: /addadmin @username"); return; }
    const na = parts[1].startsWith("@") ? parts[1] : `@${parts[1]}`;
    if (!admins.map(a=>a.toLowerCase()).includes(na.toLowerCase())) { admins.push(na); await sendPlain(chatId, `✅  ${na} ko admin bana diya!`); }
    else { await sendPlain(chatId, `⚠️  ${na} pehle se admin hai.`); }
    return;
  }
  if (lower.startsWith("/removeadmin")) {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) { await sendPlain(chatId, "❌  Usage: /removeadmin @username"); return; }
    const rem = parts[1].startsWith("@") ? parts[1] : `@${parts[1]}`;
    const match = admins.find(a => a.toLowerCase() === rem.toLowerCase());
    if (match && match.toLowerCase() !== "@rtfgamming") { admins = admins.filter(a => a.toLowerCase() !== rem.toLowerCase()); await sendPlain(chatId, `✅  ${rem} ko hata diya.`); }
    else if (match) { await sendPlain(chatId, "❌  Owner ko remove nahi kar sakte!"); }
    else { await sendPlain(chatId, `⚠️  ${rem} list me nahi hai.`); }
    return;
  }
  if (lower === "/listadmins") { await sendPlain(chatId, "╔══════════════════╗\n║  📋 ADMIN LIST    ║\n╚══════════════════╝\n" + admins.map(a=>`• ${a}`).join("\n")); return; }
  if (lower.startsWith("/setcustomtg")) {
    const parts = text.trim().split(/\s+/, 3);
    if (parts.length < 3) { await sendPlain(chatId, "❌  Usage: /setcustomtg @username <custom_text>"); return; }
    const target = parts[1].replace(/^@/,"").toLowerCase();
    const customText = text.trim().slice(parts[0].length + parts[1].length + 2).trim();
    customTgData.set(target, customText);
    dbSaveData(`customtg:${target}`, { username: target, data: customText });
    await sendPlain(chatId, `✅  Custom TG data set!\n👤 Key: ${target}`);
    return;
  }
  if (lower.startsWith("/delcustomtg")) {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) { await sendPlain(chatId, "❌  Usage: /delcustomtg @username"); return; }
    const target = parts[1].replace(/^@/,"").toLowerCase();
    if (customTgData.has(target)) { customTgData.delete(target); await sendPlain(chatId, `✅  ${target} ka custom TG data delete ho gaya.`); }
    else { await sendPlain(chatId, `⚠️  ${target} ka koi custom TG data nahi mila.`); }
    return;
  }
  if (lower.startsWith("/setcustomnum")) {
    const parts = text.trim().split(/\s+/, 3);
    if (parts.length < 3) { await sendPlain(chatId, "❌  Usage: /setcustomnum <number> <custom_text>"); return; }
    const target = parts[1].replace(/[+\s]/g,"").replace(/^91/,"");
    const customText = text.trim().slice(parts[0].length + parts[1].length + 2).trim();
    customNumData.set(target, customText);
    dbSaveData(`customnum:${target}`, { number: target, data: customText });
    await sendPlain(chatId, `✅  Custom Number data set!\n📱 Key: ${target}`);
    return;
  }
  if (lower.startsWith("/delcustomnum")) {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) { await sendPlain(chatId, "❌  Usage: /delcustomnum <number>"); return; }
    const target = parts[1].replace(/[+\s]/g,"").replace(/^91/,"");
    if (customNumData.has(target)) { customNumData.delete(target); await sendPlain(chatId, `✅  ${target} ka custom Number data delete ho gaya.`); }
    else { await sendPlain(chatId, `⚠️  ${target} ka koi custom Number data nahi mila.`); }
    return;
  }
  if (lower === "/listcustom") {
    let output = "╔══════════════════════════╗\n║  📋  CUSTOM DATA LIST    ║\n╠══════════════════════════╣\n\n";
    output += "🔹 CUSTOM TG DATA:\n";
    if (customTgData.size) { for (const [k,v] of customTgData) output += `   👤 ${k}\n     📝 ${v.slice(0,50)}${v.length>50?"...":""}\n`; }
    else { output += "  ❌ Koi custom TG data nahi\n"; }
    output += "\n🔹 CUSTOM NUMBER DATA:\n";
    if (customNumData.size) { for (const [k,v] of customNumData) output += `   📱 ${k}\n     📝 ${v.slice(0,50)}${v.length>50?"...":""}\n`; }
    else { output += "  ❌ Koi custom Number data nahi\n"; }
    output += "╚══════════════════════════╝";
    await sendPlain(chatId, output);
    return;
  }
}

async function handleCommand(msg) {
  const from   = msg.from;
  if (!from || from.is_bot) return;
  const chatId = msg.chat.id;
  const msgId  = msg.message_id;
  const text   = (msg.text || "").trim();
  const _isAdm = isAdmin(from.username);

  dbSaveUser(from);
  if (!_isAdm && !(await checkJoin(from.id))) { await sendJoinPrompt(chatId); return; }

  const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?/);
  if (!match) return;
  const [, cmd, args = ""] = match;

  if (cmd === "start" && args.startsWith("ref_")) {
    const referrerId = parseInt(args.replace("ref_", ""));
    if (!isNaN(referrerId)) {
      await handleReferralStart(from.id, referrerId);
    }
  }

  if (cmd === "start") { 
    await tgApi("sendMessage", { 
      chat_id: chatId, 
      text: MAIN_MENU_TEXT, 
      reply_markup: _isAdm ? adminMenuKb() : mainMenuKb() 
    }); 
  }
  else if (cmd === "help")    { await sendPlain(chatId, HELP_TEXT); }
  else if (cmd === "coins")   { await handleCoins(chatId, from.id); }
  else if (cmd === "refer")   { await handleRefer(chatId, from); }
  else if (cmd === "request") { await handleRequest(chatId, text, from, msgId); }
  else if (cmd === "myrequests") { await handleMyRequests(chatId, from.id); }
  else if (cmd === "num")     { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /num <number>"); return; } await handleNumber(chatId, args.trim(), msgId, from.id); }
  else if (cmd === "tg")      { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /tg <username ya userid>"); return; } await handleTg(chatId, args.trim(), msgId, from.id); }
  else if (cmd === "adhar")   { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /adhar <aadhaar_number>"); return; } await handleAdhar(chatId, args.trim(), msgId, from.id); }
  else if (cmd === "upi")     { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /upi <upi_id>"); return; } await handleUpi(chatId, args.trim(), msgId, from.id); }
  else if (cmd === "vehicle") { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /vehicle <reg_number>"); return; } await handleVehicle(chatId, args.trim(), msgId, from.id); }
  else if (_isAdm)            { await handleAdminText(chatId, from.id, text); }
}

// ── WEBHOOK ───────────────────────────────────
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update) return;
  if (update.callback_query) { queueForUser(update.callback_query.from.id, () => handleCallback(update.callback_query)); return; }
  const msg = update.message || update.edited_message;
  if (!msg || !msg.from) return;
  const uid  = msg.from.id;
  const text = (msg.text || "").trim();
  if (text.startsWith("/")) { queueForUser(uid, () => handleCommand(msg)); }
  else                      { queueForUser(uid, () => handleUpdate(update)); }
});

app.get("/", (_req, res) => res.send("RTF Bot is running ✅"));

async function start() {
  if (!BOT_TOKEN) { console.error("[BOT] BOT_TOKEN not set! Exiting."); process.exit(1); }
  await initDb();
  await dbLoadChannels();
  await dbLoadApiUrls();
  await setMyCommands([
    { command: "start",          description: "🏠 Main Menu" },
    { command: "num",            description: "📞 Number Lookup" },
    { command: "tg",             description: "🔎 TG Username / UserID" },
    { command: "adhar",          description: "🪪 Aadhaar Lookup" },
    { command: "upi",            description: "💳 UPI ID Lookup" },
    { command: "vehicle",        description: "🚗 Vehicle Lookup" },
    { command: "help",           description: "❓ Help Guide" },
    { command: "coins",          description: "💰 Check Your Coins" },
    { command: "refer",          description: "🔗 Get Referral Link" },
    { command: "request",        description: "📝 Request Data Using Coins" },
    { command: "myrequests",     description: "📋 Check Your Requests" },
    { command: "apiurlmanager",  description: "🔗 API URL Manager (Admin)" },
    { command: "channelmanager", description: "📢 Channel Manager (Admin)" },
  ]);
  if (WEBHOOK_URL) {
    const wh = `${WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
    await setWebhook(wh);
    console.log(`[BOT] Webhook set → ${wh}`);
  } else { console.warn("[BOT] WEBHOOK_URL not set"); }
  app.listen(PORT, () => console.log(`[BOT] Server listening on port ${PORT} ✅`));
}

start();
