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
const SERIES_DB_FILE = "series.json";

const USER_STATE = {};

// ================= DB =================
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8") || "[]");
  } catch {
    return [];
  }
}

let CACHE = loadDB();

function saveDB(data) {
  CACHE = data;
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ================= SERIES =================
function loadSeriesDB() {
  if (!fs.existsSync(SERIES_DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SERIES_DB_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}

let SERIES_DB = loadSeriesDB();

function saveSeriesDB(data) {
  SERIES_DB = data;
  fs.writeFileSync(SERIES_DB_FILE, JSON.stringify(data, null, 2));
}

// ================= HISTORY =================
function saveHistory(userId, entry) {
  let h = {};
  if (fs.existsSync(HISTORY_FILE)) {
    try { h = JSON.parse(fs.readFileSync(HISTORY_FILE)); } catch {}
  }

  if (!h[userId]) h[userId] = [];

  h[userId] = [entry, ...h[userId].filter(x => x.id !== entry.id)].slice(0, 15);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
}

function readHistory(userId) {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE))[userId] || [];
}

// ================= TELEGRAM =================
async function tg(method, body) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

// ================= HELPERS =================

function getCover(data = {}) {
  if (data?.poster_path) {
    return `https://image.tmdb.org/t/p/w500${data.poster_path}`;
  }

  if (data?.backdrop_path) {
    return `https://image.tmdb.org/t/p/w500${data.backdrop_path}`;
  }

  return "https://dummyimage.com/500x750/000/fff&text=No+Image";
}

function getBanner(data = {}) {
  if(data?.backdrop_path){
    return `https://image.tmdb.org/t/p/original${data.backdrop_path}`;
  }

  if(data?.poster_path){
    return `https://image.tmdb.org/t/p/w780${data.poster_path}`;
  }

  return "https://dummyimage.com/1280x720/000/fff&text=Library+of+Legends";
}

function buildStyledCover(title){
  return `https://dummyimage.com/500x750/000/fff&text=${encodeURIComponent(title)}`;
}

const CHANNELS = {
  default: CHANNEL_ID,
  28: process.env.CHANNEL_ACTION,
  27: process.env.CHANNEL_HORROR,
  35: process.env.CHANNEL_COMEDY
};

function getTargetChannel(genres=[]){
  for(const g of genres){
    if(CHANNELS[g]) return CHANNELS[g];
  }
  return CHANNELS.default;
}

function getLocalByGenre(genreId){
  return CACHE.filter(x => x.genres?.includes(parseInt(genreId)));
}

function getLocalByGenre(genreId){
  return CACHE.filter(x => x.genres?.includes(parseInt(genreId)));
}

function parseFileName(name = "") {
  const clean = name.replace(/[._\-]+/g, " ");
  const match = clean.match(/S(\d{1,2})E(\d{1,2})/i);

  if (match) {
    return {
      type: "tv",
      title: clean.replace(match[0], "").trim(),
      season: parseInt(match[1]),
      episode: parseInt(match[2])
    };
  }

  return { type: "movie", title: clean };
}

function cleanTitleAdvanced(name = "") {
  return name
    .replace(/\.(mp4|mkv|avi)$/i, "")
    .replace(/\b(1080p|720p|2160p|4k|uhd)\b/gi, "")
    .replace(/\b(x264|x265|h264|h265)\b/gi, "")
    .replace(/\b(bluray|web|webrip|webdl)\b/gi, "")
    .replace(/\b(german|deutsch|dual|dl)\b/gi, "")
    .replace(/S\d{1,2}E\d{1,2}/gi, "")
    .replace(/[._\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectQuality(n=""){return /4k|2160/i.test(n)?"4K":/1080/.test(n)?"1080p":/720/.test(n)?"720p":"HD";}
function detectAudio(n=""){return /deutsch|german/i.test(n)?"Deutsch":"EN";}
function detectSource(n=""){return /bluray/i.test(n)?"BluRay":/web/i.test(n)?"WEB":"-";}