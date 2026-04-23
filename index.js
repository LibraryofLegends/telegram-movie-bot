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