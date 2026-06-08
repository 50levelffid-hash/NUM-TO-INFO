import aiohttp
import logging
import asyncio
import os
import json
import io
from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, BotCommand
from telegram.ext import (
    ApplicationBuilder, CommandHandler, ContextTypes,
    CallbackQueryHandler, MessageHandler, filters
)
from motor.motor_asyncio import AsyncIOMotorClient

# ══════════════════════════════════════════
#  LOGGING
# ══════════════════════════════════════════
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler()]   # Render me file log nahi, stdout use karo
)
logger = logging.getLogger("RTFBot")

# ══════════════════════════════════════════
#  CONFIG — Render environment variables
# ══════════════════════════════════════════
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
MONGO_URI = os.environ.get("MONGO_URI", "")
OWNER     = "@RTFGAMMING"

NUM_API_URL     = "https://movements-invoice-amanda-victoria.trycloudflare.com/search/number?number={number}&key=mysecretkey123"
SECOND_API_URL  = "https://surya.suryahacker.workers.dev/?query={number}"
ADHAR_API_URL   = "https://surya.suryahacker.workers.dev/?query={number}"
TG_USERNAME_API = "https://username-usrid-to-num.onrender.com/username/{username}?key=3c7c79ee5d09e54d714c6cf960017b62"
TG_USERID_API   = "https://username-usrid-to-num.onrender.com/userid={userid}?key=3c7c79ee5d09e54d714c6cf960017b62"
TG_FALLBACK_API = "https://krish-osintoy.lovable.app/api/v1/tg?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&info={query}"
UPI_API_URL     = "https://krish-osintoy.lovable.app/api/v1/upi?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&upi={upi}"
VEHICLE_API_URL = "https://krish-osintoy.lovable.app/api/v1/vehicle?key=rtf-7e9m8w62cmqyrbgyfq4tnpln&vehicle={vehicle}"

CHANNELS = [
    ("🔥 RTF GAMING",  "RTFGMINGGC"),
    ("🎁 GIVEAWAY",    "RTFGAMINGHACK0"),
    ("💀 RTF ERA",     "BYEPAASLINK"),
]

# ── In-memory state (multi-user safe — dict per user_id) ──────
user_state     = {}   # {user_id: "number"/"tg"/...}
admins         = ["@rtfgamming"]
custom_tg_data = {}

JOINED_STATUSES = {"member", "administrator", "creator"}

# ══════════════════════════════════════════
#  MONGODB
# ══════════════════════════════════════════
mongo_client = None
db           = None
users_col    = None
data_col     = None

async def init_db():
    global mongo_client, db, users_col, data_col
    if not MONGO_URI:
        logger.warning("[DB] MONGO_URI not set — DB disabled")
        return
    try:
        mongo_client = AsyncIOMotorClient(
            MONGO_URI,
            serverSelectionTimeoutMS=8000,
            connectTimeoutMS=8000,
            socketTimeoutMS=8000,
            maxPoolSize=50,          # ← concurrent users support
            minPoolSize=5,
        )
        await mongo_client.admin.command("ping")
        db        = mongo_client["rtfbot"]
        users_col = db["users"]
        data_col  = db["saved_data"]
        await users_col.create_index("user_id", unique=True)
        await data_col.create_index("key")
        logger.info("[DB] MongoDB connected ✅")
    except Exception as e:
        logger.error(f"[DB ERROR] {e}")
        mongo_client = None

async def db_save_user(user):
    if not users_col:
        return
    try:
        uid = user.id
        await users_col.update_one(
            {"user_id": uid},
            {"$set": {
                "user_id":    uid,
                "username":   user.username or "",
                "name":       (user.full_name or "").strip(),
                "first_name": (user.first_name or "").strip(),
                "last_name":  (user.last_name  or "").strip(),
                "last_seen":  datetime.utcnow().isoformat(),
            }, "$setOnInsert": {
                "first_seen": datetime.utcnow().isoformat(),
            }},
            upsert=True
        )
    except Exception as e:
        logger.error(f"[DB SAVE USER] {e}")

async def db_save_data(key: str, value: dict):
    if not data_col:
        return
    try:
        await data_col.update_one(
            {"key": key},
            {"$set": {"key": key, "value": value, "updated_at": datetime.utcnow().isoformat()}},
            upsert=True
        )
    except Exception as e:
        logger.error(f"[DB SAVE DATA] key={key} {e}")

async def db_get_all_users() -> list:
    if not users_col:
        return []
    try:
        return await users_col.find({}, {"_id": 0}).to_list(length=None)
    except Exception as e:
        logger.error(f"[DB GET USERS] {e}")
        return []

async def db_user_count() -> int:
    if not users_col:
        return 0
    try:
        return await users_col.count_documents({})
    except Exception:
        return 0

# ══════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════

async def auto_delete(msg, delay: int = 10):
    await asyncio.sleep(delay)
    try:
        await msg.delete()
    except Exception:
        pass

async def send_temp(chat, text: str, parse_mode: str = None, delay: int = 10):
    try:
        kwargs = {"parse_mode": parse_mode} if parse_mode else {}
        sent = await chat.reply_text(text, **kwargs)
        asyncio.create_task(auto_delete(sent, delay))
        return sent
    except Exception as e:
        logger.error(f"[SEND TEMP] {e}")

# ══════════════════════════════════════════
#  MENUS
# ══════════════════════════════════════════

def main_inline_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📞 Number Lookup", callback_data="menu_number"),
            InlineKeyboardButton("🔎 TG Lookup",     callback_data="menu_tg"),
        ],
        [InlineKeyboardButton("🪪 Aadhaar Lookup",  callback_data="menu_adhar")],
        [InlineKeyboardButton("💳 UPI Lookup",      callback_data="menu_upi")],
        [InlineKeyboardButton("🚗 Vehicle Lookup",  callback_data="menu_vehicle")],
        [
            InlineKeyboardButton("❓ Help",  callback_data="menu_help"),
            InlineKeyboardButton("👑 Owner", callback_data="menu_owner"),
        ],
    ])

def admin_inline_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📞 Number Lookup", callback_data="menu_number"),
            InlineKeyboardButton("🔎 TG Lookup",     callback_data="menu_tg"),
        ],
        [InlineKeyboardButton("🪪 Aadhaar Lookup",  callback_data="menu_adhar")],
        [InlineKeyboardButton("💳 UPI Lookup",      callback_data="menu_upi")],
        [InlineKeyboardButton("🚗 Vehicle Lookup",  callback_data="menu_vehicle")],
        [
            InlineKeyboardButton("❓ Help",  callback_data="menu_help"),
            InlineKeyboardButton("👑 Owner", callback_data="menu_owner"),
        ],
        [
            InlineKeyboardButton("📢 Broadcast",   callback_data="menu_broadcast"),
            InlineKeyboardButton("👥 Users Count", callback_data="menu_users"),
        ],
        [
            InlineKeyboardButton("📋 Admin List",  callback_data="menu_adminlist"),
            InlineKeyboardButton("⚙️ Admin Panel", callback_data="menu_adminpanel"),
        ],
        [InlineKeyboardButton("✏️ Set Custom TG Data", callback_data="menu_setcustomtg")],
        [InlineKeyboardButton("🗄️ Database Backup",    callback_data="menu_dbbackup")],
    ])

MAIN_MENU_TEXT = (
    "╔══════════════════════════╗\n"
    "║  ⚡️  R T F   B O T  ⚡️   ║\n"
    "╠══════════════════════════╣\n"
    "🟢  Status  : ONLINE\n"
    "👑  Owner   : @RTFGAMMING\n"
    "🔥  Version : v3.0\n"
    "╠══════════════════════════╣\n"
    "📌  Neeche se option chuno:\n"
    "╚══════════════════════════╝"
)

HELP_TEXT = (
    "╔══════════════════════════╗\n"
    "║  📖  B O T   H E L P    ║\n"
    "╠══════════════════════════╣\n"
    "📞  /num <number>\n"
    "   ➜  Number ki full details\n"
    "   📌 Example: /num 9876543210\n\n"
    "🔎  /tg <username ya userid>\n"
    "   ➜  TG Username OR numeric ID\n"
    "   📌 Example: /tg rtfgamming\n"
    "   📌 Example: /tg 8518042438\n\n"
    "🪪  /adhar <aadhaar_no>\n"
    "   ➜  Aadhaar + family + ration\n"
    "   📌 Example: /adhar 598229659586\n\n"
    "💳  /upi <upi_id>\n"
    "   ➜  UPI ID se bank details\n"
    "   📌 Example: /upi 70497398@axl\n\n"
    "🚗  /vehicle <reg_number>\n"
    "   ➜  Vehicle registration details\n"
    "   📌 Example: /vehicle MH02FZ0555\n\n"
    "🏠  /start  ➜  Main menu\n"
    "❓  /help   ➜  Ye message\n"
    "╠══════════════════════════╣\n"
    "👑  Owner : @RTFGAMMING\n"
    "╚══════════════════════════╝"
)

# ══════════════════════════════════════════
#  JOIN CHECK
# ══════════════════════════════════════════

async def get_not_joined_channels(bot, user_id: int) -> list:
    not_joined = []
    for name, username in CHANNELS:
        try:
            member = await bot.get_chat_member(f"@{username}", user_id)
            if member.status not in JOINED_STATUSES:
                not_joined.append((name, username))
        except Exception as e:
            logger.warning(f"[JOIN CHECK] @{username} uid={user_id}: {e}")
            not_joined.append((name, username))
    return not_joined

async def check_join(bot, user_id: int) -> bool:
    return len(await get_not_joined_channels(bot, user_id)) == 0

async def send_join_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id    = update.effective_user.id
    not_joined = await get_not_joined_channels(context.bot, user_id)
    if not not_joined:
        return False
    buttons = [
        [InlineKeyboardButton(f"➕ {name}", url=f"https://t.me/{username}")]
        for name, username in not_joined
    ]
    buttons.append([InlineKeyboardButton("✅ VERIFY JOIN", callback_data="verify")])
    markup = InlineKeyboardMarkup(buttons)
    text = (
        "╔════════════════════════╗\n"
        "║  🔒  ACCESS LOCKED  🔒  ║\n"
        "╠════════════════════════╣\n"
        "📢  Sabhi channels JOIN karo\n"
        "⚡  Phir ✅ VERIFY dabao\n"
        "╚════════════════════════╝"
    )
    if update.callback_query:
        await update.callback_query.answer("❌ Pehle sab channels join karo!", show_alert=True)
        try:
            await update.callback_query.edit_message_text(text, reply_markup=markup)
        except Exception:
            await update.callback_query.message.reply_text(text, reply_markup=markup)
    else:
        await update.message.reply_text(text, reply_markup=markup)
    return True

def is_admin_user(username: str) -> bool:
    return f"@{username}".lower() in [a.lower() for a in admins]

def require_join(func):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        username = update.effective_user.username or ""
        if is_admin_user(username):
            return await func(update, context)
        if not await check_join(context.bot, update.effective_user.id):
            await send_join_prompt(update, context)
            return
        return await func(update, context)
    wrapper.__name__ = func.__name__
    return wrapper

# ══════════════════════════════════════════
#  /start  /help
# ══════════════════════════════════════════

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user     = update.effective_user
    username = user.username or ""
    asyncio.create_task(db_save_user(user))   # non-blocking
    logger.info(f"[/start] uid={user.id} @{username}")
    if not is_admin_user(username) and not await check_join(context.bot, user.id):
        await send_join_prompt(update, context)
        return
    kb = admin_inline_menu() if is_admin_user(username) else main_inline_menu()
    await update.message.reply_text(MAIN_MENU_TEXT, reply_markup=kb)

@require_join
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    asyncio.create_task(db_save_user(update.effective_user))
    await update.message.reply_text(HELP_TEXT)

# ══════════════════════════════════════════
#  VERIFY
# ══════════════════════════════════════════

async def verify(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query      = update.callback_query
    await query.answer()
    user_id    = query.from_user.id
    not_joined = await get_not_joined_channels(context.bot, user_id)
    if not not_joined:
        username = query.from_user.username or ""
        kb = admin_inline_menu() if is_admin_user(username) else main_inline_menu()
        await query.edit_message_text(MAIN_MENU_TEXT, reply_markup=kb)
    else:
        remaining = ", ".join(name for name, _ in not_joined)
        await query.answer(f"❌ Abhi bhi join karo: {remaining}", show_alert=True)
        join_btns = [
            [InlineKeyboardButton(f"➕ {name}", url=f"https://t.me/{u}")]
            for name, u in not_joined
        ]
        join_btns.append([InlineKeyboardButton("✅ VERIFY JOIN", callback_data="verify")])
        try:
            await query.edit_message_reply_markup(reply_markup=InlineKeyboardMarkup(join_btns))
        except Exception:
            pass

# ══════════════════════════════════════════
#  DB BACKUP
# ══════════════════════════════════════════

async def send_db_backup(target_msg, bot, admin_uid: int):
    if not users_col:
        await target_msg.reply_text("❌  MongoDB connected nahi hai.")
        return
    status = await target_msg.reply_text("🗄️  Database se data fetch ho raha hai...")
    try:
        all_users_db = await db_get_all_users()
        total        = len(all_users_db)
        if not all_users_db:
            await status.edit_text("📭  Database empty hai.")
            return
        lines = [
            "╔══════════════════════════════╗",
            "║  🗄️  DATABASE BACKUP REPORT   ║",
            "╠══════════════════════════════╣",
            f"📊  Total Users : {total}",
            f"🕐  Generated   : {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
            "╠══════════════════════════════╣",
        ]
        for i, u in enumerate(all_users_db, start=1):
            uid       = u.get("user_id",   "N/A")
            uname     = u.get("username",  "")
            name      = u.get("name",      "")
            fseen     = u.get("first_seen","")[:10] if u.get("first_seen") else "N/A"
            lseen     = u.get("last_seen", "")[:10] if u.get("last_seen")  else "N/A"
            uname_str = f"@{uname}" if uname else "no username"
            name_str  = name if name else "no name"
            lines.append(f"{i}. {name_str} | {uname_str} | ID: {uid}")
            lines.append(f"   📅 First: {fseen}  |  Last: {lseen}")
        lines.append("╚══════════════════════════════╝")
        full_text = "\n".join(lines)
        if len(full_text) > 4000:
            file_content = full_text.encode("utf-8")
            file_obj     = io.BytesIO(file_content)
            file_obj.name = f"rtfbot_backup_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.txt"
            await bot.send_document(
                chat_id=admin_uid,
                document=file_obj,
                caption=f"🗄️ RTF Bot DB Backup — {total} users\n📅 {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
            )
            await status.delete()
        else:
            await status.edit_text(full_text)
    except Exception as e:
        logger.error(f"[DB BACKUP] {e}", exc_info=True)
        await status.edit_text(f"❌  Backup failed: {e}")

# ══════════════════════════════════════════
#  MENU CALLBACK
# ══════════════════════════════════════════

async def menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query    = update.callback_query
    await query.answer()
    user_id  = query.from_user.id
    username = query.from_user.username or ""
    _is_admin = is_admin_user(username)
    action    = query.data

    logger.info(f"[MENU] uid={user_id} action={action}")

    if not _is_admin and not await check_join(context.bot, user_id):
        await send_join_prompt(update, context)
        return

    if action == "menu_help":
        await query.message.reply_text(HELP_TEXT)
        return

    if action == "menu_owner":
        await query.message.reply_text(
            "╔══════════════════╗\n║  👑  OWNER INFO   ║\n╚══════════════════╝\n"
            "🔗 Telegram: @RTFGAMMING\nhttps://t.me/RTFGAMMING"
        )
        return

    if action == "menu_users" and _is_admin:
        count = await db_user_count()
        await query.message.reply_text(
            f"╔══════════════════╗\n║  👥 USER COUNT   ║\n╚══════════════════╝\n"
            f"📊  Total: `{count}`\n🗄️  Source: MongoDB",
            parse_mode="Markdown"
        )
        return

    if action == "menu_dbbackup" and _is_admin:
        await send_db_backup(query.message, context.bot, user_id)
        return

    if action == "menu_adminlist" and _is_admin:
        await query.message.reply_text(
            "╔══════════════════╗\n║  📋 ADMIN LIST   ║\n╚══════════════════╝\n"
            + "\n".join(f"• {a}" for a in admins)
        )
        return

    if action == "menu_adminpanel" and _is_admin:
        await query.message.reply_text(
            "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n"
            "📢  /broadcast <msg>\n"
            "👥  /users\n"
            "➕  /addadmin @user\n"
            "➖  /removeadmin @user\n"
            "📋  /listadmins\n"
            "✏️  /setcustomtg @user <data>\n"
            "🗑️  /delcustomtg @user\n"
            "📋  /listcustomtg\n"
            "🗄️  /dbbackup\n"
            "╚══════════════════════════╝"
        )
        return

    if action == "menu_broadcast" and _is_admin:
        user_state[user_id] = "broadcast"
        await query.message.reply_text("📢  Broadcast message type karo:")
        return

    if action == "menu_setcustomtg" and _is_admin:
        user_state[user_id] = "setcustomtg_step1"
        await query.message.reply_text(
            "╔══════════════════════════╗\n"
            "║  ✏️  SET CUSTOM TG DATA   ║\n"
            "╠══════════════════════════╣\n"
            "📥  Username bhejo jiska data set karna hai\n"
            "📌  Example: rtfgamming\n"
            "╚══════════════════════════╝"
        )
        return

    if action in ("menu_number", "menu_tg", "menu_adhar", "menu_upi", "menu_vehicle"):
        state_map = {
            "menu_number":  "number",
            "menu_tg":      "tg",
            "menu_adhar":   "adhar",
            "menu_upi":     "upi",
            "menu_vehicle": "vehicle",
        }
        prompts = {
            "number":  "╔════════════════════╗\n║  📞 NUMBER LOOKUP  ║\n╚════════════════════╝\n📥  Number bhejo:\n📌 Format: 9876543210",
            "tg":      "╔═══════════════════════╗\n║   🔎  TG LOOKUP       ║\n╠═══════════════════════╣\n📥  Username YA numeric ID\n✅  rtfgamming\n✅  @rtfgamming\n✅  8518042438\n╚═══════════════════════╝",
            "adhar":   "╔══════════════════════╗\n║  🪪  AADHAAR LOOKUP  ║\n╚══════════════════════╝\n📥  Aadhaar number bhejo:\n📌 Example: 598229659586",
            "upi":     "╔══════════════════════╗\n║  💳  UPI LOOKUP      ║\n╚══════════════════════╝\n📥  UPI ID bhejo:\n📌 Example: 70497398@axl",
            "vehicle": "╔══════════════════════╗\n║  🚗  VEHICLE LOOKUP  ║\n╚══════════════════════╝\n📥  Vehicle number bhejo:\n📌 Example: MH02FZ0555",
        }
        chosen = state_map[action]
        user_state[user_id] = chosen
        await query.message.reply_text(prompts[chosen])
        return

# ══════════════════════════════════════════
#  FORMAT HELPERS
# ══════════════════════════════════════════

def cb(label: str, value) -> str:
    v = str(value).strip() if value else ""
    if v and v not in ("N/A", "", "None", "null", "nan"):
        return f"{label}: `{v}`"
    return f"{label}: ❌ N/A"

def extract_records(data):
    records = []
    try:
        results = data.get("result", []) if isinstance(data, dict) else data
        for r in results:
            records.append({
                "name":    (r.get("name")    or "N/A").strip(),
                "fname":   (r.get("fname")   or "N/A").strip(),
                "address": (r.get("address") or "N/A").strip(),
                "circle":  (r.get("circle")  or "N/A").strip(),
                "alt":     str(r.get("alt")   or "N/A"),
                "aadhar":  str(r.get("aadhar") or "N/A"),
                "email":   (r.get("email")   or "N/A"),
            })
    except Exception as e:
        logger.error(f"[extract_records] {e}")
    return records

def format_num_result(records, number):
    colors = ["🔴", "🟠", "🟡", "🟢", "🔵"]
    header = (
        f"┌─────────────────────────┐\n"
        f"│  📞  N U M B E R  I N F O  │\n"
        f"├─────────────────────────┤\n"
        f"📱  Number  : `{number}`\n"
        f"📊  Records : {min(len(records), 5)} found\n\n"
    )
    body = ""
    for i, r in enumerate(records[:5], start=1):
        dot = colors[(i - 1) % len(colors)]
        body += (
            f"{dot}━━━ RECORD {i} ━━━{dot}\n"
            f"{cb('👤 Name   ', r['name'])}\n"
            f"{cb('👨 Father ', r['fname'])}\n"
            f"{cb('📍 Address', r['address'])}\n"
            f"{cb('📡 Circle ', r['circle'])}\n"
            f"{cb('☎️  Alt Num', r['alt'])}\n"
            f"{cb('🪪 Aadhar ', r['aadhar'])}\n"
            f"{cb('✉️  Email  ', r['email'])}\n\n"
        )
    footer = f"└─────────────────────────┘\n👑  {OWNER}  |  ⚡ ACTIVE"
    return header + body + footer

def format_deep_data(data):
    if not data:
        return None
    colors = ["🔴", "🟠", "🟡", "🟢", "🔵", "🟣"]
    text = (
        "┌─────────────────────────┐\n"
        "│  🔬  D E E P   D A T A  │\n"
        "├─────────────────────────┤\n"
    )
    has_data = False
    for i, r in enumerate(data, start=1):
        if not isinstance(r, dict):
            continue
        has_data = True
        dot = colors[(i - 1) % len(colors)]
        text += (
            f"{dot}━━━ RECORD {i} ━━━{dot}\n"
            f"{cb('👤 Name   ', r.get('FullName'))}\n"
            f"{cb('👨 Father ', r.get('FatherName'))}\n"
            f"{cb('📞 Phone1 ', r.get('Phone'))}\n"
            f"{cb('📞 Phone2 ', r.get('Phone2'))}\n"
            f"{cb('📞 Phone3 ', r.get('Phone3'))}\n"
            f"{cb('📞 Phone4 ', r.get('Phone4'))}\n"
            f"{cb('📞 Phone5 ', r.get('Phone5'))}\n"
            f"{cb('📍 Address', r.get('Adres'))}\n"
            f"{cb('📡 Region ', r.get('Region'))}\n\n"
        )
    if not has_data:
        return None
    text += "└─────────────────────────┘"
    return text

def format_adhar_result(data: dict, adhar_number: str):
    try:
        result  = data.get("result", {})
        results = result.get("results", [])
        if not results:
            return None
        entry   = results[0]
        rc      = entry.get("ration_card_details", {})
        addl    = entry.get("additional_info", {})
        members = entry.get("members", [])
        central = "✅ YES" if addl.get("exists_in_central_repository") else "❌ NO"
        header  = (
            f"┌─────────────────────────┐\n"
            f"│  🪪  A A D H A A R       │\n"
            f"├─────────────────────────┤\n"
            f"🔢  Aadhaar : `{adhar_number}`\n\n"
            f"📋━━━ RATION CARD ━━━📋\n"
            f"{cb('🪪  Card No  ', rc.get('ration_card_no'))}\n"
            f"{cb('📌  Scheme   ', rc.get('scheme_name'))}\n"
            f"{cb('📍  District ', rc.get('district_name'))}\n"
            f"{cb('🗺️  State    ', rc.get('state_name'))}\n"
            f"{cb('🏪  FPS Type ', addl.get('fps_category'))}\n"
            f"🏛️  Central  : {central}\n\n"
            f"👨‍👩‍👧‍👦━━━ FAMILY ({len(members)}) ━━━👨‍👩‍👧‍👦\n"
        )
        colors = ["🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚪"]
        body   = ""
        for i, m in enumerate(members, start=1):
            dot = colors[(i - 1) % len(colors)]
            body += f"{dot}  [{m.get('s_no', i)}]  `{m.get('member_name', 'N/A')}`\n"
        footer = f"\n└─────────────────────────┘\n👑  {OWNER}  |  ⚡ ACTIVE"
        return header + body + footer
    except Exception as e:
        logger.error(f"[format_adhar] {e}")
        return None

def format_upi_result(data: dict, upi_id: str) -> str:
    def val(v):
        if v is None or str(v).strip() in ("", "None", "null", "nan", "false", "False"):
            return None
        return str(v).strip()

    name         = val(data.get("name"))
    username     = val(data.get("username"))
    valid        = data.get("valid")
    acc_type     = val(data.get("account_type"))
    is_merchant  = data.get("merchant")
    merchant_ver = data.get("merchant_verified")
    bank         = val(data.get("bank"))
    bank_type    = val(data.get("bank_type"))
    ifsc         = val(data.get("ifsc"))
    ifsc_d       = data.get("ifsc_details") or {}
    branch       = val(ifsc_d.get("BRANCH"))
    address      = val(ifsc_d.get("ADDRESS"))
    city         = val(ifsc_d.get("CITY"))
    district     = val(ifsc_d.get("DISTRICT"))
    state        = val(ifsc_d.get("STATE"))
    contact      = val(ifsc_d.get("CONTACT"))
    rtgs         = ifsc_d.get("RTGS")
    neft         = ifsc_d.get("NEFT")
    imps         = ifsc_d.get("IMPS")
    upi_sup      = ifsc_d.get("UPI")

    def tick(v): return "✅" if v else "❌"

    lines = [
        "┌─────────────────────────┐",
        "│  💳  U P I   L O O K U P  │",
        "├─────────────────────────┤",
        cb("💳 UPI ID      ", upi_id),
    ]
    if name:     lines.append(cb("👤 Name        ", name))
    if username: lines.append(cb("🔖 Username    ", username))
    lines.append(f"✅ Valid        : {'✅ YES' if valid else '❌ NO'}")
    if acc_type: lines.append(cb("🏦 Account Type", acc_type))
    if bank:     lines.append(cb("🏛️  Bank        ", bank))
    if bank_type:lines.append(cb("📂 Bank Type   ", bank_type))
    if ifsc:     lines.append(cb("🔢 IFSC        ", ifsc))
    if is_merchant  is not None: lines.append(f"🏪 Merchant    : {tick(is_merchant)}")
    if merchant_ver is not None: lines.append(f"✔️  Merch.Verif : {tick(merchant_ver)}")
    if any([branch, address, city, district, state, contact]):
        lines += ["├─────────────────────────┤", "│  🏦  IFSC DETAILS        │", "├─────────────────────────┤"]
        if branch:   lines.append(cb("🏢 Branch      ", branch))
        if address:  lines.append(cb("📍 Address     ", address))
        if city:     lines.append(cb("🏙️  City        ", city))
        if district: lines.append(cb("📍 District    ", district))
        if state:    lines.append(cb("🗺️  State       ", state))
        if contact:  lines.append(cb("📞 Contact     ", contact))
    if any(x is not None for x in [rtgs, neft, imps, upi_sup]):
        lines += ["├─────────────────────────┤", "│  💸  PAYMENT MODES       │", "├─────────────────────────┤"]
        if rtgs    is not None: lines.append(f"⚡ RTGS        : {tick(rtgs)}")
        if neft    is not None: lines.append(f"🔄 NEFT        : {tick(neft)}")
        if imps    is not None: lines.append(f"📲 IMPS        : {tick(imps)}")
        if upi_sup is not None: lines.append(f"💳 UPI         : {tick(upi_sup)}")
    lines += ["└─────────────────────────┘", f"👑  {OWNER}  |  ⚡ ACTIVE"]
    return "\n".join(lines)

def format_vehicle_result(data: dict) -> str:
    vd = data.get("vehicle_data", {})
    if not isinstance(vd, dict):
        vd = {}

    def v(val):
        s = str(val).strip() if val is not None else ""
        return s if s and s not in ("None", "null", "", "nan", "0", "false", "False") else None

    mob          = v(data.get("mobile_number"))
    eng          = v(data.get("engine_number"))
    chassis      = v(data.get("chassis_number"))
    reg_no       = v(data.get("vehicle_number") or data.get("vehicle"))
    father       = v(vd.get("ownerFatherName"))
    reg_auth     = v(vd.get("regAuthority"))
    reg_date     = v(vd.get("regDate"))
    mfr          = v(vd.get("manufacturer"))
    model        = v(vd.get("vehicle"))
    variant      = v(vd.get("variant"))
    fuel         = v(vd.get("fuelType"))
    veh_class    = v(vd.get("vehicleClass"))
    veh_type     = v(vd.get("vehicleType"))
    cc           = v(vd.get("cubicCapacity"))
    seats        = v(vd.get("seatCapacity"))
    mfr_year     = v(vd.get("manufacturerYear"))
    present_addr = v(vd.get("presentAddress")) or v(vd.get("permAddress"))
    financer     = v(vd.get("financerName"))
    ins_company  = v(vd.get("insuranceCompanyName"))
    ins_upto     = v(vd.get("insuranceUpto"))
    ins_expired  = vd.get("insuranceExpired")
    pucc_valid   = v(vd.get("puccValidUpto"))
    pincode      = v(vd.get("pincode"))
    rto_name     = v(vd.get("rtoData", {}).get("rtoName") if isinstance(vd.get("rtoData"), dict) else None)
    rto_code     = v(vd.get("rtoCode"))
    is_comm      = vd.get("isCommercial")

    lines = ["┌────────────────────────────┐", "│  🚗  V E H I C L E  I N F O  │", "└────────────────────────────┘"]
    lines.append("🔷━━━ REGISTRATION ━━━🔷")
    if reg_no:   lines.append(f"🚘  Reg No      : `{reg_no}`")
    if reg_auth: lines.append(f"🏛️   Reg Auth    : `{reg_auth}`")
    if reg_date: lines.append(f"📅  Reg Date    : `{reg_date}`")
    if rto_code: lines.append(f"🗂️   RTO Code    : `{rto_code}`")
    if rto_name: lines.append(f"🏢  RTO Name    : `{rto_name}`")
    if any([father, mob, present_addr, pincode]):
        lines.append("\n🔶━━━ OWNER DETAILS ━━━🔶")
        if father:       lines.append(f"👨  Father       : `{father}`")
        if mob:          lines.append(f"📞  Mobile       : `{mob}`")
        if present_addr: lines.append(f"📍  Address      : `{present_addr}`")
        if pincode:      lines.append(f"📮  Pincode      : `{pincode}`")
    if any([mfr, model, variant, fuel, veh_class, cc, seats, mfr_year]):
        lines.append("\n🟢━━━ VEHICLE SPECS ━━━🟢")
        if mfr:       lines.append(f"🏭  Manufacturer : `{mfr}`")
        if model:     lines.append(f"🚗  Model        : `{model}`")
        if variant:   lines.append(f"⚙️   Variant      : `{variant}`")
        if fuel:      lines.append(f"⛽  Fuel Type    : `{fuel}`")
        if veh_class: lines.append(f"📋  Class        : `{veh_class}`")
        if veh_type:  lines.append(f"🔖  Type         : `{veh_type}`")
        if mfr_year:  lines.append(f"📆  Mfr Year     : `{mfr_year}`")
        if cc:        lines.append(f"🔩  Cubic Cap    : `{cc} cc`")
        if seats:     lines.append(f"💺  Seats        : `{seats}`")
        if is_comm is not None: lines.append(f"🏪  Commercial   : {'✅ YES' if is_comm else '❌ NO'}")
    if any([eng, chassis]):
        lines.append("\n🔵━━━ TECHNICAL ━━━🔵")
        if eng:     lines.append(f"🔧  Engine No    : `{eng}`")
        if chassis: lines.append(f"🔩  Chassis No   : `{chassis}`")
    if any([financer, ins_company, ins_upto, pucc_valid]):
        lines.append("\n🟣━━━ FINANCE & INSURANCE ━━━🟣")
        if financer:    lines.append(f"💰  Financer     : `{financer}`")
        if ins_company: lines.append(f"🛡️   Insurance    : `{ins_company}`")
        if ins_upto:
            expired_tag = " ❌ EXPIRED" if ins_expired else " ✅ VALID"
            lines.append(f"📅  Ins Upto     : `{ins_upto}`{expired_tag}")
        if pucc_valid: lines.append(f"🌿  PUCC Valid   : `{pucc_valid}`")
    lines += ["\n┌────────────────────────────┐", f"│  👑 {OWNER}  |  ⚡ ACTIVE  │", "└────────────────────────────┘"]
    return "\n".join(lines)

# ══════════════════════════════════════════
#  API FETCHERS (concurrent-safe)
# ══════════════════════════════════════════

async def fetch_deep_api(number: str) -> list:
    raw = number.replace("+", "").replace(" ", "").strip()
    if not raw.startswith("91"):
        raw = "91" + raw
    url = SECOND_API_URL.format(number=raw)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as res:
                data    = await res.json(content_type=None)
                records = []
                if isinstance(data, dict):
                    if "data" in data and isinstance(data["data"], dict):
                        for _, val in data["data"].items():
                            if isinstance(val, dict) and "records" in val:
                                recs = val["records"]
                                if isinstance(recs, list):
                                    records.extend([r for r in recs if isinstance(r, dict)])
                    elif "records" in data:
                        recs = data["records"]
                        if isinstance(recs, list):
                            records.extend([r for r in recs if isinstance(r, dict)])
                elif isinstance(data, list):
                    records.extend([r for r in data if isinstance(r, dict)])
                return records
    except Exception as e:
        logger.error(f"[DEEP API] {e}")
        return []

async def fetch_num_api(clean_phone: str) -> list:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                NUM_API_URL.format(number=clean_phone),
                timeout=aiohttp.ClientTimeout(total=15)
            ) as res:
                data = await res.json(content_type=None)
                return extract_records(data)
    except Exception as e:
        logger.error(f"[NUM API] {e}")
        return []

def parse_tg_primary(data: dict, input_term: str):
    tg_id           = str(data.get("target_id", "N/A"))
    target_username = data.get("target_username", input_term)
    phone = country_code = None
    for _, source_val in (data.get("data") or {}).items():
        if not isinstance(source_val, dict):
            continue
        for rec in source_val.get("records", []):
            if not isinstance(rec, dict):
                continue
            rec_phone = rec.get("phone")
            if rec_phone and str(rec_phone).strip() not in ("", "None", "null"):
                phone        = str(rec_phone)
                country_code = str(rec.get("country_code", "N/A"))
                rec_tgid     = rec.get("tg_id")
                if rec_tgid:
                    tg_id = str(rec_tgid)
                break
        if phone:
            break
    return tg_id, target_username, phone, country_code

async def fetch_tg_fallback(query_str: str):
    q = query_str if query_str.startswith("@") or query_str.isdigit() else f"@{query_str}"
    url = TG_FALLBACK_API.format(query=q)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as res:
                raw  = await res.text()
        data = json.loads(raw)
        if not data.get("success"):
            return None, None, None, None
        phone = str(data.get("number", ""))
        if not phone or phone.strip() in ("", "None", "null"):
            phone = None
        return str(data.get("tg_id", "N/A")), phone, str(data.get("country", "N/A")), str(data.get("country_code", "N/A"))
    except Exception as e:
        logger.error(f"[TG FALLBACK] {e}")
        return None, None, None, None

# ══════════════════════════════════════════
#  LOOKUP HANDLERS
# ══════════════════════════════════════════

async def handle_number(update: Update, number: str):
    msg        = update.message or update.callback_query.message
    status_msg = await msg.reply_text(f"🔍  Searching: `{number}` ...", parse_mode="Markdown")
    try:
        clean = number.strip().replace(" ", "").replace("+91", "")
        if clean.startswith("91") and len(clean) > 10:
            clean = clean[2:]
        num_task, deep_task = await asyncio.gather(
            fetch_num_api(clean), fetch_deep_api(number), return_exceptions=True
        )
        records   = num_task  if isinstance(num_task,  list) else []
        deep_data = deep_task if isinstance(deep_task, list) else []
        if not records:
            await status_msg.delete()
            await send_temp(
                msg,
                f"╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n"
                f"📱  Number: `{clean}`\n⚠️  Koi record nahi mila",
                parse_mode="Markdown"
            )
            return
        full_msg = format_num_result(records, clean)
        deep_fmt = format_deep_data(deep_data)
        if deep_fmt:
            full_msg += "\n\n" + deep_fmt
        await msg.reply_text(full_msg, parse_mode="Markdown")
        await status_msg.delete()
    except Exception as e:
        logger.error(f"[NUM LOOKUP] {e}", exc_info=True)
        await msg.reply_text("❌  API Error / Timeout.")
        try: await status_msg.delete()
        except Exception: pass

async def handle_tg(update: Update, term: str):
    msg     = update.message or update.callback_query.message
    term    = term.strip().lstrip("@")
    if not term:
        await send_temp(msg, "❌  Kuch toh bhejo!\n✅ /tg rtfgamming\n✅ /tg 8518042438")
        return

    term_key = term.lower()
    if term_key in custom_tg_data:
        await msg.reply_text(custom_tg_data[term_key], parse_mode="Markdown")
        return

    is_userid  = term.isdigit()
    status_msg = await msg.reply_text(
        f"🔍  Searching TG {'UserID' if is_userid else 'Username'}: "
        f"{'#' if is_userid else '@'}{term} ..."
    )
    url = TG_USERID_API.format(userid=term) if is_userid else TG_USERNAME_API.format(username=term)

    tg_id = "N/A"; target_uname = term; phone = None; country_code = None; used_fallback = False

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as res:
                raw_text = await res.text()
        try:
            data = json.loads(raw_text)
        except Exception:
            data = {}

        if data.get("status") and data.get("target_id"):
            tg_id, target_uname, phone, country_code = parse_tg_primary(data, term)

        if not phone:
            fb_tg_id, fb_phone, _, fb_cc = await fetch_tg_fallback(term)
            if fb_phone:
                used_fallback = True
                phone         = fb_phone
                country_code  = fb_cc or country_code
                if fb_tg_id and fb_tg_id != "N/A":
                    tg_id = fb_tg_id

        if not phone and tg_id == "N/A":
            await status_msg.delete()
            await send_temp(
                msg,
                f"╔══════════════════════╗\n║  ❌ DATA NOT FOUND    ║\n╠══════════════════════╣\n"
                f"🔎  Input : {term}\n⚠️  Dono APIs se data nahi mila\n╚══════════════════════╝"
            )
            return

        src_label = "🔁 Fallback" if used_fallback else "✅ Primary"
        tg_block  = (
            f"┌─────────────────────────┐\n"
            f"│  🔎  T G   L O O K U P  │\n"
            f"├─────────────────────────┤\n"
            f"{cb('💻 Username    ', f'@{target_uname}' if not target_uname.isdigit() else target_uname)}\n"
            f"{cb('🆔 Telegram ID ', tg_id)}\n"
            f"{cb('📞 Phone       ', phone or 'N/A')}\n"
            f"{cb('🌍 Country Code', country_code or 'N/A')}\n"
            f"🔌  Source       : {src_label}\n"
            f"└─────────────────────────┘\n"
        )
        num_block = deep_block = ""
        if phone:
            clean_phone = phone.replace("+", "").replace(" ", "").strip()
            if clean_phone.startswith("91") and len(clean_phone) > 10:
                clean_phone = clean_phone[2:]
            num_res, deep_res = await asyncio.gather(
                fetch_num_api(clean_phone), fetch_deep_api(phone), return_exceptions=True
            )
            if isinstance(num_res,  list) and num_res:  num_block  = "\n" + format_num_result(num_res, clean_phone)
            if isinstance(deep_res, list) and deep_res:
                df = format_deep_data(deep_res)
                if df: deep_block = "\n\n" + df

        await msg.reply_text(tg_block + num_block + deep_block, parse_mode="Markdown")

    except aiohttp.ClientConnectorError:
        await msg.reply_text("❌  API se connect nahi ho paya.")
    except asyncio.TimeoutError:
        await msg.reply_text("❌  API timeout.")
    except Exception as e:
        logger.error(f"[TG LOOKUP] {e}", exc_info=True)
        await msg.reply_text("❌  Kuch gadbad ho gayi.")
    finally:
        try: await status_msg.delete()
        except Exception: pass

async def handle_adhar(update: Update, adhar_raw: str):
    msg        = update.message or update.callback_query.message
    status_msg = await msg.reply_text(f"🔍  Searching Aadhaar: `{adhar_raw}` ...", parse_mode="Markdown")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                ADHAR_API_URL.format(number=adhar_raw),
                timeout=aiohttp.ClientTimeout(total=15)
            ) as res:
                data = await res.json(content_type=None)
        if not data.get("success"):
            await status_msg.delete()
            await send_temp(msg, f"╔══════════════════╗\n║  ❌ DATA NOT FOUND  ║\n╚══════════════════╝\n🪪  Aadhaar: `{adhar_raw}`", parse_mode="Markdown")
            return
        formatted = format_adhar_result(data, adhar_raw)
        if not formatted:
            await status_msg.delete()
            await send_temp(msg, f"❌  Data format error — Aadhaar: `{adhar_raw}`", parse_mode="Markdown")
            return
        await msg.reply_text(formatted, parse_mode="Markdown")
        await status_msg.delete()
    except Exception as e:
        logger.error(f"[ADHAR] {e}", exc_info=True)
        await msg.reply_text("❌  API Error / Timeout.")
        try: await status_msg.delete()
        except Exception: pass

async def handle_upi(update: Update, upi_id: str):
    msg        = update.message or update.callback_query.message
    status_msg = await msg.reply_text(f"🔍  Searching UPI: `{upi_id}` ...", parse_mode="Markdown")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                UPI_API_URL.format(upi=upi_id.strip()),
                timeout=aiohttp.ClientTimeout(total=15)
            ) as res:
                data = await res.json(content_type=None)
        if not data.get("success"):
            await status_msg.delete()
            await send_temp(msg, f"╔══════════════════╗\n║  ❌ UPI NOT FOUND   ║\n╚══════════════════╝\n💳  UPI: `{upi_id}`", parse_mode="Markdown")
            return
        await msg.reply_text(format_upi_result(data, upi_id), parse_mode="Markdown")
        await status_msg.delete()
    except Exception as e:
        logger.error(f"[UPI] {e}", exc_info=True)
        await msg.reply_text("❌  API Error / Timeout.")
        try: await status_msg.delete()
        except Exception: pass

async def handle_vehicle(update: Update, vehicle_no: str):
    msg        = update.message or update.callback_query.message
    vehicle_no = vehicle_no.strip().upper().replace(" ", "")
    status_msg = await msg.reply_text(f"🔍  Searching Vehicle: `{vehicle_no}` ...", parse_mode="Markdown")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                VEHICLE_API_URL.format(vehicle=vehicle_no),
                timeout=aiohttp.ClientTimeout(total=20)
            ) as res:
                data = await res.json(content_type=None)
        if not data.get("success"):
            await status_msg.delete()
            await send_temp(msg, f"╔══════════════════════╗\n║  ❌ VEHICLE NOT FOUND  ║\n╚══════════════════════╝\n🚗  Vehicle: `{vehicle_no}`", parse_mode="Markdown")
            return
        await msg.reply_text(format_vehicle_result(data), parse_mode="Markdown")
        await status_msg.delete()
    except Exception as e:
        logger.error(f"[VEHICLE] {e}", exc_info=True)
        await msg.reply_text("❌  API Error / Timeout.")
        try: await status_msg.delete()
        except Exception: pass

# ══════════════════════════════════════════
#  SLASH COMMANDS
# ══════════════════════════════════════════

@require_join
async def num_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    asyncio.create_task(db_save_user(update.effective_user))
    if not context.args:
        await update.message.reply_text("❌  Usage: /num <number>\n📌  Example: /num 9876543210"); return
    await handle_number(update, context.args[0])

@require_join
async def tg_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    asyncio.create_task(db_save_user(update.effective_user))
    if not context.args:
        await update.message.reply_text("❌  Usage: /tg <username ya userid>\n📌 /tg rtfgamming\n📌 /tg 8518042438"); return
    await handle_tg(update, context.args[0])

@require_join
async def adhar_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    asyncio.create_task(db_save_user(update.effective_user))
    if not context.args:
        await update.message.reply_text("❌  Usage: /adhar <aadhaar_number>\n📌 Example: /adhar 598229659586"); return
    await handle_adhar(update, context.args[0].strip())

@require_join
async def upi_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    asyncio.create_task(db_save_user(update.effective_user))
    if not context.args:
        await update.message.reply_text("❌  Usage: /upi <upi_id>\n📌 Example: /upi 70497398@axl"); return
    await handle_upi(update, context.args[0])

@require_join
async def vehicle_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    asyncio.create_task(db_save_user(update.effective_user))
    if not context.args:
        await update.message.reply_text("❌  Usage: /vehicle <reg_number>\n📌 Example: /vehicle MH02FZ0555"); return
    await handle_vehicle(update, context.args[0])

# ══════════════════════════════════════════
#  MESSAGE ROUTER  (concurrent-safe)
# ══════════════════════════════════════════

async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return
    user_id   = update.effective_user.id
    username  = update.effective_user.username or ""
    text      = update.message.text.strip()
    _is_admin = is_admin_user(username)
    asyncio.create_task(db_save_user(update.effective_user))

    # Admin text commands
    if _is_admin and text.lower().startswith((
        "/broadcast", "/addadmin", "/removeadmin", "/users",
        "/listadmins", "/admin", "/setcustomtg", "/delcustomtg",
        "/listcustomtg", "/dbbackup"
    )):
        await _handle_admin_text(update, context, text)
        return

    # Per-user state — safe for concurrent users
    choice = user_state.get(user_id)
    if not choice:
        return

    if not _is_admin and not await check_join(context.bot, user_id):
        await send_join_prompt(update, context)
        return

    if choice == "broadcast" and _is_admin:
        users_list = await db_get_all_users()
        uids       = [u["user_id"] for u in users_list] if users_list else []
        status     = await update.message.reply_text(f"📤  Broadcasting to {len(uids)} users...")
        success = failed = 0
        for uid in uids:
            try:
                await context.bot.send_message(chat_id=uid, text=text)
                success += 1
                await asyncio.sleep(0.05)
            except Exception as e:
                logger.warning(f"[BROADCAST FAIL] uid={uid} {e}")
                failed += 1
        await status.edit_text(
            f"╔══════════════════╗\n║  📢 BROADCAST DONE  ║\n╚══════════════════╝\n"
            f"✅  Delivered : {success}\n❌  Failed    : {failed}\n👥  Total     : {len(uids)}"
        )
    elif choice == "number":  await handle_number(update, text)
    elif choice == "tg":      await handle_tg(update, text)
    elif choice == "adhar":   await handle_adhar(update, text)
    elif choice == "upi":     await handle_upi(update, text)
    elif choice == "vehicle": await handle_vehicle(update, text)
    elif choice == "setcustomtg_step1" and _is_admin:
        user_state[user_id] = f"setcustomtg_step2::{text.strip().lstrip('@').lower()}"
        await update.message.reply_text(
            f"✅  Username: `{text.strip()}`\n\n📥  Ab custom data bhejo:",
            parse_mode="Markdown"
        )
        return
    elif choice and choice.startswith("setcustomtg_step2::") and _is_admin:
        target_key = choice.split("::", 1)[1]
        custom_tg_data[target_key] = text.strip()
        await db_save_data(f"customtg:{target_key}", {"username": target_key, "data": text.strip()})
        await update.message.reply_text(f"✅  Custom data set!\n👤 Key: `{target_key}`", parse_mode="Markdown")

    user_state[user_id] = None

async def _handle_admin_text(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str):
    if text.lower() == "/admin":
        await update.message.reply_text(
            "╔══════════════════════════╗\n║  ⚙️  ADMIN PANEL          ║\n╠══════════════════════════╣\n"
            "📢  /broadcast <msg>\n👥  /users\n➕  /addadmin @user\n➖  /removeadmin @user\n"
            "📋  /listadmins\n✏️  /setcustomtg @user <data>\n🗑️  /delcustomtg @user\n"
            "📋  /listcustomtg\n🗄️  /dbbackup\n╚══════════════════════════╝"
        )
    elif text.lower().startswith("/broadcast"):
        msg_text = text[len("/broadcast"):].strip()
        if not msg_text:
            await update.message.reply_text("❌  Usage: /broadcast <message>"); return
        users_list = await db_get_all_users()
        uids       = [u["user_id"] for u in users_list] if users_list else []
        status     = await update.message.reply_text(f"📤  Broadcasting to {len(uids)} users...")
        success = failed = 0
        for uid in uids:
            try:
                await context.bot.send_message(chat_id=uid, text=msg_text)
                success += 1; await asyncio.sleep(0.05)
            except Exception as e:
                logger.warning(f"[BROADCAST FAIL] uid={uid} {e}"); failed += 1
        await status.edit_text(f"✅ Delivered: {success}\n❌ Failed: {failed}\n👥 Total: {len(uids)}")
    elif text.lower() == "/users":
        count = await db_user_count()
        await update.message.reply_text(f"📊  Total Users: `{count}`\n🗄️ Source: MongoDB", parse_mode="Markdown")
    elif text.lower() == "/dbbackup":
        await send_db_backup(update.message, context.bot, update.effective_user.id)
    elif text.lower().startswith("/addadmin"):
        parts = text.split()
        if len(parts) < 2:
            await update.message.reply_text("❌  Usage: /addadmin @username"); return
        new_admin = parts[1] if parts[1].startswith("@") else f"@{parts[1]}"
        if new_admin.lower() not in [a.lower() for a in admins]:
            admins.append(new_admin)
            await update.message.reply_text(f"✅  {new_admin} ko admin bana diya!")
        else:
            await update.message.reply_text(f"⚠️  {new_admin} pehle se admin hai.")
    elif text.lower().startswith("/removeadmin"):
        parts = text.split()
        if len(parts) < 2:
            await update.message.reply_text("❌  Usage: /removeadmin @username"); return
        rem   = parts[1] if parts[1].startswith("@") else f"@{parts[1]}"
        match = next((a for a in admins if a.lower() == rem.lower()), None)
        if match and match.lower() != "@rtfgamming":
            admins.remove(match)
            await update.message.reply_text(f"✅  {rem} ko hata diya.")
        elif match:
            await update.message.reply_text("❌  Owner ko remove nahi kar sakte!")
        else:
            await update.message.reply_text(f"⚠️  {rem} list me nahi hai.")
    elif text.lower() == "/listadmins":
        await update.message.reply_text(
            "╔══════════════════╗\n║  📋 ADMIN LIST    ║\n╚══════════════════╝\n"
            + "\n".join(f"• {a}" for a in admins)
        )
    elif text.lower().startswith("/setcustomtg"):
        parts = text.split(None, 2)
        if len(parts) < 3:
            await update.message.reply_text("❌  Usage: /setcustomtg @username <custom_text>"); return
        target      = parts[1].lstrip("@").lower()
        custom_text = parts[2].strip()
        custom_tg_data[target] = custom_text
        await db_save_data(f"customtg:{target}", {"username": target, "data": custom_text})
        await update.message.reply_text(f"✅  Custom data set!\n👤 Key: `{target}`", parse_mode="Markdown")
    elif text.lower().startswith("/delcustomtg"):
        parts = text.split()
        if len(parts) < 2:
            await update.message.reply_text("❌  Usage: /delcustomtg @username"); return
        target = parts[1].lstrip("@").lower()
        if target in custom_tg_data:
            del custom_tg_data[target]
            await update.message.reply_text(f"✅  `{target}` ka custom data delete ho gaya.", parse_mode="Markdown")
        else:
            await update.message.reply_text(f"⚠️  `{target}` ka koi custom data nahi mila.", parse_mode="Markdown")
    elif text.lower() == "/listcustomtg":
        if not custom_tg_data:
            await update.message.reply_text("📋  Koi custom TG data set nahi hai."); return
        lines = ["╔══════════════════════════╗", "║  📋  CUSTOM TG DATA LIST  ║", "╠══════════════════════════╣"]
        for k, v in custom_tg_data.items():
            lines.append(f"👤 `{k}`\n   📝 {v[:60]}{'...' if len(v) > 60 else ''}")
        lines.append("╚══════════════════════════╝")
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

# ══════════════════════════════════════════
#  MAIN — Render ready (no yaml needed)
# ══════════════════════════════════════════

async def post_init(app):
    await init_db()
    await app.bot.set_my_commands([
        BotCommand("start",   "🏠 Main Menu"),
        BotCommand("num",     "📞 Number Lookup"),
        BotCommand("tg",      "🔎 TG Username / UserID"),
        BotCommand("adhar",   "🪪 Aadhaar Lookup"),
        BotCommand("upi",     "💳 UPI ID Lookup"),
        BotCommand("vehicle", "🚗 Vehicle Lookup"),
        BotCommand("help",    "❓ Help Guide"),
    ])
    logger.info("[BOT] Commands registered. Bot live ✅")

def main():
    if not BOT_TOKEN:
        logger.error("[BOT] BOT_TOKEN not set! Exiting.")
        return
    logger.info("[BOT] Starting up...")
    app = (
        ApplicationBuilder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .concurrent_updates(True)          # ← Multiple users simultaneously
        .build()
    )
    app.add_handler(CommandHandler("start",       start))
    app.add_handler(CommandHandler("help",        help_command))
    app.add_handler(CommandHandler("num",         num_command))
    app.add_handler(CommandHandler("tg",          tg_command))
    app.add_handler(CommandHandler("adhar",       adhar_command))
    app.add_handler(CommandHandler("upi",         upi_command))
    app.add_handler(CommandHandler("vehicle",     vehicle_command))
    app.add_handler(CommandHandler("admin",       message_handler))
    app.add_handler(CommandHandler("broadcast",   message_handler))
    app.add_handler(CommandHandler("users",       message_handler))
    app.add_handler(CommandHandler("addadmin",    message_handler))
    app.add_handler(CommandHandler("removeadmin", message_handler))
    app.add_handler(CommandHandler("listadmins",  message_handler))
    app.add_handler(CommandHandler("dbbackup",    message_handler))
    app.add_handler(CallbackQueryHandler(verify,        pattern="^verify$"))
    app.add_handler(CallbackQueryHandler(menu_callback, pattern="^menu_"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))
    logger.info("[BOT] All handlers registered. Polling started.")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
