import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes, CallbackQueryHandler, MessageHandler, filters
import asyncio

BOT_TOKEN = "8765184537:AAGPCaYDSRTmh7Pd45_hLhrI6xgHNV5aLig"
OWNER = "@RTFGAMMING"

NUM_API_URL = "https://paid.proportalx.workers.dev/number?key=Rexultron&num={number}"
TG_API_URL = "http://Api.subhxcosmo.in/api?key=KRISHRDP2&type=tg&term={term}"

CHANNELS = [
    ("🔥 RTF GAMING", "RTFGMINGGC"),
    ("🎁 GIVEAWAY", "RTFGAMINGHACK0"),
    ("💀 RTF ERA", "BYEPAASLINK")
]

user_state = {}

async def join_buttons(update: Update):
    bot = update.get_bot()
    user_id = update.effective_user.id
    buttons = []
    for name, username in CHANNELS:
        try:
            member = await bot.get_chat_member(f"@{username}", user_id)
            if member.status in ["left", "kicked"]:
                buttons.append([InlineKeyboardButton(name, url=f"https://t.me/{username}")])
        except:
            buttons.append([InlineKeyboardButton(name, url=f"https://t.me/{username}")])
    if buttons:
        buttons.append([InlineKeyboardButton("✅ VERIFY", callback_data="verify")])
        return InlineKeyboardMarkup(buttons)
    else:
        return None

async def check_join(update: Update):
    try:
        user_id = update.effective_user.id
        bot = update.get_bot()
        for _, username in CHANNELS:
            member = await bot.get_chat_member(f"@{username}", user_id)
            if member.status in ["left", "kicked"]:
                return False
        return True
    except:
        return False

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_join(update):
        buttons = await join_buttons(update)
        await update.message.reply_text(
"""╔══════════════════════╗
║ 🔒 ACCESS LOCKED 🔒 ║
╠══════════════════════╣

📢 सभी चैनल JOIN करो  
⚡ फिर VERIFY दबाओ  

╚══════════════════════╝""",
            reply_markup=buttons
        )
        return
    await show_main_buttons(update)

async def show_main_buttons(update: Update):
    buttons = [
        [InlineKeyboardButton("📞 Number to Info", callback_data="number")],
        [InlineKeyboardButton("💻 TG to Info", callback_data="tg")]
    ]
    await update.message.reply_text("✅ ACCESS GRANTED\n\nSelect option:", reply_markup=InlineKeyboardMarkup(buttons))

async def verify(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if await check_join(update):
        await query.edit_message_text("✅ ACCESS GRANTED\nSelect option:")
        buttons = [
            [InlineKeyboardButton("📞 Number to Info", callback_data="number")],
            [InlineKeyboardButton("💻 TG to Info", callback_data="tg")]
        ]
        await query.message.reply_text("Select option:", reply_markup=InlineKeyboardMarkup(buttons))
    else:
        await query.answer("❌ Join first", show_alert=True)

async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    data = query.data
    if data == "number":
        user_state[user_id] = "number"
        await query.message.reply_text("📥 Send me the number to fetch info:")
    elif data == "tg":
        user_state[user_id] = "tg"
        await query.message.reply_text("📥 Send me the TG username @ mt lagana/userid to fetch info:")

def extract_records(data):
    records = []
    if "result" in data and "data" in data["result"]:
        main_data = data["result"]["data"]
        if "main" in main_data:
            records.append({
                "name": main_data["main"].get("name", "N/A"),
                "fname": main_data["main"].get("father_name", "N/A"),
                "address": main_data["main"].get("address", "N/A"),
                "circle": main_data["main"].get("circle", "N/A"),
                "alt": main_data["main"].get("mobile", "N/A")
            })
        for r in main_data.get("additional", []):
            records.append({
                "name": r.get("name", "N/A"),
                "fname": r.get("father_name", "N/A"),
                "address": r.get("address", "N/A"),
                "circle": r.get("circle", "N/A"),
                "alt": r.get("alternate_mobile", "N/A")
            })
    return records

def format_result(records, number):
    text = f"""╔═══〔 📞 NUMBER INTEL 〕═══╗
📱 Number: {number}

"""
    for i, r in enumerate(records[:5], start=1):
        text += f"""🔴 RECORD {i}
👤 Name   : {r.get("name")}
👨 Father : {r.get("fname")}
📍 Address: {r.get("address")}
📡 Circle : {r.get("circle")}
☎️ Alt    : {r.get("alt")}

"""
    text += f"""━━━━━━━━━━━━━━
👑 Owner : {OWNER}
⚡ Status: ACTIVE"""
    return text

async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id not in user_state or user_state[user_id] is None:
        return
    choice = user_state[user_id]
    text = update.message.text.strip()
    if choice == "number":
        await handle_number(update, text)
    elif choice == "tg":
        await handle_tg(update, text)
    user_state[user_id] = None

async def handle_number(update: Update, number):
    user_msg = await update.message.reply_text(f"📥 Searching number: {number}...")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(NUM_API_URL.format(number=number), timeout=15) as res:
                data = await res.json()
        records = extract_records(data)
        if not records:
            bot_msg = await update.message.reply_text(f"❌ No Data Found for {number}")
            await asyncio.sleep(20)
            await user_msg.delete()
            await bot_msg.delete()
            return
        result = format_result(records, number)
        await update.message.reply_text(result)
    except Exception as e:
        print("ERROR:", e)
        await update.message.reply_text("❌ API Error / Timeout")

async def handle_tg(update: Update, term):
    user_msg = await update.message.reply_text(f"📥 Searching TG user: {term}...")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(TG_API_URL.format(term=term), timeout=15) as res:
                data = await res.json()
        if "result" in data and data["result"].get("success"):
            result = data["result"]
            country_code = result.get("country_code", "N/A")
            number = result.get("number", "N/A")
            tg_id = result.get("tg_id", "N/A")
            msg = f"""╔═══〔 💻 TG INFO 〕═══╗
📡 Telegram ID : {tg_id}
🌍 Country Code : {country_code}
📱 Number      : {number}
╚═══════════════════╝"""
            await update.message.reply_text(msg)
        else:
            await update.message.reply_text("❌ No TG Info Found")
    except Exception as e:
        print("ERROR:", e)
        await update.message.reply_text("❌ API Error / Timeout")

async def num_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("❌ Use: /num 9999999999")
        return
    await handle_number(update, context.args[0])

async def tg_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("❌ Use: /tg username_or_id")
        return
    await handle_tg(update, context.args[0])

app = ApplicationBuilder().token(BOT_TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(CallbackQueryHandler(verify, pattern="verify"))
app.add_handler(CallbackQueryHandler(button_handler, pattern="^(number|tg)$"))
app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), message_handler))
app.add_handler(CommandHandler("num", num_command))
app.add_handler(CommandHandler("tg", tg_command))

print("🔥 BOT RUNNING...")
app.run_polling()
