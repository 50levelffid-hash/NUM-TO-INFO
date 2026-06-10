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

const NUM_API_URL     = "https://movements-invoice-amanda-victoria.trycloudflare.com/search/number?number={number}&key=mysecretkey123";
const SECOND_API_URL  = "https://surya.suryahacker.workers.dev/?query={number}";
const ADHAR_API_URL   = "https://surya.suryahacker.workers.dev/?query={number}";
const TG_USERNAME_API = "https://username-usrid-to-num.onrender.com/username/{username}?key=b5e6f7ca9a0da02d5190aa3c9bef1d73";
const TG_USERID_API   = "https://username-usrid-to-num.onrender.com/userid={userid}?key=b5e6f7ca9a0da02d5190aa3c9bef1d73";
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

// ── API TOGGLE STATE ──────────────────────────
// Admin ek click se kisi bhi TG API ko on/off kar sakta hai
const apiToggle = {
  tg_primary:  true,   // TG_USERNAME_API / TG_USERID_API
  tg_fallback: true,   // TG_FALLBACK_API
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
    mongoClient = new MongoClient(MONGO_URI, { maxPoolSize: 100, minPoolSize: 10, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 30000 });
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
    { $set: { user_id: from.id, username: from.username||"", name: [from.first_name,from.last_name].filter(Boolean).join(" "), first_name: from.first_name||"", last_name: from.last_name||"", last_seen: now }, $setOnInsert: { first_seen: now } },
    { upsert: true }
  ).catch(e => console.error("[DB SAVE USER]", e.message));
}

async function dbSaveData(key, value) {
  if (!dataCol) return;
  dataCol.updateOne({ key }, { $set: { key, value, updated_at: new Date().toISOString() } }, { upsert: true }).catch(e => console.error("[DB SAVE DATA]", e.message));
}

async function dbGetAllUsers() {
  if (!usersCol) return [];
  try { return await usersCol.find({}, { projection: { _id: 0 } }).toArray(); } catch (e) { return []; }
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

// ── KEY FIX: MarkdownV2 escape ────────────────
// Underscore, asterisk, dot etc sab escape hone chahiye MarkdownV2 me
// Ye function sab special chars escape karta hai
function escMd(text) {
  if (text == null) return "";
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}

// Code block me value dikhao — safer than inline backtick
function cbMd(label, value) {
  const v = (value != null ? String(value).trim() : "");
  if (v && !["N/A","","None","null","nan"].includes(v))
    return `${escMd(label)}: \`${escMd(v)}\``;
  return `${escMd(label)}: ❌ N/A`;
}

// MarkdownV2 me sab messages bhejo
const sendMessage     = (chat_id, text, extra = {}) => tgApi("sendMessage",     { chat_id, text, parse_mode: "MarkdownV2", disable_web_page_preview: true, ...extra });
const editMessageText = (chat_id, message_id, text, extra = {}) => tgApi("editMessageText", { chat_id, message_id, text, parse_mode: "MarkdownV2", disable_web_page_preview: true, ...extra });
const deleteMessage   = (chat_id, message_id) => tgApi("deleteMessage", { chat_id, message_id });
const answerCallback  = (callback_query_id, text = "", show_alert = false) => tgApi("answerCallbackQuery", { callback_query_id, text, show_alert });
const getChatMember   = (chat_id, user_id) => tgApi("getChatMember", { chat_id, user_id });
const setMyCommands   = (commands) => tgApi("setMyCommands", { commands });
const setWebhook      = (url) => tgApi("setWebhook", { url, drop_pending_updates: true });

// Plain text send (no markdown) — for messages with unpredictable content
const sendPlain = (chat_id, text, extra = {}) => tgApi("sendMessage", { chat_id, text, disable_web_page_preview: true, ...extra });

// ── sendData helpers ──────────────────────────
async function sendDataNotFound(chatId, userMsgId, notFoundText) {
  const extra = userMsgId ? { reply_to_message_id: userMsgId } : {};
  const notFoundMsg = await sendPlain(chatId, notFoundText, extra);
  setTimeout(() => {
    if (notFoundMsg) deleteMessage(chatId, notFoundMsg.message_id);
    if (userMsgId)   deleteMessage(chatId, userMsgId);
  }, 15000);
}

// Data result bhejo — MarkdownV2 safe text
async function sendDataFound(chatId, userMsgId, text) {
  const extra = userMsgId ? { reply_to_message_id: userMsgId } : {};
  // Try MarkdownV2 first, fallback to plain if fails
  const res = await sendMessage(chatId, text, extra);
  if (!res) {
    // Strip all markdown, send plain
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
  if (joinCache.size > 5000) { const cutoff = Date.now() - JOIN_CACHE_TTL; for (const [k,v] of joinCache) { if (v.ts < cutoff) joinCache.delete(k); } }
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
  await sendPlain(chatId,
    "╔════════════════════════╗\n║  🔒  ACCESS LOCKED  🔒  ║\n╠════════════════════════╣\n📢  Sabhi channels JOIN karo\n⚡  Phir ✅ VERIFY dabao\n╚════════════════════════╝",
    { reply_markup: { inline_keyboard: buttons } }
  );
  return true;
}

// ── MENUS ─────────────────────────────────────
const MAIN_MENU_TEXT =
  "╔══════════════════════════╗\n" +
  "║  ⚡️  R T F   B O T  ⚡️   ║\n" +
  "╠══════════════════════════╣\n" +
  "🟢  Status  : ONLINE\n" +
  "👑  Owner   : @RTFGAMMING\n" +
  "🔥  Version : v3.0\n" +
  "╠══════════════════════════╣\n" +
  "📌  Neeche se option chuno:\n" +
  "╚══════════════════════════╝";

const HELP_TEXT =
  "╔══════════════════════════╗\n" +
  "║  📖  B O T   H E L P    ║\n" +
  "╠══════════════════════════╣\n" +
  "📞  /num <number>\n" +
  "   Example: /num 9876543210\n\n" +
  "🔎  /tg <username ya userid>\n" +
  "   Example: /tg rtfgamming\n" +
  "   Example: /tg 8518042438\n\n" +
  "🪪  /adhar <aadhaar_no>\n" +
  "   Example: /adhar 598229659586\n\n" +
  "💳  /upi <upi_id>\n" +
  "   Example: /upi 70497398@axl\n\n" +
  "🚗  /vehicle <reg_number>\n" +
  "   Example: /vehicle MH02FZ0555\n\n" +
  "🏠 /start  ❓ /help\n" +
  "╠══════════════════════════╣\n" +
  "👑  Owner : @RTFGAMMING\n" +
  "╚══════════════════════════╝";

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
    [{ text: "✏️ Set Custom TG Data", callback_data: "menu_setcustomtg" }],
    [{ text: "🗄️ Database Backup", callback_data: "menu_dbbackup" }],
    [{ text: "🔌 API Manager", callback_data: "menu_api" }],
  ]};
}

// ── API MANAGER PANEL ─────────────────────────
function apiManagerKb() {
  const p1 = apiToggle.tg_primary  ? "🟢 ON" : "🔴 OFF";
  const p2 = apiToggle.tg_fallback ? "🟢 ON" : "🔴 OFF";
  return { inline_keyboard: [
    [{ text: `🔌 TG Primary API — ${p1}`,  callback_data: "api_tog_primary"  }],
    [{ text: `🔌 TG Fallback API — ${p2}`, callback_data: "api_tog_fallback" }],
    [{ text: "🔙 Back", callback_data: "menu_adminpanel" }],
  ]};
}

function apiManagerText() {
  const p1Status = apiToggle.tg_primary  ? "🟢 ACTIVE" : "🔴 DISABLED";
  const p2Status = apiToggle.tg_fallback ? "🟢 ACTIVE" : "🔴 DISABLED";
  return (
    "╔══════════════════════════╗\n" +
    "║  🔌  TG API MANAGER      ║\n" +
    "╠══════════════════════════╣\n" +
    "TG Primary API\n" +
    `   URL: username-usrid-to-num.onrender.com\n` +
    `   Status: ${p1Status}\n\n` +
    "TG Fallback API\n" +
    `   URL: krish-osintoy.lovable.app\n` +
    `   Status: ${p2Status}\n\n` +
    "Button dabao toggle karne ke liye:\n" +
    "╚══════════════════════════╝"
  );
}

// ── FORMAT HELPERS (MarkdownV2 safe) ──────────
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
    `┌─────────────────────────┐\n` +
    `│  📞  NUMBER INFO         │\n` +
    `├─────────────────────────┤\n` +
    `📱  Number  : \`${escMd(number)}\`\n` +
    `📊  Records : ${Math.min(records.length,5)} found\n\n`;
  records.slice(0,5).forEach((r,i) => {
    const dot = colors[i % colors.length];
    out +=
      `${dot}━━━ RECORD ${i+1} ━━━${dot}\n` +
      `${cbMd("👤 Name   ",r.name)}\n` +
      `${cbMd("👨 Father ",r.fname)}\n` +
      `${cbMd("📍 Address",r.address)}\n` +
      `${cbMd("📡 Circle ",r.circle)}\n` +
      `${cbMd("☎️  Alt Num",r.alt)}\n` +
      `${cbMd("🪪 Aadhar ",r.aadhar)}\n` +
      `${cbMd("✉️  Email  ",r.email)}\n\n`;
  });
  out += `└─────────────────────────┘\n👑  ${escMd(OWNER)}  \\|  ⚡ ACTIVE`;
  return out;
}

function formatDeepData(data) {
  if (!data || !data.length) return null;
  const colors = ["🔴","🟠","🟡","🟢","🔵","🟣"];
  let text = "┌─────────────────────────┐\n│  🔬  DEEP DATA           │\n├─────────────────────────┤\n";
  let has = false;
  data.forEach((r, i) => {
    if (typeof r !== "object") return;
    has = true;
    const dot = colors[i % colors.length];
    text +=
      `${dot}━━━ RECORD ${i+1} ━━━${dot}\n` +
      `${cbMd("👤 Name   ",r.FullName)}\n` +
      `${cbMd("👨 Father ",r.FatherName)}\n` +
      `${cbMd("📞 Phone1 ",r.Phone)}\n` +
      `${cbMd("📞 Phone2 ",r.Phone2)}\n` +
      `${cbMd("📞 Phone3 ",r.Phone3)}\n` +
      `${cbMd("📞 Phone4 ",r.Phone4)}\n` +
      `${cbMd("📞 Phone5 ",r.Phone5)}\n` +
      `${cbMd("📍 Address",r.Adres)}\n` +
      `${cbMd("📡 Region ",r.Region)}\n\n`;
  });
  if (!has) return null;
  text += "└─────────────────────────┘";
  return text;
}

function formatAdharResult(data, adharNumber) {
  try {
    const result  = (data.result || {});
    const results = (result.results || []);
    if (!results.length) return null;
    const entry   = results[0];
    const rc      = entry.ration_card_details || {};
    const addl    = entry.additional_info     || {};
    const members = entry.members             || [];
    const central = addl.exists_in_central_repository ? "✅ YES" : "❌ NO";
    let out =
      `┌─────────────────────────┐\n│  🪪  AADHAAR              │\n├─────────────────────────┤\n` +
      `🔢  Aadhaar : \`${escMd(adharNumber)}\`\n\n` +
      `📋━━━ RATION CARD ━━━📋\n` +
      `${cbMd("🪪  Card No  ",rc.ration_card_no)}\n` +
      `${cbMd("📌  Scheme   ",rc.scheme_name)}\n` +
      `${cbMd("📍  District ",rc.district_name)}\n` +
      `${cbMd("🗺️  State    ",rc.state_name)}\n` +
      `${cbMd("🏪  FPS Type ",addl.fps_category)}\n` +
      `🏛️  Central  : ${central}\n\n` +
      `👨‍👩‍👧‍👦━━━ FAMILY \\(${members.length}\\) ━━━👨‍👩‍👧‍👦\n`;
    const colors = ["🔴","🟠","🟡","🟢","🔵","🟣","⚪"];
    members.forEach((m, i) => {
      out += `${colors[i % colors.length]}  \\[${m.s_no || i+1}\\]  \`${escMd(m.member_name || "N/A")}\`\n`;
    });
    out += `\n└─────────────────────────┘\n👑  ${escMd(OWNER)}  \\|  ⚡ ACTIVE`;
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
    const lines = [
      "╔══════════════════════════════╗",
      "║  🗄️  DATABASE BACKUP REPORT   ║",
      "╠══════════════════════════════╣",
      `📊  Total Users : ${total}`,
      `🕐  Generated   : ${new Date().toISOString().slice(0,16).replace("T"," ")} UTC`,
      "╠══════════════════════════════╣",
    ];
    allUsers.forEach((u, i) => {
      lines.push(`${i+1}. ${u.name||"no name"} | ${u.username ? "@"+u.username : "no username"} | ID: ${u.user_id||"N/A"}`);
      lines.push(`   📅 First: ${(u.first_seen||"").slice(0,10)||"N/A"}  |  Last: ${(u.last_seen||"").slice(0,10)||"N/A"}`);
    });
    lines.push("╚══════════════════════════════╝");
    const fullText = lines.join("\n");
    if (fullText.length > 4000) {
      const buf  = Buffer.from(fullText, "utf8");
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("caption", `🗄️ RTF Bot DB Backup — ${total} users`);
      form.append("document", buf, { filename: `rtfbot_backup_${new Date().toISOString().slice(0,10)}.txt`, contentType: "text/plain" });
      await fetch(`${TG_BASE}/sendDocument`, { method: "POST", body: form, ...agentFor(TG_BASE) });
      deleteMessage(chatId, statusMsg.message_id);
    } else {
      await tgApi("editMessageText", { chat_id: chatId, message_id: statusMsg.message_id, text: fullText });
    }
  } catch (e) { console.error("[DB BACKUP]", e); tgApi("editMessageText", { chat_id: chatId, message_id: statusMsg.message_id, text: `❌  Backup failed: ${e.message}` }); }
}

// ── API FETCHERS ──────────────────────────────
async function apiFetch(url, timeout = 15000) {
  const res  = await fetch(url, { signal: AbortSignal.timeout(timeout), ...agentFor(url) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchDeepApi(number) {
  let raw = String(number).replace(/[+\s]/g,"");
  if (!raw.startsWith("91")) raw = "91" + raw;
  try {
    const data = await apiFetch(SECOND_API_URL.replace("{number}", raw));
    const records = [];
    if (data && typeof data === "object" && !Array.isArray(data)) {
      if (data.data && typeof data.data === "object") {
        for (const val of Object.values(data.data)) {
          if (val && val.records && Array.isArray(val.records)) records.push(...val.records.filter(r => typeof r === "object"));
        }
      } else if (Array.isArray(data.records)) { records.push(...data.records.filter(r => typeof r === "object")); }
    } else if (Array.isArray(data)) { records.push(...data.filter(r => typeof r === "object")); }
    return records;
  } catch (e) { console.error("[DEEP API]", e.message); return []; }
}

async function fetchNumApi(cleanPhone) {
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

// ── KEY FIX: TG API toggle check ─────────────
// Agar primary off hai to seedha fallback jaao
// Agar fallback off hai to sirf primary use karo
// Agar dono off hain to error message
async function fetchTgData(term) {
  const isUserId = /^\d+$/.test(term);
  let tgId = "N/A", targetUname = term, phone = null, countryCode = null, usedFallback = false;

  // Step 1: Primary API (agar on hai)
  if (apiToggle.tg_primary) {
    try {
      const url  = isUserId ? TG_USERID_API.replace("{userid}", term) : TG_USERNAME_API.replace("{username}", term);
      const data = await apiFetch(url, 20000);
      if (data && data.status && data.target_id) {
        const p = parseTgPrimary(data, term);
        tgId = p.tgId; targetUname = p.targetUname; phone = p.phone; countryCode = p.countryCode;
      }
    } catch (e) { console.error("[TG PRIMARY]", e.message); }
  } else {
    console.log("[TG] Primary API disabled — skipping");
  }

  // Step 2: Fallback API (agar phone nahi mila AND fallback on hai)
  if (!phone && apiToggle.tg_fallback) {
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
  } else if (!phone) {
    console.log("[TG] Fallback API disabled — skipping");
  }

  return { tgId, targetUname, phone, countryCode, usedFallback };
}

// ══════════════════════════════════════════════
//  LOOKUP HANDLERS
// ══════════════════════════════════════════════

async function handleNumber(chatId, number, userMsgId = null) {
  const statusMsg = await sendPlain(chatId, `🔍  Searching: ${number} ...`);
  try {
    let clean = number.trim().replace(/\s/g,"").replace("+91","");
    if (clean.startsWith("91") && clean.length > 10) clean = clean.slice(2);
    const [records, deepData] = await Promise.all([fetchNumApi(clean), fetchDeepApi(number)]);
    deleteMessage(chatId, statusMsg.message_id);
    if (!records.length) {
      await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n📱  Number: ${clean}\n⚠️  Koi record nahi mila`);
      return;
    }
    let full = formatNumResult(records, clean);
    const deep = formatDeepData(deepData);
    if (deep) full += "\n\n" + deep;
    await sendDataFound(chatId, userMsgId, full);
  } catch (e) {
    console.error("[NUM LOOKUP]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  API Error / Timeout.");
  }
}

async function handleTg(chatId, term, userMsgId = null) {
  term = term.trim().replace(/^@/,"");
  if (!term) { await sendDataNotFound(chatId, userMsgId, "❌  Kuch toh bhejo!\n✅ /tg rtfgamming\n✅ /tg 8518042438"); return; }

  const termKey = term.toLowerCase();
  if (customTgData.has(termKey)) { await sendDataFound(chatId, userMsgId, customTgData.get(termKey)); return; }

  // Both APIs off check
  if (!apiToggle.tg_primary && !apiToggle.tg_fallback) {
    await sendDataNotFound(chatId, userMsgId, "╔══════════════════════╗\n║  ⚠️  APIs DISABLED    ║\n╠══════════════════════╣\nDono TG APIs off hain.\nAdmin se contact karo.\n╚══════════════════════╝");
    return;
  }

  const isUserId  = /^\d+$/.test(term);
  const statusMsg = await sendPlain(chatId, `🔍  Searching TG ${isUserId ? "UserID" : "Username"}: ${isUserId ? "#" : "@"}${term} ...`);

  try {
    const { tgId, targetUname, phone, countryCode, usedFallback } = await fetchTgData(term);

    deleteMessage(chatId, statusMsg.message_id);

    if (!phone && tgId === "N/A") {
      await sendDataNotFound(chatId, userMsgId, `╔══════════════════════╗\n║  ❌ DATA NOT FOUND    ║\n╠══════════════════════╣\n🔎  Input : ${term}\n⚠️  Data nahi mila\n╚══════════════════════╝`);
      return;
    }

    const srcLabel = usedFallback ? "🔁 Fallback" : "✅ Primary";
    const uDisplay = /^\d+$/.test(targetUname) ? targetUname : `@${targetUname}`;

    let tgBlock =
      `┌─────────────────────────┐\n` +
      `│  🔎  TG LOOKUP           │\n` +
      `├─────────────────────────┤\n` +
      `${cbMd("💻 Username    ", uDisplay)}\n` +
      `${cbMd("🆔 Telegram ID ", tgId)}\n` +
      `${cbMd("📞 Phone       ", phone || "N/A")}\n` +
      `${cbMd("🌍 Country Code", countryCode || "N/A")}\n` +
      `🔌  Source       : ${escMd(srcLabel)}\n` +
      `└─────────────────────────┘\n`;

    if (phone) {
      let cleanPhone = phone.replace(/[+\s]/g,"");
      if (cleanPhone.startsWith("91") && cleanPhone.length > 10) cleanPhone = cleanPhone.slice(2);
      const [numRes, deepRes] = await Promise.all([fetchNumApi(cleanPhone), fetchDeepApi(phone)]);
      if (numRes.length) tgBlock += "\n" + formatNumResult(numRes, cleanPhone);
      if (deepRes.length) { const df = formatDeepData(deepRes); if (df) tgBlock += "\n\n" + df; }
    }

    await sendDataFound(chatId, userMsgId, tgBlock);

  } catch (e) {
    console.error("[TG LOOKUP]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  Kuch gadbad ho gayi.");
  }
}

async function handleAdhar(chatId, adharRaw, userMsgId = null) {
  const statusMsg = await sendPlain(chatId, `🔍  Searching Aadhaar: ${adharRaw} ...`);
  try {
    const data = await apiFetch(ADHAR_API_URL.replace("{number}", adharRaw));
    deleteMessage(chatId, statusMsg.message_id);
    const resultObj   = data.result || {};
    const resultsList = resultObj.results || [];
    if (!data.success && !resultObj.success && !resultsList.length) {
      await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n🪪  Aadhaar: ${adharRaw}`);
      return;
    }
    const formatted = formatAdharResult(data, adharRaw);
    if (!formatted) { await sendDataNotFound(chatId, userMsgId, `❌  Data format error — Aadhaar: ${adharRaw}`); return; }
    await sendDataFound(chatId, userMsgId, formatted);
  } catch (e) {
    console.error("[ADHAR]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  API Error / Timeout.");
  }
}

async function handleUpi(chatId, upiId, userMsgId = null) {
  const statusMsg = await sendPlain(chatId, `🔍  Searching UPI: ${upiId} ...`);
  try {
    const data = await apiFetch(UPI_API_URL.replace("{upi}", upiId.trim()));
    deleteMessage(chatId, statusMsg.message_id);
    if (!data.success) { await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ❌ UPI NOT FOUND   ║\n╚══════════════════╝\n💳  UPI: ${upiId}`); return; }
    await sendDataFound(chatId, userMsgId, formatUpiResult(data, upiId));
  } catch (e) {
    console.error("[UPI]", e.message);
    deleteMessage(chatId, statusMsg.message_id);
    await sendPlain(chatId, "❌  API Error / Timeout.");
  }
}

async function handleVehicle(chatId, vehicleNo, userMsgId = null) {
  vehicleNo = vehicleNo.trim().toUpperCase().replace(/\s/g,"");
  const statusMsg = await sendPlain(chatId, `🔍  Searching Vehicle: ${vehicleNo} ...`);
  try {
    const data = await apiFetch(VEHICLE_API_URL.replace("{vehicle}", vehicleNo), 20000);
    deleteMessage(chatId, statusMsg.message_id);
    if (!data.success) { await sendDataNotFound(chatId, userMsgId, `╔══════════════════════╗\n║  ❌ VEHICLE NOT FOUND  ║\n╚══════════════════════╝\n🚗  Vehicle: ${vehicleNo}`); return; }
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

  // API toggle callbacks — admin only
  if (data === "api_tog_primary" && _isAdmin) {
    apiToggle.tg_primary = !apiToggle.tg_primary;
    await answerCallback(cb.id, `TG Primary API ${apiToggle.tg_primary ? "🟢 ON" : "🔴 OFF"}`, true);
    await tgApi("editMessageText", { chat_id: chatId, message_id: msgId, text: apiManagerText(), reply_markup: apiManagerKb() });
    return;
  }
  if (data === "api_tog_fallback" && _isAdmin) {
    apiToggle.tg_fallback = !apiToggle.tg_fallback;
    await answerCallback(cb.id, `TG Fallback API ${apiToggle.tg_fallback ? "🟢 ON" : "🔴 OFF"}`, true);
    await tgApi("editMessageText", { chat_id: chatId, message_id: msgId, text: apiManagerText(), reply_markup: apiManagerKb() });
    return;
  }

  await answerCallback(cb.id);

  if (!_isAdmin && !(await checkJoin(from.id))) { await sendJoinPrompt(chatId); return; }

  const prompts = {
    menu_number:  "╔════════════════════╗\n║  📞 NUMBER LOOKUP  ║\n╚════════════════════╝\n📥  Number bhejo:\n📌 Format: 9876543210",
    menu_tg:      "╔═══════════════════════╗\n║   🔎  TG LOOKUP       ║\n╠═══════════════════════╣\n📥  Username YA numeric ID\n✅  rtfgamming\n✅  @rtfgamming\n✅  8518042438\n╚═══════════════════════╝",
    menu_adhar:   "╔══════════════════════╗\n║  🪪  AADHAAR LOOKUP  ║\n╚══════════════════════╝\n📥  Aadhaar number bhejo:\n📌 Example: 598229659586",
    menu_upi:     "╔══════════════════════╗\n║  💳  UPI LOOKUP      ║\n╚══════════════════════╝\n📥  UPI ID bhejo:\n📌 Example: 70497398@axl",
    menu_vehicle: "╔══════════════════════╗\n║  🚗  VEHICLE LOOKUP  ║\n╚══════════════════════╝\n📥  Vehicle number bhejo:\n📌 Example: MH02FZ0555",
  };
  const stateMap = { menu_number:"number", menu_tg:"tg", menu_adhar:"adhar", menu_upi:"upi", menu_vehicle:"vehicle" };

  if (stateMap[data]) { userState.set(from.id, stateMap[data]); await sendPlain(chatId, prompts[data]); return; }
  if (data === "menu_help")  { await sendPlain(chatId, HELP_TEXT); return; }
  if (data === "menu_owner") { await sendPlain(chatId, "╔══════════════════╗\n║  👑  OWNER INFO   ║\n╚══════════════════╝\n🔗 Telegram: @RTFGAMMING\nhttps://t.me/RTFGAMMING"); return; }

  if (!_isAdmin) return;

  if (data === "menu_users")      { const count = await dbUserCount(); await sendPlain(chatId, `📊 Total Users: ${count}\n🗄️ Source: MongoDB`); return; }
  if (data === "menu_dbbackup")   { await sendDbBackup(chatId); return; }
  if (data === "menu_adminlist")  { await sendPlain(chatId, "╔══════════════════╗\n║  📋 ADMIN LIST   ║\n╚══════════════════╝\n" + admins.map(a=>`• ${a}`).join("\n")); return; }
  if (data === "menu_broadcast")  { userState.set(from.id, "broadcast"); await sendPlain(chatId, "📢  Broadcast message type karo:"); return; }
  if (data === "menu_setcustomtg"){ userState.set(from.id, "setcustomtg_step1"); await sendPlain(chatId, "╔══════════════════════════╗\n║  ✏️  SET CUSTOM TG DATA   ║\n╠══════════════════════════╣\n📥  Username bhejo jiska data set karna hai\n📌  Example: rtfgamming\n╚══════════════════════════╝"); return; }

  if (data === "menu_api") {
    await tgApi("editMessageText", { chat_id: chatId, message_id: msgId, text: apiManagerText(), reply_markup: apiManagerKb() });
    return;
  }

  if (data === "menu_adminpanel") {
    await sendPlain(chatId, "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n📢  /broadcast <msg>\n👥  /users\n➕  /addadmin @user\n➖  /removeadmin @user\n📋  /listadmins\n✏️  /setcustomtg @user <data>\n🗑️  /delcustomtg @user\n📋  /listcustomtg\n🗄️  /dbbackup\n🔌  /apimanager\n╚══════════════════════════╝");
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

    if (_isAdmin && ["/broadcast","/addadmin","/removeadmin","/users","/listadmins","/admin","/setcustomtg","/delcustomtg","/listcustomtg","/dbbackup","/apimanager"].some(c => text.toLowerCase().startsWith(c))) {
      return await handleAdminText(chatId, from.id, text);
    }

    const choice = userState.get(from.id);
    if (!choice) return;

    if (!_isAdmin && !(await checkJoin(from.id))) { await sendJoinPrompt(chatId); return; }

    if (choice === "broadcast" && _isAdmin) {
      const users = await dbGetAllUsers();
      const uids  = users.map(u => u.user_id);
      const status = await sendPlain(chatId, `📤  Broadcasting to ${uids.length} users...`);
      let ok = 0, fail = 0;
      for (const uid of uids) { const r = await tgApi("sendMessage", { chat_id: uid, text }); r ? ok++ : fail++; await new Promise(r => setTimeout(r, 50)); }
      await tgApi("editMessageText", { chat_id: chatId, message_id: status.message_id, text: `╔══════════════════╗\n║  📢 BROADCAST DONE  ║\n╚══════════════════╝\n✅  Delivered : ${ok}\n❌  Failed    : ${fail}\n👥  Total     : ${uids.length}` });
    }
    else if (choice === "number")  { await handleNumber(chatId, text, msgId); }
    else if (choice === "tg")      { await handleTg(chatId, text, msgId); }
    else if (choice === "adhar")   { await handleAdhar(chatId, text, msgId); }
    else if (choice === "upi")     { await handleUpi(chatId, text, msgId); }
    else if (choice === "vehicle") { await handleVehicle(chatId, text, msgId); }
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
  if (lower === "/admin") { await sendPlain(chatId, "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n📢  /broadcast <msg>\n👥  /users\n➕  /addadmin @user\n➖  /removeadmin @user\n📋  /listadmins\n✏️  /setcustomtg @user <data>\n🗑️  /delcustomtg @user\n📋  /listcustomtg\n🗄️  /dbbackup\n🔌  /apimanager\n╚══════════════════════════╝"); return; }
  if (lower === "/apimanager") { await sendPlain(chatId, apiManagerText(), { reply_markup: apiManagerKb() }); return; }
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
  if (lower === "/users") { const count = await dbUserCount(); await sendPlain(chatId, `📊  Total Users: ${count}\n🗄️ Source: MongoDB`); return; }
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
  else if (cmd === "num")     { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /num <number>"); return; } await handleNumber(chatId, args.trim(), msgId); }
  else if (cmd === "tg")      { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /tg <username ya userid>"); return; } await handleTg(chatId, args.trim(), msgId); }
  else if (cmd === "adhar")   { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /adhar <aadhaar_number>"); return; } await handleAdhar(chatId, args.trim(), msgId); }
  else if (cmd === "upi")     { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /upi <upi_id>"); return; } await handleUpi(chatId, args.trim(), msgId); }
  else if (cmd === "vehicle") { if (!args.trim()) { await sendPlain(chatId, "❌  Usage: /vehicle <reg_number>"); return; } await handleVehicle(chatId, args.trim(), msgId); }
  else if (_isAdm)            { await handleAdminText(chatId, from.id, text); }
}

// ── EXPRESS WEBHOOK ───────────────────────────
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update) return;

  if (update.callback_query) {
    const uid = update.callback_query.from.id;
    queueForUser(uid, () => handleCallback(update.callback_query));
    return;
  }

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
  } else {
    console.warn("[BOT] WEBHOOK_URL not set");
  }
  app.listen(PORT, () => console.log(`[BOT] Server listening on port ${PORT} ✅`));
}

start();
