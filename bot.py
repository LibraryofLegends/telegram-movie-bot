import os
import requests
import urllib.request
from PIL import Image, ImageDraw, ImageFont

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes

TOKEN = os.getenv("BOT_TOKEN")
CHANNEL = "-1003526259129"
OMDB_KEY = "a3776f86"

# ================================
# TOP SYSTEM
# ================================

top_movies = {}

def update_top(title):
    key = title.lower()
    top_movies[key] = top_movies.get(key, 0) + 1

def get_top10():
    sorted_movies = sorted(top_movies.items(), key=lambda x: x[1], reverse=True)
    text = "🏆 *TOP 10*\n\n"

    for i, (title, _) in enumerate(sorted_movies[:10], 1):
        text += f"{i}. 🎬 {title.title()}\n"

    return text

def get_badges(title):
    key = title.lower()
    badges = []

    sorted_titles = [t for t, _ in sorted(top_movies.items(), key=lambda x: x[1], reverse=True)]

    if key in sorted_titles[:3]:
        badges.append("🔥 TRENDING")

    if len(top_movies) < 5:
        badges.append("🆕 NEW")

    return " ".join(badges)

# ================================
# OMDB
# ================================

def get_movie(title):
    url = f"http://www.omdbapi.com/?t={title}&apikey={OMDB_KEY}"
    data = requests.get(url).json()

    if data.get("Response") == "False":
        return None

    return data

# ================================
# POSTER DOWNLOAD
# ================================

def download_poster(url, title):
    if not url or url == "N/A":
        return "default_cover.jpg"

    filename = f"{title.replace(' ', '_')}.jpg"

    try:
        urllib.request.urlretrieve(url, filename)
        return filename
    except:
        return "default_cover.jpg"

# ================================
# BANNER (NETFLIX STYLE)
# ================================

def create_banner(image_path, title):
    img = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(img)

    width, height = img.size

    # dunkler Bereich unten
    draw.rectangle((0, height-200, width, height), fill=(0,0,0))

    try:
        font = ImageFont.truetype("arial.ttf", 80)
    except:
        font = ImageFont.load_default()

    draw.text((50, height-150), title, fill="white", font=font)

    output = f"banner_{title}.jpg"
    img.save(output)

    return output

# ================================
# FILMKARTE
# ================================

def build_card(data, title):
    badges = get_badges(title)

    return f"""{badges}

🎬 {data.get("Title")} ({data.get("Year")})
🔥 4K • {data.get("Genre")}
━━━━━━━━━━━━━━
⭐ {data.get("imdbRating")} • ⏱ {data.get("Runtime")} • 🔞 FSK 16
🎥 {data.get("Director")}
🎭 {", ".join(data.get("Actors","").split(", ")[:2])}
━━━━━━━━━━━━━━
📖 STORY
{data.get("Plot")}
━━━━━━━━━━━━━━
▶️ #{title.replace(" ", "")}
━━━━━━━━━━━━━━
@LibraryOfLegends"""

# ================================
# START UI
# ================================

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("📤 Upload", callback_data="upload")],
        [InlineKeyboardButton("🔥 Trending", callback_data="trending")],
        [InlineKeyboardButton("🏆 Top 10", callback_data="top")]
    ]

    await update.message.reply_text(
        "🎬 *Library of Legends*\n\nNetflix Style Bot",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

# ================================
# BUTTONS
# ================================

async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if query.data == "upload":
        await query.edit_message_text("📤 Schick dein Video")

    elif query.data == "trending":
        await query.edit_message_text("🔥 Trending wird automatisch generiert")

    elif query.data == "top":
        await query.edit_message_text(get_top10(), parse_mode="Markdown")

# ================================
# VIDEO HANDLER
# ================================

async def handle_video(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    video = msg.video or msg.document

    await msg.reply_text("⏳ Lade Film + Poster...")

    title = msg.caption if msg.caption else "Unknown"

    data = get_movie(title)

    if not data:
        caption = f"🎬 {title}\n\nEin spannender Film."
        poster = "default_cover.jpg"
        banner = poster
    else:
        update_top(title)

        poster = download_poster(data.get("Poster"), data.get("Title"))
        banner = create_banner(poster, data.get("Title"))

        caption = build_card(data, title)

    file = await context.bot.get_file(video.file_id)
    path = f"{video.file_unique_id}.mp4"
    await file.download_to_drive(path)

    # Banner senden
    with open(banner, "rb") as img:
        await context.bot.send_photo(CHANNEL, img)

    # Video senden
    with open(path, "rb") as vid:
        await context.bot.send_video(CHANNEL, vid, caption=caption)

    await msg.reply_text("🔥 Mit Netflix Style gepostet!")

    os.remove(path)

    if poster != "default_cover.jpg":
        os.remove(poster)
    if banner != "default_cover.jpg":
        os.remove(banner)

# ================================
# MAIN
# ================================

def main():
    app = Application.builder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button))
    app.add_handler(MessageHandler(filters.VIDEO | filters.Document.VIDEO, handle_video))

    app.run_polling()

if __name__ == "__main__":
    main()
