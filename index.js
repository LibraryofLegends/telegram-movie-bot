const fetch = global.fetch || require("node-fetch");
const express = require("express");
const fs = require("fs");

const app = express();
app.use(express.json());

const TOKEN = process.env.TOKEN;
const TMDB_KEY = process.env.TMDB_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const BOT_USERNAME = process.env.BOT_USERNAME || "LIBRARY_OF_LEGENDS_Bot";

const DB_FILE = "films.json";
const HISTORY_FILE = "history.json";

// ================= GLOBAL UI STATE =================
global.LAST_LIST = null;
global.LAST_HEADING = "";

// ================= DB =================
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8") || "[]");
  } catch {
    return []; // 🔥 verhindert Crash bei kaputter JSON
  }
}

let CACHE = loadDB();

function saveDB(data) {
  CACHE = data;
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ================= SERIES DB =================
const SERIES_DB_FILE = "series.json";

function loadSeriesDB() {
  if (!fs.existsSync(SERIES_DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SERIES_DB_FILE, "utf8") || "{}");
  } catch {
    return {}; // 🔥 verhindert Crash bei kaputter JSON
  }
}

let SERIES_DB = loadSeriesDB();

function saveSeriesDB(data) {
  SERIES_DB = data;
  fs.writeFileSync(SERIES_DB_FILE, JSON.stringify(data, null, 2));
}

// ================= UTF / SAFE =================
function sanitizeTelegramText(input = "") {
  try {
    return String(input)
      .toWellFormed()
      .normalize("NFC")
      .replace(/\u0000/g, "");
  } catch {
    return String(input || "").replace(/\u0000/g, "");
  }
}

function sanitizeDeep(value) {
  if (typeof value === "string") return sanitizeTelegramText(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v);
    return out;
  }
  return value;
}

function limitText(text = "", max = 1024) {
  const safe = sanitizeTelegramText(text);
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
}

// ================= TELEGRAM =================
async function tg(method, body) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(sanitizeDeep(body))
    });

    const data = await res.json();

    if (!data.ok) {
      console.error("TG ERROR:", data);
    }

    return data || { ok: false };

  } catch (err) {
    console.error("TG FETCH ERROR:", err);
    return { ok: false };
  }
}


// ================= PARSER =================
function parseFileName(name = "") {

  const clean = name
    .replace(/\.(mp4|mkv|avi)$/i, "")
    .replace(/[._\-]+/g, " ")
    .trim();

  const match = clean.match(/S(\d{1,2})E(\d{1,2})/i); // 🔥 stabiler

  if (match) {
    return {
      type: "tv",
      title: clean.replace(match[0], "").trim(),
      season: parseInt(match[1], 10),
      episode: parseInt(match[2], 10)
    };
  }

  return {
    type: "movie",
    title: clean
  };
}


// 🔥 BESSERER CLEANER (wichtig für TMDB Treffer)
function cleanTitleAdvanced(name = "") {
  return name
    .replace(/\.(mp4|mkv|avi)$/i, "")

    // Qualität
    .replace(/\b(1080p|720p|2160p|4k|uhd)\b/gi, "")

    // Codecs
    .replace(/\b(x264|x265|h264|h265)\b/gi, "")

    // Sources
    .replace(/\b(bluray|web|webdl|webrip|hdrip|brrip)\b/gi, "")

    // Audio
    .replace(/\b(german|deutsch|dl|dual|ac3|eac3|aac)\b/gi, "")

    // Staffel/Episode entfernen (🔥 wichtig!)
    .replace(/S\d{1,2}E\d{1,2}/gi, "")

    // Trennzeichen
    .replace(/[._\-]+/g, " ")

    .replace(/\s+/g, " ")
    .trim();
}


// 🔥 Titel sauber kürzen (bessere Suche)
function smartTitleSplit(title = "") {

  if (!title) return "";

  // Klassiker: "Film - Extended Cut"
  if (title.includes(" - ")) {
    return title.split(" - ")[0].trim();
  }

  // Entfernt Klammern am Ende
  return title.replace(/\(.*?\)$/g, "").trim();
}

// ================= TMDB =================

// 🔥 BASE FETCH (WICHTIG!)
async function tmdbFetch(url) {
  try {
    const res = await fetch(url);

    if (!res.ok) {
      console.error("TMDB HTTP ERROR:", res.status);
      return null;
    }

    return await res.json();

  } catch (err) {
    console.error("TMDB FETCH ERROR:", err);
    return null;
  }
}


// ================= SEARCH =================
async function searchTMDB(title, type = "movie") {
  const urlType = type === "tv" ? "tv" : "movie";

  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/search/${urlType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=de-DE`
  );

  if (!data?.results?.length) return null;

  return data.results[0];
}


// 🔥 ULTRA SEARCH (verbessert)
async function multiSearch(title, preferredType = "movie") {

  const clean = title.trim();

  const variants = [
    clean,
    clean.split(" ").slice(0, 3).join(" "),
    clean.split(" ").slice(0, 2).join(" "),
    clean.split(" ")[0]
  ].filter(v => v && v.length >= 2);

  const types = preferredType === "tv"
    ? ["tv", "movie"]
    : ["movie", "tv"];

  for (const v of variants) {
    for (const type of types) {
      const res = await searchTMDB(v, type);
      if (res) return res;
    }
  }

  return null;
}


// ================= DETAILS =================
async function getDetails(id, type = "movie") {
  const urlType = type === "tv" ? "tv" : "movie";

  return await tmdbFetch(
    `https://api.themoviedb.org/3/${urlType}/${id}?api_key=${TMDB_KEY}&append_to_response=credits,release_dates&language=de-DE`
  );
}


// ================= LISTS =================
async function getTrending() {
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_KEY}&language=de-DE`
  );

  if (!data?.results) return [];

  return data.results
    .filter(x => x.media_type === "movie" || x.media_type === "tv")
    .slice(0, 10);
}


async function getPopular() {
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=de-DE`
  );

  return data?.results?.slice(0, 10) || [];
}


async function getByGenre(genreId) {
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_genres=${genreId}&sort_by=popularity.desc&language=de-DE`
  );

  return data?.results?.slice(0, 10) || [];
}


// ================= SIMILAR =================
async function getSimilar(id, type = "movie") {
  const urlType = type === "tv" ? "tv" : "movie";

  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/${urlType}/${id}/similar?api_key=${TMDB_KEY}&language=de-DE`
  );

  return data?.results?.slice(0, 10) || [];
}


// ================= SERIES =================
async function getSeasons(tvId) {
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/tv/${tvId}?api_key=${TMDB_KEY}&language=de-DE`
  );

  return data?.seasons || [];
}


async function getEpisodes(tvId, season) {
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/tv/${tvId}/season/${season}?api_key=${TMDB_KEY}&language=de-DE`
  );

  return data?.episodes || [];
}

// ================= HELPERS =================

// 🔥 FAST BOLD MAP
const BOLD_MAP = (() => {
  const normal = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bold = "𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟕𝟖𝟗";
  const map = {};
  for (let i = 0; i < normal.length; i++) {
    map[normal[i]] = bold[i];
  }
  return map;
})();

function toBold(text = "") {
  return sanitizeTelegramText(text)
    .split("")
    .map(c => BOLD_MAP[c] || c)
    .join("");
}


// ================= COVER =================
function getCover(data = {}) {
  if (data?.poster_path) {
    return `https://image.tmdb.org/t/p/w500${data.poster_path}`;
  }

  if (data?.backdrop_path) {
    return `https://image.tmdb.org/t/p/w500${data.backdrop_path}`;
  }

  return "https://via.placeholder.com/500x750?text=No+Image";
}


// ================= DETECT =================
function detectQuality(name = "") {
  const n = name.toLowerCase();
  if (/2160|4k/.test(n)) return "4K";
  if (/1080/.test(n)) return "1080p";
  if (/720/.test(n)) return "720p";
  return "HD";
}

function detectAudio(name = "") {
  const n = name.toLowerCase();
  if (/deutsch|german/.test(n) && /eng/.test(n)) return "Deutsch • Englisch";
  if (/deutsch|german/.test(n)) return "Deutsch";
  if (/eng/.test(n)) return "Englisch";
  return "Deutsch • Englisch";
}

function detectSource(name = "") {
  const n = name.toLowerCase();
  if (n.includes("bluray")) return "BluRay";
  if (n.includes("web")) return "WEB-DL";
  return "-";
}


// ================= UI =================
function stars(r = 0) {
  const rating = Number(r) || 0;
  const s = Math.round(rating / 2);
  return "⭐".repeat(s) + "☆".repeat(5 - s) + ` (${rating.toFixed(1)})`;
}


// ================= FSK =================
function getFSK(data = {}) {
  try {
    const releases = data?.release_dates?.results || [];

    const findCert = (arr) =>
      arr?.release_dates?.find(x => x.certification)?.certification;

    const de = releases.find(r => r.iso_3166_1 === "DE");
    let cert = findCert(de);

    if (!cert) {
      const us = releases.find(r => r.iso_3166_1 === "US");
      cert = findCert(us);

      if (cert === "G") cert = "0";
      if (cert === "PG") cert = "6";
      if (cert === "PG-13") cert = "12";
      if (cert === "R") cert = "16";
      if (cert === "NC-17") cert = "18";
    }

    return cert || "-";
  } catch {
    return "-";
  }
}


// ================= TAGS =================
function generateTags(data = {}) {
  const tags = new Set();

  const baseTitle = data.title || data.name || "";

  const titleWords = String(baseTitle)
    .replace(/[^\w\s]/gi, "")
    .split(" ")
    .filter(w => w.length > 2)
    .slice(0, 2);

  if (titleWords.length) {
    tags.add(`#${titleWords.join("")}`);
  }

  (data?.genres || []).slice(0, 3).forEach(g => {
    if (g?.name) tags.add(`#${g.name.replace(/\s/g, "")}`);
  });

  (data?.credits?.cast || []).slice(0, 2).forEach(actor => {
    const name = actor?.name?.split(" ")[0];
    if (name && name.length > 3) tags.add(`#${name}`);
  });

  return [...tags].slice(0, 6).join(" ");
}


// ================= CARD =================
function buildCard(data, extra = {}, fileName = "", id = "0001") {

  // 🔥 ABSOLUTE SAFETY
  if (!data) {
    return "❌ Keine Daten verfügbar";
  }

  const title = toBold((data.title || data.name || "UNBEKANNT").toUpperCase());
  const year = (data.release_date || data.first_air_date || "").slice(0, 4);

  const genres = (data?.genres || [])
    .slice(0, 2)
    .map(g => g.name)
    .join(" • ");

  const cast =
    data?.credits?.cast?.slice(0, 3).map(x => x.name).join(" • ") || "-";

  const director =
    data?.credits?.crew?.find(x => x.job === "Director")?.name ||
    data?.created_by?.[0]?.name ||
    "-";

  const runtime =
    data.runtime ||
    (Array.isArray(data?.episode_run_time) && data.episode_run_time[0]) ||
    "-";

  const fsk = getFSK(data);
  const tags = generateTags(data);

  const quality = detectQuality(fileName);
  const audio = detectAudio(fileName);
  const source = detectSource(fileName);

  const collection = data?.belongs_to_collection?.name || null;

  const collectionLine = collection
    ? `🎞 ${collection.toUpperCase()}`
    : "";

  let story = data?.overview?.trim() || "Keine Beschreibung verfügbar.";

  if (story.length > 220) {
    story = story.slice(0, 220);
    const cut = story.lastIndexOf(".");
    if (cut > 100) story = story.slice(0, cut + 1);
    story += "...";
  }

  const typeLine =
    extra.type === "tv" && extra.season
      ? `📺 S${extra.season}E${extra.episode || "01"}`
      : "";

  const LINE_MAIN = "━━━━━━━━━━━━━━━━━━";
  const LINE_SOFT = "──────────────";

  let text = `${LINE_MAIN}
🎬 𝐋𝐈𝐁𝐑𝐀𝐑𝐘 𝐎𝐅 𝐋𝐄𝐆𝐄𝐍𝐃𝐒
${title}${year ? ` (${year})` : ""}
${collectionLine ? collectionLine + "\n" : ""}${typeLine ? typeLine + "\n" : ""}${LINE_SOFT}
🔥 ${quality} • ${genres || "-"}
🎧 ${audio} • 💿 ${source}
${LINE_MAIN}
${stars(data.vote_average)}
⏱ ${runtime} Min • 🔞 FSK ${fsk}
🎥 ${director}
👥 ${cast}
${LINE_MAIN}
📖 HANDLUNG
${story}
${LINE_MAIN}
▶️ #${id}
${LINE_SOFT}
${tags}
@LibraryOfLegends`;

  return limitText(
    text
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n"),
    1024
  );
}

// ================= UI / NETFLIX MODE =================

function showNetflixMenu(chatId) {
  return tg("sendMessage", {
    chat_id: chatId,
    text: `🎬 LIBRARY OF LEGENDS

Wähle deinen Bereich 👇`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔥 Trending", callback_data: "net_trending" }],
        [{ text: "📈 Popular", callback_data: "net_popular" }],
        [
          { text: "🎬 Filme A–Z", callback_data: "movies_az" },
          { text: "📺 Serien", callback_data: "series_menu" }
        ],
        [
          { text: "🔥 Action", callback_data: "genre_28" },
          { text: "😂 Comedy", callback_data: "genre_35" }
        ],
        [{ text: "▶️ Weiter schauen", callback_data: "continue" }]
      ]
    }
  });
}


// 🔥 USER STATE (statt global!)
const USER_STATE = {};

async function sendResultsList(chatId, heading, list, page = 0, defaultType = "movie") {

  if (!list || !list.length) {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "❌ Keine Ergebnisse"
    });
  }

  const perPage = 4;
  const start = page * perPage;
  const slice = list.slice(start, start + perPage);

  // 🔥 PRO USER STATE
  USER_STATE[chatId] = {
    list,
    heading
  };

  // ================= SEND CARDS (PARALLEL 🔥)
  await Promise.all(
    slice.map(m => {
      const title = sanitizeTelegramText(m.title || m.name || "Unbekannt");
      const year = (m.release_date || m.first_air_date || "").slice(0, 4);

      return tg("sendPhoto", {
        chat_id: chatId,
        photo: getCover(m),
        caption: `🎬 ${title}${year ? ` (${year})` : ""}`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "▶️ Öffnen",
                callback_data: `search_${m.id}_${m.media_type || defaultType}`
              }
            ],
            [
              {
                text: "🔥 Ähnliche",
                callback_data: `sim_${m.id}_${m.media_type || defaultType}`
              }
            ]
          ]
        }
      });
    })
  );

  // ================= NAVIGATION =================
  const nav = [];

  if (page > 0) {
    nav.push({ text: "⬅️", callback_data: `page_${page - 1}` });
  }

  if (start + perPage < list.length) {
    nav.push({ text: "➡️", callback_data: `page_${page + 1}` });
  }

  const keyboard = [];

  if (nav.length) {
    keyboard.push(nav);
  }

  keyboard.push([{ text: "🏠 Menü", callback_data: "netflix" }]);

  return tg("sendMessage", {
    chat_id: chatId,
    text: `📄 ${heading} • Seite ${page + 1}`,
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}


// ================= FILE SEND =================
async function sendFileById(chatId, item) {
  if (!item) {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "❌ Datei nicht gefunden"
    });
  }

  saveHistory(chatId, {
    id: item.display_id,
    type: item.media_type
  });

  try {
    if (item.file_type === "document") {
      return tg("sendDocument", {
        chat_id: chatId,
        document: item.file_id
      });
    }

    return tg("sendVideo", {
      chat_id: chatId,
      video: item.file_id,
      supports_streaming: true
    });

  } catch (err) {
    console.error("SEND FILE ERROR:", err);

    return tg("sendMessage", {
      chat_id: chatId,
      text: "❌ Fehler beim Senden"
    });
  }
}

// ================= START HANDLER =================
async function handleStart(msg, param) {

  const chatId = msg.chat.id;

  if (param === "netflix" || param === "browse" || param === "menu") {
    return showNetflixMenu(chatId);
  }

  // 🔥 TRENDING
  if (param === "net_trending") {
    const list = await getTrending();
    return sendResultsList(chatId, "🔥 Trending:", list, 0);
  }

  // 🔥 POPULAR
  if (param === "net_popular") {
    const list = await getPopular();
    return sendResultsList(chatId, "📈 Popular:", list, 0);
  }

  // 🔥 SIMILAR
  if (param.startsWith("sim_")) {
    const [, id, typeRaw] = param.split("_");
    const type = typeRaw === "tv" ? "tv" : "movie";

    const list = await getSimilar(id, type);
    return sendResultsList(chatId, "🎬 Ähnliche:", list, 0);
  }

  // 🔥 STREAM / DOWNLOAD
  if (param.startsWith("str_") || param.startsWith("dl_") || param.startsWith("play_")) {
    const id = param.replace(/^(str_|dl_|play_)/, "");
    const item = CACHE.find(x => x.display_id === id);
    return sendFileById(chatId, item);
  }

  // 🔥 FALLBACK
  const item = CACHE.find(x => x.display_id === param);

  if (!item) {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "❌ Datei nicht gefunden"
    });
  }

  return sendFileById(chatId, item);
}


// ================= UPLOAD =================
async function handleUpload(msg) {

  const chatId = msg.chat.id;
  const file = msg.document || msg.video;

  if (!file) return;

  const fileName = file.file_name || msg.caption || "";
  if (!fileName) return;

  const parsed = parseFileName(fileName);
  const searchBase = cleanTitleAdvanced(parsed.title || fileName);
  const searchTitle = smartTitleSplit(searchBase) || searchBase;

  const result = await multiSearch(searchTitle, parsed.type);

  if (!result || !result.id) {
    return tg("sendMessage", {
      chat_id: chatId,
      text: `❌ Kein Match gefunden\n${sanitizeTelegramText(searchTitle)}`
    });
  }

  const details = await getDetails(result.id, result.media_type || parsed.type);

  // 🔥 FALLBACK DETAILS
  if (!details) {
    console.error("DETAILS ERROR:", result.id);
  }

  const db = CACHE;

  // 🔥 SAFE ID GENERATION
  const lastId = db.length
    ? Math.max(...db.map(x => parseInt(x.display_id || "0", 10) || 0))
    : 0;

  const nextId = String((lastId || 0) + 1).padStart(4, "0");

  // 🔥 SERIES SAVE (nur TV)
  if (parsed.type === "tv") {
    const seriesKey = parsed.title.toLowerCase().replace(/\s/g, "_");

    if (!SERIES_DB[seriesKey]) SERIES_DB[seriesKey] = {};
    if (!SERIES_DB[seriesKey][parsed.season]) SERIES_DB[seriesKey][parsed.season] = {};

    SERIES_DB[seriesKey][parsed.season][parsed.episode] = {
      file_id: file.file_id,
      display_id: nextId
    };

    saveSeriesDB(SERIES_DB);
  }

  const item = {
    display_id: nextId,
    file_id: file.file_id,
    file_type: msg.document ? "document" : "video",
    tmdb_id: result.id,
    media_type: result.media_type || parsed.type,
    title: result.title || result.name
  };

  db.unshift(item);

  if (db.length > 500) db.length = 500;

  saveDB(db);

  let caption;

  try {
    caption = buildCard(details, parsed, fileName, item.display_id);
  } catch (e) {
    console.error("CARD ERROR:", e);
    caption = "❌ Fehler beim Erstellen der Karte";
  }

  await tg("sendPhoto", {
    chat_id: CHANNEL_ID,
    photo: getCover(details || {}),
    caption,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "▶️ Stream", url: playerUrl("str", item.display_id) },
          { text: "⬇️ Download", url: playerUrl("dl", item.display_id) }
        ],
        [
          {
            text: "🎬 Ähnliche",
            url: `https://t.me/${BOT_USERNAME}?start=sim_${item.tmdb_id}_${item.media_type}`
          }
        ]
      ]
    }
  });

  await tg("sendMessage", {
    chat_id: chatId,
    text: "✅ Upload verarbeitet"
  });
}

// ================= SERIES SAVE =================
if (parsed.type === "tv") {

  const safeTitle = (parsed.title || "unknown")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "_");

  const season = parsed.season || 1;
  const episode = parsed.episode || 1;

  if (!SERIES_DB[safeTitle]) SERIES_DB[safeTitle] = {};
  if (!SERIES_DB[safeTitle][season]) SERIES_DB[safeTitle][season] = {};

  SERIES_DB[safeTitle][season][episode] = {
    file_id: file.file_id,
    display_id: nextId
  };

  saveSeriesDB(SERIES_DB);
}


// ================= ITEM =================
const item = {
  display_id: nextId,
  file_id: file.file_id,
  file_type: msg.document ? "document" : "video",
  tmdb_id: result.id,
  media_type: result.media_type || parsed.type,
  title: result.title || result.name || parsed.title || "Unbekannt"
};

db.unshift(item);
if (db.length > 500) db.length = 500;

saveDB(db);


// ================= CARD =================
let caption;

try {
  caption = buildCard(details, parsed, fileName, item.display_id);
} catch (e) {
  console.error("CARD ERROR:", e);
  caption = "❌ Fehler beim Erstellen der Karte";
}


// ================= SEND =================
await tg("sendPhoto", {
  chat_id: CHANNEL_ID,
  photo: getCover(details || {}),
  caption,
  reply_markup: {
    inline_keyboard: [
      [
        { text: "▶️ Stream", url: playerUrl("str", item.display_id) },
        { text: "⬇️ Download", url: playerUrl("dl", item.display_id) }
      ],
      [
        {
          text: "🎬 Ähnliche",
          url: `https://t.me/${BOT_USERNAME}?start=sim_${item.tmdb_id}_${item.media_type}`
        }
      ]
    ]
  }
});


// ================= FEEDBACK =================
await tg("sendMessage", {
  chat_id: msg.chat.id,
  text: "✅ Upload verarbeitet"
});

// ================= CALLBACK =================
if (body.callback_query) {
  const data = body.callback_query.data;
  const chatId = body.callback_query.message.chat.id;

  await tg("answerCallbackQuery", {
    callback_query_id: body.callback_query.id
  });

  // ================= CONTINUE =================
  if (data === "continue") {
    const history = readHistory(chatId);

    if (!history.length) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Kein Verlauf vorhanden"
      });
    }

    const last = history[0];

    return tg("sendMessage", {
      chat_id: chatId,
      text: "▶️ Weiter schauen:",
      reply_markup: {
        inline_keyboard: [[
          {
            text: "🎬 Öffnen",
            callback_data: `search_${last.id}_${last.type}`
          }
        ]]
      }
    });
  }

  // ================= MENU =================
  if (data === "netflix") {
    return showNetflixMenu(chatId);
  }

  // ================= PAGE =================
  if (data.startsWith("page_")) {
    if (!global.LAST_LIST) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Keine Liste geladen"
      });
    }

    const page = parseInt(data.split("_")[1], 10);

    return sendResultsList(
      chatId,
      global.LAST_HEADING || "Ergebnisse",
      global.LAST_LIST,
      page
    );
  }

  // ================= TRENDING =================
  if (data === "net_trending") {
    const list = await getTrending();

    global.LAST_LIST = list;
    global.LAST_HEADING = "🔥 Trending:";

    return sendResultsList(chatId, global.LAST_HEADING, list, 0);
  }

  // ================= POPULAR =================
  if (data === "net_popular") {
    const list = await getPopular();

    global.LAST_LIST = list;
    global.LAST_HEADING = "📈 Popular:";

    return sendResultsList(chatId, global.LAST_HEADING, list, 0);
  }

  // ================= GENRE =================
  if (data.startsWith("genre_")) {
    const genre = data.split("_")[1];

    const list = await getByGenre(genre);

    global.LAST_LIST = list;
    global.LAST_HEADING = "📂 Kategorie:";

    return sendResultsList(chatId, global.LAST_HEADING, list, 0);
  }

  // ================= SERIES =================

  // 📺 SERIE → STAFFELN
  if (data.startsWith("tv_")) {
    const [, rawKey] = data.split("_");

    const seriesKey = rawKey.toLowerCase();

    const seasons = SERIES_DB[seriesKey];

    if (!seasons) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Keine Staffel vorhanden"
      });
    }

    const buttons = Object.keys(seasons)
      .sort((a, b) => a - b)
      .map(season => ([
        {
          text: `📺 Staffel ${season}`,
          callback_data: `season_${seriesKey}_${season}`
        }
      ]));

    buttons.push([
      { text: "🏠 Menü", callback_data: "netflix" }
    ]);

    return tg("sendMessage", {
      chat_id: chatId,
      text: "📺 Staffel auswählen:",
      reply_markup: { inline_keyboard: buttons }
    });
  }

  // 🎬 STAFFEL → EPISODEN
  if (data.startsWith("season_")) {
    const [, seriesKey, season] = data.split("_");

    const episodes = SERIES_DB?.[seriesKey]?.[season];

    if (!episodes) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Keine Episoden vorhanden"
      });
    }

    const buttons = Object.keys(episodes)
      .sort((a, b) => a - b)
      .map(ep => ([
        {
          text: `🎬 Episode ${ep}`,
          callback_data: `episode_${seriesKey}_${season}_${ep}`
        }
      ]));

    buttons.push([
      { text: "⬅️ Zurück", callback_data: `tv_${seriesKey}` },
      { text: "🏠 Menü", callback_data: "netflix" }
    ]);

    return tg("sendMessage", {
      chat_id: chatId,
      text: `📺 Staffel ${season}`,
      reply_markup: { inline_keyboard: buttons }
    });
  }

  // ▶️ EPISODE → PLAYER UI
  if (data.startsWith("episode_")) {
    const [, seriesKey, season, ep] = data.split("_");

    const item = SERIES_DB?.[seriesKey]?.[season]?.[ep];

    if (!item) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Episode nicht gefunden"
      });
    }

    return tg("sendMessage", {
      chat_id: chatId,
      text: `🎬 Episode ${ep} • Staffel ${season}`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "▶️ Stream",
              callback_data: `play_${seriesKey}_${season}_${ep}`
            },
            {
              text: "⬇️ Download",
              callback_data: `dl_${seriesKey}_${season}_${ep}`
            }
          ],
          [
            {
              text: "⬅️ Zurück",
              callback_data: `season_${seriesKey}_${season}`
            },
            {
              text: "🏠 Menü",
              callback_data: "netflix"
            }
          ]
        ]
      }
    });
  }

  // ▶️ STREAM / DOWNLOAD
  if (data.startsWith("play_") || data.startsWith("dl_")) {
    const [, seriesKey, season, ep] = data.split("_");

    const item = SERIES_DB?.[seriesKey]?.[season]?.[ep];

    if (!item) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Datei nicht gefunden"
      });
    }

    return tg("sendVideo", {
      chat_id: chatId,
      video: item.file_id,
      supports_streaming: true
    });
  }

  return; // 🔥 VERY IMPORTANT
}

// ================= SEARCH =================
if (data.startsWith("search_")) {
  const [, id, typeRaw] = data.split("_");
  const type = typeRaw === "tv" ? "tv" : "movie";

  const details = await getDetails(id, type);

  // 📺 TV MODE
  if (type === "tv") {
    const seriesKey = (details.name || "")
      .toLowerCase()
      .replace(/\s/g, "_");

    return tg("sendMessage", {
      chat_id: chatId,
      text: `📺 ${details.name}`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📺 Staffel öffnen",
              callback_data: `tv_${seriesKey}`
            }
          ],
          [
            {
              text: "🏠 Menü",
              callback_data: "netflix"
            }
          ]
        ]
      }
    });
  }

  // 🎬 MOVIE MODE (🔥 DAS HAT GEFEHlt)
  saveHistory(chatId, { id, type });

  return tg("sendPhoto", {
    chat_id: chatId,
    photo: getCover(details),
    caption: buildCard(details, {}, "", id),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "▶️ Stream", url: playerUrl("str", id) },
          { text: "⬇️ Download", url: playerUrl("dl", id) }
        ],
        [
          { text: "🔥 Ähnliche", callback_data: `sim_${id}_${type}` }
        ],
        [
          { text: "🏠 Menü", callback_data: "netflix" }
        ]
      ]
    }
  });
}


// ================= SIMILAR =================
if (data.startsWith("sim_")) {
  const [, id, typeRaw] = data.split("_");
  const type = typeRaw === "tv" ? "tv" : "movie";

  const list = await getSimilar(id, type);

  global.LAST_LIST = list;
  global.LAST_HEADING = "🎬 Ähnliche:";

  return sendResultsList(chatId, global.LAST_HEADING, list, 0);
}

return; // 🔥 WICHTIG!