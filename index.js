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

// ── API URLs ──────────────────────────────────
const NUM_API_URL     = "https://movements-invoice-amanda-victoria.trycloudflare.com/search/number?number={number}&key=mysecretkey123";
const DEEP_API_URL    = "https://all-leak-check-api.vercel.app/api/search?query={number}";
const ADHAR_API_URL   = "https://atof.onrender.com/full-search?aadhaar={number}";
const TG_USERNAME_API = "https://username-usrid-to-num.onrender.com/username/{username}?key=3c7c79ee5d09e54d714c6cf960017b62";
const TG_USERID_API   = "https://username-usrid-to-num.onrender.com/userid={userid}?key=3c7c79ee5d09e54d714c6cf960017b62";
const TG_FALLBACK_API = "https://krish-osintoy.lovable.app/api/v1/tg?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&info={query}";
const UPI_API_URL     = "https://krish-osintoy.lovable.app/api/v1/upi?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&upi={upi}";
const VEHICLE_API_URL = "https://krish-osintoy.lovable.app/api/v1/vehicle?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&vehicle={vehicle}";

const CHANNELS = [
  { name: "🔥 RTF GAMING",  username: "RTFGMINGGC"     },
  { name: "🎁 GIVEAWAY",    username: "RTFGAMINGHACK0" },
  { name: "💀 RTF ERA",     username: "BYEPAASLINK"    },
];

const JOINED_STATUSES = new Set(["member","administrator","creator","restricted"]);

let admins         = ["@rtfgamming"];
const userState    = new Map();
const customTgData = new Map();

// ══════════════════════════════════════════════
//  API TOGGLE SYSTEM
//  Har API ke liye:
//    enabled: on/off
//    offMsg:  admin ka custom message jab API off ho
// ══════════════════════════════════════════════
const apiToggle = {
  num: {
    enabled: true,
    label:   "📞 Number API",
    offMsg:  "❌ Number lookup abhi available nahi hai. Thodi der baad try karo.",
  },
  deep: {
    enabled: true,
    label:   "🔬 Deep Intel API",
    offMsg:  "❌ Deep data lookup abhi available nahi hai.",
  },
  tg_primary: {
    enabled: true,
    label:   "🔎 TG Primary API",
    offMsg:  "❌ TG lookup abhi available nahi hai. Fallback try kar raha hai...",
  },
  tg_fallback: {
    enabled: true,
    label:   "🔎 TG Fallback API",
    offMsg:  "❌ TG fallback bhi abhi available nahi hai.",
  },
  adhar: {
    enabled: true,
    label:   "🪪 Aadhaar API",
    offMsg:  "❌ Aadhaar lookup abhi available nahi hai. Thodi der baad try karo.",
  },
  upi: {
    enabled: true,
    label:   "💳 UPI API",
    offMsg:  "❌ UPI lookup abhi available nahi hai.",
  },
  vehicle: {
    enabled: true,
    label:   "🚗 Vehicle API",
    offMsg:  "❌ Vehicle lookup abhi available nahi hai.",
  },
};

// ── CONCURRENCY CONTROL ───────────────────────
const userQueue = new Map();
function queueForUser(userId, taskFn) {
  const prev = userQueue.get(userId) || Promise.resolve();
  const next = prev.then(() => taskFn()).catch(e => console.error(`[QUEUE] uid=${userId}`, e.message));
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

function dbSaveUser(from) {
  if (!usersCol) return;
  const now = new Date().toISOString();
  usersCol.updateOne(
    { user_id: from.id },
    {
      $set: { user_id: from.id, username: from.username||"", name: [from.first_name, from.last_name].filter(Boolean).join(" "), first_name: from.first_name||"", last_name: from.last_name||"", last_seen: now },
      $setOnInsert: { first_seen: now, total_searches: 0 }
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
function agentFor(url) { return url.startsWith("https") ? { agent: httpsAgent } : { agent: httpAgent }; }

async function tgApi(method, body = {}) {
  try {
    const res  = await fetch(`${TG_BASE}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000), ...agentFor(TG_BASE) });
    const json = await res.json();
    if (!json.ok) { console.error(`[TG ${method}]`, json.description); return null; }
    return json.result;
  } catch (e) { console.error(`[TG ${method}]`, e.message); return null; }
}

function escMd(text) {
  if (text == null) return "";
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}
function cbMd(label, value) {
  const v = (value != null ? String(value).trim() : "");
  if (v && !["N/A","","None","null","nan","undefined"].includes(v))
    return `${escMd(label)}: \`${escMd(v)}\``;
  return `${escMd(label)}: ❌ N/A`;
}

const sendMessage     = (chat_id, text, extra = {}) => tgApi("sendMessage",     { chat_id, text, parse_mode: "MarkdownV2", disable_web_page_preview: true, ...extra });
const editMessageText = (chat_id, message_id, text, extra = {}) => tgApi("editMessageText", { chat_id, message_id, text, parse_mode: "MarkdownV2", disable_web_page_preview: true, ...extra });
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
    const plain = text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "");
    await sendPlain(chatId, plain, extra);
  }
  return res;
}

// ── JOIN CHECK ────────────────────────────────
const joinCache = new Map();
const JOIN_CACHE_TTL = 60_000;

async function getNotJoinedChannels(userId) {
  const missing = [];
  for (const ch of CHANNELS) {
    try {
      const m = await getChatMember(`@${ch.username}`, userId);
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
  const buttons = missing.map(ch => [{ text: `➕ ${ch.name}`, url: `https://t.me/${ch.username}` }]);
  buttons.push([{ text: "✅ VERIFY JOIN", callback_data: "verify" }]);
  await sendPlain(chatId, "╔════════════════════════╗\n║  🔒  ACCESS LOCKED  🔒  ║\n╠════════════════════════╣\n📢  Sabhi channels JOIN karo\n⚡  Phir ✅ VERIFY dabao\n╚════════════════════════╝", { reply_markup: { inline_keyboard: buttons } });
  return true;
}

// ── MENUS ─────────────────────────────────────
const MAIN_MENU_TEXT =
  "╔══════════════════════════╗\n║  ⚡️  R T F   B O T  ⚡️   ║\n╠══════════════════════════╣\n" +
  "🟢  Status  : ONLINE\n👑  Owner   : @RTFGAMMING\n🔥  Version : v3.0\n" +
  "╠══════════════════════════╣\n📌  Neeche se option chuno:\n╚══════════════════════════╝";

const HELP_TEXT =
  "╔══════════════════════════╗\n║  📖  B O T   H E L P    ║\n╠══════════════════════════╣\n" +
  "📞  /num <number>\n   Example: /num 9876543210\n\n" +
  "🔎  /tg <username ya userid>\n   Example: /tg rtfgamming\n   Example: /tg 8518042438\n\n" +
  "🪪  /adhar <aadhaar_no>\n   Example: /adhar 598229659586\n\n" +
  "💳  /upi <upi_id>\n   Example: /upi 70497398@axl\n\n" +
  "🚗  /vehicle <reg_number>\n   Example: /vehicle MH02FZ0555\n\n" +
  "🏠 /start  ❓ /help\n╠══════════════════════════╣\n👑  Owner : @RTFGAMMING\n╚══════════════════════════╝";

function mainMenuKb() {
  return { inline_keyboard: [
    [{ text: "📞 Number Lookup", callback_data: "menu_number" }, { text: "🔎 TG Lookup", callback_data: "menu_tg" }],
    [{ text: "🪪 Aadhaar Lookup", callback_data: "menu_adhar" }],
    [{ text: "💳 UPI Lookup", callback_data: "menu_upi" }],
    [{ text: "🚗 Vehicle Lookup", callback_data: "menu_vehicle" }],
    [{ text: "❓ Help", callback_data: "menu_help" }, { text: "👑 Owner", callback_data: "menu_owner" }],
  ]};
}

function adminMenuKb() {
  return { inline_keyboard: [
    [{ text: "📞 Number Lookup", callback_data: "menu_number" }, { text: "🔎 TG Lookup", callback_data: "menu_tg" }],
    [{ text: "🪪 Aadhaar Lookup", callback_data: "menu_adhar" }],
    [{ text: "💳 UPI Lookup", callback_data: "menu_upi" }],
    [{ text: "🚗 Vehicle Lookup", callback_data: "menu_vehicle" }],
    [{ text: "❓ Help", callback_data: "menu_help" }, { text: "👑 Owner", callback_data: "menu_owner" }],
    [{ text: "📢 Broadcast", callback_data: "menu_broadcast" }, { text: "👥 Users Count", callback_data: "menu_users" }],
    [{ text: "📋 Admin List", callback_data: "menu_adminlist" }, { text: "⚙️ Admin Panel", callback_data: "menu_adminpanel" }],
    [{ text: "✏️ Set Custom TG", callback_data: "menu_setcustomtg" }],
    [{ text: "🗄️ DB Backup", callback_data: "menu_dbbackup" }],
    [{ text: "🔌 API Manager", callback_data: "menu_api" }],
  ]};
}

// ══════════════════════════════════════════════
//  API MANAGER PANEL
//  Har API ka toggle + custom off message
// ══════════════════════════════════════════════
const API_KEYS = ["num","deep","tg_primary","tg_fallback","adhar","upi","vehicle"];

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
    if (!api.enabled) text += `      💬 "${api.offMsg.slice(0,40)}..."\n`;
    text += "\n";
  }
  text += "Toggle = ON/OFF\n✏️ Msg = Custom message set karo\n╚══════════════════════════╝";
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

function formatNumResult(records, number) {
  const colors = ["🔴","🟠","🟡","🟢","🔵"];
  let out =
    `┌─────────────────────────┐\n│  📞  NUMBER INFO         │\n├─────────────────────────┤\n` +
    `📱  Number  : \`${escMd(number)}\`\n📊  Records : ${Math.min(records.length,5)} found\n\n`;
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

// ══════════════════════════════════════════════
//  DEEP API PARSER + FORMATTER
//  Input: full API response
//  Response format: { result: { data: ["Mobile: ...", "Address: ..."] } }
// ══════════════════════════════════════════════

function parseDeepApiResponse(apiData) {
  try {
    if (!apiData || apiData.status !== "success") return null;
    const result = apiData.result;
    if (!result || result.status !== "success") return null;
    const dataArr = result.data;
    if (!Array.isArray(dataArr) || !dataArr.length) return null;

    const parsed = {
      mobiles:   [],
      addresses: [],
      full_name: null,
      father:    null,
      region:    null,
      facebook:  null,
      name:      null,
      surname:   null,
      gender:    null,
      country:   null,
    };

    for (const line of dataArr) {
      if (!line || typeof line !== "string") continue;
      const sep = line.indexOf(":");
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim().toLowerCase();
      const val = line.slice(sep + 1).trim();
      if (!val || val === "" || val.includes("0001") || val === "null" || val === "undefined") continue;

      if      (key === "mobile")          { if (!parsed.mobiles.includes(val)) parsed.mobiles.push(val); }
      else if (key === "address")         { if (!parsed.addresses.includes(val)) parsed.addresses.push(val); }
      else if (key === "full name")       { if (!parsed.full_name) parsed.full_name = val; }
      else if (key === "father name")     { if (!parsed.father) parsed.father = val; }
      else if (key === "region")          { if (!parsed.region) parsed.region = val; }
      else if (key === "facebookid")      { if (!parsed.facebook) parsed.facebook = val; }
      else if (key === "name")            { if (!parsed.name) parsed.name = val; }
      else if (key === "surname")         { if (!parsed.surname) parsed.surname = val; }
      else if (key === "gender")          { if (!parsed.gender) parsed.gender = val; }
      else if (key === "country")         { if (!parsed.country && val) parsed.country = val; }
    }
    return parsed;
  } catch (e) { console.error("[parseDeepApi]", e.message); return null; }
}

function formatDeepResult(parsed, queryNumber) {
  if (!parsed) return null;
  const hasMeaningful = parsed.mobiles.length || parsed.addresses.length ||
    parsed.full_name || parsed.father || parsed.region;
  if (!hasMeaningful) return null;

  let text =
    `\n\n` +
    `🔬━━━━━━━━━━━━━━━━━━━━━🔬\n` +
    `│  🕵️  D E E P   I N T E L   │\n` +
    `🔬━━━━━━━━━━━━━━━━━━━━━🔬\n` +
    `🔢  Query : \`${escMd(queryNumber)}\`\n\n`;

  // Identity
  if (parsed.full_name || parsed.name || parsed.surname || parsed.father || parsed.gender) {
    text += `👤━━━ IDENTITY ━━━👤\n`;
    if (parsed.full_name) text += `${cbMd("🧑 Full Name  ", parsed.full_name)}\n`;
    if (parsed.name || parsed.surname) {
      const nm = [parsed.name, parsed.surname].filter(Boolean).join(" ");
      text += `${cbMd("🏷️  Name      ", nm)}\n`;
    }
    if (parsed.father) text += `${cbMd("👨 Father    ", parsed.father)}\n`;
    if (parsed.gender) text += `${cbMd("⚧️  Gender    ", parsed.gender)}\n`;
    text += "\n";
  }

  // Phone numbers
  if (parsed.mobiles.length) {
    const unique = [...new Set(parsed.mobiles)];
    text += `📞━━━ PHONES \\(${unique.length}\\) ━━━📞\n`;
    const colors = ["🔴","🟠","🟡","🟢","🔵","🟣","🔘","⚪"];
    unique.forEach((mob, i) => {
      text += `${colors[i % colors.length]}  \`${escMd(mob)}\`\n`;
    });
    text += "\n";
  }

  // Addresses
  if (parsed.addresses.length) {
    const unique = [...new Set(parsed.addresses)];
    text += `📍━━━ ADDRESSES \\(${unique.length}\\) ━━━📍\n`;
    unique.forEach(addr => { text += `🔸  ${escMd(addr)}\n`; });
    text += "\n";
  }

  // Network
  if (parsed.region) {
    text += `📡━━━ NETWORK ━━━📡\n${cbMd("📶 Region", parsed.region)}\n\n`;
  }

  // Social
  if (parsed.facebook || parsed.country) {
    text += `🌐━━━ SOCIAL ━━━🌐\n`;
    if (parsed.facebook) text += `${cbMd("📘 Facebook", parsed.facebook)}\n`;
    if (parsed.country)  text += `${cbMd("🌍 Country ", parsed.country)}\n`;
    text += "\n";
  }

  text += `👑  ${escMd(OWNER)}  \\|  ⚡ DEEP INTEL`;
  return text;
}

// ══════════════════════════════════════════════
//  NEW AADHAAR API FORMAT
//  URL: https://atof.onrender.com/full-search?aadhaar={number}
//  Response: { success, ration_card_id, details: { card_info, members, monthly_summary } }
// ══════════════════════════════════════════════

function formatAdharResult(data, adharNumber) {
  try {
    if (!data || !data.success) return null;
    const details = data.details || {};
    const card    = details.card_info        || {};
    const members = details.members          || [];
    const monthly = details.monthly_summary  || [];

    let out =
      `┌─────────────────────────┐\n│  🪪  AADHAAR INTEL       │\n├─────────────────────────┤\n` +
      `🔢  Aadhaar     : \`${escMd(adharNumber)}\`\n` +
      `${cbMd("🪪  RC ID       ", data.ration_card_id)}\n\n`;

    // Card info block
    if (Object.keys(card).length) {
      out += `📋━━━ RATION CARD ━━━📋\n`;
      if (card["Card Type"])       out += `${cbMd("📌 Card Type   ", card["Card Type"])}\n`;
      if (card["Scheme"])          out += `${cbMd("📋 Scheme      ", card["Scheme"])}\n`;
      if (card["State"])           out += `${cbMd("🗺️  State       ", card["State"])}\n`;
      if (card["District"])        out += `${cbMd("📍 District    ", card["District"])}\n`;
      if (card["Issue Date"])      out += `${cbMd("📅 Issue Date  ", card["Issue Date"])}\n`;
      if (card["Home FPS"])        out += `${cbMd("🏪 Home FPS    ", card["Home FPS"])}\n`;
      if (card["Address"] && card["Address"] !== "null") out += `${cbMd("🏠 Address     ", card["Address"])}\n`;
      out += "\n";
    }

    // Members block
    if (members.length) {
      out += `👨‍👩‍👧‍👦━━━ FAMILY MEMBERS \\(${members.length}\\) ━━━👨‍👩‍👧‍👦\n`;
      const genderIcon = g => (g||"").toLowerCase() === "f" ? "👩" : (g||"").toLowerCase() === "m" ? "👨" : "🧑";
      const ekyc = s => s === "Y" ? "✅" : "❌";
      const colors = ["🔴","🟠","🟡","🟢","🔵","🟣","⚪"];
      members.forEach((m, i) => {
        const dot = colors[i % colors.length];
        out +=
          `${dot}━━ ${i+1}\\. ${escMd(m.member_name || "N/A")} ${genderIcon(m.gender)}\n` +
          `   📋 Relation  : ${escMd(m.relationship || "N/A")}\n` +
          `   🆔 UID       : \`${escMd(m.uid_masked || "N/A")}\`\n` +
          `   ✅ eKYC      : ${ekyc(m.ekyc_status)}\n` +
          `   📅 Updated   : ${escMd(m.cr_last_updated || "N/A")}\n\n`;
      });
    }

    // Monthly summary
    if (monthly.length) {
      out += `📊━━━ RECENT MONTHS ━━━📊\n`;
      monthly.slice(0,3).forEach(m => {
        out += `📅 ${escMd(m.month)}  \\|  👥 Members: ${escMd(m.member_count)}\n`;
      });
      out += "\n";
    }

    out += `└─────────────────────────┘\n👑  ${escMd(OWNER)}  \\|  ⚡ ACTIVE`;
    return out;
  } catch (e) { console.error("[formatAdhar]", e.message); return null; }
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
  const vd = (typeof data.vehicle_data === "object" && data.vehicle_data) || {};
  const v  = val => { const s = String(val||"").trim(); return s && !["None","null","","nan","0","false","False"].includes(s) ? s : null; };
  const mob = v(data.mobile_number); const eng = v(data.engine_number); const chassis = v(data.chassis_number);
  const regNo = v(data.vehicle_number || data.vehicle);
  const father = v(vd.ownerFatherName); const regAuth = v(vd.regAuthority); const regDate = v(vd.regDate);
  const mfr = v(vd.manufacturer); const model = v(vd.vehicle); const variant = v(vd.variant);
  const fuel = v(vd.fuelType); const vehClass = v(vd.vehicleClass); const vehType = v(vd.vehicleType);
  const cc = v(vd.cubicCapacity); const seats = v(vd.seatCapacity); const mfrYear = v(vd.manufacturerYear);
  const presentAddr = v(vd.presentAddress) || v(vd.permAddress);
  const financer = v(vd.financerName); const insCompany = v(vd.insuranceCompanyName);
  const insUpto = v(vd.insuranceUpto); const insExpired = vd.insuranceExpired;
  const puccValid = v(vd.puccValidUpto); const pincode = v(vd.pincode);
  const rtoName = v((typeof vd.rtoData === "object" && vd.rtoData) ? vd.rtoData.rtoName : null);
  const rtoCode = v(vd.rtoCode); const isComm = vd.isCommercial;
  const lines = ["┌────────────────────────────┐","│  🚗  VEHICLE INFO           │","└────────────────────────────┘","🔷━━━ REGISTRATION ━━━🔷"];
  if (regNo)   lines.push(`🚘  Reg No      : \`${escMd(regNo)}\``);
  if (regAuth) lines.push(`🏛️   Reg Auth    : \`${escMd(regAuth)}\``);
  if (regDate) lines.push(`📅  Reg Date    : \`${escMd(regDate)}\``);
  if (rtoCode) lines.push(`🗂️   RTO Code    : \`${escMd(rtoCode)}\``);
  if (rtoName) lines.push(`🏢  RTO Name    : \`${escMd(rtoName)}\``);
  if ([father,mob,presentAddr,pincode].some(Boolean)) {
    lines.push("\n🔶━━━ OWNER DETAILS ━━━🔶");
    if (father)      lines.push(`👨  Father       : \`${escMd(father)}\``);
    if (mob)         lines.push(`📞  Mobile       : \`${escMd(mob)}\``);
    if (presentAddr) lines.push(`📍  Address      : \`${escMd(presentAddr)}\``);
    if (pincode)     lines.push(`📮  Pincode      : \`${escMd(pincode)}\``);
  }
  if ([mfr,model,variant,fuel,vehClass,cc,seats,mfrYear].some(Boolean)) {
    lines.push("\n🟢━━━ VEHICLE SPECS ━━━🟢");
    if (mfr)      lines.push(`🏭  Manufacturer : \`${escMd(mfr)}\``);
    if (model)    lines.push(`🚗  Model        : \`${escMd(model)}\``);
    if (variant)  lines.push(`⚙️   Variant      : \`${escMd(variant)}\``);
    if (fuel)     lines.push(`⛽  Fuel Type    : \`${escMd(fuel)}\``);
    if (vehClass) lines.push(`📋  Class        : \`${escMd(vehClass)}\``);
    if (vehType)  lines.push(`🔖  Type         : \`${escMd(vehType)}\``);
    if (mfrYear)  lines.push(`📆  Mfr Year     : \`${escMd(mfrYear)}\``);
    if (cc)       lines.push(`🔩  Cubic Cap    : \`${escMd(cc)} cc\``);
    if (seats)    lines.push(`💺  Seats        : \`${escMd(seats)}\``);
    if (isComm != null) lines.push(`🏪  Commercial   : ${isComm ? "✅ YES" : "❌ NO"}`);
  }
  if ([eng,chassis].some(Boolean)) {
    lines.push("\n🔵━━━ TECHNICAL ━━━🔵");
    if (eng)     lines.push(`🔧  Engine No    : \`${escMd(eng)}\``);
    if (chassis) lines.push(`🔩  Chassis No   : \`${escMd(chassis)}\``);
  }
  if ([financer,insCompany,insUpto,puccValid].some(Boolean)) {
    lines.push("\n🟣━━━ FINANCE & INSURANCE ━━━🟣");
    if (financer)   lines.push(`💰  Financer     : \`${escMd(financer)}\``);
    if (insCompany) lines.push(`🛡️   Insurance    : \`${escMd(insCompany)}\``);
    if (insUpto)    lines.push(`📅  Ins Upto     : \`${escMd(insUpto)}\`${insExpired ? " ❌ EXPIRED" : " ✅ VALID"}`);
    if (puccValid)  lines.push(`🌿  PUCC Valid   : \`${escMd(puccValid)}\``);
  }
  lines.push(`\n┌────────────────────────────┐`,`│  👑 ${escMd(OWNER)}  \\|  ⚡ ACTIVE  │`,"└────────────────────────────┘");
  return lines.join("\n");
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
    const sorted = [...allUsers].sort((a,b) => (b.total_searches||0) - (a.total_searches||0));
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
    if (sorted[0]) lines.push(`🏆  Top Searcher: ${sorted[0].name||sorted[0].username||sorted[0].user_id} — ${sorted[0].total_searches||0} searches`);
    lines.push("────────────────────────────────");
    sorted.forEach((u, i) => {
      const name  = u.name     || "no name";
      const uname = u.username ? `@${u.username}` : "no username";
      const srch  = u.total_searches != null ? u.total_searches : 0;
      const fseen = (u.first_seen||"").slice(0,10) || "N/A";
      const lseen = (u.last_seen ||"").slice(0,10) || "N/A";
      lines.push(`${i+1}. ${name} | ${uname} | ID: ${u.user_id||"N/A"} | 🔍 ${srch}`);
      lines.push(`   📅 First: ${fseen}  |  Last: ${lseen}`);
    });
    lines.push("╚════════════════════════════════╝");
    const fullText = lines.join("\n");
    if (fullText.length > 4000) {
      const buf  = Buffer.from(fullText, "utf8");
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("caption", `🗄️ RTF Bot DB — ${total} users | 🔍 ${totalSearches} searches | ${now} UTC`);
      form.append("document", buf, { filename: `rtfbot_${new Date().toISOString().slice(0,10)}.txt`, contentType: "text/plain" });
      await fetch(`${TG_BASE}/sendDocument`, { method: "POST", body: form, ...agentFor(TG_BASE) });
      deleteMessage(chatId, statusMsg.message_id);
    } else {
      await tgApi("editMessageText", { chat_id: chatId, message_id: statusMsg.message_id, text: fullText });
    }
  } catch (e) {
    console.error("[DB BACKUP]", e);
    tgApi("editMessageText", { chat_id: chatId, message_id: statusMsg.message_id, text: `❌  Backup failed: ${e.message}` });
  }
}

// ── API FETCHERS ──────────────────────────────
async function apiFetch(url, timeout = 15000) {
  const res  = await fetch(url, { signal: AbortSignal.timeout(timeout), ...agentFor(url) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchDeepApi(number) {
  if (!apiToggle.deep.enabled) return null;
  // Normalize: strip +, spaces, country code prefix if needed
  let raw = String(number).replace(/[+\s]/g,"");
  // Agar 10 digit Indian number hai, 91 lagao
  if (raw.length === 10 && !raw.startsWith("91")) raw = "91" + raw;
  // Agar pehle se 91 se shuru hai (12 digits) — theek hai
  console.log(`[DEEP API] Querying: ${raw}`);
  try {
    const data = await apiFetch(DEEP_API_URL.replace("{number}", raw), 20000);
    console.log(`[DEEP API] Response status: ${data && data.status}`);
    if (!data || typeof data !== "object") return null;
    return data;
  } catch (e) { console.error("[DEEP API]", e.message); return null; }
}

async function fetchNumApi(cleanPhone) {
  if (!apiToggle.num.enabled) return [];
  try {
    const data = await apiFetch(NUM_API_URL.replace("{number}", cleanPhone));
    return extractRecords(data);
  } catch (e) { console.error("[NUM API]", e.message); return []; }
}

function parseTgPrimary(data, inputTerm) {
  let tgId = String(data.target_id || "N/A");
  let targetUname = data.target_username || inputTerm;
  let phone = null, countryCode = null;
  for (const sv of Object.values(data.data || {})) {
    if (typeof sv !== "object") continue;
    for (const rec of (sv.records || [])) {
      if (!rec) continue;
      const rp = rec.phone ? String(rec.phone).trim() : null;
      if (rp && !["","None","null"].includes(rp)) {
        phone = rp; countryCode = String(rec.country_code || "N/A");
        if (rec.tg_id) tgId = String(rec.tg_id);
        break;
      }
    }
    if (phone) break;
  }
  return { tgId, targetUname, phone, countryCode };
}

async function fetchTgData(term) {
  const isUserId = /^\d+$/.test(term);
  let tgId = "N/A", targetUname = term, phone = null, countryCode = null, usedFallback = false;

  if (apiToggle.tg_primary.enabled) {
    try {
      const url  = isUserId ? TG_USERID_API.replace("{userid}", term) : TG_USERNAME_API.replace("{username}", term);
      const data = await apiFetch(url, 20000);
      if (data && data.status && data.target_id) {
        const p = parseTgPrimary(data, term);
        tgId = p.tgId; targetUname = p.targetUname; phone = p.phone; countryCode = p.countryCode;
      }
    } catch (e) { console.error("[TG PRIMARY]", e.message); }
  }

  if (!phone && apiToggle.tg_fallback.enabled) {
    try {
      const q    = (term.startsWith("@") || isUserId) ? term : `@${term}`;
      const data = await apiFetch(TG_FALLBACK_API.replace("{query}", encodeURIComponent(q)), 20000);
      if (data && data.success) {
        const fp = String(data.number || "").trim();
        if (fp && fp !== "None" && fp !== "") {
          usedFallback = true;
          phone        = fp;
          countryCode  = String(data.country_code || countryCode || "N/A");
          if (data.tg_id && String(data.tg_id) !== "N/A") tgId = String(data.tg_id);
        }
      }
    } catch (e) { console.error("[TG FALLBACK]", e.message); }
  }

  return { tgId, targetUname, phone, countryCode, usedFallback };
}

// ══════════════════════════════════════════════
//  LOOKUP HANDLERS
// ══════════════════════════════════════════════

async function handleNumber(chatId, number, userMsgId = null, userId = null) {
  // Check if BOTH num + deep are off
  if (!apiToggle.num.enabled && !apiToggle.deep.enabled) {
    await sendDataNotFound(chatId, userMsgId,
      `╔══════════════════╗\n║  ⚠️  API OFFLINE   ║\n╚══════════════════╝\n${apiToggle.num.offMsg}`
    );
    return;
  }

  const statusMsg = await sendPlain(chatId, `🔍  Searching: ${number} ...`);
  try {
    let clean = number.trim().replace(/\s/g,"").replace("+91","");
    if (clean.startsWith("91") && clean.length > 10) clean = clean.slice(2);

    // Run both APIs in parallel
    const [records, deepApiRaw] = await Promise.all([
      fetchNumApi(clean),
      fetchDeepApi(number),
    ]);

    deleteMessage(chatId, statusMsg.message_id);

    const deepParsed = parseDeepApiResponse(deepApiRaw);
    const deepFmt    = formatDeepResult(deepParsed, clean);

    if (!records.length && !deepFmt) {
      await sendDataNotFound(chatId, userMsgId,
        `╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n📱  Number: ${clean}\n⚠️  Koi record nahi mila`
      );
      return;
    }

    if (userId) dbIncrSearch(userId);

    // Combine: num result first, then deep data below with clear separator
    let full = "";
    if (records.length && apiToggle.num.enabled) {
      full += formatNumResult(records, clean);
    }
    if (deepFmt) {
      // deepFmt already starts with \n\n separator from formatDeepResult
      full += deepFmt;
    }

    await sendDataFound(chatId, userMsgId, full);
  } catch (e) {
    console.error("[NUM LOOKUP]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  API Error / Timeout.");
  }
}

async function handleTg(chatId, term, userMsgId = null, userId = null) {
  term = term.trim().replace(/^@/,"");
  if (!term) { await sendDataNotFound(chatId, userMsgId, "❌  Kuch toh bhejo!\n✅ /tg rtfgamming\n✅ /tg 8518042438"); return; }

  const termKey = term.toLowerCase();
  if (customTgData.has(termKey)) {
    if (userId) dbIncrSearch(userId);
    await sendDataFound(chatId, userMsgId, customTgData.get(termKey));
    return;
  }

  if (!apiToggle.tg_primary.enabled && !apiToggle.tg_fallback.enabled) {
    await sendDataNotFound(chatId, userMsgId,
      `╔══════════════════════╗\n║  ⚠️  API OFFLINE      ║\n╠══════════════════════╣\n${apiToggle.tg_primary.offMsg}\n╚══════════════════════╝`
    );
    return;
  }

  const isUserId  = /^\d+$/.test(term);
  const statusMsg = await sendPlain(chatId, `🔍  Searching TG ${isUserId ? "UserID" : "Username"}: ${isUserId ? "#" : "@"}${term} ...`);

  try {
    const { tgId, targetUname, phone, countryCode, usedFallback } = await fetchTgData(term);
    deleteMessage(chatId, statusMsg.message_id);

    if (!phone && tgId === "N/A") {
      await sendDataNotFound(chatId, userMsgId,
        `╔══════════════════════╗\n║  ❌ DATA NOT FOUND    ║\n╠══════════════════════╣\n🔎  Input : ${term}\n⚠️  Data nahi mila\n╚══════════════════════╝`
      );
      return;
    }

    if (userId) dbIncrSearch(userId);

    const srcLabel = usedFallback ? "🔁 Fallback" : "✅ Primary";
    const uDisplay = /^\d+$/.test(targetUname) ? targetUname : `@${targetUname}`;

    let tgBlock =
      `┌─────────────────────────┐\n│  🔎  TG LOOKUP           │\n├─────────────────────────┤\n` +
      `${cbMd("💻 Username    ", uDisplay)}\n` +
      `${cbMd("🆔 Telegram ID ", tgId)}\n` +
      `${cbMd("📞 Phone       ", phone || "N/A")}\n` +
      `${cbMd("🌍 Country Code", countryCode || "N/A")}\n` +
      `🔌  Source       : ${escMd(srcLabel)}\n` +
      `└─────────────────────────┘\n`;

    if (phone) {
      let cleanPhone = phone.replace(/[+\s]/g,"");
      if (cleanPhone.startsWith("91") && cleanPhone.length > 10) cleanPhone = cleanPhone.slice(2);
      const [numRes, deepApiRaw] = await Promise.all([fetchNumApi(cleanPhone), fetchDeepApi(phone)]);
      if (numRes.length && apiToggle.num.enabled) tgBlock += "\n" + formatNumResult(numRes, cleanPhone);
      const dp = parseDeepApiResponse(deepApiRaw);
      const df = formatDeepResult(dp, cleanPhone);
      if (df) tgBlock += df;  // formatDeepResult already adds \n\n prefix
    }

    await sendDataFound(chatId, userMsgId, tgBlock);
  } catch (e) {
    console.error("[TG LOOKUP]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  Kuch gadbad ho gayi.");
  }
}

async function handleAdhar(chatId, adharRaw, userMsgId = null, userId = null) {
  if (!apiToggle.adhar.enabled) {
    await sendDataNotFound(chatId, userMsgId,
      `╔══════════════════╗\n║  ⚠️  API OFFLINE   ║\n╚══════════════════╝\n${apiToggle.adhar.offMsg}`
    );
    return;
  }
  const statusMsg = await sendPlain(chatId, `🔍  Searching Aadhaar: ${adharRaw} ...`);
  try {
    const data = await apiFetch(ADHAR_API_URL.replace("{number}", adharRaw));
    deleteMessage(chatId, statusMsg.message_id);
    if (!data || !data.success) {
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
  if (!apiToggle.upi.enabled) {
    await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ⚠️  API OFFLINE   ║\n╚══════════════════╝\n${apiToggle.upi.offMsg}`);
    return;
  }
  const statusMsg = await sendPlain(chatId, `🔍  Searching UPI: ${upiId} ...`);
  try {
    const data = await apiFetch(UPI_API_URL.replace("{upi}", upiId.trim()));
    deleteMessage(chatId, statusMsg.message_id);
    if (!data.success) { await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ❌ UPI NOT FOUND   ║\n╚══════════════════╝\n💳  UPI: ${upiId}`); return; }
    if (userId) dbIncrSearch(userId);
    await sendDataFound(chatId, userMsgId, formatUpiResult(data, upiId));
  } catch (e) {
    console.error("[UPI]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  API Error / Timeout.");
  }
}

async function handleVehicle(chatId, vehicleNo, userMsgId = null, userId = null) {
  if (!apiToggle.vehicle.enabled) {
    await sendDataNotFound(chatId, userMsgId, `╔══════════════════════╗\n║  ⚠️  API OFFLINE       ║\n╚══════════════════════╝\n${apiToggle.vehicle.offMsg}`);
    return;
  }
  vehicleNo = vehicleNo.trim().toUpperCase().replace(/\s/g,"");
  const statusMsg = await sendPlain(chatId, `🔍  Searching Vehicle: ${vehicleNo} ...`);
  try {
    const data = await apiFetch(VEHICLE_API_URL.replace("{vehicle}", vehicleNo), 20000);
    deleteMessage(chatId, statusMsg.message_id);
    if (!data.success) { await sendDataNotFound(chatId, userMsgId, `╔══════════════════════╗\n║  ❌ VEHICLE NOT FOUND  ║\n╚══════════════════════╝\n🚗  Vehicle: ${vehicleNo}`); return; }
    if (userId) dbIncrSearch(userId);
    await sendDataFound(chatId, userMsgId, formatVehicleResult(data));
  } catch (e) {
    console.error("[VEHICLE]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  API Error / Timeout.");
  }
}

// ── CALLBACKS ─────────────────────────────────
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
      const btns = missing.map(c => [{ text: `➕ ${c.name}`, url: `https://t.me/${c.username}` }]);
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

  // API toggle — admin only
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

  // API set custom off message
  if (data.startsWith("api_msg_") && _isAdmin) {
    const key = data.replace("api_msg_", "");
    if (apiToggle[key]) {
      userState.set(from.id, `api_offmsg::${key}`);
      await answerCallback(cb.id);
      await sendPlain(chatId,
        `✏️  ${apiToggle[key].label} ka off message set karo:\n\n` +
        `Current: "${apiToggle[key].offMsg}"\n\n` +
        `Ab naya message type karo (ya "cancel" bhejo):`
      );
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
  };
  const stateMap = { menu_number:"number", menu_tg:"tg", menu_adhar:"adhar", menu_upi:"upi", menu_vehicle:"vehicle" };

  if (stateMap[data]) { userState.set(from.id, stateMap[data]); await sendPlain(chatId, prompts[data]); return; }
  if (data === "menu_help")  { await sendPlain(chatId, HELP_TEXT); return; }
  if (data === "menu_owner") { await sendPlain(chatId, "╔══════════════════╗\n║  👑  OWNER INFO   ║\n╚══════════════════╝\n🔗 https://t.me/RTFGAMMING"); return; }

  if (!_isAdmin) return;

  if (data === "menu_users")      { const c = await dbUserCount(); await sendPlain(chatId, `📊 Total Users: ${c}\n🗄️ Source: MongoDB`); return; }
  if (data === "menu_dbbackup")   { await sendDbBackup(chatId); return; }
  if (data === "menu_adminlist")  { await sendPlain(chatId, "╔══════════════════╗\n║  📋 ADMIN LIST   ║\n╚══════════════════╝\n" + admins.map(a=>`• ${a}`).join("\n")); return; }
  if (data === "menu_broadcast")  { userState.set(from.id, "broadcast"); await sendPlain(chatId, "📢  Broadcast message type karo:"); return; }
  if (data === "menu_setcustomtg"){ userState.set(from.id, "setcustomtg_step1"); await sendPlain(chatId, "📥  Username bhejo jiska data set karna hai\n📌  Example: rtfgamming"); return; }
  if (data === "menu_api")        { await tgApi("editMessageText", { chat_id: chatId, message_id: msgId, text: apiManagerText(), reply_markup: apiManagerKb() }); return; }
  if (data === "menu_adminpanel") {
    await sendPlain(chatId,
      "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n" +
      "📢 /broadcast  👥 /users\n➕ /addadmin  ➖ /removeadmin\n📋 /listadmins  🗄️ /dbbackup\n" +
      "✏️ /setcustomtg  🗑️ /delcustomtg\n📋 /listcustomtg  🔌 /apimanager\n╚══════════════════════════╝"
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
        "/setcustomtg","/delcustomtg","/listcustomtg","/dbbackup","/apimanager"].some(c => text.toLowerCase().startsWith(c))) {
      return await handleAdminText(chatId, from.id, text);
    }

    const choice = userState.get(from.id);
    if (!choice) return;

    if (!_isAdmin && !(await checkJoin(from.id))) { await sendJoinPrompt(chatId); return; }

    // API off-message setter
    if (typeof choice === "string" && choice.startsWith("api_offmsg::") && _isAdmin) {
      const key = choice.split("::")[1];
      if (text.toLowerCase() === "cancel") {
        userState.delete(from.id);
        await sendPlain(chatId, "❌  Cancel ho gaya.");
        return;
      }
      if (apiToggle[key]) {
        apiToggle[key].offMsg = text.trim();
        await sendPlain(chatId, `✅  ${apiToggle[key].label} ka off message set ho gaya!\n\n"${text.trim()}"`);
      }
      userState.delete(from.id);
      return;
    }

    if (choice === "broadcast" && _isAdmin) {
      const users = await dbGetAllUsers();
      const uids  = users.map(u => u.user_id);
      const status = await sendPlain(chatId, `📤  Broadcasting to ${uids.length} users...`);
      let ok = 0, fail = 0;
      for (const uid of uids) {
        const r = await tgApi("sendMessage", { chat_id: uid, text });
        r ? ok++ : fail++;
        await new Promise(r => setTimeout(r, 50));
      }
      await tgApi("editMessageText", { chat_id: chatId, message_id: status.message_id,
        text: `╔══════════════════╗\n║  📢 BROADCAST DONE  ║\n╚══════════════════╝\n✅  Delivered : ${ok}\n❌  Failed    : ${fail}\n👥  Total     : ${uids.length}` });
    }
    else if (choice === "number")  { await handleNumber(chatId, text, msgId, from.id); }
    else if (choice === "tg")      { await handleTg(chatId, text, msgId, from.id); }
    else if (choice === "adhar")   { await handleAdhar(chatId, text, msgId, from.id); }
    else if (choice === "upi")     { await handleUpi(chatId, text, msgId, from.id); }
    else if (choice === "vehicle") { await handleVehicle(chatId, text, msgId, from.id); }
    else if (choice === "setcustomtg_step1" && _isAdmin) {
      userState.set(from.id, `setcustomtg_step2::${text.trim().replace(/^@/,"").toLowerCase()}`);
      await sendPlain(chatId, `✅  Username: ${text.trim()}\n\n📥  Ab custom data bhejo:`);
      return;
    } else if (typeof choice === "string" && choice.startsWith("setcustomtg_step2::") && _isAdmin) {
      const targetKey = choice.split("::")[1];
      customTgData.set(targetKey, text.trim());
      dbSaveData(`customtg:${targetKey}`, { username: targetKey, data: text.trim() });
      await sendPlain(chatId, `✅  Custom data set!\n👤 Key: ${targetKey}`);
    }

    userState.delete(from.id);
  } catch (e) { console.error("[handleUpdate]", e.message); }
}

async function handleAdminText(chatId, userId, text) {
  const lower = text.toLowerCase();
  if (lower === "/admin")        { await sendPlain(chatId, "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n📢 /broadcast  👥 /users\n➕ /addadmin  ➖ /removeadmin\n📋 /listadmins  🗄️ /dbbackup\n✏️ /setcustomtg  🗑️ /delcustomtg\n📋 /listcustomtg  🔌 /apimanager\n╚══════════════════════════╝"); return; }
  if (lower === "/apimanager")   { await sendPlain(chatId, apiManagerText(), { reply_markup: apiManagerKb() }); return; }
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
  if (lower === "/users")        { const c = await dbUserCount(); await sendPlain(chatId, `📊  Total Users: ${c}\n🗄️ Source: MongoDB`); return; }
  if (lower === "/dbbackup")     { await sendDbBackup(chatId); return; }
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
  if (lower === "/listadmins")   { await sendPlain(chatId, "╔══════════════════╗\n║  📋 ADMIN LIST    ║\n╚══════════════════╝\n" + admins.map(a=>`• ${a}`).join("\n")); return; }
  if (lower.startsWith("/setcustomtg")) {
    const parts = text.trim().split(/\s+/, 3);
    if (parts.length < 3) { await sendPlain(chatId, "❌  Usage: /setcustomtg @username <custom_text>"); return; }
    const target     = parts[1].replace(/^@/,"").toLowerCase();
    const customText = text.trim().slice(parts[0].length + parts[1].length + 2).trim();
    customTgData.set(target, customText);
    dbSaveData(`customtg:${target}`, { username: target, data: customText });
    await sendPlain(chatId, `✅  Custom data set!\n👤 Key: ${target}`);
    return;
  }
  if (lower.startsWith("/delcustomtg")) {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) { await sendPlain(chatId, "❌  Usage: /delcustomtg @username"); return; }
    const target = parts[1].replace(/^@/,"").toLowerCase();
    if (customTgData.has(target)) { customTgData.delete(target); await sendPlain(chatId, `✅  ${target} ka custom data delete ho gaya.`); }
    else { await sendPlain(chatId, `⚠️  ${target} ka koi custom data nahi mila.`); }
    return;
  }
  if (lower === "/listcustomtg") {
    if (!customTgData.size) { await sendPlain(chatId, "📋  Koi custom TG data set nahi hai."); return; }
    const lines = ["╔══════════════════════════╗","║  📋  CUSTOM TG DATA LIST  ║","╠══════════════════════════╣"];
    for (const [k,v] of customTgData) lines.push(`👤 ${k}\n   📝 ${v.slice(0,60)}${v.length>60?"...":""}`);
    lines.push("╚══════════════════════════╝");
    await sendPlain(chatId, lines.join("\n"));
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

  if      (cmd === "start")   { await tgApi("sendMessage", { chat_id: chatId, text: MAIN_MENU_TEXT, reply_markup: _isAdm ? adminMenuKb() : mainMenuKb() }); }
  else if (cmd === "help")    { await sendPlain(chatId, HELP_TEXT); }
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
  await setMyCommands([
    { command: "start",   description: "🏠 Main Menu" },
    { command: "num",     description: "📞 Number Lookup" },
    { command: "tg",      description: "🔎 TG Username / UserID" },
    { command: "adhar",   description: "🪪 Aadhaar Lookup" },
    { command: "upi",     description: "💳 UPI ID Lookup" },
    { command: "vehicle", description: "🚗 Vehicle Lookup" },
    { command: "help",    description: "❓ Help Guide" },
  ]);
  if (WEBHOOK_URL) {
    const wh = `${WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
    await setWebhook(wh);
    console.log(`[BOT] Webhook set → ${wh}`);
  } else { console.warn("[BOT] WEBHOOK_URL not set"); }
  app.listen(PORT, () => console.log(`[BOT] Server listening on port ${PORT} ✅`));
}

start();
