"use strict";

const express         = require("express");
const fetch           = require("node-fetch");
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

// ══════════════════════════════════════════════
//  API SYSTEM — URL + RESPONSE MAPPING
//  Admin panel se dono change ho sakti hain
// ══════════════════════════════════════════════

// DEFAULT API URLs — {query} placeholder required
const DEFAULT_API_URLS = {
  num:     "https://movements-invoice-amanda-victoria.trycloudflare.com/search/number?number={query}&key=mysecretkey123",
  deep:    "https://rootx-osint.in/?type=num&key=RootXIndia&query={query}",
  tg:      "https://rootx-osint.in/?type=tg_num&key=Jack_The_Dack&query={query}",
  adhar:   "https://aadhar-to-family-impds-info-api.onrender.com/search-aadhaar?search=A&aadhaar={query}",
  upi:     "https://krish-osintoy.lovable.app/api/v1/upi?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&upi={query}",
  vehicle: "https://vehicle.suryahacker.workers.dev/fetch?query={query}",
};

// Runtime URLs (DB se override hoga)
let apiUrls = { ...DEFAULT_API_URLS };

// ── DEFAULT RESPONSE MAPS ─────────────────────
// Har API ke liye: konse response fields dikhane hain
// Format: [ { label: "...", path: "a.b.c" }, ... ]
// path = dot-notation se nested object traverse hoga

const DEFAULT_RESPONSE_MAPS = {
  num: [
    { label: "👤 Name",    path: "result[].name"    },
    { label: "👨 Father",  path: "result[].fname"   },
    { label: "📍 Address", path: "result[].address" },
    { label: "📡 Circle",  path: "result[].circle"  },
    { label: "☎️  Alt Num", path: "result[].alt"     },
    { label: "🪪 Aadhar",  path: "result[].aadhar"  },
    { label: "✉️  Email",   path: "result[].email"   },
  ],
  deep: [
    { label: "👤 Name",    path: "[].NAME"    },
    { label: "📱 Mobile",  path: "[].MOBILE"  },
    { label: "📍 Address", path: "[].ADDRESS" },
    { label: "🆔 ID",      path: "[].id"      },
  ],
  tg: [
    { label: "👤 Name",     path: "name"       },
    { label: "📱 Phone",    path: "phone"      },
    { label: "🆔 User ID",  path: "user_id"    },
    { label: "🔵 Username", path: "username"   },
    { label: "📸 Photo",    path: "photo_url"  },
  ],
  adhar: [
    { label: "👤 Name",     path: "result[].name"    },
    { label: "📅 DOB",      path: "result[].dob"     },
    { label: "🚻 Gender",   path: "result[].gender"  },
    { label: "📍 Address",  path: "result[].address" },
    { label: "📌 Pincode",  path: "result[].pincode" },
  ],
  upi: [
    { label: "👤 Name",    path: "data.name"    },
    { label: "💳 UPI ID",  path: "data.upi_id"  },
    { label: "🏦 Bank",    path: "data.bank"    },
    { label: "✅ Status",  path: "data.status"  },
  ],
  vehicle: [
    { label: "🔢 Reg No",       path: "vehicle_number"                   },
    { label: "👤 Owner",        path: "vehicle_data.owner"               },
    { label: "👨 Father",       path: "vehicle_data.ownerFatherName"     },
    { label: "📍 Address",      path: "vehicle_data.presentAddress"      },
    { label: "📍 Perm Addr",    path: "vehicle_data.permAddress"         },
    { label: "📞 Mobile",       path: "mobile_number"                    },
    { label: "🏭 Manufacturer", path: "vehicle_data.manufacturer"        },
    { label: "🚘 Vehicle",      path: "vehicle_data.vehicle"             },
    { label: "🔧 Variant",      path: "vehicle_data.variant"             },
    { label: "⛽ Fuel",         path: "vehicle_data.fuelType"            },
    { label: "🏷️ Class",        path: "vehicle_data.vehicleClass"        },
    { label: "📅 Reg Date",     path: "vehicle_data.regDate"             },
    { label: "🗓️ Mfg Year",     path: "vehicle_data.manufacturerYear"    },
    { label: "💺 Seats",        path: "vehicle_data.seatCapacity"        },
    { label: "⚙️ Engine No",    path: "engine_number"                    },
    { label: "🔩 Chassis No",   path: "chassis_number"                   },
    { label: "🏢 RTO",          path: "vehicle_data.rtoData.rtoName"     },
    { label: "📌 RTO Code",     path: "vehicle_data.rtoData.rtoCode"     },
    { label: "🗺️ State",        path: "vehicle_data.rtoData.statename"   },
    { label: "🏦 Financer",     path: "vehicle_data.financerName"        },
    { label: "🛡️ Insurance",    path: "vehicle_data.insuranceCompanyName"},
    { label: "📋 Policy No",    path: "vehicle_data.insurancePolicyNumber"},
    { label: "📅 Ins Upto",     path: "vehicle_data.insuranceUpto"       },
  ],
};

// Runtime response maps (DB se override hoga)
let responseMaps = JSON.parse(JSON.stringify(DEFAULT_RESPONSE_MAPS));

// ── CHANNELS ──────────────────────────────────
let CHANNELS = [
  { name: "🔥 RTF GAMING",  username: "RTFGAMING1",     id: null },
  { name: "🎁 GIVEAWAY",    username: "RTFGAMINGHACK0", id: null },
  { name: "🎁 BACKUP",      username: "USERX1NFO",      id: null },
];

const JOINED_STATUSES = new Set(["member","administrator","creator","restricted"]);

let admins = ["@rtfgamming"];

const userState     = new Map();
const customTgData  = new Map();
const customNumData = new Map();

// ── API TOGGLE ────────────────────────────────
const apiToggle = {
  num:     { enabled: true, label: "📞 Number API",     offMsg: "❌ Number lookup abhi available nahi hai." },
  deep:    { enabled: true, label: "🔬 Deep Intel API", offMsg: "❌ Deep data lookup abhi available nahi hai." },
  tg:      { enabled: true, label: "🔎 TG Lookup API",  offMsg: "❌ TG lookup abhi available nahi hai." },
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

// ── CONCURRENCY ───────────────────────────────
const userQueue = new Map();
function queueForUser(userId, taskFn) {
  const prev = userQueue.get(userId) || Promise.resolve();
  const next = prev.then(() => taskFn()).catch(e => console.error(`[QUEUE] uid=${userId}`, e.message));
  userQueue.set(userId, next);
  next.finally(() => { if (userQueue.get(userId) === next) userQueue.delete(userId); });
  return next;
}

// ══════════════════════════════════════════════
//  MongoDB
// ══════════════════════════════════════════════
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
async function dbSave(key, value) {
  if (!dataCol) return;
  try {
    await dataCol.updateOne({ key }, { $set: { key, value, updated_at: new Date().toISOString() } }, { upsert: true });
  } catch (e) { console.error(`[DB SAVE ${key}]`, e.message); }
}

async function dbLoad(key) {
  if (!dataCol) return null;
  try {
    const doc = await dataCol.findOne({ key });
    return doc ? doc.value : null;
  } catch (e) { console.error(`[DB LOAD ${key}]`, e.message); return null; }
}

async function dbLoadAll() {
  // Channels
  const chVal = await dbLoad("channels");
  if (Array.isArray(chVal) && chVal.length > 0) {
    CHANNELS = chVal;
    console.log(`[DB] Loaded ${CHANNELS.length} channels ✅`);
  }
  // API URLs
  const urlVal = await dbLoad("api_urls");
  if (urlVal && typeof urlVal === "object") {
    apiUrls = { ...DEFAULT_API_URLS, ...urlVal };
    console.log("[DB] Loaded API URLs ✅");
  }
  // Response Maps
  const mapVal = await dbLoad("response_maps");
  if (mapVal && typeof mapVal === "object") {
    responseMaps = { ...DEFAULT_RESPONSE_MAPS, ...mapVal };
    console.log("[DB] Loaded Response Maps ✅");
  }
  // Admins
  const admVal = await dbLoad("admins");
  if (Array.isArray(admVal) && admVal.length > 0) {
    admins = admVal;
    console.log("[DB] Loaded admins ✅");
  }
  // API Toggle
  const togVal = await dbLoad("api_toggle");
  if (togVal && typeof togVal === "object") {
    for (const k of API_KEYS) {
      if (togVal[k]) Object.assign(apiToggle[k], togVal[k]);
    }
    console.log("[DB] Loaded API toggle ✅");
  }
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

async function dbGetAllUsers() {
  if (!usersCol) return [];
  try { return await usersCol.find({}, { projection: { _id: 0 } }).toArray(); }
  catch (e) { console.error("[DB GET USERS]", e.message); return []; }
}

async function dbUserCount() {
  if (!usersCol) return 0;
  try { return await usersCol.countDocuments(); } catch { return 0; }
}

// ══════════════════════════════════════════════
//  TELEGRAM API
// ══════════════════════════════════════════════
const TG_BASE    = `https://api.telegram.org/bot${BOT_TOKEN}`;
const httpAgent  = new http.Agent ({ keepAlive: true, maxSockets: 200 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 200 });
const httpsAgentExternal = new https.Agent({ keepAlive: false, timeout: 60000 });
const httpAgentExternal  = new http.Agent ({ keepAlive: false, timeout: 60000 });

function agentForTelegram(url) { return url.startsWith("https") ? { agent: httpsAgent } : { agent: httpAgent }; }
function agentForExternal(url) { return url.startsWith("https") ? { agent: httpsAgentExternal } : { agent: httpAgentExternal }; }

async function tgApi(method, body = {}) {
  try {
    const res  = await fetch(`${TG_BASE}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000), ...agentForTelegram(TG_BASE) });
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
  if (v && !["N/A","","None","null","nan","undefined","Not Available","0"].includes(v))
    return `${escMd(label)}: \`${escMd(v)}\``;
  return `${escMd(label)}: ❌ N/A`;
}

const sendMessage    = (chat_id, text, extra = {}) => tgApi("sendMessage",  { chat_id, text, parse_mode: "MarkdownV2", disable_web_page_preview: true, ...extra });
const deleteMessage  = (chat_id, message_id) => tgApi("deleteMessage", { chat_id, message_id });
const answerCallback = (callback_query_id, text = "", show_alert = false) => tgApi("answerCallbackQuery", { callback_query_id, text, show_alert });
const getChatMember  = (chat_id, user_id) => tgApi("getChatMember", { chat_id, user_id });
const setWebhook     = (url) => tgApi("setWebhook", { url, drop_pending_updates: true });
const sendPlain      = (chat_id, text, extra = {}) => tgApi("sendMessage", { chat_id, text, disable_web_page_preview: true, ...extra });

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
  if (joinCache.size > 5000) {
    const c = Date.now() - JOIN_CACHE_TTL;
    for (const [k,v] of joinCache) { if (v.ts < c) joinCache.delete(k); }
  }
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
  await sendPlain(chatId,
    "╔════════════════════════╗\n║  🔒  ACCESS LOCKED  🔒  ║\n╠════════════════════════╣\n📢  Sabhi channels JOIN karo\n⚡  Phir ✅ VERIFY dabao\n╚════════════════════════╝",
    { reply_markup: { inline_keyboard: buttons } }
  );
  return true;
}

// ══════════════════════════════════════════════
//  RESPONSE MAP HELPER — dot-path se value nikalo
// ══════════════════════════════════════════════

function getByPath(obj, path) {
  // Support: "a.b.c" and "result[].name" (array unwrap)
  try {
    const parts = path.replace(/\[\]/g, ".[*]").split(".");
    let cur = obj;
    for (const p of parts) {
      if (p === "[*]") {
        // Array — return array of values
        if (!Array.isArray(cur)) return null;
        return cur;
      }
      if (cur == null) return null;
      cur = cur[p];
    }
    return cur;
  } catch { return null; }
}

// ── GENERIC RESPONSE FORMATTER ────────────────
// Kisi bhi API ka response + responseMap se formatted text banao
function formatGenericResult(apiKey, data, query, title) {
  const map = responseMaps[apiKey] || [];
  const colors = ["🔴","🟠","🟡","🟢","🔵","🟣"];

  // Check karo ki koi field array hai ([] wali)
  const hasArray = map.some(f => f.path.includes("[]"));

  let out = `┌─────────────────────────┐\n│  ${title.padEnd(24)}│\n├─────────────────────────┤\n`;

  if (!hasArray) {
    // Simple flat response
    for (const field of map) {
      const val = getByPath(data, field.path);
      out += cbMd(field.label, val) + "\n";
    }
  } else {
    // Array-based response — pehle array field dhundo
    const arrayField = map.find(f => f.path.includes("[]"));
    if (!arrayField) {
      out += "❌ Data parse nahi hua\n";
    } else {
      const basePath = arrayField.path.split("[]")[0].replace(/\.$/, "");
      let arr = basePath ? getByPath(data, basePath) : data;
      if (!Array.isArray(arr)) arr = Array.isArray(data) ? data : [];
      const records = arr.slice(0, 5);

      if (!records.length) {
        out += "❌ Koi record nahi mila\n";
      } else {
        out += `📊  Records : ${records.length} found\n\n`;
        records.forEach((rec, i) => {
          const dot = colors[i % colors.length];
          out += `${dot}━━━ RECORD ${i+1} ━━━${dot}\n`;
          for (const field of map) {
            if (!field.path.includes("[]")) continue;
            const subPath = field.path.split("[]")[1].replace(/^\./, "");
            const val = subPath ? getByPath(rec, subPath) : rec;
            out += cbMd(field.label, val) + "\n";
          }
          out += "\n";
        });
      }
    }
  }

  out += `└─────────────────────────┘\n👑  ${escMd(OWNER)}  \\|  ⚡ ACTIVE`;
  return out;
}

// ══════════════════════════════════════════════
//  API HANDLERS
// ══════════════════════════════════════════════

async function fetchApi(apiKey, query) {
  const url = (apiUrls[apiKey] || DEFAULT_API_URLS[apiKey]).replace("{query}", encodeURIComponent(query));
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      ...agentForExternal(url),
    });
    const data = await res.json();
    return { ok: true, data, url };
  } catch (e) {
    console.error(`[FETCH ${apiKey}]`, e.message);
    return { ok: false, error: e.message };
  }
}

// ── NUMBER LOOKUP ─────────────────────────────
async function handleNum(chatId, userId, query, msgId) {
  if (!apiToggle.num.enabled) return sendDataNotFound(chatId, msgId, apiToggle.num.offMsg);

  // Custom data check
  const custom = customNumData.get(query);
  if (custom) {
    dbIncrSearch(userId);
    return sendDataFound(chatId, msgId, custom);
  }

  const { ok, data } = await fetchApi("num", query);
  if (!ok) return sendDataNotFound(chatId, msgId, "❌ Number API se response nahi mila.");

  // Check empty
  const results = data && data.result;
  if (!results || (Array.isArray(results) && !results.length)) {
    // Try deep API fallback
    return handleDeep(chatId, userId, query, msgId);
  }

  dbIncrSearch(userId);
  const text = formatGenericResult("num", data, query, "📞  NUMBER INFO        ");
  return sendDataFound(chatId, msgId, text);
}

// ── DEEP INTEL ────────────────────────────────
async function handleDeep(chatId, userId, query, msgId) {
  if (!apiToggle.deep.enabled) return sendDataNotFound(chatId, msgId, apiToggle.deep.offMsg);

  const { ok, data } = await fetchApi("deep", query);
  if (!ok) return sendDataNotFound(chatId, msgId, "❌ Deep API se response nahi mila.");

  const arr = Array.isArray(data) ? data : (data && Array.isArray(data.result) ? data.result : []);
  const records = arr.filter(r => r.NAME || r.MOBILE);
  if (!records.length) return sendDataNotFound(chatId, msgId, `❌ \`${query}\` ka koi data nahi mila.`);

  dbIncrSearch(userId);
  const text = formatGenericResult("deep", records, query, "🔬  DEEP INTEL         ");
  return sendDataFound(chatId, msgId, text);
}

// ── TG LOOKUP ─────────────────────────────────
async function handleTg(chatId, userId, query, msgId) {
  if (!apiToggle.tg.enabled) return sendDataNotFound(chatId, msgId, apiToggle.tg.offMsg);

  const custom = customTgData.get(query.toLowerCase());
  if (custom) {
    dbIncrSearch(userId);
    return sendDataFound(chatId, msgId, custom);
  }

  const { ok, data } = await fetchApi("tg", query);
  if (!ok) return sendDataNotFound(chatId, msgId, "❌ TG API se response nahi mila.");
  if (!data || data.error) return sendDataNotFound(chatId, msgId, `❌ TG user \`${query}\` nahi mila.`);

  dbIncrSearch(userId);
  const text = formatGenericResult("tg", data, query, "🔎  TG LOOKUP          ");
  return sendDataFound(chatId, msgId, text);
}

// ── AADHAAR LOOKUP ────────────────────────────
async function handleAdhar(chatId, userId, query, msgId) {
  if (!apiToggle.adhar.enabled) return sendDataNotFound(chatId, msgId, apiToggle.adhar.offMsg);

  const { ok, data } = await fetchApi("adhar", query);
  if (!ok) return sendDataNotFound(chatId, msgId, "❌ Aadhaar API se response nahi mila.");

  const results = data && data.result;
  if (!results || (Array.isArray(results) && !results.length))
    return sendDataNotFound(chatId, msgId, `❌ Aadhaar \`${query}\` ka data nahi mila.`);

  dbIncrSearch(userId);
  const text = formatGenericResult("adhar", data, query, "🪪  AADHAAR INFO       ");
  return sendDataFound(chatId, msgId, text);
}

// ── UPI LOOKUP ────────────────────────────────
async function handleUpi(chatId, userId, query, msgId) {
  if (!apiToggle.upi.enabled) return sendDataNotFound(chatId, msgId, apiToggle.upi.offMsg);

  const { ok, data } = await fetchApi("upi", query);
  if (!ok) return sendDataNotFound(chatId, msgId, "❌ UPI API se response nahi mila.");
  if (!data || data.error || data.status === "error")
    return sendDataNotFound(chatId, msgId, `❌ UPI \`${query}\` ka data nahi mila.`);

  dbIncrSearch(userId);
  const text = formatGenericResult("upi", data, query, "💳  UPI INFO           ");
  return sendDataFound(chatId, msgId, text);
}

// ── VEHICLE LOOKUP ────────────────────────────
async function handleVehicle(chatId, userId, query, msgId) {
  if (!apiToggle.vehicle.enabled) return sendDataNotFound(chatId, msgId, apiToggle.vehicle.offMsg);

  const { ok, data } = await fetchApi("vehicle", query);
  if (!ok) return sendDataNotFound(chatId, msgId, "❌ Vehicle API se response nahi mila.");
  if (!data || !data.success || !data.vehicle_data)
    return sendDataNotFound(chatId, msgId, `❌ Vehicle \`${query}\` ka data nahi mila.`);

  dbIncrSearch(userId);
  const text = formatGenericResult("vehicle", data, query, "🚗  VEHICLE INFO       ");
  return sendDataFound(chatId, msgId, text);
}

// ══════════════════════════════════════════════
//  MENUS
// ══════════════════════════════════════════════

const MAIN_MENU_TEXT =
  "╔══════════════════════════╗\n║  ⚡️  R T F   B O T  ⚡️   ║\n╠══════════════════════════╣\n" +
  "🛡  Status  : ONLINE\n👑  Owner   : @RTFGAMMING\n🔥  Version : v4.0\n" +
  "╠══════════════════════════╣\n📌  Neeche se option chuno:\n╚══════════════════════════╝";

const HELP_TEXT =
  "╔══════════════════════════╗\n║  📖  B O T   H E L P    ║\n╠══════════════════════════╣\n" +
  "📞  /num <number>\n   Example: /num 9876543210\n\n" +
  "🔎  /tg <username ya userid>\n   Example: /tg rtfgamming\n\n" +
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
    [{ text: "🔌 API Toggle",   callback_data: "menu_api" }],
    [{ text: "🔗 API URL Manager",      callback_data: "menu_apiurl" }],
    [{ text: "🗂️ API Response Manager", callback_data: "menu_apiresponse" }],
    [{ text: "📢 Channel Manager", callback_data: "menu_channels" }],
  ]};
}

// ══════════════════════════════════════════════
//  API TOGGLE PANEL
// ══════════════════════════════════════════════

function apiManagerText() {
  let text = "╔══════════════════════════╗\n║  🔌  API TOGGLE           ║\n╠══════════════════════════╣\n\n";
  for (const k of API_KEYS) {
    const api = apiToggle[k];
    const st  = api.enabled ? "🟢 ON " : "🔴 OFF";
    text += `${st}  ${api.label}\n`;
    if (!api.enabled) text += `      💬 "${api.offMsg.slice(0,40)}"\n`;
    text += "\n";
  }
  text += "Toggle = ON/OFF  |  ✏️ = Custom off msg\n╚══════════════════════════╝";
  return text;
}

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

// ══════════════════════════════════════════════
//  API URL MANAGER
// ══════════════════════════════════════════════

function apiUrlManagerText() {
  let text = "╔══════════════════════════╗\n║  🔗  API URL MANAGER     ║\n╠══════════════════════════╣\n\n";
  for (const k of API_KEYS) {
    const url = apiUrls[k] || DEFAULT_API_URLS[k];
    const isDefault = url === DEFAULT_API_URLS[k];
    const shortUrl = url.length > 50 ? url.slice(0, 50) + "..." : url;
    text += `${API_LABELS[k]}\n`;
    text += `${isDefault ? "🟢 Default" : "🔵 Custom"}\n`;
    text += `🔗 ${shortUrl}\n\n`;
  }
  text += "✏️ = URL change  |  🔄 = Default reset\n╚══════════════════════════╝";
  return text;
}

function apiUrlManagerKb() {
  const rows = API_KEYS.map(k => [
    { text: `✏️ ${API_LABELS[k]}`, callback_data: `apiurl_edit_${k}` },
    { text: "🔄 Reset",            callback_data: `apiurl_reset_${k}` },
  ]);
  rows.push([{ text: "🔙 Back", callback_data: "menu_adminpanel" }]);
  return { inline_keyboard: rows };
}

// ══════════════════════════════════════════════
//  API RESPONSE MANAGER
//  Admin yahan se har API ke liye fields set karta hai
// ══════════════════════════════════════════════

function apiResponseManagerText() {
  let text = "╔══════════════════════════╗\n║  🗂️  API RESPONSE MGR    ║\n╠══════════════════════════╣\n\n";
  text += "Yahan har API ke response fields set karo.\n";
  text += "JSON path example:\n";
  text += "  Flat:  vehicle_data.owner\n";
  text += "  Array: result[].name\n\n";
  for (const k of API_KEYS) {
    const map = responseMaps[k] || [];
    const isDefault = JSON.stringify(map) === JSON.stringify(DEFAULT_RESPONSE_MAPS[k]);
    text += `${API_LABELS[k]}  ${isDefault ? "🟢 Default" : "🔵 Custom"}\n`;
    text += `  ${map.length} fields configured\n\n`;
  }
  text += "✏️ = Edit fields  |  🔄 = Reset\n╚══════════════════════════╝";
  return text;
}

function apiResponseManagerKb() {
  const rows = API_KEYS.map(k => [
    { text: `✏️ ${API_LABELS[k]}`, callback_data: `apires_edit_${k}` },
    { text: "🔄 Reset",            callback_data: `apires_reset_${k}` },
  ]);
  rows.push([{ text: "📋 Format Guide",   callback_data: "apires_guide" }]);
  rows.push([{ text: "🔙 Back",           callback_data: "menu_adminpanel" }]);
  return { inline_keyboard: rows };
}

function apiResponseFieldsText(apiKey) {
  const map = responseMaps[apiKey] || [];
  let text = `╔══════════════════════════╗\n║  ${API_LABELS[apiKey].padEnd(24)}║\n╠══════════════════════════╣\n\n`;
  text += `Current Fields (${map.length}):\n\n`;
  map.forEach((f, i) => {
    text += `${i+1}. ${f.label}\n   Path: ${f.path}\n\n`;
  });
  text += "✏️ Edit karne ke liye JSON format mein bhejo.\n";
  return text;
}

const RESPONSE_MAP_GUIDE =
  "╔══════════════════════════╗\n║  📋  RESPONSE MAP GUIDE  ║\n╠══════════════════════════╣\n\n" +
  "JSON format:\n[\n  {\"label\": \"👤 Name\", \"path\": \"owner\"},\n  {\"label\": \"📍 Addr\", \"path\": \"address\"}\n]\n\n" +
  "PATH TYPES:\n" +
  "1️⃣  Flat field:\n   path: \"vehicle_data.owner\"\n\n" +
  "2️⃣  Nested:\n   path: \"vehicle_data.rtoData.rtoName\"\n\n" +
  "3️⃣  Array records:\n   path: \"result[].name\"\n   (result array ke andar name field)\n\n" +
  "4️⃣  Root array:\n   path: \"[].NAME\"\n   (response khud array hai)\n\n" +
  "⚠️  Rules:\n" +
  "- Har field mein label aur path dono required\n" +
  "- Array fields mein [] zaroor likho\n" +
  "- Valid JSON array bhejo\n" +
  "╚══════════════════════════╝";

// ── CHANNEL MANAGER ───────────────────────────
function channelManagerText() {
  let text = "╔══════════════════════════╗\n║  📢  CHANNEL MANAGER     ║\n╠══════════════════════════╣\n\n";
  if (!CHANNELS.length) {
    text += "❌  Koi channel nahi hai abhi.\n\n";
  } else {
    CHANNELS.forEach((ch, i) => {
      const type = ch.username ? "🌐 Public" : "🔒 Private";
      const ref  = ch.username ? `@${ch.username}` : `ID: ${ch.id}`;
      text += `${i+1}. ${ch.name}\n   ${type} | ${ref}\n`;
      if (ch.invite_link) text += `   🔗 Invite link set ✅\n`;
      text += "\n";
    });
  }
  text += "🗑️ = Remove  |  ➕ = Naya Add\n╚══════════════════════════╝";
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

// ══════════════════════════════════════════════
//  BROADCAST
// ══════════════════════════════════════════════

async function broadcastMessage(text, fromChatId) {
  const users = await dbGetAllUsers();
  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      await sendPlain(u.user_id, text);
      sent++;
      await new Promise(r => setTimeout(r, 35));
    } catch { failed++; }
  }
  await sendPlain(fromChatId, `✅ Broadcast done!\nSent: ${sent}\nFailed: ${failed}`);
}

// ══════════════════════════════════════════════
//  MESSAGE HANDLER
// ══════════════════════════════════════════════

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const from   = msg.from || {};
  const userId = from.id;
  const text   = (msg.text || "").trim();

  if (!text || !userId) return;

  dbSaveUser(from);

  const adminUser = isAdmin(from.username);
  const state     = userState.get(userId);

  // ── ADMIN STATE HANDLERS ──────────────────
  if (adminUser && state) {

    // ── API URL edit state ──
    if (state.startsWith("await_apiurl_")) {
      const key = state.replace("await_apiurl_", "");
      userState.delete(userId);
      if (!API_KEYS.includes(key)) return sendPlain(chatId, "❌ Invalid API key.");
      if (!text.includes("{query}")) {
        return sendPlain(chatId, "❌ URL mein {query} placeholder hona chahiye!\nExample:\nhttps://api.example.com/fetch?q={query}");
      }
      apiUrls[key] = text.trim();
      await dbSave("api_urls", apiUrls);
      return sendPlain(chatId,
        `✅ ${API_LABELS[key]} URL update ho gaya!\n\n🔗 New URL:\n${text.trim()}`,
        { reply_markup: { inline_keyboard: [[{ text: "🔗 Back to URL Manager", callback_data: "menu_apiurl" }]] } }
      );
    }

    // ── API Response Map edit state ──
    if (state.startsWith("await_apires_")) {
      const key = state.replace("await_apires_", "");
      userState.delete(userId);
      if (!API_KEYS.includes(key)) return sendPlain(chatId, "❌ Invalid API key.");
      try {
        const clean = text.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(clean);
        if (!Array.isArray(parsed)) throw new Error("Array chahiye");
        for (const item of parsed) {
          if (!item.label || !item.path) throw new Error("Har item mein label aur path chahiye");
        }
        responseMaps[key] = parsed;
        await dbSave("response_maps", responseMaps);
        return sendPlain(chatId,
          `✅ ${API_LABELS[key]} response map update ho gaya!\n${parsed.length} fields set hue.\n\nFields:\n${parsed.map((f,i) => `${i+1}. ${f.label} → ${f.path}`).join("\n")}`,
          { reply_markup: { inline_keyboard: [
            [{ text: "🗂️ Back to Response Manager", callback_data: "menu_apiresponse" }],
            [{ text: "🧪 Test API", callback_data: `apires_test_${key}` }],
          ] } }
        );
      } catch (e) {
        return sendPlain(chatId, `❌ JSON parse error: ${e.message}\n\nValid JSON array bhejo.\n📋 /apires_guide se format dekho.`);
      }
    }

    // ── API Response Test state ──
    if (state.startsWith("await_apires_test_")) {
      const key = state.replace("await_apires_test_", "");
      userState.delete(userId);
      if (!API_KEYS.includes(key)) return sendPlain(chatId, "❌ Invalid API key.");
      const waitMsg = await sendPlain(chatId, "⏳ Testing API...");
      const { ok, data } = await fetchApi(key, text.trim());
      if (waitMsg) deleteMessage(chatId, waitMsg.message_id);
      if (!ok) return sendPlain(chatId, "❌ API fetch failed. URL check karo.");
      try {
        const title = `${API_LABELS[key].slice(0,20)}`;
        const formatted = formatGenericResult(key, data, text.trim(), title.padEnd(24));
        await sendDataFound(chatId, null, formatted);
        await sendPlain(chatId, "✅ Test successful! Formatting sahi dikh rahi hai.");
      } catch (e) {
        await sendPlain(chatId, `⚠️ Test me error: ${e.message}\nResponse map check karo.`);
      }
      return;
    }

    // ── Broadcast state ──
    if (state === "await_broadcast") {
      userState.delete(userId);
      await sendPlain(chatId, "📢 Broadcasting...");
      return broadcastMessage(text, chatId);
    }

    // ── Add admin state ──
    if (state === "await_addadmin") {
      userState.delete(userId);
      const uname = text.startsWith("@") ? text.toLowerCase() : `@${text.toLowerCase()}`;
      if (!admins.includes(uname)) {
        admins.push(uname);
        await dbSave("admins", admins);
      }
      return sendPlain(chatId, `✅ ${uname} admin ban gaya!`);
    }

    // ── Remove admin state ──
    if (state === "await_removeadmin") {
      userState.delete(userId);
      const uname = text.startsWith("@") ? text.toLowerCase() : `@${text.toLowerCase()}`;
      admins = admins.filter(a => a !== uname);
      await dbSave("admins", admins);
      return sendPlain(chatId, `✅ ${uname} admin se remove ho gaya!`);
    }

    // ── API off message state ──
    if (state.startsWith("await_apimsg_")) {
      const key = state.replace("await_apimsg_", "");
      userState.delete(userId);
      if (API_KEYS.includes(key)) {
        apiToggle[key].offMsg = text.trim();
        await dbSave("api_toggle", apiToggle);
        return sendPlain(chatId, `✅ ${API_LABELS[key]} off message update ho gaya!`);
      }
    }

    // ── Custom TG state ──
    if (state === "await_customtg_key") {
      userState.set(userId, { step: "await_customtg_val", key: text.trim().toLowerCase() });
      return sendPlain(chatId, "Ab custom data bhejo (ye message us TG user ke liye show hoga):");
    }
    if (state && state.step === "await_customtg_val") {
      customTgData.set(state.key, text.trim());
      userState.delete(userId);
      return sendPlain(chatId, `✅ Custom TG data set for: ${state.key}`);
    }

    // ── Custom Num state ──
    if (state === "await_customnum_key") {
      userState.set(userId, { step: "await_customnum_val", key: text.trim() });
      return sendPlain(chatId, "Ab custom data bhejo (ye message us number ke liye show hoga):");
    }
    if (state && state.step === "await_customnum_val") {
      customNumData.set(state.key, text.trim());
      userState.delete(userId);
      return sendPlain(chatId, `✅ Custom Num data set for: ${state.key}`);
    }

    // ── Channel add states ──
    if (state === "await_ch_name") {
      userState.set(userId, { step: "await_ch_username", name: text.trim() });
      return sendPlain(chatId, "Channel username bhejo (bina @ ke) ya private channel ID bhejo:");
    }
    if (state && state.step === "await_ch_username") {
      const isId = /^-?\d+$/.test(text.trim());
      const newCh = { name: state.name, username: isId ? null : text.trim().replace("@",""), id: isId ? Number(text.trim()) : null };
      userState.set(userId, { step: "await_ch_invite", ch: newCh });
      return sendPlain(chatId, "Invite link bhejo (optional, skip karne ke liye 'skip' likho):");
    }
    if (state && state.step === "await_ch_invite") {
      const ch = state.ch;
      if (text.toLowerCase() !== "skip" && text.startsWith("https://")) ch.invite_link = text.trim();
      CHANNELS.push(ch);
      await dbSave("channels", CHANNELS);
      userState.delete(userId);
      return sendPlain(chatId, `✅ Channel "${ch.name}" add ho gaya!\n\nTotal channels: ${CHANNELS.length}`,
        { reply_markup: { inline_keyboard: [[{ text: "📢 Channel Manager", callback_data: "menu_channels" }]] } }
      );
    }
  }

  // ── NON-ADMIN STATE: Menu-driven input ──
  if (!adminUser && state) {
    const joined = await checkJoin(userId);
    if (!joined) { userState.delete(userId); return sendJoinPrompt(chatId); }

    if (state === "await_number") {
      userState.delete(userId);
      return queueForUser(userId, () => handleNum(chatId, userId, text, msg.message_id));
    }
    if (state === "await_tg") {
      userState.delete(userId);
      return queueForUser(userId, () => handleTg(chatId, userId, text, msg.message_id));
    }
    if (state === "await_adhar") {
      userState.delete(userId);
      return queueForUser(userId, () => handleAdhar(chatId, userId, text, msg.message_id));
    }
    if (state === "await_upi") {
      userState.delete(userId);
      return queueForUser(userId, () => handleUpi(chatId, userId, text, msg.message_id));
    }
    if (state === "await_vehicle") {
      userState.delete(userId);
      return queueForUser(userId, () => handleVehicle(chatId, userId, text, msg.message_id));
    }
  }

  // ── COMMANDS ──────────────────────────────
  if (text === "/start") {
    if (!adminUser) {
      const joined = await checkJoin(userId);
      if (!joined) return sendJoinPrompt(chatId);
    }
    const kb = adminUser ? adminMenuKb() : mainMenuKb();
    return sendPlain(chatId, MAIN_MENU_TEXT, { reply_markup: kb });
  }

  if (text === "/help") {
    if (!adminUser) {
      const joined = await checkJoin(userId);
      if (!joined) return sendJoinPrompt(chatId);
    }
    return sendPlain(chatId, HELP_TEXT);
  }

  // ── SLASH COMMANDS (with args) ──
  if (!adminUser) {
    const joined = await checkJoin(userId);
    if (!joined) return sendJoinPrompt(chatId);
  }

  if (text.startsWith("/num ") || text.startsWith("/num@")) {
    const q = text.replace(/^\/num\S*\s*/i, "").trim();
    if (!q) return sendPlain(chatId, "Usage: /num <number>\nExample: /num 9876543210");
    return queueForUser(userId, () => handleNum(chatId, userId, q, msg.message_id));
  }

  if (text.startsWith("/tg ") || text.startsWith("/tg@")) {
    const q = text.replace(/^\/tg\S*\s*/i, "").trim();
    if (!q) return sendPlain(chatId, "Usage: /tg <username>\nExample: /tg rtfgamming");
    return queueForUser(userId, () => handleTg(chatId, userId, q, msg.message_id));
  }

  if (text.startsWith("/adhar ") || text.startsWith("/adhar@")) {
    const q = text.replace(/^\/adhar\S*\s*/i, "").trim();
    if (!q) return sendPlain(chatId, "Usage: /adhar <aadhaar_no>\nExample: /adhar 598229659586");
    return queueForUser(userId, () => handleAdhar(chatId, userId, q, msg.message_id));
  }

  if (text.startsWith("/upi ") || text.startsWith("/upi@")) {
    const q = text.replace(/^\/upi\S*\s*/i, "").trim();
    if (!q) return sendPlain(chatId, "Usage: /upi <upi_id>\nExample: /upi 70497398@axl");
    return queueForUser(userId, () => handleUpi(chatId, userId, q, msg.message_id));
  }

  if (text.startsWith("/vehicle ") || text.startsWith("/vehicle@")) {
    const q = text.replace(/^\/vehicle\S*\s*/i, "").trim();
    if (!q) return sendPlain(chatId, "Usage: /vehicle <reg_number>\nExample: /vehicle MH02FZ0555");
    return queueForUser(userId, () => handleVehicle(chatId, userId, q, msg.message_id));
  }

  // ── ADMIN COMMANDS ──
  if (adminUser) {
    if (text.startsWith("/addadmin ")) {
      const uname = text.replace("/addadmin ", "").trim().toLowerCase();
      const full = uname.startsWith("@") ? uname : `@${uname}`;
      if (!admins.includes(full)) { admins.push(full); await dbSave("admins", admins); }
      return sendPlain(chatId, `✅ ${full} admin ban gaya!`);
    }
    if (text.startsWith("/removeadmin ")) {
      const uname = text.replace("/removeadmin ", "").trim().toLowerCase();
      const full = uname.startsWith("@") ? uname : `@${uname}`;
      admins = admins.filter(a => a !== full);
      await dbSave("admins", admins);
      return sendPlain(chatId, `✅ ${full} admin se remove ho gaya!`);
    }
    if (text.startsWith("/broadcast ")) {
      const msg2 = text.replace("/broadcast ", "").trim();
      await sendPlain(chatId, "📢 Broadcasting...");
      return broadcastMessage(msg2, chatId);
    }
    if (text === "/users") {
      const count = await dbUserCount();
      return sendPlain(chatId, `👥 Total Users: ${count}`);
    }
  }
}

// ══════════════════════════════════════════════
//  CALLBACK HANDLER
// ══════════════════════════════════════════════

async function handleCallback(cq) {
  const chatId  = cq.message.chat.id;
  const msgId   = cq.message.message_id;
  const userId  = cq.from.id;
  const data    = cq.data || "";
  const adminUser = isAdmin(cq.from.username);

  await answerCallback(cq.id);

  // ── VERIFY JOIN ──
  if (data === "verify") {
    joinCache.delete(userId);
    const joined = await checkJoin(userId);
    if (joined) {
      await deleteMessage(chatId, msgId);
      const kb = adminUser ? adminMenuKb() : mainMenuKb();
      return sendPlain(chatId, MAIN_MENU_TEXT, { reply_markup: kb });
    }
    return answerCallback(cq.id, "❌ Abhi bhi kuch channels join nahi kiye!", true);
  }

  // ── MAIN MENU ACTIONS ──
  if (data === "menu_number") {
    if (!adminUser) {
      const joined = await checkJoin(userId);
      if (!joined) return sendJoinPrompt(chatId);
    }
    userState.set(userId, "await_number");
    return sendPlain(chatId, "📞 Number bhejo (10 digits):\nExample: 9876543210");
  }
  if (data === "menu_tg") {
    if (!adminUser) {
      const joined = await checkJoin(userId);
      if (!joined) return sendJoinPrompt(chatId);
    }
    userState.set(userId, "await_tg");
    return sendPlain(chatId, "🔎 TG Username ya User ID bhejo:\nExample: rtfgamming\nExample: 8518042438");
  }
  if (data === "menu_adhar") {
    if (!adminUser) {
      const joined = await checkJoin(userId);
      if (!joined) return sendJoinPrompt(chatId);
    }
    userState.set(userId, "await_adhar");
    return sendPlain(chatId, "🪪 Aadhaar number bhejo (12 digits):\nExample: 598229659586");
  }
  if (data === "menu_upi") {
    if (!adminUser) {
      const joined = await checkJoin(userId);
      if (!joined) return sendJoinPrompt(chatId);
    }
    userState.set(userId, "await_upi");
    return sendPlain(chatId, "💳 UPI ID bhejo:\nExample: 70497398@axl");
  }
  if (data === "menu_vehicle") {
    if (!adminUser) {
      const joined = await checkJoin(userId);
      if (!joined) return sendJoinPrompt(chatId);
    }
    userState.set(userId, "await_vehicle");
    return sendPlain(chatId, "🚗 Vehicle registration number bhejo:\nExample: MH02FZ0555");
  }
  if (data === "menu_help") return sendPlain(chatId, HELP_TEXT);
  if (data === "menu_owner") return sendPlain(chatId, `👑 Owner: ${OWNER}\n📩 Contact karo kisi bhi help ke liye.`);

  // ── ADMIN ONLY BELOW ──
  if (!adminUser) return answerCallback(cq.id, "❌ Admin only!", true);

  if (data === "menu_adminpanel") {
    return tgApi("editMessageText", { chat_id: chatId, message_id: msgId, text: "⚙️ Admin Panel", reply_markup: adminMenuKb() });
  }

  if (data === "menu_users") {
    const count = await dbUserCount();
    return sendPlain(chatId, `👥 Total Users: ${count}`);
  }

  if (data === "menu_adminlist") {
    const list = admins.join("\n") || "No admins";
    return sendPlain(chatId, `📋 Admin List:\n${list}`);
  }

  if (data === "menu_broadcast") {
    userState.set(userId, "await_broadcast");
    return sendPlain(chatId, "📢 Broadcast message bhejo:");
  }

  if (data === "menu_setcustomtg") {
    userState.set(userId, "await_customtg_key");
    return sendPlain(chatId, "TG username ya user ID bhejo jiske liye custom data set karna hai:");
  }

  if (data === "menu_setcustomnum") {
    userState.set(userId, "await_customnum_key");
    return sendPlain(chatId, "Number bhejo jiske liye custom data set karna hai:");
  }

  if (data === "menu_dbbackup") {
    const count = await dbUserCount();
    const users = await dbGetAllUsers();
    const preview = users.slice(0, 5).map(u => `${u.user_id} | @${u.username} | ${u.name}`).join("\n");
    return sendPlain(chatId,
      `🗄️ DB Backup Info:\n\nTotal Users: ${count}\n\nLatest 5:\n${preview || "None"}\n\nFull backup ke liye MongoDB se export karo.`
    );
  }

  // ── API TOGGLE ──
  if (data === "menu_api") {
    return tgApi("editMessageText", { chat_id: chatId, message_id: msgId, text: apiManagerText(), reply_markup: apiManagerKb() });
  }
  if (data.startsWith("api_tog_")) {
    const key = data.replace("api_tog_", "");
    if (API_KEYS.includes(key)) {
      apiToggle[key].enabled = !apiToggle[key].enabled;
      await dbSave("api_toggle", apiToggle);
      return tgApi("editMessageText", { chat_id: chatId, message_id: msgId, text: apiManagerText(), reply_markup: apiManagerKb() });
    }
  }
  if (data.startsWith("api_msg_")) {
    const key = data.replace("api_msg_", "");
    if (API_KEYS.includes(key)) {
      userState.set(userId, `await_apimsg_${key}`);
      return sendPlain(chatId, `✏️ ${API_LABELS[key]} ka off message bhejo:\nCurrent: "${apiToggle[key].offMsg}"`);
    }
  }

  // ── API URL MANAGER ──
  if (data === "menu_apiurl") {
    return sendPlain(chatId, apiUrlManagerText(), { reply_markup: apiUrlManagerKb() });
  }
  if (data.startsWith("apiurl_edit_")) {
    const key = data.replace("apiurl_edit_", "");
    if (API_KEYS.includes(key)) {
      userState.set(userId, `await_apiurl_${key}`);
      const cur = apiUrls[key] || DEFAULT_API_URLS[key];
      return sendPlain(chatId,
        `✏️ ${API_LABELS[key]} ka naya URL bhejo:\n\n⚠️ URL mein {query} placeholder zaroor rakho!\n\nCurrent URL:\n${cur}`,
        { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "menu_apiurl" }]] } }
      );
    }
  }
  if (data.startsWith("apiurl_reset_")) {
    const key = data.replace("apiurl_reset_", "");
    if (API_KEYS.includes(key)) {
      apiUrls[key] = DEFAULT_API_URLS[key];
      await dbSave("api_urls", apiUrls);
      await answerCallback(cq.id, `✅ ${API_LABELS[key]} default URL reset ho gaya!`, true);
      return sendPlain(chatId, apiUrlManagerText(), { reply_markup: apiUrlManagerKb() });
    }
  }

  // ── API RESPONSE MANAGER ──
  if (data === "menu_apiresponse") {
    return sendPlain(chatId, apiResponseManagerText(), { reply_markup: apiResponseManagerKb() });
  }
  if (data === "apires_guide") {
    return sendPlain(chatId, RESPONSE_MAP_GUIDE,
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "menu_apiresponse" }]] } }
    );
  }
  if (data.startsWith("apires_edit_")) {
    const key = data.replace("apires_edit_", "");
    if (API_KEYS.includes(key)) {
      userState.set(userId, `await_apires_${key}`);
      const cur = responseMaps[key] || [];
      const curJson = JSON.stringify(cur, null, 2);
      await sendPlain(chatId,
        `✏️ ${API_LABELS[key]} ke response fields bhejo JSON format mein:\n\nCurrent (${cur.length} fields):\n\n${curJson}\n\n📋 Format guide ke liye "apires_guide" button dabao.`,
        { reply_markup: { inline_keyboard: [
          [{ text: "📋 Format Guide", callback_data: "apires_guide" }],
          [{ text: "❌ Cancel", callback_data: "menu_apiresponse" }],
        ] } }
      );
    }
  }
  if (data.startsWith("apires_reset_")) {
    const key = data.replace("apires_reset_", "");
    if (API_KEYS.includes(key)) {
      responseMaps[key] = JSON.parse(JSON.stringify(DEFAULT_RESPONSE_MAPS[key]));
      await dbSave("response_maps", responseMaps);
      await answerCallback(cq.id, `✅ ${API_LABELS[key]} default response map reset ho gaya!`, true);
      return sendPlain(chatId, apiResponseManagerText(), { reply_markup: apiResponseManagerKb() });
    }
  }
  if (data.startsWith("apires_test_")) {
    const key = data.replace("apires_test_", "");
    if (API_KEYS.includes(key)) {
      userState.set(userId, `await_apires_test_${key}`);
      return sendPlain(chatId,
        `🧪 ${API_LABELS[key]} test karne ke liye query bhejo:\n(e.g. vehicle number, phone number, etc.)`,
        { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "menu_apiresponse" }]] } }
      );
    }
  }

  // ── CHANNEL MANAGER ──
  if (data === "menu_channels") {
    return sendPlain(chatId, channelManagerText(), { reply_markup: channelManagerKb() });
  }
  if (data === "ch_add") {
    userState.set(userId, "await_ch_name");
    return sendPlain(chatId, "Naye channel ka naam bhejo (display name):\nExample: 🔥 RTF GAMING");
  }
  if (data.startsWith("ch_del_")) {
    const idx = parseInt(data.replace("ch_del_", ""));
    if (!isNaN(idx) && idx >= 0 && idx < CHANNELS.length) {
      const removed = CHANNELS.splice(idx, 1)[0];
      await dbSave("channels", CHANNELS);
      await answerCallback(cq.id, `✅ "${removed.name}" remove ho gaya!`, true);
      return sendPlain(chatId, channelManagerText(), { reply_markup: channelManagerKb() });
    }
  }
}

// ══════════════════════════════════════════════
//  WEBHOOK
// ══════════════════════════════════════════════

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body;
    if (update.message)       await handleMessage(update.message);
    if (update.callback_query) await handleCallback(update.callback_query);
  } catch (e) { console.error("[WEBHOOK]", e.message); }
});

app.get("/", (req, res) => res.json({ status: "RTF Bot v4.0 running", time: new Date().toISOString() }));

// ══════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════

async function boot() {
  await initDb();
  await dbLoadAll();

  if (WEBHOOK_URL) {
    const r = await setWebhook(WEBHOOK_URL);
    console.log("[WEBHOOK]", r ? "Set ✅" : "Failed ❌", WEBHOOK_URL);
  }

  await tgApi("setMyCommands", { commands: [
    { command: "start",   description: "Bot start karo" },
    { command: "help",    description: "Help dekho" },
    { command: "num",     description: "Number lookup" },
    { command: "tg",      description: "TG lookup" },
    { command: "adhar",   description: "Aadhaar lookup" },
    { command: "upi",     description: "UPI lookup" },
    { command: "vehicle", description: "Vehicle lookup" },
  ] });

  app.listen(PORT, () => console.log(`[SERVER] Port ${PORT} ✅`));
}

boot().catch(console.error);
