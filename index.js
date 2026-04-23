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