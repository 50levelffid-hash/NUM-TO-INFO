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
// ⚠️  UPDATE THIS URL IF THE TUNNEL EXPIRES ⚠️
const NUM_API_URL     = "https://movements-invoice-amanda-victoria.trycloudflare.com/search/number?number={number}&key=mysecretkey123";
const TG_API_URL      = "https://tgtonumlifetime.suryahacker.workers.dev/?tg={query}";
const DEEP_API_URL    = "https://l34k-osint.onrender.com/search?key=4e7feeb644fb638362361a94e7e43691&query={query}";
const ADHAR_API_URL   = "https://atof.onrender.com/full-search?aadhaar={number}";
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
const customNumData = new Map();

// ── API TOGGLE SYSTEM ─────────────────────────
const apiToggle = {
  num: {
    enabled: true,
    label:   "📞 Number API",
    offMsg:  "❌ Number lookup abhi available nahi hai.",
  },
  deep: {
    enabled: true,
    label:   "🔬 Deep Intel API (new)",
    offMsg:  "❌ Deep data lookup abhi available nahi hai.",
  },
  tg: {
    enabled: true,
    label:   "🔎 TG → Number API",
    offMsg:  "❌ TG API unavailable.",
  },
  adhar: {
    enabled: true,
    label:   "🪪 Aadhaar API",
    offMsg:  "❌ Aadhaar lookup abhi available nahi hai.",
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
  "🛡  Status  : ONLINE\n👑  Owner   : @RTFGAMMING\n🔥  Version : v3.0\n" +
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
    [{ text: "✏️ Set Custom Num", callback_data: "menu_setcustomnum" }],
    [{ text: "🗄️ DB Backup", callback_data: "menu_dbbackup" }],
    [{ text: "🔌 API Manager", callback_data: "menu_api" }],
  ]};
}

// ══════════════════════════════════════════════
//  API MANAGER PANEL
// ══════════════════════════════════════════════
const API_KEYS = ["num","deep","tg","adhar","upi","vehicle"];

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
    let source = data;
    if (source && typeof source === "object") {
      if (source.success === false || source.status === false) return [];
      if (Array.isArray(source.result)) source = source.result;
      else if (Array.isArray(source.data)) source = source.data;
      else if (Array.isArray(source.records)) source = source.records;
      else if (Array.isArray(source)) { /* already array */ }
      else return [];
    }
    if (!Array.isArray(source)) return [];
    for (const r of source) {
      if (r && typeof r === "object") {
        records.push({
          name:    (r.name    || r.fullName || "N/A").trim(),
          fname:   (r.fname   || r.fatherName || r.fathername || "N/A").trim(),
          address: (r.address || r.addr || r.Adres || "N/A").trim(),
          circle:  (r.circle  || r.region || "N/A").trim(),
          alt:     String(r.alt    || r.alternate || "N/A"),
          aadhar:  String(r.aadhar || r.aadhaar || "N/A"),
          email:   (r.email   || "N/A"),
        });
      }
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
//  DEEP API PARSER + FORMATTER (NEW)
// ══════════════════════════════════════════════

function parseNewDeepApiResponse(apiData) {
  try {
    if (!apiData) return null;
    if (apiData.status === false || apiData.success === false) return null;
    let source = apiData.data;
    if (!source) source = apiData;
    let records = null;
    if (source.source1 && source.source1.records) {
      records = source.source1.records;
    } else if (source.records) {
      records = source.records;
    } else if (Array.isArray(source)) {
      records = source;
    }
    if (!records || !Array.isArray(records) || records.length === 0) return null;

    const parsed = {
      mobiles:   [],
      addresses: [],
      full_name: null,
      father:    null,
      region:    null,
    };

    for (const rec of records) {
      const phoneFields = ["Phone","Phone2","Phone3","Phone4","Phone5"];
      for (const field of phoneFields) {
        const val = rec[field];
        if (val && typeof val === "string" && val.trim() !== "") {
          const cleaned = val.trim();
          if (!parsed.mobiles.includes(cleaned)) parsed.mobiles.push(cleaned);
        }
      }
      const addrFields = ["Adres","Adres2","Adres3","address","addr"];
      for (const field of addrFields) {
        const val = rec[field];
        if (val && typeof val === "string" && val.trim() !== "") {
          const cleaned = val.trim();
          if (!parsed.addresses.includes(cleaned)) parsed.addresses.push(cleaned);
        }
      }
      if (!parsed.full_name) {
        const fn = rec.FullName || rec.fullName || rec.name || rec.full_name;
        if (fn && typeof fn === "string" && fn.trim() !== "") parsed.full_name = fn.trim();
      }
      if (!parsed.father) {
        const fa = rec.FatherName || rec.fatherName || rec.fathername || rec.father;
        if (fa && typeof fa === "string" && fa.trim() !== "") parsed.father = fa.trim();
      }
      if (!parsed.region) {
        const rg = rec.Region || rec.region || rec.circle;
        if (rg && typeof rg === "string" && rg.trim() !== "") parsed.region = rg.trim();
      }
    }

    if (parsed.mobiles.length === 0 && parsed.addresses.length === 0 && !parsed.full_name && !parsed.father && !parsed.region) {
      return null;
    }
    return parsed;
  } catch (e) {
    console.error("[parseNewDeepApi]", e.message);
    return null;
  }
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

  if (parsed.full_name || parsed.father) {
    text += `👤━━━ IDENTITY ━━━👤\n`;
    if (parsed.full_name) text += `${cbMd("🧑 Full Name  ", parsed.full_name)}\n`;
    if (parsed.father)    text += `${cbMd("👨 Father     ", parsed.father)}\n`;
    text += "\n";
  }

  if (parsed.mobiles.length) {
    const unique = [...new Set(parsed.mobiles)];
    text += `📞━━━ PHONES \\(${unique.length}\\) ━━━📞\n`;
    const colors = ["🔴","🟠","🟡","🟢","🔵","🟣","🔘","⚪"];
    unique.forEach((mob, i) => {
      text += `${colors[i % colors.length]}  \`${escMd(mob)}\`\n`;
    });
    text += "\n";
  }

  if (parsed.addresses.length) {
    const unique = [...new Set(parsed.addresses)];
    text += `📍━━━ ADDRESSES \\(${unique.length}\\) ━━━📍\n`;
    unique.forEach(addr => { text += `🔸  ${escMd(addr)}\n`; });
    text += "\n";
  }

  if (parsed.region) {
    text += `📡━━━ NETWORK ━━━📡\n${cbMd("📶 Region", parsed.region)}\n\n`;
  }

  text += `👑  ${escMd(OWNER)}  \\|  ⚡ DEEP INTEL`;
  return text;
}

// ══════════════════════════════════════════════
//  AADHAAR, UPI, VEHICLE FORMATTERS (unchanged)
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

async function fetchNumApi(cleanPhone) {
  if (!apiToggle.num.enabled) return [];
  try {
    const url = NUM_API_URL.replace("{number}", cleanPhone);
    console.log(`[NUM API] Querying: ${url}`);
    const data = await apiFetch(url);
    console.log(`[NUM API] Response type: ${typeof data}, status/success:`, data?.status, data?.success);
    const records = extractRecords(data);
    console.log(`[NUM API] Extracted ${records.length} records`);
    return records;
  } catch (e) {
    console.error("[NUM API] ERROR:", e.message);
    // Return empty array but also return a flag that we had an error
    return { error: true, records: [] };
  }
}

async function fetchDeepApi(query) {
  if (!apiToggle.deep.enabled) return null;
  let raw = String(query).replace(/[+\s]/g,"");
  if (raw.length === 10 && !raw.startsWith("91")) raw = "91" + raw;
  const url = DEEP_API_URL.replace("{query}", raw);
  console.log(`[NEW DEEP API] Querying: ${url}`);
  try {
    const data = await apiFetch(url, 20000);
    console.log(`[NEW DEEP API] Response status: ${data && data.status}`);
    if (!data || typeof data !== "object") return null;
    return data;
  } catch (e) {
    console.error("[NEW DEEP API] ERROR:", e.message);
    return null;
  }
}

async function fetchTgApi(query) {
  if (!apiToggle.tg.enabled) return null;
  try {
    const url = TG_API_URL.replace("{query}", encodeURIComponent(query));
    console.log(`[TG API] Querying: ${url}`);
    const data = await apiFetch(url, 20000);
    console.log(`[TG API] Response:`, data);
    if (data && data.success === true && data.number) {
      return {
        tgId: data.tg_id || "N/A",
        number: data.number,
        country: data.country || "N/A",
        countryCode: data.country_code || "+91",
        developer: data.developer || "N/A",
      };
    }
    return null;
  } catch (e) {
    console.error("[TG API] ERROR:", e.message);
    return null;
  }
}

async function fetchTgData(term) {
  const termKey = term.toLowerCase();
  if (customTgData.has(termKey)) {
    return { custom: true, data: customTgData.get(termKey) };
  }
  const result = await fetchTgApi(term);
  return { custom: false, data: result };
}

// ══════════════════════════════════════════════
//  LOOKUP HANDLERS
// ══════════════════════════════════════════════

async function handleNumber(chatId, number, userMsgId = null, userId = null) {
  const numKey = number.trim().toLowerCase();
  if (customNumData.has(numKey)) {
    if (userId) dbIncrSearch(userId);
    await sendDataFound(chatId, userMsgId, customNumData.get(numKey));
    return;
  }

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

    // Fetch both APIs
    const numResult = await fetchNumApi(clean);
    const deepApiRaw = await fetchDeepApi(number);

    // Check if num API had an error
    const numError = numResult.error || false;
    const records = numError ? [] : numResult;

    deleteMessage(chatId, statusMsg.message_id);

    const deepParsed = parseNewDeepApiResponse(deepApiRaw);
    const deepFmt    = formatDeepResult(deepParsed, clean);

    // If both are empty, show not found
    if ((!records || records.length === 0) && !deepFmt) {
      let notFoundMsg = `╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n📱  Number: ${clean}\n⚠️  Koi record nahi mila`;
      if (numError) {
        notFoundMsg += `\n\n⚠️  Number API temporarily unavailable.\n🔍  Deep Intel also returned no data.`;
      }
      await sendDataNotFound(chatId, userMsgId, notFoundMsg);
      return;
    }

    if (userId) dbIncrSearch(userId);

    let full = "";
    // Show number info only if we have records and API is enabled
    if (records && records.length > 0 && apiToggle.num.enabled) {
      full += formatNumResult(records, clean);
    } else if (numError && apiToggle.num.enabled) {
      // If number API errored but we have deep data, show a warning
      full += `⚠️  Number API unavailable – showing Deep Intel only.\n\n`;
    }

    if (deepFmt) {
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

  const statusMsg = await sendPlain(chatId, `🔍  Searching TG: ${term} ...`);

  try {
    const { custom, data } = await fetchTgData(term);
    deleteMessage(chatId, statusMsg.message_id);

    if (custom) {
      if (userId) dbIncrSearch(userId);
      await sendDataFound(chatId, userMsgId, data);
      return;
    }

    if (!data || !data.number) {
      await sendDataNotFound(chatId, userMsgId,
        `╔══════════════════════╗\n║  ❌ DATA NOT FOUND    ║\n╠══════════════════════╣\n🔎  Input : ${term}\n⚠️  Data nahi mila\n╚══════════════════════╝`
      );
      return;
    }

    if (userId) dbIncrSearch(userId);

    let tgBlock =
      `┌─────────────────────────┐\n│  🔎  TG LOOKUP           │\n├─────────────────────────┤\n` +
      `${cbMd("💻 TG Username", term)}\n` +
      `${cbMd("🆔 Telegram ID", data.tgId || "N/A")}\n` +
      `${cbMd("📞 Phone      ", data.number || "N/A")}\n` +
      `${cbMd("🌍 Country    ", data.country || "N/A")}\n` +
      `${cbMd("📱 Country Code", data.countryCode || "+91")}\n` +
      `└─────────────────────────┘\n`;

    let cleanPhone = data.number.replace(/[+\s]/g,"");
    if (cleanPhone.startsWith("91") && cleanPhone.length > 10) cleanPhone = cleanPhone.slice(2);

    const numResult = await fetchNumApi(cleanPhone);
    const deepApiRaw = await fetchDeepApi(data.number);

    const numError = numResult.error || false;
    const records = numError ? [] : numResult;

    if (numError && apiToggle.num.enabled) {
      tgBlock += `\n⚠️  Number API unavailable – showing Deep Intel only.\n\n`;
    } else if (records && records.length > 0 && apiToggle.num.enabled) {
      tgBlock += "\n" + formatNumResult(records, cleanPhone);
    }

    const deepParsed = parseNewDeepApiResponse(deepApiRaw);
    const deepFmt = formatDeepResult(deepParsed, cleanPhone);
    if (deepFmt) {
      tgBlock += deepFmt;
    }

    await sendDataFound(chatId, userMsgId, tgBlock);
  } catch (e) {
    console.error("[TG LOOKUP]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  Kuch gadbad ho gayi.");
  }
}

// (handleAdhar, handleUpi, handleVehicle remain exactly as before – omitted for brevity but they are unchanged)
// We'll keep them in the final code but not re-paste them here to save space.

// ── Rest of the code (callbacks, admin, webhook, start) unchanged ──
// The final complete code is provided below.

start();
