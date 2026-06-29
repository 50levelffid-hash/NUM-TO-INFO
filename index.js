import os
import re
import json
import time
import threading
import logging
from datetime import datetime, timezone
from urllib.parse import quote_plus

import requests

# ── Logging ──────────────────────────────────
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────
BOT_TOKEN = "8765184537:AAG6S0ggdA6MH6nDEeFv6prwZ_HrJhV9wCg"
OWNER = "@RTFGAMMING"

if not BOT_TOKEN:
    logger.error("BOT_TOKEN not set!")
    exit(1)

# ── File storage setup ──────────────────────
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)
USERS_FILE = os.path.join(DATA_DIR, "users.json")
SAVED_DATA_FILE = os.path.join(DATA_DIR, "saved_data.json")

users_db = {}
saved_data_db = {}
users_db_lock = threading.Lock()
saved_data_lock = threading.Lock()

def load_json_file(filepath, default):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default

def save_json_file(filepath, data):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def load_databases():
    global users_db, saved_data_db
    users_db = load_json_file(USERS_FILE, {})
    saved_data_db = load_json_file(SAVED_DATA_FILE, {})
    logger.info("Databases loaded from file")

def save_users():
    with users_db_lock:
        save_json_file(USERS_FILE, users_db)

def save_saved_data():
    with saved_data_lock:
        save_json_file(SAVED_DATA_FILE, saved_data_db)

# ── DB Functions (file-based) ───────────────
def db_save_user(from_data):
    user_id = from_data["id"]
    now = datetime.now(timezone.utc).isoformat()
    with users_db_lock:
        if user_id not in users_db:
            users_db[user_id] = {
                "user_id": user_id,
                "username": from_data.get("username", ""),
                "name": " ".join(filter(None, [from_data.get("first_name", ""), from_data.get("last_name", "")])),
                "first_name": from_data.get("first_name", ""),
                "last_name": from_data.get("last_name", ""),
                "first_seen": now,
                "total_searches": 0
            }
        else:
            users_db[user_id]["username"] = from_data.get("username", "")
            users_db[user_id]["name"] = " ".join(filter(None, [from_data.get("first_name", ""), from_data.get("last_name", "")]))
            users_db[user_id]["first_name"] = from_data.get("first_name", "")
            users_db[user_id]["last_name"] = from_data.get("last_name", "")
        users_db[user_id]["last_seen"] = now
    save_users()

def db_incr_search(user_id):
    with users_db_lock:
        if user_id in users_db:
            users_db[user_id]["total_searches"] = users_db[user_id].get("total_searches", 0) + 1
    save_users()

def db_save_data(key, value):
    with saved_data_lock:
        saved_data_db[key] = {"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()}
    save_saved_data()

def db_get_all_users():
    with users_db_lock:
        return list(users_db.values())

def db_user_count():
    with users_db_lock:
        return len(users_db)

# ── API URLs ──────────────────────────────────
NUM_API_URL     = "https://movements-invoice-amanda-victoria.trycloudflare.com/search/number?number={number}&key=mysecretkey123"
# UPDATED Deep API – using new service
DEEP_API_URL    = "https://l34k-osint.onrender.com/search?key=4e7feeb644fb638362361a94e7e43691&query={query}"
ADHAR_API_URL   = "https://atof.onrender.com/full-search?aadhaar={number}"
TG_NEW_API_URL  = "https://rootx-osint.in/?type=tg_num&key=userxinfo&query={term}"   # rootx TG API
UPI_API_URL     = "https://krish-osintoy.lovable.app/api/v1/upi?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&upi={upi}"
VEHICLE_API_URL = "https://krish-osintoy.lovable.app/api/v1/vehicle?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&vehicle={vehicle}"

CHANNELS = [
    {"name": "🔥 RTF GAMING", "username": "RTFGMINGGC"},
    {"name": "🎁 GIVEAWAY", "username": "RTFGAMINGHACK0"},
    {"name": "💀 RTF ERA", "username": "BYEPAASLINK"},
]
JOINED_STATUSES = {"member", "administrator", "creator", "restricted"}

admins = ["@rtfgamming"]
user_state = {}
custom_tg_data = {}
custom_num_data = {}

# ── API Toggle ──────────────────────────────
api_toggle = {
    "num": {"enabled": True, "label": "📞 Number API", "offMsg": "❌ Number lookup abhi available nahi hai."},
    "deep": {"enabled": True, "label": "🔬 Deep Intel API", "offMsg": "❌ Deep data lookup abhi available nahi hai."},
    "tg": {"enabled": True, "label": "🔎 TG API", "offMsg": "❌ TG lookup abhi available nahi hai."},
    "adhar": {"enabled": True, "label": "🪪 Aadhaar API", "offMsg": "❌ Aadhaar lookup abhi available nahi hai."},
    "upi": {"enabled": True, "label": "💳 UPI API", "offMsg": "❌ UPI lookup abhi available nahi hai."},
    "vehicle": {"enabled": True, "label": "🚗 Vehicle API", "offMsg": "❌ Vehicle lookup abhi available nahi hai."},
}
API_KEYS = list(api_toggle.keys())

# ── Concurrency Control ─────────────────────
user_queue = {}
queue_lock = threading.Lock()

def queue_for_user(user_id, func, *args, **kwargs):
    with queue_lock:
        user_lock = user_queue.get(user_id)
        if user_lock is None:
            user_lock = threading.Lock()
            user_queue[user_id] = user_lock
        def run():
            with user_lock:
                try:
                    func(*args, **kwargs)
                except Exception as e:
                    logger.error(f"Error in queued task for {user_id}: {e}")
        threading.Thread(target=run, daemon=True).start()

# ── Telegram API ─────────────────────────────
TG_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"

def tg_request(method, payload=None, files=None, timeout=20):
    url = f"{TG_BASE}/{method}"
    try:
        if files:
            resp = requests.post(url, data=payload, files=files, timeout=timeout)
        else:
            headers = {"Content-Type": "application/json"} if payload else {}
            resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("ok"):
            logger.error(f"TG {method} error: {data.get('description')}")
            return None
        return data.get("result")
    except requests.exceptions.Timeout:
        logger.error(f"TG {method} timeout")
        return None
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 400:
            logger.debug(f"TG {method} 400 error: {e}")
        else:
            logger.error(f"TG {method} HTTP error: {e}")
        return None
    except Exception as e:
        logger.error(f"TG {method} request error: {e}")
        return None

def esc_md(text):
    if text is None:
        return ""
    return re.sub(r"([_*[\]()~`>#+=|{}.!\\-])", r"\\\1", str(text))

def cb_md(label, value):
    v = str(value).strip() if value is not None else ""
    if v and v not in ("N/A", "", "None", "null", "nan", "undefined"):
        return f"{esc_md(label)}: `{esc_md(v)}`"
    return f"{esc_md(label)}: ❌ N/A"

def send_message(chat_id, text, extra=None):
    if not text or not text.strip():
        logger.warning(f"Attempted to send empty message to {chat_id}")
        return None
    if extra is None:
        extra = {}
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "MarkdownV2",
        "disable_web_page_preview": True,
        **extra
    }
    return tg_request("sendMessage", payload)

def send_plain(chat_id, text, extra=None):
    if not text or not text.strip():
        logger.warning(f"Attempted to send empty plain message to {chat_id}")
        return None
    if extra is None:
        extra = {}
    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
        **extra
    }
    return tg_request("sendMessage", payload)

def edit_message_text(chat_id, message_id, text, extra=None):
    if not text or not text.strip():
        logger.warning(f"Attempted to edit with empty text")
        return None
    if extra is None:
        extra = {}
    payload = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": "MarkdownV2",
        "disable_web_page_preview": True,
        **extra
    }
    return tg_request("editMessageText", payload)

def delete_message(chat_id, message_id):
    return tg_request("deleteMessage", {"chat_id": chat_id, "message_id": message_id})

def answer_callback(callback_id, text="", show_alert=False):
    return tg_request("answerCallbackQuery", {"callback_query_id": callback_id, "text": text, "show_alert": show_alert})

def get_chat_member(chat_id, user_id):
    return tg_request("getChatMember", {"chat_id": chat_id, "user_id": user_id})

def set_my_commands(commands):
    return tg_request("setMyCommands", {"commands": commands})

def get_updates(offset=None, timeout=30):
    payload = {"timeout": timeout, "allowed_updates": ["message", "edited_message", "callback_query"]}
    if offset:
        payload["offset"] = offset
    return tg_request("getUpdates", payload, timeout=35)

def delete_webhook():
    return tg_request("deleteWebhook")

# ── Join Check ──────────────────────────────
join_cache = {}
JOIN_CACHE_TTL = 60

def get_not_joined_channels(user_id):
    missing = []
    for ch in CHANNELS:
        try:
            m = get_chat_member(f"@{ch['username']}", user_id)
            if not m or m.get("status") not in JOINED_STATUSES:
                missing.append(ch)
        except:
            missing.append(ch)
    return missing

def check_join(user_id):
    now = time.time()
    cached = join_cache.get(user_id)
    if cached and now - cached["ts"] < JOIN_CACHE_TTL:
        return cached["ok"]
    missing = get_not_joined_channels(user_id)
    ok = len(missing) == 0
    join_cache[user_id] = {"ok": ok, "ts": now}
    if len(join_cache) > 5000:
        for k, v in list(join_cache.items()):
            if now - v["ts"] > JOIN_CACHE_TTL:
                del join_cache[k]
    return ok

def is_admin(username):
    return f"@{username.lower()}" in [a.lower() for a in admins] if username else False

def send_join_prompt(chat_id):
    missing = get_not_joined_channels(chat_id)
    if not missing:
        return False
    buttons = []
    for ch in missing:
        buttons.append([{"text": f"➕ {ch['name']}", "url": f"https://t.me/{ch['username']}"}])
    buttons.append([{"text": "✅ VERIFY JOIN", "callback_data": "verify"}])
    text = ("╔════════════════════════╗\n"
            "║  🔒  ACCESS LOCKED  🔒  ║\n"
            "╠════════════════════════╣\n"
            "📢  Sabhi channels JOIN karo\n"
            "⚡  Phir ✅ VERIFY dabao\n"
            "╚════════════════════════╝")
    send_plain(chat_id, text, extra={"reply_markup": {"inline_keyboard": buttons}})
    return True

# ── Menus ────────────────────────────────────
MAIN_MENU_TEXT = (
    "╔══════════════════════════╗\n"
    "║  ⚡️  R T F   B O T  ⚡️   ║\n"
    "╠══════════════════════════╣\n"
    "🛡  Status  : ONLINE\n"
    f"👑  Owner   : {OWNER}\n"
    "🔥  Version : v3.0\n"
    "╠══════════════════════════╣\n"
    "📌  Neeche se option chuno:\n"
    "╚══════════════════════════╝"
)

HELP_TEXT = (
    "╔══════════════════════════╗\n"
    "║  📖  B O T   H E L P    ║\n"
    "╠══════════════════════════╣\n"
    "📞  /num <number>\n   Example: /num 9876543210\n\n"
    "🔎  /tg <username ya userid>\n   Example: /tg rtfgamming\n   Example: /tg 8518042438\n\n"
    "🪪  /adhar <aadhaar_no>\n   Example: /adhar 598229659586\n\n"
    "💳  /upi <upi_id>\n   Example: /upi 70497398@axl\n\n"
    "🚗  /vehicle <reg_number>\n   Example: /vehicle MH02FZ0555\n\n"
    "🏠 /start  ❓ /help\n"
    "╠══════════════════════════╣\n"
    f"👑  Owner : {OWNER}\n"
    "╚════════════════════════╝"
)

def main_menu_kb():
    return {"inline_keyboard": [
        [{"text": "📞 Number Lookup", "callback_data": "menu_number"}, {"text": "🔎 TG Lookup", "callback_data": "menu_tg"}],
        [{"text": "🪪 Aadhaar Lookup", "callback_data": "menu_adhar"}],
        [{"text": "💳 UPI Lookup", "callback_data": "menu_upi"}],
        [{"text": "🚗 Vehicle Lookup", "callback_data": "menu_vehicle"}],
        [{"text": "❓ Help", "callback_data": "menu_help"}, {"text": "👑 Owner", "callback_data": "menu_owner"}],
    ]}

def admin_menu_kb():
    return {"inline_keyboard": [
        [{"text": "📞 Number Lookup", "callback_data": "menu_number"}, {"text": "🔎 TG Lookup", "callback_data": "menu_tg"}],
        [{"text": "🪪 Aadhaar Lookup", "callback_data": "menu_adhar"}],
        [{"text": "💳 UPI Lookup", "callback_data": "menu_upi"}],
        [{"text": "🚗 Vehicle Lookup", "callback_data": "menu_vehicle"}],
        [{"text": "❓ Help", "callback_data": "menu_help"}, {"text": "👑 Owner", "callback_data": "menu_owner"}],
        [{"text": "📢 Broadcast", "callback_data": "menu_broadcast"}, {"text": "👥 Users Count", "callback_data": "menu_users"}],
        [{"text": "📋 Admin List", "callback_data": "menu_adminlist"}, {"text": "⚙️ Admin Panel", "callback_data": "menu_adminpanel"}],
        [{"text": "✏️ Set Custom TG", "callback_data": "menu_setcustomtg"}],
        [{"text": "✏️ Set Custom Num", "callback_data": "menu_setcustomnum"}],
        [{"text": "🗄️ DB Backup", "callback_data": "menu_dbbackup"}],
        [{"text": "🔌 API Manager", "callback_data": "menu_api"}],
    ]}

# ── API Manager ──────────────────────────────
def api_manager_kb():
    rows = []
    for k in API_KEYS:
        api = api_toggle[k]
        st = "🟢 ON" if api["enabled"] else "🔴 OFF"
        rows.append([
            {"text": f"{st}  {api['label']}", "callback_data": f"api_tog_{k}"},
            {"text": "✏️ Msg", "callback_data": f"api_msg_{k}"}
        ])
    rows.append([{"text": "🔙 Back", "callback_data": "menu_adminpanel"}])
    return {"inline_keyboard": rows}

def api_manager_text():
    text = "╔══════════════════════════╗\n║  🔌  API MANAGER          ║\n╠══════════════════════════╣\n\n"
    for k in API_KEYS:
        api = api_toggle[k]
        st = "🟢 ON " if api["enabled"] else "🔴 OFF"
        text += f"{st}  {api['label']}\n"
        if not api["enabled"]:
            text += f'      💬 "{api["offMsg"][:40]}..."\n'
        text += "\n"
    text += "Toggle = ON/OFF\n✏️ Msg = Custom message set karo\n╚══════════════════════════╝"
    return text

# ── Helper functions ─────────────────────────
def send_data_not_found(chat_id, user_msg_id, not_found_text):
    extra = {"reply_to_message_id": user_msg_id} if user_msg_id else {}
    msg = send_plain(chat_id, not_found_text, extra)
    if msg:
        def del_msgs():
            time.sleep(15)
            if msg:
                delete_message(chat_id, msg["message_id"])
            if user_msg_id:
                delete_message(chat_id, user_msg_id)
        threading.Thread(target=del_msgs, daemon=True).start()

def send_data_found(chat_id, user_msg_id, text):
    extra = {"reply_to_message_id": user_msg_id} if user_msg_id else {}
    res = send_message(chat_id, text, extra)
    if not res:
        plain = re.sub(r"[_*[\]()~`>#+=|{}.!\\-]", "", text)
        send_plain(chat_id, plain, extra)
    return res

def api_fetch(url, timeout=15):
    try:
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        try:
            return resp.json()
        except:
            return resp.text
    except Exception as e:
        logger.error(f"API fetch error {url}: {e}")
        return None

# ── Record extraction and formatting ────────
def extract_records(data):
    records = []
    try:
        results = data.get("result", []) if isinstance(data, dict) and not isinstance(data, list) else data
        if isinstance(results, list):
            for r in results:
                records.append({
                    "name": r.get("name", "N/A").strip(),
                    "fname": r.get("fname", "N/A").strip(),
                    "address": r.get("address", "N/A").strip(),
                    "circle": r.get("circle", "N/A").strip(),
                    "alt": str(r.get("alt", "N/A")),
                    "aadhar": str(r.get("aadhar", "N/A")),
                    "email": r.get("email", "N/A"),
                })
    except Exception as e:
        logger.error(f"extract_records error: {e}")
    return records

def format_num_result(records, number):
    colors = ["🔴", "🟠", "🟡", "🟢", "🔵"]
    out = (f"┌─────────────────────────┐\n"
           f"│  📞  NUMBER INFO         │\n"
           f"├─────────────────────────┤\n"
           f"📱  Number  : `{esc_md(number)}`\n"
           f"📊  Records : {min(len(records), 5)} found\n\n")
    for i, r in enumerate(records[:5]):
        dot = colors[i % len(colors)]
        out += (f"{dot}━━━ RECORD {i+1} ━━━{dot}\n"
                f"{cb_md('👤 Name   ', r['name'])}\n"
                f"{cb_md('👨 Father ', r['fname'])}\n"
                f"{cb_md('📍 Address', r['address'])}\n"
                f"{cb_md('📡 Circle ', r['circle'])}\n"
                f"{cb_md('☎️  Alt Num', r['alt'])}\n"
                f"{cb_md('🪪 Aadhar ', r['aadhar'])}\n"
                f"{cb_md('✉️  Email  ', r['email'])}\n\n")
    out += f"└─────────────────────────┘\n👑  {esc_md(OWNER)}  \\|  ⚡ ACTIVE"
    return out

# ─── UPDATED DEEP API PARSER ────────────────
def parse_deep_api_response(api_data):
    """
    Parses the new deep API response format (l34k-osint.onrender.com):
    {
      "status": true,
      "data": {
        "source1": {
          "records": [
            {
              "FullName": "...",
              "FatherName": "...",
              "Phone": "...",
              "Phone2": "...",
              "Adres": "...",
              "Adres2": "...",
              "Region": "...",
              ...
            }
          ]
        }
      }
    }
    Returns the same `parsed` dict used by `format_deep_result`.
    """
    try:
        if not api_data or api_data.get("status") is not True:
            return None
        source = api_data.get("data", {}).get("source1", {})
        records = source.get("records", [])
        if not isinstance(records, list) or not records:
            return None

        parsed = {
            "mobiles": [],
            "addresses": [],
            "full_name": None,
            "father": None,
            "region": None,
            "facebook": None,
            "name": None,
            "surname": None,
            "gender": None,
            "country": None,
        }

        for rec in records:
            if not isinstance(rec, dict):
                continue

            # Extract phones
            for key in ["Phone", "Phone2", "Phone3", "Phone4", "Phone5"]:
                val = rec.get(key)
                if val and str(val).strip() not in ("", "None", "null"):
                    phone = str(val).strip()
                    if phone not in parsed["mobiles"]:
                        parsed["mobiles"].append(phone)

            # Extract addresses
            for key in ["Adres", "Adres2", "Adres3"]:
                val = rec.get(key)
                if val and str(val).strip() not in ("", "None", "null"):
                    addr = str(val).strip()
                    if addr not in parsed["addresses"]:
                        parsed["addresses"].append(addr)

            # Identity fields
            if rec.get("FullName") and not parsed["full_name"]:
                parsed["full_name"] = str(rec["FullName"]).strip()
            if rec.get("FatherName") and not parsed["father"]:
                parsed["father"] = str(rec["FatherName"]).strip()
            if rec.get("Region") and not parsed["region"]:
                parsed["region"] = str(rec["Region"]).strip()
            if rec.get("Name") and not parsed["name"]:
                parsed["name"] = str(rec["Name"]).strip()
            if rec.get("Surname") and not parsed["surname"]:
                parsed["surname"] = str(rec["Surname"]).strip()
            if rec.get("Gender") and not parsed["gender"]:
                parsed["gender"] = str(rec["Gender"]).strip()
            if rec.get("Country") and not parsed["country"]:
                parsed["country"] = str(rec["Country"]).strip()
            if rec.get("FacebookID") and not parsed["facebook"]:
                parsed["facebook"] = str(rec["FacebookID"]).strip()
            if rec.get("Facebook") and not parsed["facebook"]:
                parsed["facebook"] = str(rec["Facebook"]).strip()

        # If no meaningful data, return None
        if not any([parsed["mobiles"], parsed["addresses"],
                    parsed["full_name"], parsed["father"], parsed["region"]]):
            return None
        return parsed
    except Exception as e:
        logger.error(f"parse_deep_api_response error: {e}")
        return None

# ── Rest of the formatters (unchanged) ──────
def format_deep_result(parsed, query_number):
    if not parsed:
        return None
    has_meaningful = any([parsed["mobiles"], parsed["addresses"],
                          parsed["full_name"], parsed["father"], parsed["region"]])
    if not has_meaningful:
        return None
    text = (f"\n\n"
            f"🔬━━━━━━━━━━━━━━━━━━━━━🔬\n"
            f"│  🕵️  D E E P   I N T E L   │\n"
            f"🔬━━━━━━━━━━━━━━━━━━━━━🔬\n"
            f"🔢  Query : `{esc_md(query_number)}`\n\n")
    if any([parsed["full_name"], parsed["name"], parsed["surname"], parsed["father"], parsed["gender"]]):
        text += "👤━━━ IDENTITY ━━━👤\n"
        if parsed["full_name"]:
            text += f"{cb_md('🧑 Full Name  ', parsed['full_name'])}\n"
        if parsed["name"] or parsed["surname"]:
            nm = " ".join(filter(None, [parsed["name"], parsed["surname"]]))
            text += f"{cb_md('🏷️  Name      ', nm)}\n"
        if parsed["father"]:
            text += f"{cb_md('👨 Father    ', parsed['father'])}\n"
        if parsed["gender"]:
            text += f"{cb_md('⚧️  Gender    ', parsed['gender'])}\n"
        text += "\n"
    if parsed["mobiles"]:
        unique = list(set(parsed["mobiles"]))
        text += f"📞━━━ PHONES ({len(unique)}) ━━━📞\n"
        colors = ["🔴","🟠","🟡","🟢","🔵","🟣","🔘","⚪"]
        for i, mob in enumerate(unique):
            text += f"{colors[i % len(colors)]}  `{esc_md(mob)}`\n"
        text += "\n"
    if parsed["addresses"]:
        unique = list(set(parsed["addresses"]))
        text += f"📍━━━ ADDRESSES ({len(unique)}) ━━━📍\n"
        for addr in unique:
            text += f"🔸  {esc_md(addr)}\n"
        text += "\n"
    if parsed["region"]:
        text += f"📡━━━ NETWORK ━━━📡\n{cb_md('📶 Region', parsed['region'])}\n\n"
    if parsed["facebook"] or parsed["country"]:
        text += "🌐━━━ SOCIAL ━━━🌐\n"
        if parsed["facebook"]:
            text += f"{cb_md('📘 Facebook', parsed['facebook'])}\n"
        if parsed["country"]:
            text += f"{cb_md('🌍 Country ', parsed['country'])}\n"
        text += "\n"
    text += f"👑  {esc_md(OWNER)}  \\|  ⚡ DEEP INTEL"
    return text

def format_adhar_result(data, adhar_number):
    try:
        if not data or not data.get("success"):
            return None
        details = data.get("details", {})
        card = details.get("card_info", {})
        members = details.get("members", [])
        monthly = details.get("monthly_summary", [])
        out = (f"┌─────────────────────────┐\n"
               f"│  🪪  AADHAAR INTEL       │\n"
               f"├─────────────────────────┤\n"
               f"🔢  Aadhaar     : `{esc_md(adhar_number)}`\n"
               f"{cb_md('🪪  RC ID       ', data.get('ration_card_id'))}\n\n")
        if card:
            out += "📋━━━ RATION CARD ━━━📋\n"
            for key, val in card.items():
                if val and val != "null":
                    out += f"{cb_md(key, val)}\n"
            out += "\n"
        if members:
            out += f"👨‍👩‍👧‍👦━━━ FAMILY MEMBERS ({len(members)}) ━━━👨‍👩‍👧‍👦\n"
            colors = ["🔴","🟠","🟡","🟢","🔵","🟣","⚪"]
            for i, m in enumerate(members):
                dot = colors[i % len(colors)]
                gender_icon = "👩" if m.get("gender", "").lower() == "f" else "👨" if m.get("gender", "").lower() == "m" else "🧑"
                ekyc = "✅" if m.get("ekyc_status") == "Y" else "❌"
                out += (f"{dot}━━ {i+1}\\. {esc_md(m.get('member_name', 'N/A'))} {gender_icon}\n"
                        f"   📋 Relation  : {esc_md(m.get('relationship', 'N/A'))}\n"
                        f"   🆔 UID       : `{esc_md(m.get('uid_masked', 'N/A'))}`\n"
                        f"   ✅ eKYC      : {ekyc}\n"
                        f"   📅 Updated   : {esc_md(m.get('cr_last_updated', 'N/A'))}\n\n")
        if monthly:
            out += "📊━━━ RECENT MONTHS ━━━📊\n"
            for m in monthly[:3]:
                out += f"📅 {esc_md(m.get('month', 'N/A'))}  \\|  👥 Members: {esc_md(m.get('member_count', 'N/A'))}\n"
            out += "\n"
        out += f"└─────────────────────────┘\n👑  {esc_md(OWNER)}  \\|  ⚡ ACTIVE"
        return out
    except Exception as e:
        logger.error(f"format_adhar error: {e}")
        return None

def format_upi_result(data, upi_id):
    def val(v):
        s = str(v).strip() if v is not None else ""
        return s if s and s not in ("None","null","nan","false","False","") else None
    tick = lambda v: "✅" if v else "❌"
    name = val(data.get("name"))
    username = val(data.get("username"))
    valid = data.get("valid")
    acc_type = val(data.get("account_type"))
    is_merchant = data.get("merchant")
    merchant_ver = data.get("merchant_verified")
    bank = val(data.get("bank"))
    bank_type = val(data.get("bank_type"))
    ifsc = val(data.get("ifsc"))
    ifsc_d = data.get("ifsc_details", {})
    branch = val(ifsc_d.get("BRANCH"))
    address = val(ifsc_d.get("ADDRESS"))
    city = val(ifsc_d.get("CITY"))
    district = val(ifsc_d.get("DISTRICT"))
    state = val(ifsc_d.get("STATE"))
    contact = val(ifsc_d.get("CONTACT"))
    rtgs = ifsc_d.get("RTGS")
    neft = ifsc_d.get("NEFT")
    imps = ifsc_d.get("IMPS")
    upi_sup = ifsc_d.get("UPI")
    lines = ["┌─────────────────────────┐", "│  💳  UPI LOOKUP          │", "├─────────────────────────┤", cb_md("💳 UPI ID      ", upi_id)]
    if name:
        lines.append(cb_md("👤 Name        ", name))
    if username:
        lines.append(cb_md("🔖 Username    ", username))
    lines.append(f"✅ Valid        : {'✅ YES' if valid else '❌ NO'}")
    if acc_type:
        lines.append(cb_md("🏦 Account Type", acc_type))
    if bank:
        lines.append(cb_md("🏛️  Bank        ", bank))
    if bank_type:
        lines.append(cb_md("📂 Bank Type   ", bank_type))
    if ifsc:
        lines.append(cb_md("🔢 IFSC        ", ifsc))
    if is_merchant is not None:
        lines.append(f"🏪 Merchant    : {tick(is_merchant)}")
    if merchant_ver is not None:
        lines.append(f"✔️  Merch\\.Verif : {tick(merchant_ver)}")
    if any([branch, address, city, district, state, contact]):
        lines.extend(["├─────────────────────────┤", "│  🏦  IFSC DETAILS        │", "├─────────────────────────┤"])
        if branch:
            lines.append(cb_md("🏢 Branch      ", branch))
        if address:
            lines.append(cb_md("📍 Address     ", address))
        if city:
            lines.append(cb_md("🏙️  City        ", city))
        if district:
            lines.append(cb_md("📍 District    ", district))
        if state:
            lines.append(cb_md("🗺️  State       ", state))
        if contact:
            lines.append(cb_md("📞 Contact     ", contact))
    if any([rtgs is not None, neft is not None, imps is not None, upi_sup is not None]):
        lines.extend(["├─────────────────────────┤", "│  💸  PAYMENT MODES       │", "├─────────────────────────┤"])
        if rtgs is not None:
            lines.append(f"⚡ RTGS        : {tick(rtgs)}")
        if neft is not None:
            lines.append(f"🔄 NEFT        : {tick(neft)}")
        if imps is not None:
            lines.append(f"📲 IMPS        : {tick(imps)}")
        if upi_sup is not None:
            lines.append(f"💳 UPI         : {tick(upi_sup)}")
    lines.append("└─────────────────────────┘")
    lines.append(f"👑  {esc_md(OWNER)}  \\|  ⚡ ACTIVE")
    return "\n".join(lines)

def format_vehicle_result(data):
    vd = data.get("vehicle_data", {}) if isinstance(data.get("vehicle_data"), dict) else {}
    def v(val):
        s = str(val).strip() if val is not None else ""
        return s if s and s not in ("None","null","","nan","0","false","False") else None
    mob = v(data.get("mobile_number"))
    eng = v(data.get("engine_number"))
    chassis = v(data.get("chassis_number"))
    reg_no = v(data.get("vehicle_number") or data.get("vehicle"))
    father = v(vd.get("ownerFatherName"))
    reg_auth = v(vd.get("regAuthority"))
    reg_date = v(vd.get("regDate"))
    mfr = v(vd.get("manufacturer"))
    model = v(vd.get("vehicle"))
    variant = v(vd.get("variant"))
    fuel = v(vd.get("fuelType"))
    veh_class = v(vd.get("vehicleClass"))
    veh_type = v(vd.get("vehicleType"))
    cc = v(vd.get("cubicCapacity"))
    seats = v(vd.get("seatCapacity"))
    mfr_year = v(vd.get("manufacturerYear"))
    present_addr = v(vd.get("presentAddress") or vd.get("permAddress"))
    financer = v(vd.get("financerName"))
    ins_company = v(vd.get("insuranceCompanyName"))
    ins_upto = v(vd.get("insuranceUpto"))
    ins_expired = vd.get("insuranceExpired")
    pucc_valid = v(vd.get("puccValidUpto"))
    pincode = v(vd.get("pincode"))
    rto_data = vd.get("rtoData", {}) if isinstance(vd.get("rtoData"), dict) else {}
    rto_name = v(rto_data.get("rtoName"))
    rto_code = v(vd.get("rtoCode"))
    is_comm = vd.get("isCommercial")
    lines = ["┌────────────────────────────┐",
             "│  🚗  VEHICLE INFO           │",
             "└────────────────────────────┘",
             "🔷━━━ REGISTRATION ━━━🔷"]
    if reg_no:
        lines.append(f"🚘  Reg No      : `{esc_md(reg_no)}`")
    if reg_auth:
        lines.append(f"🏛️   Reg Auth    : `{esc_md(reg_auth)}`")
    if reg_date:
        lines.append(f"📅  Reg Date    : `{esc_md(reg_date)}`")
    if rto_code:
        lines.append(f"🗂️   RTO Code    : `{esc_md(rto_code)}`")
    if rto_name:
        lines.append(f"🏢  RTO Name    : `{esc_md(rto_name)}`")
    if any([father, mob, present_addr, pincode]):
        lines.append("\n🔶━━━ OWNER DETAILS ━━━🔶")
        if father:
            lines.append(f"👨  Father       : `{esc_md(father)}`")
        if mob:
            lines.append(f"📞  Mobile       : `{esc_md(mob)}`")
        if present_addr:
            lines.append(f"📍  Address      : `{esc_md(present_addr)}`")
        if pincode:
            lines.append(f"📮  Pincode      : `{esc_md(pincode)}`")
    if any([mfr, model, variant, fuel, veh_class, cc, seats, mfr_year]):
        lines.append("\n🟢━━━ VEHICLE SPECS ━━━🟢")
        if mfr:
            lines.append(f"🏭  Manufacturer : `{esc_md(mfr)}`")
        if model:
            lines.append(f"🚗  Model        : `{esc_md(model)}`")
        if variant:
            lines.append(f"⚙️   Variant      : `{esc_md(variant)}`")
        if fuel:
            lines.append(f"⛽  Fuel Type    : `{esc_md(fuel)}`")
        if veh_class:
            lines.append(f"📋  Class        : `{esc_md(veh_class)}`")
        if veh_type:
            lines.append(f"🔖  Type         : `{esc_md(veh_type)}`")
        if mfr_year:
            lines.append(f"📆  Mfr Year     : `{esc_md(mfr_year)}`")
        if cc:
            lines.append(f"🔩  Cubic Cap    : `{esc_md(cc)} cc`")
        if seats:
            lines.append(f"💺  Seats        : `{esc_md(seats)}`")
        if is_comm is not None:
            lines.append(f"🏪  Commercial   : {'✅ YES' if is_comm else '❌ NO'}")
    if any([eng, chassis]):
        lines.append("\n🔵━━━ TECHNICAL ━━━🔵")
        if eng:
            lines.append(f"🔧  Engine No    : `{esc_md(eng)}`")
        if chassis:
            lines.append(f"🔩  Chassis No   : `{esc_md(chassis)}`")
    if any([financer, ins_company, ins_upto, pucc_valid]):
        lines.append("\n🟣━━━ FINANCE & INSURANCE ━━━🟣")
        if financer:
            lines.append(f"💰  Financer     : `{esc_md(financer)}`")
        if ins_company:
            lines.append(f"🛡️   Insurance    : `{esc_md(ins_company)}`")
        if ins_upto:
            expired = " ❌ EXPIRED" if ins_expired else " ✅ VALID"
            lines.append(f"📅  Ins Upto     : `{esc_md(ins_upto)}`{expired}")
        if pucc_valid:
            lines.append(f"🌿  PUCC Valid   : `{esc_md(pucc_valid)}`")
    lines.append(f"\n┌────────────────────────────┐")
    lines.append(f"│  👑 {esc_md(OWNER)}  \\|  ⚡ ACTIVE  │")
    lines.append("└────────────────────────────┘")
    return "\n".join(lines)

# ── DB Backup ──────────────────────────────
def send_db_backup(chat_id):
    all_users = db_get_all_users()
    total = len(all_users)
    if not total:
        send_plain(chat_id, "📭  Database empty hai.")
        return
    status = send_plain(chat_id, "🗄️  Database se data fetch ho raha hai...")
    if not status:
        return
    try:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        sorted_users = sorted(all_users, key=lambda u: u.get("total_searches", 0), reverse=True)
        total_searches = sum(u.get("total_searches", 0) for u in all_users)
        lines = [
            "╔════════════════════════════════╗",
            "║  🗄️  DATABASE BACKUP REPORT     ║",
            "╠════════════════════════════════╣",
            f"📊  Total Users    : {total}",
            f"🔍  Total Searches : {total_searches}",
            f"🕐  Generated      : {now}",
            "╠════════════════════════════════╣",
        ]
        if sorted_users:
            top = sorted_users[0]
            lines.append(f"🏆  Top Searcher: {top.get('name') or top.get('username') or top.get('user_id')} — {top.get('total_searches', 0)} searches")
        lines.append("────────────────────────────────")
        for i, u in enumerate(sorted_users):
            name = u.get("name", "no name")
            uname = f"@{u.get('username')}" if u.get("username") else "no username"
            srch = u.get("total_searches", 0)
            fseen = (u.get("first_seen") or "N/A")[:10]
            lseen = (u.get("last_seen") or "N/A")[:10]
            lines.append(f"{i+1}. {name} | {uname} | ID: {u.get('user_id', 'N/A')} | 🔍 {srch}")
            lines.append(f"   📅 First: {fseen}  |  Last: {lseen}")
        lines.append("╚════════════════════════════════╝")
        full_text = "\n".join(lines)
        if len(full_text) > 4000:
            payload = {
                "chat_id": chat_id,
                "caption": f"🗄️ RTF Bot DB — {total} users | 🔍 {total_searches} searches | {now}",
            }
            files = {
                "document": (f"rtfbot_{datetime.now(timezone.utc).date()}.txt", full_text.encode("utf-8"), "text/plain")
            }
            tg_request("sendDocument", payload, files)
            delete_message(chat_id, status["message_id"])
        else:
            edit_message_text(chat_id, status["message_id"], full_text)
    except Exception as e:
        logger.error(f"DB backup error: {e}")
        edit_message_text(chat_id, status["message_id"], f"❌  Backup failed: {e}")

# ── API Fetchers ─────────────────────────────
def fetch_deep_api(number):
    if not api_toggle["deep"]["enabled"]:
        return None
    raw = re.sub(r"[+\s]", "", str(number))
    if len(raw) == 10 and not raw.startswith("91"):
        raw = "91" + raw
    # Use the updated deep API URL
    url = DEEP_API_URL.format(query=raw)
    logger.info(f"[DEEP API] Querying: {url}")
    try:
        data = api_fetch(url, timeout=20)
        return data if isinstance(data, dict) else None
    except Exception as e:
        logger.error(f"fetch_deep_api error: {e}")
        return None

def fetch_num_api(clean_phone):
    if not api_toggle["num"]["enabled"]:
        return []
    try:
        data = api_fetch(NUM_API_URL.replace("{number}", clean_phone))
        return extract_records(data)
    except Exception as e:
        logger.error(f"fetch_num_api error: {e}")
        return []

def fetch_tg_new(term):
    if not api_toggle["tg"]["enabled"]:
        return None
    try:
        url = TG_NEW_API_URL.replace("{term}", quote_plus(term))
        logger.info(f"[TG API] Querying: {url}")
        data = api_fetch(url, timeout=20)
        if data and data.get("success") is True and data.get("number") and data.get("number") != "N/A":
            return {
                "tgId": data.get("tg_id", "N/A"),
                "phone": data.get("number"),
                "countryCode": data.get("country_code", "N/A"),
                "country": data.get("country", "N/A"),
                "req_left": data.get("req_left"),
                "req_total": data.get("req_total"),
                "expiry": data.get("expiry"),
                "developer": data.get("developer"),
            }
        return None
    except Exception as e:
        logger.error(f"fetch_tg_new error: {e}")
        return None

def fetch_tg_data(term):
    term_lower = term.lower()
    if term_lower in custom_tg_data:
        return {"custom": True, "data": custom_tg_data[term_lower]}
    result = fetch_tg_new(term)
    return {"custom": False, "data": result}

# ── Lookup Handlers ──────────────────────────
def handle_number(chat_id, number, user_msg_id=None, user_id=None):
    num_key = number.strip().lower()
    if num_key in custom_num_data:
        if user_id:
            db_incr_search(user_id)
        send_data_found(chat_id, user_msg_id, custom_num_data[num_key])
        return

    if not api_toggle["num"]["enabled"] and not api_toggle["deep"]["enabled"]:
        send_data_not_found(chat_id, user_msg_id,
            f"╔══════════════════╗\n║  ⚠️  API OFFLINE   ║\n╚══════════════════╝\n{api_toggle['num']['offMsg']}")
        return

    status = send_plain(chat_id, f"🔍  Searching: {number} ...")
    if not status:
        return
    try:
        clean = re.sub(r"\s", "", number).replace("+91", "")
        if clean.startswith("91") and len(clean) > 10:
            clean = clean[2:]

        records = fetch_num_api(clean)
        deep_raw = fetch_deep_api(number)

        delete_message(chat_id, status["message_id"])

        deep_parsed = parse_deep_api_response(deep_raw)  # uses updated parser
        deep_fmt = format_deep_result(deep_parsed, clean)

        if not records and not deep_fmt:
            send_data_not_found(chat_id, user_msg_id,
                f"╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n📱  Number: {clean}\n⚠️  Koi record nahi mila")
            return

        if user_id:
            db_incr_search(user_id)

        full = ""
        if records and api_toggle["num"]["enabled"]:
            full += format_num_result(records, clean)
        if deep_fmt:
            full += deep_fmt

        send_data_found(chat_id, user_msg_id, full)
    except Exception as e:
        logger.error(f"handle_number error: {e}")
        delete_message(chat_id, status["message_id"])
        send_plain(chat_id, "❌  API Error / Timeout.")

def handle_tg(chat_id, term, user_msg_id=None, user_id=None):
    term = term.strip().lstrip("@")
    if not term:
        send_data_not_found(chat_id, user_msg_id, "❌  Kuch toh bhejo!\n✅ /tg rtfgamming\n✅ /tg 8518042438")
        return

    status = send_plain(chat_id, f"🔍  Searching TG: {term} ...")
    if not status:
        return
    try:
        res = fetch_tg_data(term)
        delete_message(chat_id, status["message_id"])

        if res["custom"]:
            if user_id:
                db_incr_search(user_id)
            send_data_found(chat_id, user_msg_id, res["data"])
            return

        data = res["data"]
        if not data or not data.get("phone"):
            send_data_not_found(chat_id, user_msg_id,
                f"╔══════════════════════╗\n║  ❌ DATA NOT FOUND    ║\n╠══════════════════════╣\n🔎  Input : {term}\n⚠️  Data nahi mila\n╚══════════════════════╝")
            return

        if user_id:
            db_incr_search(user_id)

        is_numeric = term.isdigit()
        input_label = "🆔 UserID" if is_numeric else "👤 Username"
        input_display = term if is_numeric else f"@{term}"

        tg_block = (f"┌─────────────────────────┐\n"
                    f"│  🔎  TG LOOKUP           │\n"
                    f"├─────────────────────────┤\n"
                    f"{cb_md(input_label, input_display)}\n"
                    f"{cb_md('🆔 Telegram ID ', data.get('tgId', 'N/A'))}\n"
                    f"{cb_md('📞 Phone       ', data.get('phone', 'N/A'))}\n"
                    f"{cb_md('🌍 Country     ', data.get('country', 'N/A'))}\n"
                    f"{cb_md('📱 Country Code', data.get('countryCode', 'N/A'))}\n"
                    f"└─────────────────────────┘\n")

        if data.get("phone"):
            clean_phone = re.sub(r"[+\s]", "", data["phone"])
            if clean_phone.startswith("91") and len(clean_phone) > 10:
                clean_phone = clean_phone[2:]
            num_res = fetch_num_api(clean_phone)
            deep_raw = fetch_deep_api(data["phone"])
            if num_res and api_toggle["num"]["enabled"]:
                tg_block += "\n" + format_num_result(num_res, clean_phone)
            deep_parsed = parse_deep_api_response(deep_raw)
            deep_fmt = format_deep_result(deep_parsed, clean_phone)
            if deep_fmt:
                tg_block += deep_fmt

        send_data_found(chat_id, user_msg_id, tg_block)
    except Exception as e:
        logger.error(f"handle_tg error: {e}")
        delete_message(chat_id, status["message_id"])
        send_plain(chat_id, "❌  Kuch gadbad ho gayi.")

def handle_adhar(chat_id, adhar_raw, user_msg_id=None, user_id=None):
    if not api_toggle["adhar"]["enabled"]:
        send_data_not_found(chat_id, user_msg_id,
            f"╔══════════════════╗\n║  ⚠️  API OFFLINE   ║\n╚══════════════════╝\n{api_toggle['adhar']['offMsg']}")
        return
    status = send_plain(chat_id, f"🔍  Searching Aadhaar: {adhar_raw} ...")
    if not status:
        return
    try:
        data = api_fetch(ADHAR_API_URL.replace("{number}", adhar_raw))
        delete_message(chat_id, status["message_id"])
        if not data or not data.get("success"):
            send_data_not_found(chat_id, user_msg_id,
                f"╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n🪪  Aadhaar: {adhar_raw}")
            return
        formatted = format_adhar_result(data, adhar_raw)
        if not formatted:
            send_data_not_found(chat_id, user_msg_id, f"❌  Data format error — Aadhaar: {adhar_raw}")
            return
        if user_id:
            db_incr_search(user_id)
        send_data_found(chat_id, user_msg_id, formatted)
    except Exception as e:
        logger.error(f"handle_adhar error: {e}")
        delete_message(chat_id, status["message_id"])
        send_plain(chat_id, "❌  API Error / Timeout.")

def handle_upi(chat_id, upi_id, user_msg_id=None, user_id=None):
    if not api_toggle["upi"]["enabled"]:
        send_data_not_found(chat_id, user_msg_id,
            f"╔══════════════════╗\n║  ⚠️  API OFFLINE   ║\n╚══════════════════╝\n{api_toggle['upi']['offMsg']}")
        return
    status = send_plain(chat_id, f"🔍  Searching UPI: {upi_id} ...")
    if not status:
        return
    try:
        data = api_fetch(UPI_API_URL.replace("{upi}", upi_id.strip()))
        delete_message(chat_id, status["message_id"])
        if not data or not data.get("success"):
            send_data_not_found(chat_id, user_msg_id,
                f"╔══════════════════╗\n║  ❌ UPI NOT FOUND   ║\n╚══════════════════╝\n💳  UPI: {upi_id}")
            return
        if user_id:
            db_incr_search(user_id)
        send_data_found(chat_id, user_msg_id, format_upi_result(data, upi_id))
    except Exception as e:
        logger.error(f"handle_upi error: {e}")
        delete_message(chat_id, status["message_id"])
        send_plain(chat_id, "❌  API Error / Timeout.")

def handle_vehicle(chat_id, vehicle_no, user_msg_id=None, user_id=None):
    if not api_toggle["vehicle"]["enabled"]:
        send_data_not_found(chat_id, user_msg_id,
            f"╔══════════════════════╗\n║  ⚠️  API OFFLINE       ║\n╚══════════════════════╝\n{api_toggle['vehicle']['offMsg']}")
        return
    vehicle_no = re.sub(r"\s", "", vehicle_no.upper())
    status = send_plain(chat_id, f"🔍  Searching Vehicle: {vehicle_no} ...")
    if not status:
        return
    try:
        data = api_fetch(VEHICLE_API_URL.replace("{vehicle}", vehicle_no), timeout=20)
        delete_message(chat_id, status["message_id"])
        if not data or not data.get("success"):
            send_data_not_found(chat_id, user_msg_id,
                f"╔══════════════════════╗\n║  ❌ VEHICLE NOT FOUND  ║\n╚══════════════════════╝\n🚗  Vehicle: {vehicle_no}")
            return
        if user_id:
            db_incr_search(user_id)
        send_data_found(chat_id, user_msg_id, format_vehicle_result(data))
    except Exception as e:
        logger.error(f"handle_vehicle error: {e}")
        delete_message(chat_id, status["message_id"])
        send_plain(chat_id, "❌  API Error / Timeout.")

# ── Callback Handler ─────────────────────────
def handle_callback(cb):
    from_data = cb["from"]
    chat_id = cb["message"]["chat"]["id"]
    msg_id = cb["message"]["message_id"]
    data = cb["data"]
    _is_admin = is_admin(from_data.get("username"))

    if data == "verify":
        join_cache.pop(from_data["id"], None)
        missing = get_not_joined_channels(from_data["id"])
        if missing:
            answer_callback(cb["id"], f"❌ Abhi bhi join karo: {', '.join(c['name'] for c in missing)}", True)
            buttons = [[{"text": f"➕ {ch['name']}", "url": f"https://t.me/{ch['username']}"}] for ch in missing]
            buttons.append([{"text": "✅ VERIFY JOIN", "callback_data": "verify"}])
            tg_request("editMessageReplyMarkup", {"chat_id": chat_id, "message_id": msg_id, "reply_markup": {"inline_keyboard": buttons}})
        else:
            join_cache[from_data["id"]] = {"ok": True, "ts": time.time()}
            answer_callback(cb["id"])
            kb = admin_menu_kb() if _is_admin else main_menu_kb()
            edit_message_text(chat_id, msg_id, MAIN_MENU_TEXT, extra={"reply_markup": kb})
        return

    # API toggle
    if data.startswith("api_tog_") and _is_admin:
        key = data.replace("api_tog_", "")
        if key in api_toggle:
            api_toggle[key]["enabled"] = not api_toggle[key]["enabled"]
            st = "🟢 ON" if api_toggle[key]["enabled"] else "🔴 OFF"
            answer_callback(cb["id"], f"{api_toggle[key]['label']} {st}", True)
            edit_message_text(chat_id, msg_id, api_manager_text(), extra={"reply_markup": api_manager_kb()})
        return

    # API set custom off message
    if data.startswith("api_msg_") and _is_admin:
        key = data.replace("api_msg_", "")
        if key in api_toggle:
            user_state[from_data["id"]] = f"api_offmsg::{key}"
            answer_callback(cb["id"])
            send_plain(chat_id,
                f"✏️  {api_toggle[key]['label']} ka off message set karo:\n\n"
                f'Current: "{api_toggle[key]["offMsg"]}"\n\n'
                f'Ab naya message type karo (ya "cancel" bhejo):')
        return

    answer_callback(cb["id"])
    if not _is_admin and not check_join(from_data["id"]):
        send_join_prompt(chat_id)
        return

    prompts = {
        "menu_number": "╔════════════════════╗\n║  📞 NUMBER LOOKUP  ║\n╚════════════════════╝\n📥  Number bhejo:\n📌 Format: 9876543210",
        "menu_tg": "╔═══════════════════════╗\n║   🔎  TG LOOKUP       ║\n╠═══════════════════════╣\n📥  Username YA numeric ID\n✅  rtfgamming / @rtfgamming / 8518042438\n╚═══════════════════════╝",
        "menu_adhar": "╔══════════════════════╗\n║  🪪  AADHAAR LOOKUP  ║\n╚══════════════════════╝\n📥  Aadhaar number bhejo:\n📌 Example: 598229659586",
        "menu_upi": "╔══════════════════════╗\n║  💳  UPI LOOKUP      ║\n╚══════════════════════╝\n📥  UPI ID bhejo:\n📌 Example: 70497398@axl",
        "menu_vehicle": "╔══════════════════════╗\n║  🚗  VEHICLE LOOKUP  ║\n╚══════════════════════╝\n📥  Vehicle number bhejo:\n📌 Example: MH02FZ0555",
    }
    state_map = {
        "menu_number": "number",
        "menu_tg": "tg",
        "menu_adhar": "adhar",
        "menu_upi": "upi",
        "menu_vehicle": "vehicle",
    }

    if data in state_map:
        user_state[from_data["id"]] = state_map[data]
        send_plain(chat_id, prompts[data])
        return
    if data == "menu_help":
        send_plain(chat_id, HELP_TEXT)
        return
    if data == "menu_owner":
        send_plain(chat_id, f"╔══════════════════╗\n║  👑  OWNER INFO   ║\n╚══════════════════╝\n🔗 https://t.me/{OWNER.lstrip('@')}")
        return

    if not _is_admin:
        return

    if data == "menu_users":
        c = db_user_count()
        send_plain(chat_id, f"📊 Total Users: {c}\n🗄️ Source: File storage")
        return
    if data == "menu_dbbackup":
        send_db_backup(chat_id)
        return
    if data == "menu_adminlist":
        send_plain(chat_id, f"╔══════════════════╗\n║  📋 ADMIN LIST   ║\n╚══════════════════╝\n" + "\n".join(f"• {a}" for a in admins))
        return
    if data == "menu_broadcast":
        user_state[from_data["id"]] = "broadcast"
        send_plain(chat_id, "📢  Broadcast message type karo:")
        return
    if data == "menu_setcustomtg":
        user_state[from_data["id"]] = "setcustomtg_step1"
        send_plain(chat_id, "📥  Username bhejo jiska data set karna hai\n📌  Example: rtfgamming")
        return
    if data == "menu_setcustomnum":
        user_state[from_data["id"]] = "setcustomnum_step1"
        send_plain(chat_id, "📥  Number bhejo jiska data set karna hai\n📌  Example: 9876543210")
        return
    if data == "menu_api":
        edit_message_text(chat_id, msg_id, api_manager_text(), extra={"reply_markup": api_manager_kb()})
        return
    if data == "menu_adminpanel":
        send_plain(chat_id,
            "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n"
            "📢 /broadcast  👥 /users\n➕ /addadmin  ➖ /removeadmin\n📋 /listadmins  🗄️ /dbbackup\n"
            "✏️ /setcustomtg  🗑️ /delcustomtg\n✏️ /setcustomnum  🗑️ /delcustomnum\n📋 /listcustom  🔌 /apimanager\n╚══════════════════════════╝")
        return

# ── Message Router ───────────────────────────
def handle_update(update):
    try:
        if "callback_query" in update:
            queue_for_user(update["callback_query"]["from"]["id"], handle_callback, update["callback_query"])
            return

        msg = update.get("message") or update.get("edited_message")
        if not msg:
            return
        from_data = msg.get("from")
        if not from_data or from_data.get("is_bot"):
            return
        chat_id = msg["chat"]["id"]
        msg_id = msg.get("message_id")
        text = (msg.get("text") or "").strip()
        _is_admin = is_admin(from_data.get("username"))

        db_save_user(from_data)
        if not text:
            return

        admin_cmds = ["/broadcast","/addadmin","/removeadmin","/users","/listadmins","/admin",
                      "/setcustomtg","/delcustomtg","/setcustomnum","/delcustomnum","/listcustom","/dbbackup","/apimanager"]
        if _is_admin and any(text.lower().startswith(cmd) for cmd in admin_cmds):
            queue_for_user(from_data["id"], handle_admin_text, chat_id, from_data["id"], text)
            return

        choice = user_state.get(from_data["id"])
        if not choice:
            return

        if not _is_admin and not check_join(from_data["id"]):
            send_join_prompt(chat_id)
            return

        # API off-message setter
        if isinstance(choice, str) and choice.startswith("api_offmsg::") and _is_admin:
            key = choice.split("::")[1]
            if text.lower() == "cancel":
                user_state.pop(from_data["id"], None)
                send_plain(chat_id, "❌  Cancel ho gaya.")
                return
            if key in api_toggle:
                api_toggle[key]["offMsg"] = text.strip()
                send_plain(chat_id, f'✅  {api_toggle[key]["label"]} ka off message set ho gaya!\n\n"{text.strip()}"')
            user_state.pop(from_data["id"], None)
            return

        if choice == "broadcast" and _is_admin:
            users = db_get_all_users()
            uids = [u["user_id"] for u in users]
            status = send_plain(chat_id, f"📤  Broadcasting to {len(uids)} users...")
            ok = 0
            fail = 0
            for uid in uids:
                r = tg_request("sendMessage", {"chat_id": uid, "text": text})
                if r:
                    ok += 1
                else:
                    fail += 1
                time.sleep(0.05)
            if status:
                edit_message_text(chat_id, status["message_id"],
                    f"╔══════════════════╗\n║  📢 BROADCAST DONE  ║\n╚══════════════════╝\n✅  Delivered : {ok}\n❌  Failed    : {fail}\n👥  Total     : {len(uids)}")
            return

        if choice == "number":
            handle_number(chat_id, text, msg_id, from_data["id"])
        elif choice == "tg":
            handle_tg(chat_id, text, msg_id, from_data["id"])
        elif choice == "adhar":
            handle_adhar(chat_id, text, msg_id, from_data["id"])
        elif choice == "upi":
            handle_upi(chat_id, text, msg_id, from_data["id"])
        elif choice == "vehicle":
            handle_vehicle(chat_id, text, msg_id, from_data["id"])
        elif choice == "setcustomtg_step1" and _is_admin:
            user_state[from_data["id"]] = f"setcustomtg_step2::{text.strip().lstrip('@').lower()}"
            send_plain(chat_id, f"✅  Username: {text.strip()}\n\n📥  Ab custom data bhejo:")
            return
        elif isinstance(choice, str) and choice.startswith("setcustomtg_step2::") and _is_admin:
            target_key = choice.split("::")[1]
            custom_tg_data[target_key] = text.strip()
            db_save_data(f"customtg:{target_key}", {"username": target_key, "data": text.strip()})
            send_plain(chat_id, f"✅  Custom TG data set!\n👤 Key: {target_key}")
        elif choice == "setcustomnum_step1" and _is_admin:
            user_state[from_data["id"]] = f"setcustomnum_step2::{text.strip().lower()}"
            send_plain(chat_id, f"✅  Number: {text.strip()}\n\n📥  Ab custom data bhejo:")
            return
        elif isinstance(choice, str) and choice.startswith("setcustomnum_step2::") and _is_admin:
            target_key = choice.split("::")[1]
            custom_num_data[target_key] = text.strip()
            db_save_data(f"customnum:{target_key}", {"number": target_key, "data": text.strip()})
            send_plain(chat_id, f"✅  Custom Number data set!\n📱 Key: {target_key}")

        user_state.pop(from_data["id"], None)
    except Exception as e:
        logger.error(f"handle_update error: {e}")

def handle_admin_text(chat_id, user_id, text):
    lower = text.lower()
    if lower == "/admin":
        send_plain(chat_id,
            "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n"
            "📢 /broadcast  👥 /users\n➕ /addadmin  ➖ /removeadmin\n📋 /listadmins  🗄️ /dbbackup\n"
            "✏️ /setcustomtg  🗑️ /delcustomtg\n✏️ /setcustomnum  🗑️ /delcustomnum\n📋 /listcustom  🔌 /apimanager\n╚══════════════════════════╝")
        return
    if lower == "/apimanager":
        send_plain(chat_id, api_manager_text(), extra={"reply_markup": api_manager_kb()})
        return
    if lower.startswith("/broadcast"):
        msg_text = text[len("/broadcast"):].strip()
        if not msg_text:
            send_plain(chat_id, "❌  Usage: /broadcast <message>")
            return
        users = db_get_all_users()
        uids = [u["user_id"] for u in users]
        status = send_plain(chat_id, f"📤  Broadcasting to {len(uids)} users...")
        ok, fail = 0, 0
        for uid in uids:
            r = tg_request("sendMessage", {"chat_id": uid, "text": msg_text})
            if r:
                ok += 1
            else:
                fail += 1
            time.sleep(0.05)
        if status:
            edit_message_text(chat_id, status["message_id"],
                f"✅ Delivered: {ok}\n❌ Failed: {fail}\n👥 Total: {len(uids)}")
        return
    if lower == "/users":
        c = db_user_count()
        send_plain(chat_id, f"📊  Total Users: {c}\n🗄️ Source: File storage")
        return
    if lower == "/dbbackup":
        send_db_backup(chat_id)
        return
    if lower.startswith("/addadmin"):
        parts = text.strip().split()
        if len(parts) < 2:
            send_plain(chat_id, "❌  Usage: /addadmin @username")
            return
        na = parts[1] if parts[1].startswith("@") else f"@{parts[1]}"
        if na.lower() not in [a.lower() for a in admins]:
            admins.append(na)
            send_plain(chat_id, f"✅  {na} ko admin bana diya!")
        else:
            send_plain(chat_id, f"⚠️  {na} pehle se admin hai.")
        return
    if lower.startswith("/removeadmin"):
        parts = text.strip().split()
        if len(parts) < 2:
            send_plain(chat_id, "❌  Usage: /removeadmin @username")
            return
        rem = parts[1] if parts[1].startswith("@") else f"@{parts[1]}"
        match = next((a for a in admins if a.lower() == rem.lower()), None)
        if match and match.lower() != "@rtfgamming":
            admins = [a for a in admins if a.lower() != rem.lower()]
            send_plain(chat_id, f"✅  {rem} ko hata diya.")
        elif match:
            send_plain(chat_id, "❌  Owner ko remove nahi kar sakte!")
        else:
            send_plain(chat_id, f"⚠️  {rem} list me nahi hai.")
        return
    if lower == "/listadmins":
        send_plain(chat_id, f"╔══════════════════╗\n║  📋 ADMIN LIST    ║\n╚══════════════════╝\n" + "\n".join(f"• {a}" for a in admins))
        return
    if lower.startswith("/setcustomtg"):
        parts = text.strip().split(None, 2)
        if len(parts) < 3:
            send_plain(chat_id, "❌  Usage: /setcustomtg @username <custom_text>")
            return
        target = parts[1].lstrip("@").lower()
        custom_text = parts[2]
        custom_tg_data[target] = custom_text
        db_save_data(f"customtg:{target}", {"username": target, "data": custom_text})
        send_plain(chat_id, f"✅  Custom TG data set!\n👤 Key: {target}")
        return
    if lower.startswith("/delcustomtg"):
        parts = text.strip().split()
        if len(parts) < 2:
            send_plain(chat_id, "❌  Usage: /delcustomtg @username")
            return
        target = parts[1].lstrip("@").lower()
        if target in custom_tg_data:
            del custom_tg_data[target]
            send_plain(chat_id, f"✅  {target} ka custom TG data delete ho gaya.")
        else:
            send_plain(chat_id, f"⚠️  {target} ka koi custom TG data nahi mila.")
        return
    if lower.startswith("/setcustomnum"):
        parts = text.strip().split(None, 2)
        if len(parts) < 3:
            send_plain(chat_id, "❌  Usage: /setcustomnum <number> <custom_text>")
            return
        target = parts[1].lower()
        custom_text = parts[2]
        custom_num_data[target] = custom_text
        db_save_data(f"customnum:{target}", {"number": target, "data": custom_text})
        send_plain(chat_id, f"✅  Custom Number data set!\n📱 Key: {target}")
        return
    if lower.startswith("/delcustomnum"):
        parts = text.strip().split()
        if len(parts) < 2:
            send_plain(chat_id, "❌  Usage: /delcustomnum <number>")
            return
        target = parts[1].lower()
        if target in custom_num_data:
            del custom_num_data[target]
            send_plain(chat_id, f"✅  {target} ka custom Number data delete ho gaya.")
        else:
            send_plain(chat_id, f"⚠️  {target} ka koi custom Number data nahi mila.")
        return
    if lower == "/listcustom":
        output = "╔══════════════════════════╗\n║  📋  CUSTOM DATA LIST   ║\n╠══════════════════════════╣\n\n"
        output += "🔹 CUSTOM TG DATA:\n"
        if custom_tg_data:
            for k, v in custom_tg_data.items():
                output += f"  👤 {k}\n     📝 {v[:50]}{'...' if len(v) > 50 else ''}\n"
        else:
            output += "  ❌ Koi custom TG data nahi\n"
        output += "\n🔹 CUSTOM NUMBER DATA:\n"
        if custom_num_data:
            for k, v in custom_num_data.items():
                output += f"  📱 {k}\n     📝 {v[:50]}{'...' if len(v) > 50 else ''}\n"
        else:
            output += "  ❌ Koi custom Number data nahi\n"
        output += "╚══════════════════════════╝"
        send_plain(chat_id, output)
        return

def handle_command(msg):
    from_data = msg["from"]
    if not from_data or from_data.get("is_bot"):
        return
    chat_id = msg["chat"]["id"]
    msg_id = msg.get("message_id")
    text = (msg.get("text") or "").strip()
    _is_adm = is_admin(from_data.get("username"))

    db_save_user(from_data)

    # --- START FIX: robust join check ---
    if not _is_adm:
        try:
            if not check_join(from_data["id"]):
                send_join_prompt(chat_id)
                return
        except Exception as e:
            logger.error(f"Join check error in handle_command: {e}")
            # fall through to command handling
    # --- END FIX ---

    match = re.match(r"^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?", text)
    if not match:
        return
    cmd = match.group(1)
    args = (match.group(2) or "").strip()

    if cmd == "start":
        # Additional per‑command check with try/except to ensure reply
        try:
            if not _is_adm and not check_join(from_data["id"]):
                send_join_prompt(chat_id)
                return
        except Exception as e:
            logger.error(f"Start command join check error: {e}")
            # proceed to show menu anyway
        kb = admin_menu_kb() if _is_adm else main_menu_kb()
        send_message(chat_id, MAIN_MENU_TEXT, extra={"reply_markup": kb})
    elif cmd == "help":
        send_plain(chat_id, HELP_TEXT)
    elif cmd == "num":
        if not args:
            send_plain(chat_id, "❌  Usage: /num <number>")
            return
        handle_number(chat_id, args, msg_id, from_data["id"])
    elif cmd == "tg":
        if not args:
            send_plain(chat_id, "❌  Usage: /tg <username ya userid>")
            return
        handle_tg(chat_id, args, msg_id, from_data["id"])
    elif cmd == "adhar":
        if not args:
            send_plain(chat_id, "❌  Usage: /adhar <aadhaar_number>")
            return
        handle_adhar(chat_id, args, msg_id, from_data["id"])
    elif cmd == "upi":
        if not args:
            send_plain(chat_id, "❌  Usage: /upi <upi_id>")
            return
        handle_upi(chat_id, args, msg_id, from_data["id"])
    elif cmd == "vehicle":
        if not args:
            send_plain(chat_id, "❌  Usage: /vehicle <reg_number>")
            return
        handle_vehicle(chat_id, args, msg_id, from_data["id"])
    elif _is_adm:
        handle_admin_text(chat_id, from_data["id"], text)

# ── Polling Loop ─────────────────────────────
def run_polling():
    load_databases()
    set_my_commands([
        {"command": "start", "description": "🏠 Main Menu"},
        {"command": "num", "description": "📞 Number Lookup"},
        {"command": "tg", "description": "🔎 TG Username / UserID"},
        {"command": "adhar", "description": "🪪 Aadhaar Lookup"},
        {"command": "upi", "description": "💳 UPI ID Lookup"},
        {"command": "vehicle", "description": "🚗 Vehicle Lookup"},
        {"command": "help", "description": "❓ Help Guide"},
    ])

    delete_webhook()
    logger.info("Webhook cleared (if any).")

    logger.info("Bot started in polling mode. Waiting for updates...")
    offset = 0
    while True:
        try:
            updates = get_updates(offset=offset, timeout=30)
            if updates:
                for update in updates:
                    offset = update["update_id"] + 1
                    process_update(update)
                # if we got updates, reset any backoff
            # small sleep to avoid busy loop when no updates
            time.sleep(0.5)
        except Exception as e:
            # Timeouts and other errors are already logged by tg_request, so just wait and retry
            logger.debug(f"Polling loop error: {e}")
            # Sleep a bit before retrying to avoid flooding logs
            time.sleep(2)

def process_update(update):
    try:
        if "callback_query" in update:
            cb = update["callback_query"]
            queue_for_user(cb["from"]["id"], handle_callback, cb)
        elif "message" in update or "edited_message" in update:
            msg = update.get("message") or update.get("edited_message")
            if msg and msg.get("from") and not msg["from"].get("is_bot"):
                text = (msg.get("text") or "").strip()
                if text.startswith("/"):
                    queue_for_user(msg["from"]["id"], handle_command, msg)
                else:
                    queue_for_user(msg["from"]["id"], handle_update, update)
    except Exception as e:
        logger.error(f"process_update error: {e}")

if __name__ == "__main__":
    run_polling()
