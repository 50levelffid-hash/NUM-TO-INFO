  Number  : ${escMd(number)}\n📊  Records : ${Math.min(records.length,5)} found\n\n`;
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
//  NEW DEEP API FORMATTER
// ══════════════════════════════════════════════

function formatDeepResult(data, queryNumber) {
  try {
    if (!data || !data.status || !data.data) return null;
    
    const records = [];
    const sources = data.data;
    
    // Extract records from all sources
    for (const sourceKey of Object.keys(sources)) {
      const source = sources[sourceKey];
      if (source.records && Array.isArray(source.records)) {
        for (const rec of source.records) {
          const record = {
            name: rec.FullName || rec.Name || "",
            fname: rec.FatherName || "",
            address: rec.Adres || rec.Adres2 || rec.Adres3 || "",
            phone: rec.Phone || "",
            phone2: rec.Phone2 || "",
            phone3: rec.Phone3 || "",
            phone4: rec.Phone4 || "",
            phone5: rec.Phone5 || "",
            phone6: rec.Phone6 || "",
            documentNumber: rec.DocumentNumber || "",
            region: rec.Region || "",
            source: sourceKey,
            sourceTitle: source.title || "",
            lastActivity: rec.LastActivity || "",
            registrationDate: rec.RegistrationDate || "",
            dateOfBirth: rec.DateOfBirth || "",
            education: rec.Education || "",
            age: rec.Age || "",
            gender: rec.Gender || "",
          };
          records.push(record);
        }
      }
    }
    
    if (!records.length) return null;
    
    const colors = ["🔴","🟠","🟡","🟢","🔵","🟣"];
    let text = `\n\n🔬━━━━━━━━━━━━━━━━━━━━━🔬\n` +
               `│  🕵️  D E E P   I N T E L   │\n` +
               `🔬━━━━━━━━━━━━━━━━━━━━━🔬\n` +
               `🔢  Query : ${escMd(queryNumber)}\n\n`;
    
    // Group records by source
    const sourceGroups = {};
    records.forEach(rec => {
      if (!sourceGroups[rec.source]) sourceGroups[rec.source] = [];
      sourceGroups[rec.source].push(rec);
    });
    
    let index = 0;
    for (const sourceKey of Object.keys(sourceGroups)) {
      const sourceRecords = sourceGroups[sourceKey];
      const sourceTitle = sourceRecords[0]?.sourceTitle || sourceKey;
      text += `📁━━━ ${escMd(sourceTitle)} ━━━📁\n`;
      
      sourceRecords.forEach((rec, i) => {
        const dot = colors[index % colors.length];
        text += `${dot}━━━ RECORD ${index + 1} ━━━${dot}\n`;
        if (rec.name) text += `${cbMd("👤 Name      ", rec.name)}\n`;
        if (rec.fname) text += `${cbMd("👨 Father    ", rec.fname)}\n`;
        if (rec.phone) text += `${cbMd("📞 Phone     ", rec.phone)}\n`;
        if (rec.phone2) text += `${cbMd("📞 Phone 2   ", rec.phone2)}\n`;
        if (rec.phone3) text += `${cbMd("📞 Phone 3   ", rec.phone3)}\n`;
        if (rec.phone4) text += `${cbMd("📞 Phone 4   ", rec.phone4)}\n`;
        if (rec.phone5) text += `${cbMd("📞 Phone 5   ", rec.phone5)}\n`;
        if (rec.phone6) text += `${cbMd("📞 Phone 6   ", rec.phone6)}\n`;
        if (rec.address) text += `${cbMd("📍 Address   ", rec.address)}\n`;
        if (rec.documentNumber) text += `${cbMd("🪪 Document  ", rec.documentNumber)}\n`;
        if (rec.region) text += `${cbMd("📡 Region    ", rec.region)}\n`;
        if (rec.lastActivity) text += `${cbMd("🕐 Last Act. ", rec.lastActivity)}\n`;
        if (rec.registrationDate) text += `${cbMd("📅 Reg Date  ", rec.registrationDate)}\n`;
        if (rec.dateOfBirth) text += `${cbMd("🎂 DOB       ", rec.dateOfBirth)}\n`;
        if (rec.education) text += `${cbMd("🎓 Education ", rec.education)}\n`;
        if (rec.age) text += `${cbMd("📊 Age       ", rec.age)}\n`;
        if (rec.gender) text += `${cbMd("⚧️ Gender    ", rec.gender)}\n`;
        text += "\n";
        index++;
      });
    }
    
    text += `👑  ${escMd(OWNER)}  \\|  ⚡ DEEP INTEL`;
    return text;
  } catch (e) { 
    console.error("[formatDeepResult]", e.message); 
    return null; 
  }
}

// ══════════════════════════════════════════════
//  NEW AADHAAR API FORMATTER
// ══════════════════════════════════════════════

function formatAdharResult(data, adharNumber) {
  try {
    if (!data || typeof data !== "object") return null;
    
    // Extract developer/owner fields to skip
    const skipFields = ["developer"];
    const records = [];
    
    // Iterate through all keys to find record objects
    for (const key of Object.keys(data)) {
      if (skipFields.includes(key)) continue;
      const item = data[key];
      if (item && typeof item === "object" && item.aadhar) {
        records.push(item);
      }
    }
    
    if (!records.length) return null;
    
    let out = `┌─────────────────────────┐\n│  🪪  AADHAAR INTEL       │\n├─────────────────────────┤\n` +
              `🔢  Aadhaar : ${escMd(adharNumber)}\n\n`;
    
    // Display first record as primary
    const primary = records[0];
    out += `📋━━━ PRIMARY INFO ━━━📋\n`;
    if (primary.name) out += `${cbMd("👤 Name      ", primary.name)}\n`;
    if (primary.fname) out += `${cbMd("👨 Father    ", primary.fname)}\n`;
    if (primary.num) out += `${cbMd("📞 Phone     ", primary.num)}\n`;
    if (primary.alt) out += `${cbMd("📞 Alt Phone ", primary.alt)}\n`;
    if (primary.address) out += `${cbMd("📍 Address   ", primary.address)}\n`;
    if (primary.circle) out += `${cbMd("📡 Circle    ", primary.circle)}\n`;
    
    // Show additional records if any
    if (records.length > 1) {
      out += `\n📋━━━ ADDITIONAL RECORDS (${records.length - 1}) ━━━📋\n`;
      for (let i = 1; i < records.length && i < 5; i++) {
        const rec = records[i];
        out += `\n🔹━━━ RECORD ${i} ━━━🔹\n`;
        if (rec.name) out += `${cbMd("👤 Name    ", rec.name)}\n`;
        if (rec.fname) out += `${cbMd("👨 Father  ", rec.fname)}\n`;
        if (rec.num) out += `${cbMd("📞 Phone   ", rec.num)}\n`;
        if (rec.alt) out += `${cbMd("📞 Alt     ", rec.alt)}\n`;
        if (rec.address) out += `${cbMd("📍 Address ", rec.address)}\n`;
        if (rec.circle) out += `${cbMd("📡 Circle  ", rec.circle)}\n`;
      }
    }
    
    out += `└─────────────────────────┘\n👑  ${escMd(OWNER)}  \\|  ⚡ ACTIVE`;
    return out;
  } catch (e) { 
    console.error("[formatAdhar]", e.message); 
    return null; 
  }
}

// ══════════════════════════════════════════════
//  OLD FORMATTERS (KEPT FOR COMPATIBILITY)
// ══════════════════════════════════════════════

function parseDeepApiResponse(data) {
  try {
    let arr = Array.isArray(data) ? data : (data && Array.isArray(data.result) ? data.result : null);
    if (!arr || !arr.length) return null;
    const records = [];
    for (const item of arr) {
      if (item.req_left !== undefined || item.developer !== undefined) continue;
      if (!item.NAME && !item.MOBILE) continue;
      records.push({
        name:    String(item.NAME    || "").trim(),
        fname:   String(item.fname   || "").trim(),
        address: String(item.ADDRESS || "").trim(),
        circle:  String(item.circle  || "").trim(),
        mobile:  String(item.MOBILE  || "").trim(),
        alt:     String(item.alt     || "").trim(),
        id:      String(item.id      || "").trim(),
      });
    }
    return records.length ? records : null;
  } catch (e) { console.error("[parseDeepApiResponse]", e.message); return null; }
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
  if (regAuth) lines.push(`🏛️  Reg Auth     : ${escMd(regAuth)}`);
  if (regDate) lines.push(`📅  Reg Date     : ${escMd(regDate)}`);
  if (rtoCode) lines.push(`🗂️  RTO Code     : ${escMd(rtoCode)}`);
  if (rtoName) lines.push(`🏢  RTO Name     : ${escMd(rtoName)}`);
  if (stateName) lines.push(`🗺️  State        : ${escMd(stateName)}`);
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
    if (variant)  lines.push(`⚙️  Variant      : ${escMd(variant)}`);
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
    if (insComp)   lines.push(`🛡️  Insurance    : ${escMd(insComp)}`);
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
  lines.push(`\n┌────────────────────────────┐\n│  👑 ${escMd(OWNER)}  \\|  ⚡ ACTIVE  │\n└────────────────────────────┘`);
  return lines.join("\n");
}

// ══════════════════════════════════════════════
//  CUSTOM RESPONSE FORMATTER (FIXED — handles objects)
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
        // If extracted value is an object or array, stringify it prettily
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
    // If it's JSON, show in code block
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
      lines.push(`${i+1}. ${u.name||"no name"} | ${u.username ? "@"+u.username : "no username"} | ID: ${u.user_id||"N/A"} | 🔍 ${u.total_searches||0}`);
      lines.push(`   📅 First: ${(u.first_seen||"").slice(0,10)||"N/A"}  |  Last: ${(u.last_seen||"").slice(0,10)||"N/A"}`);
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

// ── UPDATED DEEP API FETCH ────────────────────
async function fetchDeepApi(number) {
  if (!apiToggle.deep.enabled) return null;
  // Clean number: remove spaces, +, and ensure 91 prefix
  let clean = String(number).replace(/[+\s]/g, "");
  // If number starts with 91, keep it; otherwise add 91
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

    const deepFmt = formatDeepResult(deepApiRaw, clean);

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

// ══════════════════════════════════════════════
//  UPDATED TG HANDLER — automatically detects "result" object
// ══════════════════════════════════════════════
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
      tgId = String(res.tg_id || "").trim();
      phone = String(res.number || "").trim();
      country = String(res.country || "").trim();
      countryCode = String(res.country_code || "").trim();
    } else {
      tgId = String(rawData.id || rawData.tg_id || "").trim();
      phone = String(rawData.phone || rawData.number || "").trim();
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
        const deepFmt = formatDeepResult(deepApiRaw, cleanPhone);
        if (deepFmt) tgBlock += deepFmt;
      }
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

    // Use new formatter
    const formatted = formatAdharResult(data, adharRaw);
    if (!formatted) {
      await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n🪪  Aadhaar: ${adharRaw}`);
      return;
    }
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

    if (!data.success) { await sendDataNotFound(chatId, userMsgId, `╔══════════════════╗\n║  ❌ UPI NOT FOUND   ║\n╚══════════════════╝\n💳  UPI: ${upiId}`); return; }
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
//  BROADCAST SYSTEM — SUPPORTS ALL MEDIA TYPES
// ══════════════════════════════════════════════

async function handleBroadcast(chatId, from, msg, choice) {
  const users = await dbGetAllUsers();
  const uids = users.map(u => u.user_id);
  
  if (!uids.length) {
    await sendPlain(chatId, "❌  Koi user nahi hai database mein.");
    return;
  }

  const statusMsg = await sendPlain(chatId, `📤  Broadcasting to ${uids.length} users...`);

  let ok = 0, fail = 0;

  // Check if it's a media message
  const hasMedia = msg.photo || msg.video || msg.document || msg.audio || msg.animation || msg.sticker || msg.voice || msg.video_note;

  if (hasMedia) {
    // Forward the media message
    for (const uid of uids) {
      try {
        // Forward the original message with all media and caption
        const forwarded = await tgApi("forwardMessage", {
          chat_id: uid,
          from_chat_id: chatId,
          message_id: msg.message_id
        });
        if (forwarded) ok++; else fail++;
      } catch (e) {
        fail++;
        console.error(`[BROADCAST] Failed for ${uid}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 100));
    }
  } else {
    // Text message broadcast
    const text = msg.text || "";
    if (!text) {
      await sendPlain(chatId, "❌  Kuch toh bhejo! (text ya media)");
      return;
    }
    for (const uid of uids) {
      try {
        const res = await tgApi("sendMessage", { chat_id: uid, text });
        if (res) ok++; else fail++;
      } catch (e) {
        fail++;
        console.error(`[BROADCAST] Failed for ${uid}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  await tgApi("editMessageText", {
    chat_id: chatId,
    message_id: statusMsg.message_id,
    text: `╔══════════════════════╗\n║  📢 BROADCAST DONE    ║\n╚══════════════════════╝\n✅  Delivered : ${ok}\n❌  Failed    : ${fail}\n👥  Total     : ${uids.length}`
  });
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
//  CALLBACKS — COMPLETE FIX
// ══════════════════════════════════════════════
async function handleCallback(cb) {
  const from     = cb.from;
  const chatId   = cb.message.chat.id;
  const msgId    = cb.message.message_id;
  const data     = cb.data;
  const _isAdmin = isAdmin(from.username);

  // ── VERIFY JOIN ──
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

  // ── API TOGGLE (admin only) ──
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

  // ── API OFF MESSAGE SET (admin only) ──
  if (data.startsWith("api_msg_") && _isAdmin) {
    const key = data.replace("api_msg_", "");
    if (apiToggle[key]) {
      userState.set(from.id, `api_offmsg::${key}`);
      await answerCallback(cb.id);
      await sendPlain(chatId, `✏️  ${apiToggle[key].label} ka off message set karo:\n\nCurrent: "${apiToggle[key].offMsg}"\n\nNaya message type karo (ya "cancel" bhejo):`);
    }
    return;
  }

  // ── API URL MANAGER — MAIN PANEL (HTML) ──
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

  // ── API URL EDIT BUTTON — Step 1: Ask for new URL ──
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
        `   Example: https://api.example.com/search?q={query}&key=abc\n\n` +
        `Ya "cancel" type karo:\n╚══════════════════════════╝`
      );
    }
    return;
  }

  // ── API URL RESET ──
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

  // ── CHANNEL MANAGER ──
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
    await sendPlain(chatId, `╔══════════════════════════╗\n║  ➕  CHANNEL ADD          ║\n╠══════════════════════════╣\n📥  Channel username ya ID bhejo:\n\n🌐 Public  : RTFGAMMING1 ya @RTFGAMMING1\n🔒 Private : -1001234567890\n\n⚠️  Bot ko pehle channel admin\n   banana zaroori hai!\n╚══════════════════════════╝`);
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

  // ── BROADCAST CALLBACK ──
  if (data === "menu_broadcast" && _isAdmin) {
    await answerCallback(cb.id);
    userState.set(from.id, "broadcast");
    await sendPlain(chatId, "📢  Broadcast message type karo:\n\n📎  Text, Photo, Video, File, GIF, APK — sab forward ho jayega!");
    return;
  }

  // ── CHECK JOIN FOR NON-ADMIN ──
  await answerCallback(cb.id);
  if (!_isAdmin && !(await checkJoin(from.id))) { await sendJoinPrompt(chatId); return; }

  // ── USER MENU PROMPTS ──
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

  // ── ADMIN-ONLY MENU ACTIONS ──
  if (data === "menu_users")      { const c = await dbUserCount(); await sendPlain(chatId, `📊 Total Users: ${c}\n🗄️ Source: MongoDB`); return; }
  if (data === "menu_dbbackup")   { await sendDbBackup(chatId); return; }
  if (data === "menu_adminlist")  { await sendPlain(chatId, "╔══════════════════╗\n║  📋 ADMIN LIST   ║\n╚══════════════════╝\n" + admins.map(a=>`• ${a}`).join("\n")); return; }
  if (data === "menu_setcustomtg")  { userState.set(from.id, "setcustomtg_step1");  await sendPlain(chatId, "📥  Username bhejo jiska data set karna hai\n📌  Example: rtfgamming"); return; }
  if (data === "menu_setcustomnum") { userState.set(from.id, "setcustomnum_step1"); await sendPlain(chatId, "📥  Number bhejo jiska data set karna hai\n📌  Example: 9876543210"); return; }

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
      "🔗 /apiurlmanager  📢 /channelmanager\n╚══════════════════════════╝"
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
    
    // Check if user is in broadcast state
    const choice = userState.get(from.id);
    if (choice === "broadcast" && _isAdmin) {
      await handleBroadcast(chatId, from, msg, choice);
      userState.delete(from.id);
      return;
    }

    if (!text) return;

    if (_isAdmin && ["/broadcast","/addadmin","/removeadmin","/users","/listadmins","/admin",
        "/setcustomtg","/delcustomtg","/setcustomnum","/delcustomnum","/listcustom","/dbbackup",
        "/apimanager","/apiurlmanager","/channelmanager"]
        .some(c => text.toLowerCase().startsWith(c))) {
      return await handleAdminText(chatId, from.id, text);
    }

    if (!choice) return;

    if (!_isAdmin && !(await checkJoin(from.id))) { await sendJoinPrompt(chatId); return; }

    // ── API OFF MESSAGE SET ──
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

    // ══════════════════════════════════════════════
    //  API URL SET FLOW — 2 STEPS
    // ══════════════════════════════════════════════

    // STEP 1 — Receive new URL
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
        return; // keep state, let them try again
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
        `   Example: "number" ya "result.number"\n\n` +
        `"raw" type karo ya field name bhejo:\n╚══════════════════════════╝`
      );
      return;
    }

    // STEP 2 — Receive response field config
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
        `✅ Done\\. Ab /apiurlmanager se check karo.\n╚══════════════════════════╝`
      );
      return;
    }

    // ── CHANNEL ADD FLOW ──
    if (_isAdmin && (
      choice === "ch_add_step1" ||
      (typeof choice === "string" && choice.startsWith("ch_add_step2::")) ||
      (typeof choice === "string" && choice.startsWith("ch_add_step3::"))
    )) {
      await handleChannelAddFlow(chatId, from, text, choice);
      return;
    }

    if (choice === "number")  { await handleNumber(chatId, text, msgId, from.id); }
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
      "📋 /listcustom  🔌 /apimanager\n🔗 /apiurlmanager  📢 /channelmanager\n╚══════════════════════════╝"
    );
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
    if (!msgText) { await sendPlain(chatId, "❌  Usage: /broadcast <message>\nYa bot se directly media forward karo."); return; }
    const users = await dbGetAllUsers(); const uids = users.map(u => u.user_id);
    const status = await sendPlain(chatId, `📤  Broadcasting to ${uids.length} users...`);
    let ok = 0, fail = 0;
    for (const uid of uids) {
      const r = await tgApi("sendMessage", { chat_id: uid, text: msgText });
      r ? ok++ : fail++;
      await new Promise(r => setTimeout(r, 100));
    }
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
  else {
    // Check if user is waiting for broadcast input
    const choice = userState.get(uid);
    if (choice === "broadcast" && isAdmin(msg.from.username)) {
      queueForUser(uid, () => handleUpdate(update));
    } else {
      queueForUser(uid, () => handleUpdate(update));
    }
  }
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
