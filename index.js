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

// ================= CARD =================
function buildCard(data, fileName="", id="0001"){

  const title = (data.title || data.name || "UNBEKANNT").toUpperCase();
  const year = (data.release_date || data.first_air_date || "").slice(0,4);

  const genres = (data.genres || [])
    .slice(0,2)
    .map(g => g.name)
    .join(" • ");

  const cast = (data.credits?.cast || [])
    .slice(0,3)
    .map(c => c.name)
    .join(" • ") || "-";

  const rating = data.vote_average
    ? `⭐ ${Math.round(data.vote_average / 2)} / 5 (${data.vote_average.toFixed(1)})`
    : "⭐ -";

  // 🔞 FSK
  let fsk = "-";
  try{
    const rel = data.release_dates?.results || [];
    const de = rel.find(r => r.iso_3166_1 === "DE");
    const cert = de?.release_dates?.find(x => x.certification)?.certification;
    if(cert) fsk = cert;
  }catch{}

  const storyRaw = data.overview || "Keine Beschreibung verfügbar.";
  let story = storyRaw.trim();

  if (story.length > 220) {
    story = story.slice(0, 220);
    const cut = story.lastIndexOf(".");
    if (cut > 100) story = story.slice(0, cut + 1);
    story += "...";
  }

  const quality = detectQuality(fileName);
  const audio = detectAudio(fileName);
  const source = detectSource(fileName);

  const tags = (data.genres || [])
    .slice(0,3)
    .map(g => `#${g.name.replace(/\s/g,"")}`)
    .join(" ");

  const LINE = "━━━━━━━━━━━━━━━━━━";
  const SOFT = "──────────────";

  return `${LINE}
🎬 𝐋𝐈𝐁𝐑𝐀𝐑𝐘 𝐎𝐅 𝐋𝐄𝐆𝐄𝐍𝐃𝐒
${title}${year ? ` (${year})` : ""}
${SOFT}
🔥 ${quality} • ${genres || "-"}
🎧 ${audio} • 💿 ${source}
${LINE}
${rating}
⛔ FSK ${fsk}
👥 ${cast}
${LINE}
📖 HANDLUNG
${story}
${LINE}
▶️ #${id}
${SOFT}
${tags}
@LibraryOfLegends`;
}

function playerUrl(mode,id){
  return `https://t.me/${BOT_USERNAME}?start=${mode}_${id}`;
}

// ================= TMDB =================
async function tmdbFetch(url){
  try{
    const res = await fetch(url);
    return await res.json();
  }catch{return null;}
}

async function searchTMDB(title){

  const variants = [
    title,
    title.split(" ").slice(0,3).join(" "),
    title.split(" ").slice(0,2).join(" "),
    title.split(" ")[0]
  ].filter(x => x && x.length > 2);

  for(const q of variants){

    const data = await tmdbFetch(
      `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}&language=de-DE`
    );

    if(data?.results?.length){
      return data.results[0];
    }
  }

  return null;
}

async function getDetails(id,type){
  return await tmdbFetch(
    `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&append_to_response=credits,release_dates&language=de-DE`
  );
}

async function getTrending(){
  const data = await tmdbFetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_KEY}`);
  return data?.results?.slice(0,10) || [];
}

async function getPopular(){
  const data = await tmdbFetch(`https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}`);
  return data?.results?.slice(0,10) || [];
}

async function getByGenre(genreId){
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_genres=${genreId}`
  );
  return data?.results?.slice(0,10) || [];
}

function sortAZ(list){
  return list.sort((a,b)=>{
    const A = (a.title || a.name || "").toLowerCase();
    const B = (b.title || b.name || "").toLowerCase();
    return A.localeCompare(B);
  });
}