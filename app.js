import os
import requests
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# Konfiguration
TELEGRAM_TOKEN = "IHR_TELEGRAM_BOT_TOKEN"
ALLOWED_USER_ID = 123456789  # Ihre Telegram User-ID
TMDB_API_KEY = "IHR_TMDB_API_KEY"
ZIEL_ORDNER = "/pfad/zu/ihrer/mediathek"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    await update.message.reply_text("Hallo! Sende mir einen Filmnamen oder lade eine Videodatei hoch.")

async def verarbeite_film(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    
    film_name = update.message.text
    await update.message.reply_text(f"Suche nach Metadaten für: {film_name}...")
    
    # 1. TMDb nach Film abfragen
    url = f"https://themoviedb.org{TMDB_API_KEY}&query={film_name}&language=de-DE"
    response = requests.get(url).json()
    
    if not response['results']:
        await update.message.reply_text("Film leider nicht gefunden.")
        return
    
    bester_treffer = response['results'][0]
    titel = bester_treffer['title']
    jahr = bester_treffer['release_date'].split('-')[0]
    poster_path = bester_treffer['poster_path']
    beschreibung = bester_treffer['overview']
    
    # 2. Ordnerstruktur anlegen
    ordner_name = f"{titel} ({jahr})"
    neuer_pfad = os.path.join(ZIEL_ORDNER, ordner_name)
    os.makedirs(neuer_pfad, exist_ok=True)
    
    # 3. Cover herunterladen
    cover_url = f"https://tmdb.org{poster_path}"
    cover_daten = requests.get(cover_url).content
    with open(os.path.join(neuer_pfad, "poster.jpg"), "wb") as f:
        f.write(cover_daten)
        
    # Layout-Bestätigung an Telegram senden
    text_layout = f"**{titel} ({jahr})**\n\n_Beschreibung:_\n{beschreibung}"
    await update.message.reply_photo(photo=cover_url, caption=text_layout, parse_mode="Markdown")
    await update.message.reply_text(f"Ordner erstellt und veredelt unter: {neuer_pfad}")

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, verarbeite_film))
    app.run_polling()

if __name__ == '__main__':
    main()


nfo_inhalt = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
    <title>{titel}</title>
    <year>{jahr}</year>
    <outline>{beschreibung}</outline>
</movie>"""
with open(os.path.join(neuer_pfad, "movie.nfo"), "w", encoding="utf-8") as f:
    f.write(nfo_inhalt)



import os
import re
import requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# --- KONFIGURATION ---
TELEGRAM_TOKEN = "IHR_TELEGRAM_BOT_TOKEN"
ALLOWED_USER_ID = 123456789  # Ihre Telegram User-ID (Sicherheitsschutz)
TMDB_API_KEY = "IHR_TMDB_API_KEY"

def bereinige_dateiname(dateiname):
    """ Entfernt typische Video-Suffixe, um die TMDb-Suche zu verbessern """
    # Entferne Dateiendung
    name = os.path.splitext(dateiname)[0]
    # Ersetze Punkte und Unterstriche durch Leerzeichen
    name = name.replace('.', ' ').replace('_', ' ')
    # Entferne gängige Release-Begriffe (Case-Insensitive)
    suchmuster = r'\b(1080p|720p|2160p|4k|bluray|brrip|webrip|h264|x264|x265|hevc|multi|german|dubbed|dl|ac3|dts)\b'
    name = re.sub(suchmuster, '', name, flags=re.IGNORECASE)
    # Entferne überschüssige Leerzeichen
    return name.strip()

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    await update.message.reply_text(
        "🍿 **Willkommen in Deiner privaten Videothek!**\n\n"
        "Leite mir einfach eine Film-Datei (.mp4) weiter, und ich veredele sie mit einem Layout.",
        parse_mode="Markdown"
    )

async def verarbeite_video(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Sicherheitsprüfung: Nur Sie dürfen den Bot steuern
    if update.effective_user.id != ALLOWED_USER_ID:
        return

    # Prüfen, ob eine Videodatei oder ein Dokument gesendet wurde
    nachricht = update.message
    video_objekt = nachricht.video or nachricht.document
    
    if not video_objekt:
        await nachricht.reply_text("Bitte sende mir eine gültige Videodatei.")
        return

    # Hole den Dateinamen (Entweder aus dem Video-Tag oder dem Dokumenten-Namen)
    roher_name = getattr(video_objekt, 'file_name', None) or "Unbekannter Film"
    
    if not roher_name.lower().endswith(('.mp4', '.mkv', '.avi')):
        await nachricht.reply_text("Das ist keine unterstützte Videodatei (am besten .mp4 nutzen).")
        return

    status_msg = await nachricht.reply_text("Analysiere Dateiname und suche Metadaten...")

    # Dateiname für die Suche optimieren
    suchbegriff = bereinige_dateiname(roher_name)
    
    # TMDb API-Abfrage
    url = f"https://themoviedb.org{TMDB_API_KEY}&query={suchbegriff}&language=de-DE"
    try:
        response = requests.get(url).json()
    except Exception:
        await status_msg.edit_text("Fehler bei der Verbindung zur Filmdatenbank.")
        return

    if not response.get('results'):
        await status_msg.edit_text(f"❌ Film nicht gefunden.\nGesuchter Begriff: `{suchbegriff}`\n\nDu kannst mir den reinen Filmnamen als Text senden, um das Layout manuell zu generieren.", parse_mode="Markdown")
        return

    # Besten Treffer extrahieren
    film = response['results'][0]
    titel = film.get('title', 'Unbekannter Titel')
    jahr = film.get('release_date', '????-??-??').split('-')[0]
    bewertung = film.get('vote_average', 'N/A')
    beschreibung = film.get('overview', 'Keine Beschreibung verfügbar.')
    poster_path = film.get('poster_path')

    # Wunderschönes Layout erstellen
    layout_text = (
        f"🎬 **{titel} ({jahr})**\n"
        f"⭐️ Bewertung: {bewertung}/10\n\n"
        f"📝 **Beschreibung:**\n_{beschreibung}_\n\n"
        f"📁 _Datei: {roher_name}_"
    )

    # Erstelle einen "Anschauen"-Button, der direkt auf die originale Telegram-Datei verweist
    # Da wir die Datei im selben Chat behalten wollen, antworten wir stattdessen direkt auf das Video
    # Oder wir nutzen ein Inline-Keyboard für eine saubere Optik
    
    cover_url = f"https://tmdb.org{poster_path}" if poster_path else None

    # Statusnachricht löschen
    await status_msg.delete()

    # Das fertige Layout abschicken
    if cover_url:
        # Sendet das Poster mit der Filmbeschreibung als Text darunter
        layout_nachricht = await context.bot.send_photo(
            chat_id=update.effective_chat.id,
            photo=cover_url,
            caption=layout_text,
            parse_mode="Markdown"
        )
    else:
        # Fallback falls kein Poster existiert
        layout_nachricht = await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=layout_text,
            parse_mode="Markdown"
        )

    # Die originale Videodatei direkt unter das Layout zitieren/antworten
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text="👇 **Hier ist Deine Filmdatei zum Streamen:**",
        reply_to_message_id=nachricht.message_id,
        parse_mode="Markdown"
    )

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    # Filtert sowohl Videos als auch Dokumente (da große MP4s oft als Dokument geschickt werden)
    app.add_handler(MessageHandler(filters.VIDEO | filters.Document.ALL, verarbeite_video))
    app.run_polling()

if __name__ == '__main__':
    main()




import os
import re
import requests
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# --- KONFIGURATION ---
TELEGRAM_TOKEN = "IHR_TELEGRAM_BOT_TOKEN"
ALLOWED_USER_ID = 123456789       # Ihre persönliche Telegram User-ID
TMDB_API_KEY = "IHR_TMDB_API_KEY"
ZIEL_GRUPPEN_ID = -1001234567890  # Die ID Ihrer neuen strukturierten Gruppe

# Speicher für bereits erstellte Themen (Genre-Name -> Topic-ID)
# Bei einem Server-Neustart liest der Bot die IDs automatisch neu ein
GENRE_TOPICS = {}

def bereinige_dateiname(dateiname):
    name = os.path.splitext(dateiname)[0]
    name = name.replace('.', ' ').replace('_', ' ')
    suchmuster = r'\b(1080p|720p|2160p|4k|bluray|brrip|webrip|h264|x264|x265|hevc|multi|german|dubbed|dl|ac3|dts)\b'
    name = re.sub(suchmuster, '', name, flags=re.IGNORECASE)
    return name.strip()

async def hole_oder_erstelle_topic(context, genre_name):
    """ Sucht nach dem Genre-Thema in der Gruppe oder erstellt es neu """
    if genre_name in GENRE_TOPICS:
        return GENRE_TOPICS[genre_name]
    
    try:
        # Erstellt ein neues Thema (Topic) in der Gruppe
        topic = await context.bot.create_forum_topic(
            chat_id=ZIEL_GRUPPEN_ID,
            name=f"🎬 {genre_name}"
        )
        GENRE_TOPICS[genre_name] = topic.message_thread_id
        return topic.message_thread_id
    except Exception as e:
        print(f"Fehler beim Erstellen des Themas: {e}")
        return None

async def verarbeite_video(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return

    nachricht = update.message
    video_objekt = nachricht.video or nachricht.document
    
    if not video_objekt:
        return

    roher_name = getattr(video_objekt, 'file_name', None) or "Unbekannter Film"
    status_msg = await nachricht.reply_text("Analysiere Film und sortiere ein...")

    # TMDb Suche
    suchbegriff = bereinige_dateiname(roher_name)
    url = f"https://themoviedb.org{TMDB_API_KEY}&query={suchbegriff}&language=de-DE"
    
    try:
        response = requests.get(url).json()
    except Exception:
        await status_msg.edit_text("Verbindung zur Filmdatenbank fehlgeschlagen.")
        return

    # Fallback, falls Film nicht existiert
    if not response.get('results'):
        await status_msg.edit_text(f"❌ '{suchbegriff}' nicht gefunden. Bitte manuell benennen.")
        return

    film = response['results'][0]
    titel = film.get('title', 'Unbekannt')
    jahr = film.get('release_date', '????').split('-')[0]
    bewertung = film.get('vote_average', 'N/A')
    beschreibung = film.get('overview', 'Keine Beschreibung verfügbar.')
    poster_path = film.get('poster_path')
    
    # Genre ID abrufen und in Text umwandeln
    genre_ids = film.get('genre_ids', [])
    haupt_genre = "Allgemein"
    if genre_ids:
        # Erste Genre-ID abfragen (z.B. 28 = Action, 35 = Komödie)
        genre_url = f"https://themoviedb.org{TMDB_API_KEY}&language=de-DE"
        genres_liste = requests.get(genre_url).json().get('genres', [])
        for g in genres_liste:
            if g['id'] == genre_ids[0]:
                haupt_genre = g['name']
                break

    # Passendes Thema in der Gruppe finden/erstellen
    topic_id = await hole_oder_erstelle_topic(context, haupt_genre)

    # Layout Text formatieren
    layout_text = (
        f"🎬 **{titel} ({jahr})**\n"
        f"📂 **Genre:** {haupt_genre}\n"
        f"⭐️ **Bewertung:** {bewertung}/10\n\n"
        f"📝 **Beschreibung:**\n_{beschreibung}_"
    )
    cover_url = f"https://tmdb.org{poster_path}" if poster_path else None

    # 1. Das Layout/Cover in das richtige Gruppen-Thema posten
    if cover_url:
        ziel_nachricht = await context.bot.send_photo(
            chat_id=ZIEL_GRUPPEN_ID,
            message_thread_id=topic_id, # Sortiert es in das richtige Thema ein
            photo=cover_url,
            caption=layout_text,
            parse_mode="Markdown"
        )
    else:
        ziel_nachricht = await context.bot.send_message(
            chat_id=ZIEL_GRUPPEN_ID,
            message_thread_id=topic_id,
            text=layout_text,
            parse_mode="Markdown"
        )

    # 2. Die Filmdatei direkt in das Thema spiegeln (als Antwort auf das Cover)
    await context.bot.copy_message(
        chat_id=ZIEL_GRUPPEN_ID,
        from_chat_id=update.effective_chat.id,
        message_id=nachricht.message_id,
        message_thread_id=topic_id,
        reply_to_message_id=ziel_nachricht.message_id
    )

    await status_msg.edit_text(f"✅ Erfolgreich einsortiert in das Thema **{haupt_genre}**!")

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(MessageHandler(filters.VIDEO | filters.Document.ALL, verarbeite_video))
    app.run_polling()

if __name__ == '__main__':
    main()


import os
import re
import requests
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# --- HIER IHRE DATEN EINTRAGEN ---
TELEGRAM_TOKEN = "IHR_TELEGRAM_BOT_TOKEN"
ALLOWED_USER_ID = 123456789       # Ihre persönliche Telegram User-ID
TMDB_API_KEY = "IHR_TMDB_API_KEY"
ZIEL_GRUPPEN_ID = -1001234567890  # Die ID Ihrer Telegram-Gruppe (inklusive Minuszeichen!)

# Temporärer Speicher für die IDs der bereits erstellten Genre-Themen
GENRE_TOPICS = {}

def bereinige_dateiname(dateiname):
    """ Bereinigt den Dateinamen von typischen Szenen-Begriffen """
    name, _ = os.path.splitext(dateiname)
    name = name.replace('.', ' ').replace('_', ' ').replace('-', ' ')
    # Filtert gängige Qualitäts- und Codierungsbegriffe heraus
    suchmuster = r'\b(1080p|720p|2160p|4k|bluray|brrip|webrip|hdlight|h264|x264|h265|x265|hevc|multi|german|deutsch|dubbed|dl|ac3|dts|aac)\b'
    name = re.sub(suchmuster, '', name, flags=re.IGNORECASE)
    return name.strip()

async def hole_oder_erstelle_topic(context, genre_name):
    """ Prüft ob das Genre-Thema existiert, sonst erstellt der Bot es neu """
    if genre_name in GENRE_TOPICS:
        return GENRE_TOPICS[genre_name]
    
    try:
        # Erstellt das Thema mit einem passenden Filmklappen-Emoji vorweg
        topic = await context.bot.create_forum_topic(
            chat_id=ZIEL_GRUPPEN_ID,
            name=f"🎬 {genre_name}"
        )
        GENRE_TOPICS[genre_name] = topic.message_thread_id
        print(f"[INFO] Neues Thema erstellt: {genre_name} (ID: {topic.message_thread_id})")
        return topic.message_thread_id
    except Exception as e:
        print(f"[FEHLER] Konnte Thema für '{genre_name}' nicht erstellen: {e}")
        return None

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    await update.message.reply_text(
        "🍿 **Dein automatischer Genre-Sortierer läuft!**\n\n"
        "Leite mir einfach eine Film-Datei weiter. Ich suche das Genre auf TMDb, "
        "erstelle das passende Thema in deiner Gruppe und sortiere den Film dort ein."
    )

async def verarbeite_video(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return

    nachricht = update.message
    # Erkennt sowohl direkt hochgeladene Videos als auch Videos, die als Datei/Dokument gesendet wurden
    video_objekt = nachricht.video or nachricht.document
    
    if not video_objekt:
        return

    roher_name = getattr(video_objekt, 'file_name', None) or "Unbekannter_Film.mp4"
    status_msg = await nachricht.reply_text("🔍 Analysiere Dateiname und frage TMDb ab...")

    # Suchbegriff für TMDb vorbereiten
    suchbegriff = bereinige_dateiname(roher_name)
    url = f"https://themoviedb.org{TMDB_API_KEY}&query={suchbegriff}&language=de-DE"
    
    try:
        response = requests.get(url).json()
    except Exception:
        await status_msg.edit_text("❌ Fehler: Keine Verbindung zu TMDb möglich.")
        return

    if not response.get('results'):
        await status_msg.edit_text(f"❌ Film nicht gefunden.\nBereinigter Name: `{suchbegriff}`\nBitte benenne die Datei verständlicher um.")
        return

    # Daten des besten Treffers auslesen
    film = response['results'][0]
    titel = film.get('title', 'Unbekannt')
    jahr_voll = film.get('release_date', '????')
    jahr = jahr_voll.split('-')[0] if jahr_voll else "????"
    bewertung = film.get('vote_average', 'N/A')
    beschreibung = film.get('overview', 'Keine Beschreibung verfügbar.')
    poster_path = film.get('poster_path')
    
    # Genre ermitteln
    genre_ids = film.get('genre_ids', [])
    haupt_genre = "Allgemein"
    
    if genre_ids:
        # Liste aller Genres von TMDb laden, um die ID in Text zu übersetzen
        genre_liste_url = f"https://themoviedb.org{TMDB_API_KEY}&language=de-DE"
        genres_daten = requests.get(genre_liste_url).json().get('genres', [])
        for g in genres_daten:
            if g['id'] == genre_ids[0]: # Nutzt das erste/primäre Genre des Films
                haupt_genre = g['name']
                break

    # Topic-ID aus der Gruppe holen (oder neu generieren lassen)
    topic_id = await hole_oder_erstelle_topic(context, haupt_genre)
    if not topic_id:
        # Falls die Themenerstellung fehlschlägt, nutzen wir das Haupt-Thema (General) der Gruppe
        topic_id = None

    # Text-Layout für die Gruppe formatieren
    layout_text = (
        f"🎬 **{titel} ({jahr})**\n"
        f"📂 **Genre:** {haupt_genre}\n"
        f"⭐️ **Bewertung:** {bewertung}/10\n\n"
        f"📝 **Handlung:**\n_{beschreibung}_"
    )
    cover_url = f"https://tmdb.org{poster_path}" if poster_path else None

    # 1. Kinocover und Filminfos in das richtige Gruppen-Thema posten
    if cover_url:
        ziel_nachricht = await context.bot.send_photo(
            chat_id=ZIEL_GRUPPEN_ID,
            message_thread_id=topic_id,
            photo=cover_url,
            caption=layout_text,
            parse_mode="Markdown"
        )
    else:
        ziel_nachricht = await context.bot.send_message(
            chat_id=ZIEL_GRUPPEN_ID,
            message_thread_id=topic_id,
            text=layout_text,
            parse_mode="Markdown"
        )

    # 2. Die Filmdatei direkt als Antwort unter die Filminfo in der Gruppe platzieren
    await context.bot.copy_message(
        chat_id=ZIEL_GRUPPEN_ID,
        from_chat_id=update.effective_chat.id,
        message_id=nachricht.message_id,
        message_thread_id=topic_id,
        reply_to_message_id=ziel_nachricht.message_id
    )

    await status_msg.edit_text(f"✅ **{titel}** wurde erfolgreich in das Thema **🎬 {haupt_genre}** einsortiert!")

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.VIDEO | filters.Document.ALL, verarbeite_video))
    print("[INFO] Bot gestartet und wartet auf Filme...")
    app.run_polling()

if __name__ == '__main__':
    main()


import os
import re
import requests
from telegram import Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes

# --- DIESE DREI WERTE ERSETZEN WIR GLEICH IN DER CLOUD ---
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
TMDB_API_KEY = os.getenv("TMDB_API_KEY")
ZIEL_GRUPPEN_ID = int(os.getenv("ZIEL_GRUPPEN_ID", "0"))

def bereinige_dateiname(dateiname):
    name, _ = os.path.splitext(dateiname)
    name = name.replace('.', ' ').replace('_', ' ').replace('-', ' ')
    suchmuster = r'\b(1080p|720p|2160p|4k|bluray|brrip|webrip|hdlight|h264|x264|h265|x265|hevc|multi|german|deutsch|dubbed|dl|ac3|dts|aac)\b'
    name = re.sub(suchmuster, '', name, flags=re.IGNORECASE)
    return name.strip()

async def verarbeite_video(update: Update, context: ContextTypes.DEFAULT_TYPE):
    nachricht = update.message
    video_objekt = nachricht.video or nachricht.document
    if not video_objekt:
        return

    roher_name = getattr(video_objekt, 'file_name', None) or "Unbekannter_Film.mp4"
    status_msg = await nachricht.reply_text("🔍 Analysiere...")

    suchbegriff = bereinige_dateiname(roher_name)
    url = f"https://themoviedb.org{TMDB_API_KEY}&query={suchbegriff}&language=de-DE"
    
    try:
        response = requests.get(url).json()
    except Exception:
        await status_msg.edit_text("❌ Fehler: Keine Verbindung zu TMDb.")
        return

    if not response.get('results'):
        await status_msg.edit_text(f"❌ Film nicht gefunden: `{suchbegriff}`")
        return

    film = response['results'][0]
    titel = film.get('title', 'Unbekannt')
    jahr = film.get('release_date', '????').split('-')[0]
    bewertung = film.get('vote_average', 'N/A')
    beschreibung = film.get('overview', 'Keine Beschreibung verfügbar.')
    poster_path = film.get('poster_path')
    
    genre_ids = film.get('genre_ids', [])
    haupt_genre = "Allgemein"
    if genre_ids:
        genre_liste_url = f"https://themoviedb.org{TMDB_API_KEY}&language=de-DE"
        genres_daten = requests.get(genre_liste_url).json().get('genres', [])
        for g in genres_daten:
            if g['id'] == genre_ids[0]:
                haupt_genre = g['name']
                break

    # Erstelle das Thema (Telegram verhindert Klone automatisch)
    topic_id = None
    try:
        topic = await context.bot.create_forum_topic(chat_id=ZIEL_GRUPPEN_ID, name=f"🎬 {haupt_genre}")
        topic_id = topic.message_thread_id
    except Exception:
        # Falls es existiert, senden wir es ins Hauptthema oder fangen den Fehler ab
        pass

    layout_text = f"🎬 **{titel} ({jahr})**\n📂 **Genre:** {haupt_genre}\n⭐️ **Bewertung:** {bewertung}/10\n\n📝 **Handlung:**\n_{beschreibung}_"
    cover_url = f"https://tmdb.org{poster_path}" if poster_path else None

    if cover_url:
        ziel_nachricht = await context.bot.send_photo(chat_id=ZIEL_GRUPPEN_ID, message_thread_id=topic_id, photo=cover_url, caption=layout_text, parse_mode="Markdown")
    else:
        ziel_nachricht = await context.bot.send_message(chat_id=ZIEL_GRUPPEN_ID, message_thread_id=topic_id, text=layout_text, parse_mode="Markdown")

    await context.bot.copy_message(chat_id=ZIEL_GRUPPEN_ID, from_chat_id=update.effective_chat.id, message_id=nachricht.message_id, message_thread_id=topic_id, reply_to_message_id=ziel_nachricht.message_id)
    await status_msg.edit_text(f"✅ In **🎬 {haupt_genre}** einsortiert!")

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(MessageHandler(filters.VIDEO | filters.Document.ALL, verarbeite_video))
    app.run_polling()

if __name__ == '__main__':
    main()

python-telegram-bot==20.8
requests==2.31.0


mein 🤖 
// Beispiel für ein schönes Button-Layout unter dem Post
const reply_markup = {
  inline_keyboard: [
    [
      { text: "🎬 Trailer abspielen", url: `https://youtube.com{encodeURIComponent(title)}+Trailer` },
      { text: "ℹ️ TMDb Info", url: `https://themoviedb.org{tmdb_id}` }
    ],
    [
      { text: "🍿 Stream starten (In Telegram)", callback_data: `play_${file_id}` }
    ]
  ]
};


// ====== EVENT-HANDLER / ROUTE (Auszug für Ihre TMDb-Verarbeitung) ======

// 1. Suchergebnis von TMDb holen (Hier nutzen wir die ID des besten Treffers)
const tmdbId = response.results[0].id;

// 2. Details abfragen, um das "belongs_to_collection"-Feld zu erhalten
const detailUrl = `https://themoviedb.org{tmdbId}?api_key=${TMDB_KEY}&language=de-DE`;
const movieDetails = (await axios.get(detailUrl)).data;

// ====== HIER STARTET DIE INTELLIGENTE SORTIERUNG ======
let targetTopicName = "Allgemein";
let targetGroupId = MOVIE_GROUP_ID;

// Prio 1: Gehört der Film zu einer Kollektion/Filmreihe?
if (movieDetails.belongs_to_collection) {
  // Beispiel: "Harry Potter Filmreihe" -> Thema wird zu "📦 Harry Potter Filmreihe"
  targetTopicName = `📦 ${movieDetails.belongs_to_collection.name}`;
} 
// Prio 2: Wenn keine Kollektion existiert, nutze das Haupt-Genre
else if (movieDetails.genres && movieDetails.genres.length > 0) {
  // Beispiel: "Action" -> Thema wird zu "🎬 Action"
  targetTopicName = `🎬 ${movieDetails.genres[0].name}`;
}

console.log(`[Sortierung] Film wird einsortiert in das Thema: ${targetTopicName}`);


async function getOrCreateTopic(chatId, topicName) {
  if (!pgPool) return null;

  try {
    // 1. Prüfen, ob das Thema für diese Gruppe bereits in Supabase existiert
    const checkRes = await pgPool.query(
      "SELECT topic_id FROM topics WHERE chat_id = $1 AND name = $2",
      [String(chatId), topicName]
    );

    if (checkRes.rows.length > 0) {
      return checkRes.rows[0].topic_id; // Thema existiert bereits!
    }

    // 2. Wenn nicht existiert: Neues Thema via Telegram API in der Gruppe erstellen
    console.log(`[Telegram] Erstelle neues Thema: ${topicName}`);
    const telegramRes = await axios.post(`${BASE_URL}/createForumTopic`, {
      chat_id: chatId,
      name: topicName
    });

    const newTopicId = telegramRes.data.result.message_thread_id;

    // 3. Das neue Thema in Supabase speichern, damit der Bot es sich merkt
    await pgPool.query(
      "INSERT INTO topics (name, type, chat_id, topic_id) VALUES ($1, $2, $3, $4)",
      [topicName, "movie_collection", String(chatId), newTopicId]
    );

    return newTopicId;
  } catch (err) {
    console.error("❌ Fehler bei getOrCreateTopic:", err.message);
    return null; // Fallback ins Hauptthema der Gruppe
  }
}


// Topic ID abrufen (erstellt das Thema vollautomatisch, falls neu)
const topicId = await getOrCreateTopic(MOVIE_GROUP_ID, targetTopicName);

// Formatierung des Layout-Textes für die Gruppe
const captionText = `🎬 **${movieDetails.title} (${movieDetails.release_date.split("-")[0]})**\n` +
                    `⭐️ Bewertung: ${movieDetails.vote_average}/10\n\n` +
                    `📝 **Handlung:**\n_${movieDetails.overview}_`;

// Poster direkt von der TMDb-URL senden (schont den RAM Ihres kostenlosen Servers!)
const posterUrl = movieDetails.poster_path 
  ? `https://tmdb.org{movieDetails.poster_path}` 
  : null;

// Layout in das richtige Thema posten
if (posterUrl) {
  await axios.post(`${BASE_URL}/sendPhoto`, {
    chat_id: MOVIE_GROUP_ID,
    message_thread_id: topicId, // Hier wird es einsortiert!
    photo: posterUrl,
    caption: captionText,
    parse_mode: "Markdown"
  });
}


async function getOrCreateSeriesTopic(seriesTitle, tmdbSeriesData) {
  if (!pgPool) return null;

  try {
    // 1. Prüfen, ob das Thema für diese Serie bereits existiert
    const checkRes = await pgPool.query(
      "SELECT topic_id, hub_message_id FROM series_topics WHERE series_name = $1",
      [seriesTitle]
    );

    if (checkRes.rows.length > 0) {
      return checkRes.rows[0]; // Gibt { topic_id, hub_message_id } zurück
    }

    // 2. Thema in der Telegram-Serien-Gruppe erstellen
    console.log(`[Serien] Erstelle neues Thema für Serie: ${seriesTitle}`);
    const telegramRes = await axios.post(`${BASE_URL}/createForumTopic`, {
      chat_id: SERIES_GROUP_ID,
      name: `📺 ${seriesTitle}`
    });

    const newTopicId = telegramRes.data.result.message_thread_id;

    // 3. Haupt-Banner (Hub-Message) im neuen Thema posten
    const captionText = `📺 **${tmdbSeriesData.name}**\n` +
                        `⭐️ Bewertung: ${tmdbSeriesData.vote_average}/10\n` +
                        `📅 Start: ${tmdbSeriesData.first_air_date}\n\n` +
                        `📝 **Beschreibung:**\n_${tmdbSeriesData.overview}_`;

    const posterUrl = tmdbSeriesData.poster_path 
      ? `https://tmdb.org{tmdbSeriesData.poster_path}` 
      : null;

    let hubMessageId = null;
    if (posterUrl) {
      const bannerRes = await axios.post(`${BASE_URL}/sendPhoto`, {
        chat_id: SERIES_GROUP_ID,
        message_thread_id: newTopicId,
        photo: posterUrl,
        caption: captionText,
        parse_mode: "Markdown"
      });
      hubMessageId = bannerRes.data.result.message_id;
      
      // Das Haupt-Banner im Thema pinnen für den perfekten Look
      await axios.post(`${BASE_URL}/pinChatMessage`, {
        chat_id: SERIES_GROUP_ID,
        message_id: hubMessageId
      });
    }

    // 4. In Supabase speichern
    await pgPool.query(
      "INSERT INTO series_topics (series_name, topic_id, topic_title, hub_message_id) VALUES ($1, $2, $3, $4)",
      [seriesTitle, newTopicId, `📺 ${seriesTitle}`, hubMessageId]
    );

    return { topic_id: newTopicId, hub_message_id: hubMessageId };
  } catch (err) {
    console.error("❌ Fehler in getOrCreateSeriesTopic:", err.message);
    return null;
  }
}


async function ensureSeasonBanner(topicId, seasonNumber) {
  try {
    // Abfrage der bereits existierenden Staffel-Trenner für dieses Thema aus der topics Tabelle
    const res = await pgPool.query(
      "SELECT season_separators FROM topics WHERE topic_id = $1",
      [topicId]
    );

    let separators = {};
    if (res.rows.length > 0 && res.rows[0].season_separators) {
      separators = typeof res.rows[0].season_separators === 'string' 
        ? JSON.parse(res.rows[0].season_separators) 
        : res.rows[0].season_separators;
    }

    // Wenn für diese Staffel noch kein Banner existiert, erstelle es
    if (!separators[seasonNumber]) {
      const bannerText = `✨ ────────────────── ✨\n` +
                         `💿      **STAFFEL ${seasonNumber}**      💿\n` +
                         `✨ ────────────────── ✨`;

      const telegramRes = await axios.post(`${BASE_URL}/sendMessage`, {
        chat_id: SERIES_GROUP_ID,
        message_thread_id: topicId,
        text: bannerText,
        parse_mode: "Markdown"
      });

      separators[seasonNumber] = telegramRes.data.result.message_id;

      // Aktualisiere das JSON-Objekt in der Datenbank
      await pgPool.query(
        "UPDATE topics SET season_separators = $1 WHERE topic_id = $2",
        [JSON.stringify(separators), topicId]
      );
      console.log(`[Serien] Staffel-Banner für Staffel ${seasonNumber} erstellt.`);
    }
    
    return separators[seasonNumber]; // Gibt die Message-ID des Banners zurück
  } catch (err) {
    console.error("❌ Fehler bei ensureSeasonBanner:", err.message);
    return null;
  }
}


// 1. TMDb Serien-Details holen (z. B. über die Suche nach dem Seriennamen)
const tmdbSeriesData = response.results[0]; 

// 2. Thema holen oder erstellen + Haupt-Banner pinnen
const topicData = await getOrCreateSeriesTopic(tmdbSeriesData.name, tmdbSeriesData);

if (topicData) {
  const { topic_id } = topicData;
  const currentSeason = 1;   // Aus dem Dateinamen extrahiert
  const currentEpisode = 1;  // Aus dem Dateinamen extrahiert
  const episodeTitle = "Pilot"; // Optional von TMDb geladen

  // 3. Sicherstellen, dass das Staffel-Banner existiert
  await ensureSeasonBanner(topic_id, currentSeason);

  // 4. Die eigentliche Episode (Videodatei) in das Thema posten
  const episodeCaption = `📼 **Episode ${currentEpisode}: ${episodeTitle}**\n` +
                         `⏱ Status: Bereit zum Streamen`;

  await axios.post(`${BASE_URL}/sendVideo`, {
    chat_id: SERIES_GROUP_ID,
    message_thread_id: topic_id, // Sortiert es in das Serien-Thema ein
    video: "FILE_ID_DER_WEITERGELEITETEN_DATEI",
    caption: episodeCaption,
    parse_mode: "Markdown"
  });
}


function extrahiereSerienDaten(dateiname) {
  // Entferne die Dateiendung (z.B. .mp4, .mkv)
  let name = dateiname.replace(/\.[^/.]+$/, "");
  
  // Ersetze Punkte, Unterstriche und Bindestriche durch Leerzeichen für eine sauberere Verarbeitung
  name = name.replace(/[._-]/g, " ");

  // Die 3 gängigsten Muster für Serien (Groß-/Kleinschreibung ignorieren)
  // Muster 1: S03E14 oder S3E14
  // Muster 2: 3x14
  // Muster 3: Season 3 Episode 14
  const musterListe = [
    /\bS(\d{1,2})\s*E(\d{1,3})\b/i,
    /\b(\d{1,2})x(\d{1,3})\b/i,
    /\bSeason\s*(\d{1,2})\s*Episode\s*(\d{1,3})\b/i
  ];

  let treffer = null;
  let musterIndex = -1;

  // Durchsuche den Namen nach den Mustern
  for (let i = 0; i < musterListe.length; i++) {
    const match = name.match(musterListe[i]);
    if (match) {
      treffer = match;
      musterIndex = i;
      break;
    }
  }

  // Wenn kein Serien-Muster gefunden wurde, ist es vermutlich ein Film
  if (!treffer) {
    return null;
  }

  // Staffel und Episode in echte Zahlen umwandeln (entfernt führende Nullen wie "03" zu 3)
  const staffel = parseInt(treffer[1], 10);
  const episode = parseInt(treffer[2], 10);

  // Den Serientitel herausschneiden (alles, was VOR dem S03E14-Muster stand)
  let roherTitel = name.substring(0, treffer.index).strip ? name.substring(0, treffer.index).trim() : name.substring(0, treffer.index);
  
  // Den Titel von übrig gebliebenen Qualitätsbegriffen bereinigen, falls welche davor standen
  const schmutzFilter = /\b(1080p|720p|2160p|4k|bluray|brrip|webrip|hdlight|h264|x264|h265|x265|hevc|multi|german|deutsch|dubbed|dl|ac3|dts|aac)\b/i;
  let bereinigterTitel = roherTitel.replace(schmutzFilter, "").trim();

  // Falls der Titel durch die Bereinigung leer geworden ist, nimm den rohen Titel vor dem Match
  if (!bereinigterTitel) {
    bereinigterTitel = roherTitel.trim();
  }

  return {
    serienTitel: bereinigterTitel,
    staffel: staffel,
    episode: episode
  };
}


// Wenn eine Nachricht mit einem Video/Dokument eingeht:
const dateiname = telegramNachricht.video?.file_name || telegramNachricht.document?.file_name;

if (dateiname) {
  const serienDaten = extrahiereSerienDaten(dateiname);

  if (serienDaten) {
    console.log(`[Erkennung] Serie erkannt: ${serienDaten.serienTitel} - S${serienDaten.staffel}E${serienDaten.episode}`);
    
    // --> HIER rufen Sie jetzt Ihre TMDb-Seriensuche auf mit: serienDaten.serienTitel
    // --> Danach erstellen Sie das Thema für das Genre/die Serie und nutzen serienDaten.staffel für das Staffel-Banner!
    
  } else {
    console.log("[Erkennung] Keine Serien-Struktur gefunden. Verarbeite als Film...");
    // --> Hier läuft Ihr alter Code für Filme weiter
  }
}


voe

npm install playwright playwright-extra stealth-plugin


const { chromium } = require("playwright-extra");
const StealthPlugin = require("stealth-plugin");

// Aktiviert den Tarnmodus gegen Bot-Erkennung
chromium.use(StealthPlugin());

async function extrahiereVoeStream(streamingUrl) {
  console.log(`[INFO] [Extractor] 🎬 VOE erkannt – Extraktion startet...`);
  console.log(`[INFO] [Extractor] ▶️ Methode 2/3: Playwright VOE-Handler...`);

  // Startet den Browser unsichtbar (headless: true)
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  console.log(`[INFO] [Extractor] ✅ Browser: chrome | ✅ Stealth aktiv`);

  let direkterVideoLink = null;

  try {
    // Abfangen von Netzwerkanfragen, um den versteckten Videostream zu finden
    page.on('response', response => {
      const url = response.url();
      // VOE-Streams nutzen oft das HLS-Format (.m3u8) oder direkte mp4/mkv-Pfade in ihren API-Antworten
      if (url.includes('.m3u8') || url.includes('delivery') || (url.includes('.mp4') && !url.includes('ads'))) {
        direkterVideoLink = url;
        console.log(`[INFO] [Extractor] 📺 Stream-Link abgefangen: ${direkterVideoLink}`);
      }
    });

    console.log(`[INFO] [Extractor] Lade VOE-Seite im Browser...`);
    await page.goto(streamingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const seitenTitel = await page.title();
    console.log(`[INFO] [Extractor] Titel der Seite: ${seitenTitel}`);

    // Warte maximal 30 Sekunden, bis die Netzwerkanfrage den Link ausgibt
    console.log(`[INFO] [Extractor] ⏳ Warte auf VOE-Stream (max 30s)...`);
    let counter = 0;
    while (!direkterVideoLink && counter < 30) {
      await page.waitForTimeout(1000);
      counter++;
    }

  } catch (error) {
    console.error(`[FEHLER] [Extractor] Fehler beim Scrapen:`, error.message);
  } finally {
    await browser.close();
  }

  return direkterVideoLink;
}

// In Ihrer Webhook-Route oder Nachrichten-Verarbeitung:
app.post("/telegram-webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const text = message.text;
  const chatId = message.chat.id;

  // Prüfen, ob es ein VOE-Link ist
  if (text.includes("voe.sx") || text.includes("jessicaclearout.com")) {
    
    // Dem Nutzer Bescheid geben, dass die Extraktion läuft
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: "⏳ **VOE-Link erkannt.** Extrahiere Videostream mit Playwright im Hintergrund..."
    });

    // Funktion aufrufen
    const videoUrl = await extrahiereVoeStream(text);

    if (videoUrl) {
      // Erfolg: Der Bot schickt Ihnen den direkten Link zum Streamen oder Herunterladen!
      await axios.post(`${BASE_URL}/sendMessage`, {
        chat_id: chatId,
        text: `✅ **Stream erfolgreich extrahiert!**\n\n🔗 [Direkter Video-Link](${videoUrl})\n\nDu kannst diesen Link jetzt in VLC abspielen oder per Bot hochladen.`,
        parse_mode: "Markdown"
      });
    } else {
      await axios.post(`${BASE_URL}/sendMessage`, {
        chat_id: chatId,
        text: "❌ **Fehler:** Der Stream konnte nicht extrahiert werden (Timeout oder Blockierung)."
      });
    }
  }

  res.sendStatus(200);
});


if (videoUrl) {
  await axios.post(`${BASE_URL}/sendMessage`, {
    chat_id: chatId,
    text: "📥 **Stream gefunden.** Video wird jetzt direkt in die Film-Gruppe hochgeladen (das kann je nach Dateigröße ein paar Minuten dauern)..."
  });

  try {
    // Ermittle das passende Genre-Thema (wie in den vorherigen Schritten gelernt)
    const targetTopicName = "🎬 Extrahiert"; // Oder dynamisch über TMDb geladen
    const topicId = await getOrCreateTopic(MOVIE_GROUP_ID, targetTopicName);

    // Sende das Video per URL an die Gruppe
    await axios.post(`${BASE_URL}/sendVideo`, {
      chat_id: MOVIE_GROUP_ID,
      message_thread_id: topicId,
      video: videoUrl, // Telegram lädt das Video direkt über diesen Link im Hintergrund
      caption: `🍿 **Aus Stream extrahiert**\n🔗 Quelle: VOE Hoster`,
      parse_mode: "Markdown"
    });

    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: "✅ **Erfolgreich!** Das Video wurde direkt in deine Film-Gruppe einsortiert."
    });

  } catch (uploadError) {
    console.error("Upload Fehler:", uploadError.message);
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: "❌ **Upload-Fehler:** Telegram konnte das Video nicht direkt über den Link laden (z.B. weil die Datei größer als 20 MB für URL-Uploads ist)."
    });
  }
}


