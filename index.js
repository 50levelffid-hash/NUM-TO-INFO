"use strict";

const express       = require("express");
const fetch         = require("node-fetch");
const FormData      = require("form-data");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json());

// ── CONFIG ──────────────────────────────────
const BOT_TOKEN   = process.env.BOT_TOKEN   || "";
const MONGO_URI   = process.env.MONGO_URI   || "";
const PORT        = process.env.PORT        || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const OWNER       = "@RTFGAMMING";

const NUM_API_URL     = "https://movements-invoice-amanda-victoria.trycloudflare.com/search/number?number={number}&key=mysecretkey123";
const SECOND_API_URL  = "https://surya.suryahacker.workers.dev/?query={number}";
const ADHAR_API_URL   = "https://surya.suryahacker.workers.dev/?query={number}";
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
const userState    = {};
const customTgData = {};

// ── MongoDB ──────────────────────────────────
let mongoClient, db, usersCol, dataCol;

async function initDb() {
  if (!MONGO_URI) { console.warn("[DB] MONGO_URI not set — DB disabled"); return; }
  try {
    mongoClient = new MongoClient(MONGO_URI, { maxPoolSize: 50, minPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    await mongoClient.connect();
    db       = mongoClient.db("rtfbot");
    usersCol = db.collection("users");
    dataCol  = db.collection("saved_data");
    await usersCol.createIndex({ user_id: 1 }, { unique: true });
    await dataCol.createIndex({ key: 1 });
    console.log("[DB] MongoDB connected ✅");
  } catch (e) {
    console.error("[DB ERROR]", e.message);
    mongoClient = null;
  }
}

async function dbSaveUser(from) {
  if (!usersCol) return;
  try {
    const now = new Date().toISOString();
    await usersCol.updateOne(
      { user_id: from.id },
      {
        $set: { user_id: from.id, username: from.username || "", name: [from.first_name, from.last_name].filter(Boolean).join(" "), first_name: from.first_name || "", last_name: from.last_name || "", last_seen: now },
        $setOnInsert: { first_seen: now }
      },
      { upsert: true }
    );
  } catch (e) { console.error("[DB SAVE USER]", e.message); }
}

async function dbSaveData(key, value) {
  if (!dataCol) return;
  try {
    await dataCol.updateOne({ key }, { $set: { key, value, updated_at: new Date().toISOString() } }, { upsert: true });
  } catch (e) { console.error("[DB SAVE DATA]", e.message); }
}

async function dbGetAllUsers() {
  if (!usersCol) return [];
  try { return await usersCol.find({}, { projection: { _id: 0 } }).toArray(); }
  catch (e) { console.error("[DB GET USERS]", e.message); return []; }
}

async function dbUserCount() {
  if (!usersCol) return 0;
  try { return await usersCol.countDocuments(); }
  catch (e) { return 0; }
}

// ── TELEGRAM API ─────────────────────────────
const TG_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tgApi(method, body = {}) {
  try {
    const res  = await fetch(`${TG_BASE}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!json.ok) { console.error(`[TG ${method}]`, json.description); return null; }
    return json.result;
  } catch (e) { console.error(`[TG ${method}]`, e.message); return null; }
}

const sendMessage     = (chat_id, text, extra = {}) => tgApi("sendMessage",     { chat_id, text, parse_mode: "Markdown", disable_web_page_preview: true, ...extra });
const editMessageText = (chat_id, message_id, text, extra = {}) => tgApi("editMessageText", { chat_id, message_id, text, parse_mode: "Markdown", disable_web_page_preview: true, ...extra });
const deleteMessage   = (chat_id, message_id) => tgApi("deleteMessage",   { chat_id, message_id });
const answerCallback  = (callback_query_id, text = "", show_alert = false) => tgApi("answerCallbackQuery", { callback_query_id, text, show_alert });
const getChatMember   = (chat_id, user_id)    => tgApi("getChatMember",   { chat_id, user_id });
const setMyCommands   = (commands)            => tgApi("setMyCommands",   { commands });
const setWebhook      = (url)                 => tgApi("setWebhook",      { url, drop_pending_updates: true });

// ─────────────────────────────────────────────
//  KEY FIX: sendDataNotFound
//  Jab data nahi mila:
//    1. "Data Not Found" reply bhejo user ke command message ka reply me
//    2. 15 second baad: user ka command message DELETE + data not found message DELETE
//    3. Agar data mila: sirf reply me data bhejo, kuch delete mat karo
// ─────────────────────────────────────────────

async function sendDataNotFound(chatId, userMsgId, notFoundText) {
  // Step 1: Data not found ka message bhejo — user ke command ka reply
  const extra = userMsgId ? { reply_to_message_id: userMsgId } : {};
  const notFoundMsg = await sendMessage(chatId, notFoundText, extra);

  // Step 2: 15 second baad dono delete karo
  setTimeout(async () => {
    if (notFoundMsg) await deleteMessage(chatId, notFoundMsg.message_id);
    if (userMsgId)   await deleteMessage(chatId, userMsgId);
  }, 15000);
}

// Data mila — sirf reply me bhejo, kuch delete nahi
async function sendDataFound(chatId, userMsgId, text) {
  const extra = userMsgId ? { reply_to_message_id: userMsgId } : {};
  return sendMessage(chatId, text, extra);
}

// ── JOIN CHECK ────────────────────────────────
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
  return (await getNotJoinedChannels(userId)).length === 0;
}

function isAdmin(username) {
  return admins.map(a => a.toLowerCase()).includes(`@${(username || "").toLowerCase()}`);
}

async function sendJoinPrompt(chatId, callbackQueryId = null) {
  const missing = await getNotJoinedChannels(chatId);
  if (!missing.length) return false;
  const buttons = missing.map(ch => [{ text: `➕ ${ch.name}`, url: `https://t.me/${ch.username}` }]);
  buttons.push([{ text: "✅ VERIFY JOIN", callback_data: "verify" }]);
  const text = "╔════════════════════════╗\n║  🔒  ACCESS LOCKED  🔒  ║\n╠════════════════════════╣\n📢  Sabhi channels JOIN karo\n⚡  Phir ✅ VERIFY dabao\n╚════════════════════════╝";
  if (callbackQueryId) await answerCallback(callbackQueryId, "❌ Pehle sab channels join karo!", true);
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } });
  return true;
}

// ── MENUS ─────────────────────────────────────
const MAIN_MENU_TEXT = (
  "╔══════════════════════════╗\n" +
  "║  ⚡️  R T F   B O T  ⚡️   ║\n" +
  "╠══════════════════════════╣\n" +
  "🟢  Status  : ONLINE\n" +
  "👑  Owner   : @RTFGAMMING\n" +
  "🔥  Version : v3.0\n" +
  "╠══════════════════════════╣\n" +
  "📌  Neeche se option chuno:\n" +
  "╚══════════════════════════╝"
);

const HELP_TEXT = (
  "╔══════════════════════════╗\n" +
  "║  📖  B O T   H E L P    ║\n" +
  "╠══════════════════════════╣\n" +
  "📞  /num <number>\n" +
  "   ➜  Number ki full details\n" +
  "   📌 Example: /num 9876543210\n\n" +
  "🔎  /tg <username ya userid>\n" +
  "   ➜  TG Username OR numeric ID\n" +
  "   📌 Example: /tg rtfgamming\n" +
  "   📌 Example: /tg 8518042438\n\n" +
  "🪪  /adhar <aadhaar_no>\n" +
  "   ➜  Aadhaar + family + ration\n" +
  "   📌 Example: /adhar 598229659586\n\n" +
  "💳  /upi <upi_id>\n" +
  "   ➜  UPI ID se bank details\n" +
  "   📌 Example: /upi 70497398@axl\n\n" +
  "🚗  /vehicle <reg_number>\n" +
  "   ➜  Vehicle registration details\n" +
  "   📌 Example: /vehicle MH02FZ0555\n\n" +
  "🏠  /start  ➜  Main menu\n" +
  "❓  /help   ➜  Ye message\n" +
  "╠══════════════════════════╣\n" +
  "👑  Owner : @RTFGAMMING\n" +
  "╚══════════════════════════╝"
);

function mainMenuKb() {
  return { inline_keyboard: [
    [{ text: "📞 Number Lookup", callback_data: "menu_number" }, { text: "🔎 TG Lookup", callback_data: "menu_tg" }],
    [{ text: "🪪 Aadhaar Lookup", callback_data: "menu_adhar" }],
    [{ text: "💳 UPI Lookup",    callback_data: "menu_upi" }],
    [{ text: "🚗 Vehicle Lookup", callback_data: "menu_vehicle" }],
    [{ text: "❓ Help", callback_data: "menu_help" }, { text: "👑 Owner", callback_data: "menu_owner" }],
  ]};
}

function adminMenuKb() {
  return { inline_keyboard: [
    [{ text: "📞 Number Lookup", callback_data: "menu_number" }, { text: "🔎 TG Lookup", callback_data: "menu_tg" }],
    [{ text: "🪪 Aadhaar Lookup", callback_data: "menu_adhar" }],
    [{ text: "💳 UPI Lookup",    callback_data: "menu_upi" }],
    [{ text: "🚗 Vehicle Lookup", callback_data: "menu_vehicle" }],
    [{ text: "❓ Help", callback_data: "menu_help" }, { text: "👑 Owner", callback_data: "menu_owner" }],
    [{ text: "📢 Broadcast", callback_data: "menu_broadcast" }, { text: "👥 Users Count", callback_data: "menu_users" }],
    [{ text: "📋 Admin List", callback_data: "menu_adminlist" }, { text: "⚙️ Admin Panel", callback_data: "menu_adminpanel" }],
    [{ text: "✏️ Set Custom TG Data", callback_data: "menu_setcustomtg" }],
    [{ text: "🗄️ Database Backup", callback_data: "menu_dbbackup" }],
  ]};
}

// ── FORMAT HELPERS ────────────────────────────
function cb(label, value) {
  const v = (value != null ? String(value).trim() : "");
  if (v && !["N/A","","None","null","nan"].includes(v)) return `${label}: \`${v}\``;
  return `${label}: ❌ N/A`;
}

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
  let out = `┌─────────────────────────┐\n│  📞  N U M B E R  I N F O  │\n├─────────────────────────┤\n📱  Number  : \`${number}\`\n📊  Records : ${Math.min(records.length,5)} found\n\n`;
  records.slice(0,5).forEach((r,i) => {
    const dot = colors[i % colors.length];
    out += `${dot}━━━ RECORD ${i+1} ━━━${dot}\n${cb("👤 Name   ",r.name)}\n${cb("👨 Father ",r.fname)}\n${cb("📍 Address",r.address)}\n${cb("📡 Circle ",r.circle)}\n${cb("☎️  Alt Num",r.alt)}\n${cb("🪪 Aadhar ",r.aadhar)}\n${cb("✉️  Email  ",r.email)}\n\n`;
  });
  out += `└─────────────────────────┘\n👑  ${OWNER}  |  ⚡ ACTIVE`;
  return out;
}

function formatDeepData(data) {
  if (!data || !data.length) return null;
  const colors = ["🔴","🟠","🟡","🟢","🔵","🟣"];
  let text = "┌─────────────────────────┐\n│  🔬  D E E P   D A T A  │\n├─────────────────────────┤\n";
  let has = false;
  data.forEach((r, i) => {
    if (typeof r !== "object") return;
    has = true;
    const dot = colors[i % colors.length];
    text += `${dot}━━━ RECORD ${i+1} ━━━${dot}\n${cb("👤 Name   ",r.FullName)}\n${cb("👨 Father ",r.FatherName)}\n${cb("📞 Phone1 ",r.Phone)}\n${cb("📞 Phone2 ",r.Phone2)}\n${cb("📞 Phone3 ",r.Phone3)}\n${cb("📞 Phone4 ",r.Phone4)}\n${cb("📞 Phone5 ",r.Phone5)}\n${cb("📍 Address",r.Adres)}\n${cb("📡 Region ",r.Region)}\n\n`;
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
    let out = `┌─────────────────────────┐\n│  🪪  A A D H A A R       │\n├─────────────────────────┤\n🔢  Aadhaar : \`${adharNumber}\`\n\n📋━━━ RATION CARD ━━━📋\n${cb("🪪  Card No  ",rc.ration_card_no)}\n${cb("📌  Scheme   ",rc.scheme_name)}\n${cb("📍  District ",rc.district_name)}\n${cb("🗺️  State    ",rc.state_name)}\n${cb("🏪  FPS Type ",addl.fps_category)}\n🏛️  Central  : ${central}\n\n👨‍👩‍👧‍👦━━━ FAMILY (${members.length}) ━━━👨‍👩‍👧‍👦\n`;
    const colors = ["🔴","🟠","🟡","🟢","🔵","🟣","⚪"];
    members.forEach((m, i) => {
      out += `${colors[i % colors.length]}  [${m.s_no || i+1}]  \`${m.member_name || "N/A"}\`\n`;
    });
    out += `\n└─────────────────────────┘\n👑  ${OWNER}  |  ⚡ ACTIVE`;
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
  let lines = ["┌─────────────────────────┐","│  💳  U P I   L O O K U P  │","├─────────────────────────┤", cb("💳 UPI ID      ",upiId)];
  if (name)     lines.push(cb("👤 Name        ",name));
  if (username) lines.push(cb("🔖 Username    ",username));
  lines.push(`✅ Valid        : ${valid ? "✅ YES" : "❌ NO"}`);
  if (accType)  lines.push(cb("🏦 Account Type",accType));
  if (bank)     lines.push(cb("🏛️  Bank        ",bank));
  if (bankType) lines.push(cb("📂 Bank Type   ",bankType));
  if (ifsc)     lines.push(cb("🔢 IFSC        ",ifsc));
  if (isMerchant  != null) lines.push(`🏪 Merchant    : ${tick(isMerchant)}`);
  if (merchantVer != null) lines.push(`✔️  Merch.Verif : ${tick(merchantVer)}`);
  if ([branch,address,city,district,state,contact].some(Boolean)) {
    lines.push("├─────────────────────────┤","│  🏦  IFSC DETAILS        │","├─────────────────────────┤");
    if (branch)   lines.push(cb("🏢 Branch      ",branch));
    if (address)  lines.push(cb("📍 Address     ",address));
    if (city)     lines.push(cb("🏙️  City        ",city));
    if (district) lines.push(cb("📍 District    ",district));
    if (state)    lines.push(cb("🗺️  State       ",state));
    if (contact)  lines.push(cb("📞 Contact     ",contact));
  }
  if ([rtgs,neft,imps,upiSup].some(v => v != null)) {
    lines.push("├─────────────────────────┤","│  💸  PAYMENT MODES       │","├─────────────────────────┤");
    if (rtgs   != null) lines.push(`⚡ RTGS        : ${tick(rtgs)}`);
    if (neft   != null) lines.push(`🔄 NEFT        : ${tick(neft)}`);
    if (imps   != null) lines.push(`📲 IMPS        : ${tick(imps)}`);
    if (upiSup != null) lines.push(`💳 UPI         : ${tick(upiSup)}`);
  }
  lines.push("└─────────────────────────┘", `👑  ${OWNER}  |  ⚡ ACTIVE`);
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
  const lines = ["┌────────────────────────────┐","│  🚗  V E H I C L E  I N F O  │","└────────────────────────────┘","🔷━━━ REGISTRATION ━━━🔷"];
  if (regNo)   lines.push(`🚘  Reg No      : \`${regNo}\``);
  if (regAuth) lines.push(`🏛️   Reg Auth    : \`${regAuth}\``);
  if (regDate) lines.push(`📅  Reg Date    : \`${regDate}\``);
  if (rtoCode) lines.push(`🗂️   RTO Code    : \`${rtoCode}\``);
  if (rtoName) lines.push(`🏢  RTO Name    : \`${rtoName}\``);
  if ([father,mob,presentAddr,pincode].some(Boolean)) {
    lines.push("\n🔶━━━ OWNER DETAILS ━━━🔶");
    if (father)      lines.push(`👨  Father       : \`${father}\``);
    if (mob)         lines.push(`📞  Mobile       : \`${mob}\``);
    if (presentAddr) lines.push(`📍  Address      : \`${presentAddr}\``);
    if (pincode)     lines.push(`📮  Pincode      : \`${pincode}\``);
  }
  if ([mfr,model,variant,fuel,vehClass,cc,seats,mfrYear].some(Boolean)) {
    lines.push("\n🟢━━━ VEHICLE SPECS ━━━🟢");
    if (mfr)      lines.push(`🏭  Manufacturer : \`${mfr}\``);
    if (model)    lines.push(`🚗  Model        : \`${model}\``);
    if (variant)  lines.push(`⚙️   Variant      : \`${variant}\``);
    if (fuel)     lines.push(`⛽  Fuel Type    : \`${fuel}\``);
    if (vehClass) lines.push(`📋  Class        : \`${vehClass}\``);
    if (vehType)  lines.push(`🔖  Type         : \`${vehType}\``);
    if (mfrYear)  lines.push(`📆  Mfr Year     : \`${mfrYear}\``);
    if (cc)       lines.push(`🔩  Cubic Cap    : \`${cc} cc\``);
    if (seats)    lines.push(`💺  Seats        : \`${seats}\``);
    if (isComm != null) lines.push(`🏪  Commercial   : ${isComm ? "✅ YES" : "❌ NO"}`);
  }
  if ([eng,chassis].some(Boolean)) {
    lines.push("\n🔵━━━ TECHNICAL ━━━🔵");
    if (eng)     lines.push(`🔧  Engine No    : \`${eng}\``);
    if (chassis) lines.push(`🔩  Chassis No   : \`${chassis}\``);
  }
  if ([financer,insCompany,insUpto,puccValid].some(Boolean)) {
    lines.push("\n🟣━━━ FINANCE & INSURANCE ━━━🟣");
    if (financer)   lines.push(`💰  Financer     : \`${financer}\``);
    if (insCompany) lines.push(`🛡️   Insurance    : \`${insCompany}\``);
    if (insUpto)    lines.push(`📅  Ins Upto     : \`${insUpto}\`${insExpired ? " ❌ EXPIRED" : " ✅ VALID"}`);
    if (puccValid)  lines.push(`🌿  PUCC Valid   : \`${puccValid}\``);
  }
  lines.push(`\n┌────────────────────────────┐`,`│  👑 ${OWNER}  |  ⚡ ACTIVE  │`,"└────────────────────────────┘");
  return lines.join("\n");
}

// ── DB BACKUP ─────────────────────────────────
async function sendDbBackup(chatId) {
  if (!usersCol) { await sendMessage(chatId, "❌  MongoDB connected nahi hai."); return; }
  const statusMsg = await sendMessage(chatId, "🗄️  Database se data fetch ho raha hai...");
  try {
    const allUsers = await dbGetAllUsers();
    const total    = allUsers.length;
    if (!total) { await editMessageText(chatId, statusMsg.message_id, "📭  Database empty hai."); return; }
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
      const buf   = Buffer.from(fullText, "utf8");
      const fname = `rtfbot_backup_${new Date().toISOString().slice(0,10)}.txt`;
      const form  = new FormData();
      form.append("chat_id", String(chatId));
      form.append("caption", `🗄️ RTF Bot DB Backup — ${total} users\n📅 ${new Date().toISOString().slice(0,16).replace("T"," ")} UTC`);
      form.append("document", buf, { filename: fname, contentType: "text/plain" });
      const res = await fetch(`${TG_BASE}/sendDocument`, { method: "POST", body: form });
      const json = await res.json();
      if (!json.ok) console.error("[DB BACKUP sendDocument]", json.description);
      await deleteMessage(chatId, statusMsg.message_id);
    } else {
      await editMessageText(chatId, statusMsg.message_id, fullText);
    }
  } catch (e) {
    console.error("[DB BACKUP]", e);
    await editMessageText(chatId, statusMsg.message_id, `❌  Backup failed: ${e.message}`);
  }
}

// ── API FETCHERS ──────────────────────────────
async function fetchDeepApi(number) {
  let raw = String(number).replace(/[+\s]/g,"");
  if (!raw.startsWith("91")) raw = "91" + raw;
  try {
    const res  = await fetch(SECOND_API_URL.replace("{number}", raw), { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    const records = [];
    if (data && typeof data === "object" && !Array.isArray(data)) {
      if (data.data && typeof data.data === "object") {
        for (const val of Object.values(data.data)) {
          if (val && val.records && Array.isArray(val.records)) records.push(...val.records.filter(r => typeof r === "object"));
        }
      } else if (Array.isArray(data.records)) {
        records.push(...data.records.filter(r => typeof r === "object"));
      }
    } else if (Array.isArray(data)) { records.push(...data.filter(r => typeof r === "object")); }
    return records;
  } catch (e) { console.error("[DEEP API]", e.message); return []; }
}

async function fetchNumApi(cleanPhone) {
  try {
    const res  = await fetch(NUM_API_URL.replace("{number}", cleanPhone), { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
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

async function fetchTgFallback(queryStr) {
  const q = (queryStr.startsWith("@") || /^\d+$/.test(queryStr)) ? queryStr : `@${queryStr}`;
  try {
    const res  = await fetch(TG_FALLBACK_API.replace("{query}", encodeURIComponent(q)), { signal: AbortSignal.timeout(20000) });
    const data = await res.json();
    if (!data.success) return {};
    const phone = String(data.number || "").trim();
    return { tgId: String(data.tg_id || "N/A"), phone: phone && phone !== "None" ? phone : null, country: String(data.country || "N/A"), countryCode: String(data.country_code || "N/A") };
  } catch (e) { console.error("[TG FALLBACK]", e.message); return {}; }
}

// ══════════════════════════════════════════════
//  LOOKUP HANDLERS
//  RULE:
//    - Data mila    → user ke command ka reply me data bhejo. Kuch DELETE NAHI.
//    - Data nahi mila → user ke command ka reply me "not found" bhejo,
//                       15 sec baad: not-found msg + user command msg dono delete
// ══════════════════════════════════════════════

async function handleNumber(chatId, number, userMsgId = null) {
  // Searching status — plain message, not a reply
  const statusMsg = await sendMessage(chatId, `🔍  Searching: \`${number}\` ...`);
  try {
    let clean = number.trim().replace(/\s/g,"").replace("+91","");
    if (clean.startsWith("91") && clean.length > 10) clean = clean.slice(2);

    const [records, deepData] = await Promise.all([fetchNumApi(clean), fetchDeepApi(number)]);

    // Delete searching message
    await deleteMessage(chatId, statusMsg.message_id);

    if (!records.length) {
      // DATA NAHI MILA — reply me not found, 15 sec baad dono delete
      await sendDataNotFound(chatId, userMsgId,
        `╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n📱  Number: \`${clean}\`\n⚠️  Koi record nahi mila`
      );
      return;
    }

    // DATA MILA — reply me data, kuch delete nahi
    let full = formatNumResult(records, clean);
    const deep = formatDeepData(deepData);
    if (deep) full += "\n\n" + deep;
    await sendDataFound(chatId, userMsgId, full);

  } catch (e) {
    console.error("[NUM LOOKUP]", e);
    await deleteMessage(chatId, statusMsg.message_id);
    await sendMessage(chatId, "❌  API Error / Timeout.");
  }
}

async function handleTg(chatId, term, userMsgId = null) {
  term = term.trim().replace(/^@/,"");
  if (!term) {
    await sendDataNotFound(chatId, userMsgId, "❌  Kuch toh bhejo!\n✅ /tg rtfgamming\n✅ /tg 8518042438");
    return;
  }

  const termKey = term.toLowerCase();
  if (customTgData[termKey]) {
    // Custom data — reply me bhejo, delete nahi
    await sendDataFound(chatId, userMsgId, customTgData[termKey]);
    return;
  }

  const isUserId  = /^\d+$/.test(term);
  const statusMsg = await sendMessage(chatId, `🔍  Searching TG ${isUserId ? "UserID" : "Username"}: ${isUserId ? "#" : "@"}${term} ...`);
  let tgId = "N/A", targetUname = term, phone = null, countryCode = null, usedFallback = false;

  try {
    const url = isUserId ? TG_USERID_API.replace("{userid}", term) : TG_USERNAME_API.replace("{username}", term);
    const res  = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}
    if (data.status && data.target_id) {
      const p = parseTgPrimary(data, term);
      tgId = p.tgId; targetUname = p.targetUname; phone = p.phone; countryCode = p.countryCode;
    }
    if (!phone) {
      const fb = await fetchTgFallback(term);
      if (fb.phone) { usedFallback = true; phone = fb.phone; countryCode = fb.countryCode || countryCode; if (fb.tgId && fb.tgId !== "N/A") tgId = fb.tgId; }
    }

    await deleteMessage(chatId, statusMsg.message_id);

    if (!phone && tgId === "N/A") {
      // DATA NAHI MILA
      await sendDataNotFound(chatId, userMsgId,
        `╔══════════════════════╗\n║  ❌ DATA NOT FOUND    ║\n╠══════════════════════╣\n🔎  Input : ${term}\n⚠️  Dono APIs se data nahi mila\n╚══════════════════════╝`
      );
      return;
    }

    // DATA MILA — reply me bhejo
    const srcLabel = usedFallback ? "🔁 Fallback" : "✅ Primary";
    const uDisplay = /^\d+$/.test(targetUname) ? targetUname : `@${targetUname}`;
    let tgBlock = `┌─────────────────────────┐\n│  🔎  T G   L O O K U P  │\n├─────────────────────────┤\n${cb("💻 Username    ",uDisplay)}\n${cb("🆔 Telegram ID ",tgId)}\n${cb("📞 Phone       ",phone||"N/A")}\n${cb("🌍 Country Code",countryCode||"N/A")}\n🔌  Source       : ${srcLabel}\n└─────────────────────────┘\n`;
    if (phone) {
      let cleanPhone = phone.replace(/[+\s]/g,"");
      if (cleanPhone.startsWith("91") && cleanPhone.length > 10) cleanPhone = cleanPhone.slice(2);
      const [numRes, deepRes] = await Promise.all([fetchNumApi(cleanPhone), fetchDeepApi(phone)]);
      if (numRes.length) tgBlock += "\n" + formatNumResult(numRes, cleanPhone);
      if (deepRes.length) { const df = formatDeepData(deepRes); if (df) tgBlock += "\n\n" + df; }
    }
    await sendDataFound(chatId, userMsgId, tgBlock);

  } catch (e) {
    console.error("[TG LOOKUP]", e);
    await deleteMessage(chatId, statusMsg.message_id);
    await sendMessage(chatId, "❌  Kuch gadbad ho gayi.");
  }
}

async function handleAdhar(chatId, adharRaw, userMsgId = null) {
  const statusMsg = await sendMessage(chatId, `🔍  Searching Aadhaar: \`${adharRaw}\` ...`);
  try {
    const res  = await fetch(ADHAR_API_URL.replace("{number}", adharRaw), { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    await deleteMessage(chatId, statusMsg.message_id);

    const resultObj   = data.result || {};
    const resultsList = resultObj.results || [];
    if (!data.success && !resultObj.success && !resultsList.length) {
      await sendDataNotFound(chatId, userMsgId,
        `╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n🪪  Aadhaar: \`${adharRaw}\``
      );
      return;
    }
    const formatted = formatAdharResult(data, adharRaw);
    if (!formatted) {
      await sendDataNotFound(chatId, userMsgId, `❌  Data format error — Aadhaar: \`${adharRaw}\``);
      return;
    }
    await sendDataFound(chatId, userMsgId, formatted);

  } catch (e) {
    console.error("[ADHAR]", e);
    await deleteMessage(chatId, statusMsg.message_id);
    await sendMessage(chatId, "❌  API Error / Timeout.");
  }
}

async function handleUpi(chatId, upiId, userMsgId = null) {
  const statusMsg = await sendMessage(chatId, `🔍  Searching UPI: \`${upiId}\` ...`);
  try {
    const res  = await fetch(UPI_API_URL.replace("{upi}", upiId.trim()), { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    await deleteMessage(chatId, statusMsg.message_id);

    if (!data.success) {
      await sendDataNotFound(chatId, userMsgId,
        `╔══════════════════╗\n║  ❌ UPI NOT FOUND   ║\n╚══════════════════╝\n💳  UPI: \`${upiId}\``
      );
      return;
    }
    await sendDataFound(chatId, userMsgId, formatUpiResult(data, upiId));

  } catch (e) {
    console.error("[UPI]", e);
    await deleteMessage(chatId, statusMsg.message_id);
    await sendMessage(chatId, "❌  API Error / Timeout.");
  }
}

async function handleVehicle(chatId, vehicleNo, userMsgId = null) {
  vehicleNo = vehicleNo.trim().toUpperCase().replace(/\s/g,"");
  const statusMsg = await sendMessage(chatId, `🔍  Searching Vehicle: \`${vehicleNo}\` ...`);
  try {
    const res  = await fetch(VEHICLE_API_URL.replace("{vehicle}", vehicleNo), { signal: AbortSignal.timeout(20000) });
    const data = await res.json();
    await deleteMessage(chatId, statusMsg.message_id);

    if (!data.success) {
      await sendDataNotFound(chatId, userMsgId,
        `╔══════════════════════╗\n║  ❌ VEHICLE NOT FOUND  ║\n╚══════════════════════╝\n🚗  Vehicle: \`${vehicleNo}\``
      );
      return;
    }
    await sendDataFound(chatId, userMsgId, formatVehicleResult(data));

  } catch (e) {
    console.error("[VEHICLE]", e);
    await deleteMessage(chatId, statusMsg.message_id);
    await sendMessage(chatId, "❌  API Error / Timeout.");
  }
}

// ── MAIN UPDATE HANDLER ───────────────────────
async function handleUpdate(update) {
  try {
    if (update.callback_query) return await handleCallback(update.callback_query);
    const msg = update.message || update.edited_message;
    if (!msg) return;
    const from    = msg.from;
    if (!from || from.is_bot) return;
    const chatId  = msg.chat.id;
    const msgId   = msg.message_id;
    const text    = (msg.text || "").trim();
    const _isAdmin= isAdmin(from.username);

    dbSaveUser(from);
    if (!text) return;

    if (_isAdmin && ["/broadcast","/addadmin","/removeadmin","/users","/listadmins","/admin","/setcustomtg","/delcustomtg","/listcustomtg","/dbbackup"].some(c => text.toLowerCase().startsWith(c))) {
      return await handleAdminText(chatId, from.id, text, _isAdmin);
    }

    const choice = userState[from.id];
    if (!choice) return;

    if (!_isAdmin && !(await checkJoin(from.id))) {
      await sendJoinPrompt(chatId);
      return;
    }

    if (choice === "broadcast" && _isAdmin) {
      const users = await dbGetAllUsers();
      const uids  = users.map(u => u.user_id);
      const status= await sendMessage(chatId, `📤  Broadcasting to ${uids.length} users...`);
      let ok = 0, fail = 0;
      for (const uid of uids) {
        const r = await tgApi("sendMessage", { chat_id: uid, text });
        r ? ok++ : fail++;
        await new Promise(r => setTimeout(r, 50));
      }
      await editMessageText(chatId, status.message_id,
        `╔══════════════════╗\n║  📢 BROADCAST DONE  ║\n╚══════════════════╝\n✅  Delivered : ${ok}\n❌  Failed    : ${fail}\n👥  Total     : ${uids.length}`);
    }
    else if (choice === "number")  { await handleNumber(chatId, text, msgId); }
    else if (choice === "tg")      { await handleTg(chatId, text, msgId); }
    else if (choice === "adhar")   { await handleAdhar(chatId, text, msgId); }
    else if (choice === "upi")     { await handleUpi(chatId, text, msgId); }
    else if (choice === "vehicle") { await handleVehicle(chatId, text, msgId); }
    else if (choice === "setcustomtg_step1" && _isAdmin) {
      userState[from.id] = `setcustomtg_step2::${text.trim().replace(/^@/,"").toLowerCase()}`;
      await sendMessage(chatId, `✅  Username: \`${text.trim()}\`\n\n📥  Ab custom data bhejo:`);
      return;
    } else if (choice && choice.startsWith("setcustomtg_step2::") && _isAdmin) {
      const targetKey = choice.split("::")[1];
      customTgData[targetKey] = text.trim();
      await dbSaveData(`customtg:${targetKey}`, { username: targetKey, data: text.trim() });
      await sendMessage(chatId, `✅  Custom data set!\n👤 Key: \`${targetKey}\``);
    }

    userState[from.id] = null;

  } catch (e) { console.error("[handleUpdate]", e); }
}

async function handleCallback(cb) {
  const from    = cb.from;
  const chatId  = cb.message.chat.id;
  const msgId   = cb.message.message_id;
  const data    = cb.data;
  const _isAdmin= isAdmin(from.username);

  if (data === "verify") {
    const missing = await getNotJoinedChannels(from.id);
    if (missing.length) {
      const remaining = missing.map(c => c.name).join(", ");
      await answerCallback(cb.id, `❌ Abhi bhi join karo: ${remaining}`, true);
      const btns = missing.map(c => [{ text: `➕ ${c.name}`, url: `https://t.me/${c.username}` }]);
      btns.push([{ text: "✅ VERIFY JOIN", callback_data: "verify" }]);
      await tgApi("editMessageReplyMarkup", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: btns } });
    } else {
      await answerCallback(cb.id);
      const kb = _isAdmin ? adminMenuKb() : mainMenuKb();
      await editMessageText(chatId, msgId, MAIN_MENU_TEXT, { reply_markup: kb });
    }
    return;
  }

  await answerCallback(cb.id);

  if (!_isAdmin && !(await checkJoin(from.id))) {
    await sendJoinPrompt(chatId, cb.id);
    return;
  }

  const prompts = {
    menu_number:  "╔════════════════════╗\n║  📞 NUMBER LOOKUP  ║\n╚════════════════════╝\n📥  Number bhejo:\n📌 Format: 9876543210",
    menu_tg:      "╔═══════════════════════╗\n║   🔎  TG LOOKUP       ║\n╠═══════════════════════╣\n📥  Username YA numeric ID\n✅  rtfgamming\n✅  @rtfgamming\n✅  8518042438\n╚═══════════════════════╝",
    menu_adhar:   "╔══════════════════════╗\n║  🪪  AADHAAR LOOKUP  ║\n╚══════════════════════╝\n📥  Aadhaar number bhejo:\n📌 Example: 598229659586",
    menu_upi:     "╔══════════════════════╗\n║  💳  UPI LOOKUP      ║\n╚══════════════════════╝\n📥  UPI ID bhejo:\n📌 Example: 70497398@axl",
    menu_vehicle: "╔══════════════════════╗\n║  🚗  VEHICLE LOOKUP  ║\n╚══════════════════════╝\n📥  Vehicle number bhejo:\n📌 Example: MH02FZ0555",
  };
  const stateMap = { menu_number:"number", menu_tg:"tg", menu_adhar:"adhar", menu_upi:"upi", menu_vehicle:"vehicle" };

  if (stateMap[data]) { userState[from.id] = stateMap[data]; await sendMessage(chatId, prompts[data]); return; }
  if (data === "menu_help")  { await sendMessage(chatId, HELP_TEXT); return; }
  if (data === "menu_owner") { await sendMessage(chatId, `╔══════════════════╗\n║  👑  OWNER INFO   ║\n╚══════════════════╝\n🔗 Telegram: @RTFGAMMING\nhttps://t.me/RTFGAMMING`); return; }

  if (!_isAdmin) return;

  if (data === "menu_users") { const count = await dbUserCount(); await sendMessage(chatId, `╔══════════════════╗\n║  👥 USER COUNT   ║\n╚══════════════════╝\n📊  Total: \`${count}\`\n🗄️  Source: MongoDB`); return; }
  if (data === "menu_dbbackup")   { await sendDbBackup(chatId); return; }
  if (data === "menu_adminlist")  { await sendMessage(chatId, `╔══════════════════╗\n║  📋 ADMIN LIST   ║\n╚══════════════════╝\n` + admins.map(a=>`• ${a}`).join("\n")); return; }
  if (data === "menu_adminpanel") {
    await sendMessage(chatId, "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n📢  /broadcast <msg>\n👥  /users\n➕  /addadmin @user\n➖  /removeadmin @user\n📋  /listadmins\n✏️  /setcustomtg @user <data>\n🗑️  /delcustomtg @user\n📋  /listcustomtg\n🗄️  /dbbackup\n╚══════════════════════════╝");
    return;
  }
  if (data === "menu_broadcast")   { userState[from.id] = "broadcast"; await sendMessage(chatId, "📢  Broadcast message type karo:"); return; }
  if (data === "menu_setcustomtg") { userState[from.id] = "setcustomtg_step1"; await sendMessage(chatId, "╔══════════════════════════╗\n║  ✏️  SET CUSTOM TG DATA   ║\n╠══════════════════════════╣\n📥  Username bhejo jiska data set karna hai\n📌  Example: rtfgamming\n╚══════════════════════════╝"); return; }
}

async function handleAdminText(chatId, userId, text, _isAdmin) {
  if (!_isAdmin) return;
  const lower = text.toLowerCase();

  if (lower === "/admin") {
    await sendMessage(chatId, "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n📢  /broadcast <msg>\n👥  /users\n➕  /addadmin @user\n➖  /removeadmin @user\n📋  /listadmins\n✏️  /setcustomtg @user <data>\n🗑️  /delcustomtg @user\n📋  /listcustomtg\n🗄️  /dbbackup\n╚══════════════════════════╝");
    return;
  }
  if (lower.startsWith("/broadcast")) {
    const msgText = text.slice("/broadcast".length).trim();
    if (!msgText) { await sendMessage(chatId, "❌  Usage: /broadcast <message>"); return; }
    const users = await dbGetAllUsers(); const uids = users.map(u => u.user_id);
    const status = await sendMessage(chatId, `📤  Broadcasting to ${uids.length} users...`);
    let ok = 0, fail = 0;
    for (const uid of uids) { const r = await tgApi("sendMessage", { chat_id: uid, text: msgText }); r ? ok++ : fail++; await new Promise(r => setTimeout(r, 50)); }
    await editMessageText(chatId, status.message_id, `✅ Delivered: ${ok}\n❌ Failed: ${fail}\n👥 Total: ${uids.length}`);
    return;
  }
  if (lower === "/users") { const count = await dbUserCount(); await sendMessage(chatId, `📊  Total Users: \`${count}\`\n🗄️ Source: MongoDB`); return; }
  if (lower === "/dbbackup") { await sendDbBackup(chatId); return; }
  if (lower.startsWith("/addadmin")) {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) { await sendMessage(chatId, "❌  Usage: /addadmin @username"); return; }
    const newAdmin = parts[1].startsWith("@") ? parts[1] : `@${parts[1]}`;
    if (!admins.map(a=>a.toLowerCase()).includes(newAdmin.toLowerCase())) { admins.push(newAdmin); await sendMessage(chatId, `✅  ${newAdmin} ko admin bana diya!`); }
    else { await sendMessage(chatId, `⚠️  ${newAdmin} pehle se admin hai.`); }
    return;
  }
  if (lower.startsWith("/removeadmin")) {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) { await sendMessage(chatId, "❌  Usage: /removeadmin @username"); return; }
    const rem = parts[1].startsWith("@") ? parts[1] : `@${parts[1]}`;
    const match = admins.find(a => a.toLowerCase() === rem.toLowerCase());
    if (match && match.toLowerCase() !== "@rtfgamming") { admins = admins.filter(a => a.toLowerCase() !== rem.toLowerCase()); await sendMessage(chatId, `✅  ${rem} ko hata diya.`); }
    else if (match) { await sendMessage(chatId, "❌  Owner ko remove nahi kar sakte!"); }
    else { await sendMessage(chatId, `⚠️  ${rem} list me nahi hai.`); }
    return;
  }
  if (lower === "/listadmins") { await sendMessage(chatId, "╔══════════════════╗\n║  📋 ADMIN LIST    ║\n╚══════════════════╝\n" + admins.map(a=>`• ${a}`).join("\n")); return; }
  if (lower.startsWith("/setcustomtg")) {
    const parts = text.trim().split(/\s+/, 3);
    if (parts.length < 3) { await sendMessage(chatId, "❌  Usage: /setcustomtg @username <custom_text>"); return; }
    const target     = parts[1].replace(/^@/,"").toLowerCase();
    const customText = text.trim().slice(parts[0].length + parts[1].length + 2).trim();
    customTgData[target] = customText;
    await dbSaveData(`customtg:${target}`, { username: target, data: customText });
    await sendMessage(chatId, `✅  Custom data set!\n👤 Key: \`${target}\``);
    return;
  }
  if (lower.startsWith("/delcustomtg")) {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) { await sendMessage(chatId, "❌  Usage: /delcustomtg @username"); return; }
    const target = parts[1].replace(/^@/,"").toLowerCase();
    if (customTgData[target]) { delete customTgData[target]; await sendMessage(chatId, `✅  \`${target}\` ka custom data delete ho gaya.`); }
    else { await sendMessage(chatId, `⚠️  \`${target}\` ka koi custom data nahi mila.`); }
    return;
  }
  if (lower === "/listcustomtg") {
    if (!Object.keys(customTgData).length) { await sendMessage(chatId, "📋  Koi custom TG data set nahi hai."); return; }
    const lines = ["╔══════════════════════════╗","║  📋  CUSTOM TG DATA LIST  ║","╠══════════════════════════╣"];
    for (const [k,v] of Object.entries(customTgData)) lines.push(`👤 \`${k}\`\n   📝 ${v.slice(0,60)}${v.length>60?"...":""}`);
    lines.push("╚══════════════════════════╝");
    await sendMessage(chatId, lines.join("\n"));
    return;
  }
  const match = text.match(/^\/(\w+)\s+([\s\S]+)$/);
  if (!match) return;
  const [, cmd, args] = match;
  if (cmd === "num")     { await handleNumber(chatId, args); return; }
  if (cmd === "tg")      { await handleTg(chatId, args); return; }
  if (cmd === "adhar")   { await handleAdhar(chatId, args.trim()); return; }
  if (cmd === "upi")     { await handleUpi(chatId, args); return; }
  if (cmd === "vehicle") { await handleVehicle(chatId, args); return; }
}

// ── SLASH COMMAND ROUTER ──────────────────────
async function handleCommand(msg) {
  const from   = msg.from;
  if (!from || from.is_bot) return;
  const chatId = msg.chat.id;
  const msgId  = msg.message_id;   // ← user ka command message id — reply + delete ke liye
  const text   = (msg.text || "").trim();
  const _isAdm = isAdmin(from.username);

  dbSaveUser(from);

  if (!_isAdm && !(await checkJoin(from.id))) {
    await sendJoinPrompt(chatId);
    return;
  }

  const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?/);
  if (!match) return;
  const [, cmd, args = ""] = match;

  if (cmd === "start") {
    await sendMessage(chatId, MAIN_MENU_TEXT, { reply_markup: _isAdm ? adminMenuKb() : mainMenuKb() });
  } else if (cmd === "help") {
    await sendMessage(chatId, HELP_TEXT);
  } else if (cmd === "num") {
    if (!args.trim()) { await sendMessage(chatId, "❌  Usage: /num <number>\n📌  Example: /num 9876543210"); return; }
    await handleNumber(chatId, args.trim(), msgId);
  } else if (cmd === "tg") {
    if (!args.trim()) { await sendMessage(chatId, "❌  Usage: /tg <username ya userid>\n📌 /tg rtfgamming\n📌 /tg 8518042438"); return; }
    await handleTg(chatId, args.trim(), msgId);
  } else if (cmd === "adhar") {
    if (!args.trim()) { await sendMessage(chatId, "❌  Usage: /adhar <aadhaar_number>\n📌 Example: /adhar 598229659586"); return; }
    await handleAdhar(chatId, args.trim(), msgId);
  } else if (cmd === "upi") {
    if (!args.trim()) { await sendMessage(chatId, "❌  Usage: /upi <upi_id>\n📌 Example: /upi 70497398@axl"); return; }
    await handleUpi(chatId, args.trim(), msgId);
  } else if (cmd === "vehicle") {
    if (!args.trim()) { await sendMessage(chatId, "❌  Usage: /vehicle <reg_number>\n📌 Example: /vehicle MH02FZ0555"); return; }
    await handleVehicle(chatId, args.trim(), msgId);
  } else if (_isAdm) {
    await handleAdminText(chatId, from.id, text, true);
  }
}

// ── EXPRESS WEBHOOK ───────────────────────────
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update) return;
  if (update.callback_query) { handleUpdate(update); return; }
  const msg = update.message || update.edited_message;
  if (!msg) return;
  const text = (msg.text || "").trim();
  if (text.startsWith("/")) { handleCommand(msg); } else { handleUpdate(update); }
});

app.get("/", (_req, res) => res.send("RTF Bot is running ✅"));

// ── STARTUP ───────────────────────────────────
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
    console.warn("[BOT] WEBHOOK_URL not set — webhook NOT registered.");
  }
  app.listen(PORT, () => console.log(`[BOT] Server listening on port ${PORT} ✅`));
}

start();
