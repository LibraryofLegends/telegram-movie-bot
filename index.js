const fetch = global.fetch || require("node-fetch");
const express = require("express");
const fs = require("fs");

let cloudinary;

try {
  cloudinary = require("cloudinary").v2;

  cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_KEY,
    api_secret: process.env.CLOUD_SECRET
  });

} catch (err) {
  console.log("⚠️ Cloudinary nicht installiert → Fallback aktiv");
}

const app = express();
app.use(express.json());

const TOKEN = process.env.TOKEN;
const TMDB_KEY = process.env.TMDB_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const BOT_USERNAME = process.env.BOT_USERNAME || "LIBRARY_OF_LEGENDS_Bot";
const GROUP_ID = -1002008329218;

const THREADS = {
  home: 622,
  movies: 609,
  series: 611,
  trending: 612,
  action: 613,
  horror: 614,
  comedy: 615,
  drama: 616,
  scifi: 617,
  thriller: 618,
  favorites: 619,
  picks: 620,
  continue: 624,
  popular: 625
};

const SERIES_THREADS = {};

const BANNERS = {

  main: "AgACAgIAAxkBAAIIb2nztY3EVUMNWPCNUoNwNRpZgvekAAJeGWsb94aYSzrBsWsTwbUsAQADAgADdwADOwQ",

  genres: {
    28: "ACTION_FILE_ID",
    27: "HORROR_FILE_ID",
    35: "COMEDY_FILE_ID",
    18: "DRAMA_FILE_ID",
    53: "THRILLER_FILE_ID"
  }

};

const DB_FILE = "films.json";
const HISTORY_FILE = "history.json";
const SERIES_DB_FILE = "series.json";
const FAVORITES_FILE = "favorites.json";

const USER_STATE = {};
const TMDB_CACHE = {};

// ================= DB =================
function generateCategoryId(genres=[]){

  if(!genres.length) return "GEN000";

  const main = genres[0];
  const code = GENRE_CODE[main] || "GEN";

  const sameGenre = CACHE.filter(x =>
    x.genres?.includes(main)
  );

  const next = sameGenre.length + 1;

  return `${code}${String(next).padStart(3,"0")}`;
}

function generateNextId(){

  if(!CACHE.length) return "0001";

  const maxId = Math.max(
    ...CACHE.map(x => parseInt(x.display_id || "0"))
  );

  const next = maxId + 1;

  return String(next).padStart(4,"0");
}

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

function loadFavorites(){
  if (!fs.existsSync(FAVORITES_FILE)) return {};
  return JSON.parse(fs.readFileSync(FAVORITES_FILE));
}

function saveFavorites(data){
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(data, null, 2));
}

function addFavorite(userId, item){
  const fav = loadFavorites();
  if(!fav[userId]) fav[userId] = [];

  fav[userId] = [
    item,
    ...fav[userId].filter(x => x.display_id !== item.display_id)
  ].slice(0,50);

  saveFavorites(fav);
}

function getFavorites(userId){
  const fav = loadFavorites();
  return fav[userId] || [];
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

async function ensureSeriesThread(title){

  const key = title.toLowerCase().replace(/\s/g,"_");

  if(SERIES_THREADS[key]){
    return SERIES_THREADS[key];
  }

  const res = await tg("createForumTopic",{
    chat_id: GROUP_ID,
    name: `📺 ${title}`
  });

  const threadId = res.result.message_thread_id;

  SERIES_THREADS[key] = {
    main: threadId,
    seasons: {}
  };

  return SERIES_THREADS[key];
}

async function ensureSeasonThread(seriesKey, season){

  const series = SERIES_THREADS[seriesKey];

  if(series.seasons[season]){
    return series.seasons[season];
  }

  const res = await tg("createForumTopic",{
    chat_id: GROUP_ID,
    name: `📀 Staffel ${season}`
  });

  const threadId = res.result.message_thread_id;

  series.seasons[season] = threadId;

  return threadId;
}

// 🎬 NETFLIX BANNER (MIT BADGES IM BILD)
function getNetflixBannerWithBadges(data){

  const title = encodeURIComponent((data.title || data.name || "").toUpperCase());

  const rating = data.vote_average || 0;
  const votes = data.vote_count || 0;
  const popularity = data.popularity || 0;

  let badges = [];

  if(popularity > 100) badges.push("🔥 TRENDING");
  if(rating > 8) badges.push("👑 TOP RATED");
  if(votes > 1000) badges.push("🔥 BELIEBT");

  const badgeText = encodeURIComponent(badges.join(" • "));

  return `https://dummyimage.com/1280x720/000/fff&text=${badgeText}%0A%0A${title}`;
}


// 🎬 NETFLIX TEXT OVERLAY (CAPTION)
function buildNetflixBanner(data){

  const title = (data.title || data.name || "").toUpperCase();
  const year = (data.release_date || data.first_air_date || "").slice(0,4);

  const rating = data.vote_average
    ? `⭐ ${data.vote_average.toFixed(1)}`
    : "";

  let badges = [];

  if(data.popularity > 100) badges.push("🔥 TRENDING");
  if(data.vote_average > 8) badges.push("👑 TOP RATED");
  if(data.vote_count > 1000) badges.push("🔥 BELIEBT");

  const badge = badges.join(" • ");

  return `${badge}\n🎬 ${title} ${year}\n${rating}`;
}


// ================= GENRE SYSTEM =================

const GENRE_CODE = {
  28: "ACT",
  27: "HOR",
  35: "COM",
  18: "DRA",
  878: "SCI",
  53: "THR"
};

const GENRE_MAP = {
  28:"🔥 Action",
  35:"😂 Comedy",
  27:"👻 Horror",
  18:"🎭 Drama",
  878:"🚀 Sci-Fi",
  53:"🔪 Thriller"
};

function getAvailableGenres(){
  const found = new Set();

  for(const item of CACHE){
    (item.genres || []).forEach(g => found.add(g));
  }

  return Array.from(found);
}


// ================= MEDIA HELPERS =================
function getDynamicBanner(type = "main", genre = null){

  if(type === "genre" && genre && BANNERS.genres[genre]){
    return BANNERS.genres[genre];
  }

  return BANNERS.main;
}

function getCollectionHero(items){

  if(!items.length) return null;

  const first = items[0];

  return first.cover || null;
}

function getSmartLogoSettings(genres = [], rating = 0){

  // Default (balanced)
  let size = 60;
  let opacity = 35;
  let effect = "brightness:10";

  const g = genres[0];

  // 🎬 ACTION / DUNKEL
  if([28,53].includes(g)){
    opacity = 45;
    effect = "brightness:20";
  }

  // 👻 HORROR (sehr dunkel)
  if(g === 27){
    opacity = 55;
    effect = "brightness:30";
  }

  // 😂 COMEDY (hell)
  if(g === 35){
    opacity = 25;
    effect = "contrast:-20";
  }

  // 🎭 DRAMA
  if(g === 18){
    opacity = 30;
  }

  // 👑 HIGH RATING → minimal stärker
  if(rating >= 7.5){
    opacity += 5;
  }

  return {
    width: size,
    opacity,
    effect
  };
}

function getVisualStyle(genres = [], rating = 0){

  const g = genres[0];

  let style = [
    { effect: "brightness:-10" },
    { effect: "contrast:20" },
    { effect: "sharpen:50" }
  ];

  if([28,53].includes(g)){
    style = [
      { effect: "brightness:-8" },
      { effect: "contrast:30" },
      { effect: "saturation:25" },
      { effect: "colorbalance:20_red:10_blue:-10" }
    ];
  }

  if(g === 27){
    style = [
      { effect: "brightness:-30" },
      { effect: "contrast:35" },
      { effect: "saturation:-25" },
      { effect: "colorbalance:-20_red:20_blue:30" }
    ];
  }

  if(g === 35){
    style = [
      { effect: "brightness:15" },
      { effect: "contrast:15" },
      { effect: "saturation:35" }
    ];
  }

  if(g === 18){
    style = [
      { effect: "brightness:-5" },
      { effect: "contrast:18" },
      { effect: "saturation:5" }
    ];
  }

  if(rating >= 7.5){
    style.push({ effect: "glow:20" });
  }

  style.push({ effect: "vignette:40" });

  return style;
}

async function uploadToCloudinary(url, genres = [], rating = 0){

  if(!cloudinary) return url;

  try{

    // 🎬 SAFER BASE LOOK (keine riskanten Effekte)
    const baseTransform = [
  { effect: "brightness:-10" },
  { effect: "contrast:18" },
  { effect: "sharpen:40" }
];

const g = genres?.[0];

if ([28, 53].includes(g)) {
  baseTransform.push({ effect: "saturation:15" });
}

if (g === 27) {
  baseTransform.push({ effect: "saturation:-20" });
}

if (g === 35) {
  baseTransform.push({ effect: "brightness:10" });
}

if (rating >= 7.5) {
  baseTransform.push({ effect: "contrast:25" });
}
    
    const logo = getSmartLogoSettings(genres, rating);

    const res = await cloudinary.uploader.upload(url,{
      folder:"library_of_legends",

      transformation: [

  // 🎬 BASE LOOK (wird jetzt wirklich angewendet)
  ...baseTransform,

  // 🧠 LOGO OVERLAY LADEN
  {
    overlay: "library_of_legendes_logo"
  },

  // 🎯 LOGO POSITION & STYLE
  {
    width: logo.width,
    opacity: logo.opacity,
    gravity: "south_east",
    x: 40,
    y: 40,
    flags: "layer_apply"
  }

]
    });

    console.log("🖼 FINAL COVER:", res.secure_url);

    return res.secure_url;

  }catch(err){

    console.log("❌ Cloudinary Upload Fehler:", err.message);
    return url;
  }
}

function getCover(data = {}) {

  if(data?.poster_path){
    return `https://image.tmdb.org/t/p/original${data.poster_path}`;
  }

  return null;
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

  const t = encodeURIComponent(title.toUpperCase());

  return `https://image.pollinations.ai/prompt/${t}%20movie%20poster%20cinematic%20dark%20background%20glow%20high%20contrast`;
}


// ================= CHANNEL ROUTING =================

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

// ================= THREAD ROUTING =================
function getThreadByGenre(genres=[]){

  if(genres.includes(28)) return THREADS.action;
  if(genres.includes(27)) return THREADS.horror;
  if(genres.includes(35)) return THREADS.comedy;
  if(genres.includes(18)) return THREADS.drama;
  if(genres.includes(878)) return THREADS.scifi;
  if(genres.includes(53)) return THREADS.thriller;

  return THREADS.movies;
}

// ================= LOCAL FILTER =================

function getLocalByGenre(genreId){
  return CACHE.filter(x => x.genres?.includes(parseInt(genreId)));
}

function getCollectionItems(name){

  return CACHE
    .filter(x => x.collection === name)
    .sort((a,b) => {

      const orderA = a.collection_order || 0;
      const orderB = b.collection_order || 0;

      if(orderA !== orderB){
        return orderA - orderB;
      }

      return (a.title || "").localeCompare(b.title || "");
    });
}


// ================= FILE PARSER =================

function parseFileName(name = "") {

  const clean = name.replace(/[._\-]+/g, " ");

  // 🔥 SxxExx
  let match = clean.match(/S(\d{1,2})E(\d{1,2})/i);

  if (match) {
    return {
      type: "tv",
      title: clean.replace(match[0], "").trim(),
      season: parseInt(match[1]),
      episode: parseInt(match[2])
    };
  }

  // 🔥 1x02 FORMAT
  match = clean.match(/(\d{1,2})x(\d{1,2})/i);

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

function ultraCleanTitle(name = "") {

  return name

    // =============================
    // 🔥 REMOVE FILE EXTENSION
    // =============================
    .replace(/\.(mp4|mkv|avi|mov)$/i, "")

    // =============================
    // 🔥 REMOVE TELEGRAM / TAGS
    // =============================
    .replace(/@[\w\d_]+/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([^\)]*?(subs|dub|rip|1080|720)[^\)]*\)/gi, "")

    // =============================
    // 🔥 REMOVE DATES (ALLE FORMATE)
    // =============================
    .replace(/^\d{4}[.\-_ ]\d{2}[.\-_ ]\d{2}/, "")
    .replace(/^\d{2}[.\-_ ]\d{2}[.\-_ ]\d{4}/, "")
    .replace(/^\d{4}/, "")

    // =============================
    // 🔥 REMOVE RESOLUTION / CODECS
    // =============================
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd)\b/gi, "")
    .replace(/\b(x264|x265|h264|h265|hevc)\b/gi, "")
    .replace(/\b(10bit|8bit)\b/gi, "")

    // =============================
    // 🔥 REMOVE SOURCE
    // =============================
    .replace(/\b(bluray|bdrip|brrip|web[-_. ]?dl|webrip|hdrip|dvdrip)\b/gi, "")

    // =============================
    // 🔥 REMOVE AUDIO
    // =============================
    .replace(/\b(german|deutsch|english|eng|dual|dl)\b/gi, "")
    .replace(/\b(aac|dts|ac3|atmos|truehd)\b/gi, "")

    // =============================
    // 🔥 REMOVE SCENE TAGS
    // =============================
    .replace(/\b(proper|repack|extended|uncut|remastered)\b/gi, "")

    // =============================
    // 🔥 REMOVE RESOLUTION DIMENSIONS
    // =============================
    .replace(/\d{3,4}x\d{3,4}/g, "")

    // =============================
    // 🔥 REMOVE GROUP NAMES
    // =============================
    .replace(/-([A-Za-z0-9]+)$/g, "")

    // =============================
    // 🔥 NORMALIZE SEPARATORS
    // =============================
    .replace(/[._\-]+/g, " ")

    // =============================
    // 🔥 REMOVE EXTRA NUMBERS FRONT
    // =============================
    .replace(/^\d+\s+/, "")

    // =============================
    // 🔥 FINAL CLEAN
    // =============================
    .replace(/\s+/g, " ")
    .trim();
}


// ================= META DETECTION =================

function detectQuality(n=""){
  return /4k|2160/i.test(n) ? "4K"
       : /1080/.test(n) ? "1080p"
       : /720/.test(n) ? "720p"
       : "HD";
}

function detectAudio(n=""){
  return /deutsch|german/i.test(n) ? "Deutsch" : "EN";
}

function detectSource(n=""){
  return /bluray/i.test(n) ? "BluRay"
       : /web/i.test(n) ? "WEB"
       : "-";
}

// ================= EXTRA HELPERS =================
function getCollectionOrder(title = ""){

  const t = title.toLowerCase();

  let match = t.match(/(\d+)$/);
  if(match) return parseInt(match[1]);

  match = t.match(/teil\s*(\d+)/);
  if(match) return parseInt(match[1]);

  match = t.match(/part\s*(\d+)/);
  if(match) return parseInt(match[1]);

  match = t.match(/chapter\s*(\d+)/);
  if(match) return parseInt(match[1]);

  match = t.match(/kapitel\s*(\d+)/);
  if(match) return parseInt(match[1]);

  return 1;
}

function detectCollection(title = ""){

  const t = title.toLowerCase();

  const patterns = [
    { key:"john_wick", aliases:["john wick"] },
    { key:"fast_furious", aliases:["fast furious","fast and furious"] },
    { key:"harry_potter", aliases:["harry potter"] },
    { key:"batman_nolan", aliases:["dark knight","batman begins"] },
    { key:"avengers", aliases:["avengers"] }
  ];

  for(const p of patterns){
    for(const a of p.aliases){
      if(t.includes(a)){
        return p.key;
      }
    }
  }

  let base = t.replace(/(\d+)$/, "").trim();

  base = base
    .replace(/teil\s*\d+/,"")
    .replace(/part\s*\d+/,"")
    .replace(/chapter\s*\d+/,"")
    .replace(/kapitel\s*\d+/,"")
    .trim();

  if(base.length > 5){
    return base.replace(/\s+/g,"_");
  }

  return null;
}

// 🎬 DYNAMISCHE GENRE BUTTONS (AUS DEINER DB)
function buildGenreButtons(){

  const genres = getAvailableGenres();

  if(!genres.length){
    return [[{ text:"❌ Keine Genres", callback_data:"noop" }]];
  }

  return genres.map(id => ([
    {
      text: GENRE_MAP[id] || `🎬 Genre ${id}`,
      callback_data:`genre_local_${id}`
    }
  ]));
}


// 🎬 SWIPE NAVIGATION (NETFLIX STYLE)
function buildSwipeNav(id,type){

  return {
    inline_keyboard:[

      [
        {text:"⬅️",callback_data:`prev_${id}_${type}`},
        {text:"▶️ PLAY",callback_data:`play_${id}`},
        {text:"➡️",callback_data:`next_${id}_${type}`}
      ],

      [
        {text:"⭐ Favorit",callback_data:`fav_${id}`},
        {text:"🔥 Ähnliche",callback_data:`sim_${id}_${type}`}
      ],

      [
        {text:"🏠 Menü",callback_data:"menu"},
        {text:"🧠 Für dich",callback_data:"top_picks"}
      ]
    ]
  };
}


// 🎬 VIDEO PLAYER (MIT HISTORY SAVE + SAFE CHECK)
async function sendFileById(chatId,item){

  if(!item){
    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Datei nicht gefunden"
    });
  }

  // 🧠 Verlauf speichern
  saveHistory(chatId,{
  id:item.display_id,
  type:item.media_type || "movie",
  title:item.title || "",
  timestamp:Date.now()
});

  return tg("sendVideo",{
    chat_id:chatId,
    video:item.file_id,
    supports_streaming:true
  });
}

// ================= CARD =================
function buildCard(data, fileName="", id="0001", categoryId="GEN000", width=null, height=null){

  const title = (data.title || data.name || "UNBEKANNT").toUpperCase();
  const year = (data.release_date || data.first_air_date || "").slice(0,4);

  const BOLD_MAP = {
    A:"𝐀",B:"𝐁",C:"𝐂",D:"𝐃",E:"𝐄",F:"𝐅",G:"𝐆",
    H:"𝐇",I:"𝐈",J:"𝐉",K:"𝐊",L:"𝐋",M:"𝐌",N:"𝐍",
    O:"𝐎",P:"𝐏",Q:"𝐐",R:"𝐑",S:"𝐒",T:"𝐓",U:"𝐔",
    V:"𝐕",W:"𝐖",X:"𝐗",Y:"𝐘",Z:"𝐙"
  };

  const titleStyled = title
    .split("")
    .map(c => BOLD_MAP[c] || c)
    .join("");

  // 🎬 COLLECTION (optional erkennen)
  let collection = "";

if(data.belongs_to_collection?.name){
  collection = data.belongs_to_collection.name.toUpperCase();
}

  // 🎭 GENRES
  const genresArr = (data.genres || []).slice(0,2);
  const genres = genresArr.map(g => g.name).join(" • ") || "-";

  // 🎧 AUDIO
  let audio = "Unbekannt";
const name = fileName.toLowerCase();

// 🔥 PRIORITY 1: Datei enthält Info
if(/multi|dual|dl/.test(name)){
  audio = "Deutsch • Englisch";
}
else if(/deutsch|german/.test(name)){
  audio = "Deutsch";
}
else if(/english|\beng\b/.test(name)){
  audio = "Englisch";
}

// 🔥 PRIORITY 2: FALLBACK → IMMER SINNVOLL
if(audio === "Unbekannt"){
  audio = "Deutsch • Englisch"; // 🔥 besserer Default für Telegram Releases
}

  // 💿 SOURCE
  const source =
  /bluray|bdrip|brrip/i.test(fileName) ? "BluRay" :
  /web[-_. ]?dl/i.test(fileName) ? "WEB-DL" :
  /webrip/i.test(fileName) ? "WEBRip" :
  /hdrip/i.test(fileName) ? "HDRip" :
  /dvdrip/i.test(fileName) ? "DVDRip" :
  "WEB";

  // 🎞 QUALITÄT
  let quality = "HD";

// 🔥 PRIORITY 1: echte Video-Daten
if(width && height && typeof width === "number"){
  if(height >= 2160) quality = "4K";
  else if(height >= 1080) quality = "1080p";
  else if(height >= 720) quality = "720p";
}

// 🔥 PRIORITY 2: Dateiname fallback
else{
  if(/2160|4k/i.test(fileName)) quality = "4K";
  else if(/1080/i.test(fileName)) quality = "1080p";
  else if(/720/i.test(fileName)) quality = "720p";
}

  // ⭐ RATING
  const ratingValue = data.vote_average || 0;

  const stars = "★".repeat(Math.round(ratingValue / 2)) +
                "☆".repeat(5 - Math.round(ratingValue / 2));

  const rating = `⭐ ${stars} • ${ratingValue.toFixed(1)}`;

  // ⏱ LAUFZEIT
  const runtime = data.runtime ? `${data.runtime} Min` : "-";

  // 🔞 FSK
  let fsk = "-";
  try{
    const rel = data.release_dates?.results || [];
    const de = rel.find(r => r.iso_3166_1 === "DE");
    const cert = de?.release_dates?.find(x => x.certification)?.certification;
    if(cert) fsk = cert;
  }catch{}

  // 🎥 DIRECTOR
  const director = (data.credits?.crew || [])
    .find(c => c.job === "Director")?.name || "-";

  // 👥 CAST
  const cast = (data.credits?.cast || [])
    .slice(0,3)
    .map(c => c.name)
    .join(" • ") || "-";

  // 📖 STORY (SMART CUT + 2 Absätze)
  let story = (data.overview || "Keine Beschreibung verfügbar.").trim();

  if(story.length > 180){
    const mid = Math.floor(story.length / 2);
    const split = story.indexOf(".", mid);

    if(split !== -1){
      story = story.slice(0, split + 1) + "\n\n" + story.slice(split + 1);
    }
  }

  if(story.length > 320){
    story = story.slice(0, 320) + "...";
  }

  // 🏷 TAGS
  const tags = genresArr
    .map(g => `#${g.name.replace(/\s/g,"")}`)
    .join(" ");

  const line = "━━━━━━━━━━━━━━━━━━";

  return `${line}
🎬 ${titleStyled} (${year})
${collection ? `🎞 ${collection}\n` : ""}${line}
🔥 ${quality} • ${source} • ${genres}  
🎧 ${audio}  
${line}
${rating}
⏱ ${runtime} • 🔞 FSK ${fsk}  
🎥 ${director}  
👥 ${cast}  
${line}
📖 𝐒𝐓𝐎𝐑𝐘
${story}
${line}
▶️ PLAY • #${categoryId} • #${id}
${line}
${tags}
@LibraryOfLegends`;
}


// ================= PLAYER URL =================
function playerUrl(mode,id){
  return `https://t.me/${BOT_USERNAME}?start=${mode}_${id}`;
}

// ================= TMDB =================

async function tmdbFetch(url){

  try{

    // 🔥 CACHE HIT
    if(TMDB_CACHE[url]){
      return TMDB_CACHE[url];
    }

    const res = await fetch(url);

    if(!res.ok){
      console.log("❌ TMDB ERROR:", res.status, url);
      return null;
    }

    const data = await res.json();

    // 🔥 CACHE SAVE
    TMDB_CACHE[url] = data;

    return data;

  }catch(err){
    console.log("❌ TMDB FETCH FAIL:", err.message);
    return null;
  }
}

async function getDetails(id, type){

  if(!id) return null;

  const safeType = type === "tv" ? "tv" : "movie";

  return await tmdbFetch(
    `https://api.themoviedb.org/3/${safeType}/${id}?api_key=${TMDB_KEY}&append_to_response=credits,release_dates&language=de-DE`
  );
}

async function searchTMDBUltra(title, year=null, type=null){

  if(!title) return null;

  const queries = [
    title,
    title.split(" ").slice(0,3).join(" "),
    title.split(" ").slice(0,2).join(" "),
    title.split(" ")[0]
  ].filter(Boolean);

  let best = null;
  let bestScore = -999;

  for(const q of queries){

    const data = await tmdbFetch(
      `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}&language=de-DE`
    );

    if(!data?.results) continue;

    for(const item of data.results){

      if(type && item.media_type !== type) continue;

      const name = (item.title || item.name || "").toLowerCase();
      const clean = title.toLowerCase();

      let score = 0;

      if(name === clean) score += 150;
      if(name.includes(clean)) score += 80;

      const words = clean.split(" ");
      const hits = words.filter(w => name.includes(w)).length;
      score += hits * 20;

      if(year){
        const y = parseInt((item.release_date || item.first_air_date || "").slice(0,4));
        if(y){
          const diff = Math.abs(y - year);
          if(diff === 0) score += 80;
          else if(diff === 1) score += 40;
          else if(diff <= 2) score += 10;
          else score -= 50;
        }
      }

      score += Math.min(item.popularity || 0, 40);

      if(score > bestScore){
        bestScore = score;
        best = item;
      }
    }
  }

  return best;
}


// 🔥 TRENDING
async function getTrending(){
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_KEY}`
  );

  return data?.results?.slice(0,10) || [];
}


// 📈 POPULAR MOVIES
async function getPopular(){
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=de-DE`
  );

  return data?.results?.slice(0,10) || [];
}


// 🎭 GENRE DISCOVERY
async function getByGenre(genreId){

  if(!genreId) return [];

  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_genres=${genreId}&language=de-DE`
  );

  return data?.results?.slice(0,10) || [];
}


// 🔤 SORT A-Z (SAFE)
function sortAZ(list){

  if(!Array.isArray(list)) return [];

  return list.sort((a,b)=>{

    const A = (a.title || a.name || "").toLowerCase();
    const B = (b.title || b.name || "").toLowerCase();

    return A.localeCompare(B);
  });
}

// ================= NETFLIX SYSTEM =================

async function buildHomeRows(){

  return [
    {
      title:"🔥 Trending",
      data: await getTrending()
    },
    {
      title:"📈 Popular",
      data: await getPopular()
    }
  ];
}

function getSmartRecommendations(current, limit = 10){

  if(!current?.genres) return [];

  const genreIds = current.genres.map(g => g.id || g);

  const localMatches = CACHE.filter(x =>
    x.genres?.some(g => genreIds.includes(g))
  );

  return localMatches.slice(0, limit);
}

function getTopPicks(userId){

  const history = readHistory(userId);
  if(!history.length) return [];

  const genreCount = {};

  for(const h of history){
    const item = CACHE.find(x => x.display_id === h.id);
    if(!item) continue;

    for(const g of item.genres || []){
      genreCount[g] = (genreCount[g] || 0) + 1;
    }
  }

  const sortedGenres = Object.entries(genreCount)
    .sort((a,b)=>b[1]-a[1])
    .map(x => parseInt(x[0]));

  const picks = CACHE.filter(x =>
    x.genres?.some(g => sortedGenres.includes(g))
  );

  return picks.slice(0,10);
}


// 🎬 LOKALE REIHEN (AUS DEINER DB)
function buildLocalRows(){

  const genres = getAvailableGenres();
  const rows = [];

  for(const genreId of genres){

    const list = getLocalByGenre(genreId);

    // 🔥 nur anzeigen wenn sinnvoll
    if(!list || list.length < 2) continue;

    rows.push({
      title: GENRE_MAP[genreId] || `🎬 Genre ${genreId}`,
      data: list.slice(0, 10) // max 10 für Performance
    });
  }

  return rows;
}


// 🎬 NETFLIX HOME SCREEN
async function showNetflixHome(chatId){

  try{

    // ================= HERO =================
    const trending = await getTrending();

    if(!trending || !trending.length){
      return tg("sendMessage",{
        chat_id:chatId,
        text:"❌ Keine Inhalte verfügbar"
      });
    }

    const first = trending[Math.floor(Math.random() * trending.length)];

    const type = first.media_type === "tv" ? "tv" : "movie";

    const details = await getDetails(first.id, type) || first;

    const banner = details?.backdrop_path
      ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
      : getDynamicBanner("main");

    // 🎬 BIG NETFLIX HERO
    await tg("sendPhoto",{
      chat_id:chatId,
      photo:banner,
      caption: buildNetflixBanner(details),
      reply_markup:{
        inline_keyboard:[

          [
            {text:"🔍 Details",callback_data:`search_${first.id}_${type}`},
            {text:"➕ Merken",callback_data:`fav_${first.id}`}
          ],

          [
            {text:"🔥 Ähnliche",callback_data:`sim_${first.id}_${type}`}
          ],

          [
            {text:"🏠 Menü",callback_data:"menu"}
          ]
        ]
      }
    });


    // ================= TMDB REIHEN =================
    const rows = await buildHomeRows();

    if(rows && rows.length){
      for(const row of rows){
        if(row?.data?.length){
          await sendPosterRow(chatId,row.title,row.data);
        }
      }
    }


    // ================= DEINE FILME =================
    const localRows = buildLocalRows();

    if(localRows.length){

      for(const row of localRows){
        await sendPosterRow(chatId,row.title,row.data);
      }

    }else{

      await tg("sendMessage",{
        chat_id:chatId,
        text:"📂 Noch keine eigenen Filme einsortiert"
      });

    }


    // ================= FOOTER =================
    return tg("sendMessage",{
      chat_id:chatId,
      text:"🏠 Home",
      reply_markup:{
        inline_keyboard:[
          [
            {text:"🔄 Refresh",callback_data:"home"},
            {text:"🎬 Menü",callback_data:"menu"}
          ]
        ]
      }
    });

  }catch(err){

    console.log("❌ NETFLIX HOME ERROR:", err.message);

    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Fehler beim Laden der Startseite"
    });
  }
}

// ================= UI =================

async function showGenres(chatId){

  await tg("sendPhoto",{
    chat_id:chatId,
    photo:getDynamicBanner("main"),
    caption:"🎭 Kategorien"
  });

  const buttons = buildGenreButtons();

  return tg("sendMessage",{
    chat_id:chatId,
    text:"Wähle ein Genre 👇",
    reply_markup:{
      inline_keyboard:[
        ...buttons,
        [{text:"🏠 Menü",callback_data:"menu"}]
      ]
    }
  });
}

async function sendPosterRow(chatId, heading, list){

  if(!list || !list.length) return;

  await tg("sendMessage",{
    chat_id: chatId,
    text: `🔥 ${heading}`
  });

  const slice = list.slice(0,5);

  for(const item of slice){

    const title = item.title || item.name || "Film";
    const type = item.media_type || "movie";

    await tg("sendPhoto",{
      chat_id: chatId,
      photo: getCover(item),
      caption: `🎬 ${title}`,
      reply_markup:{
        inline_keyboard:[
          [
            { text:"▶️", callback_data:`search_${item.id}_${type}` },
            { text:"🔥", callback_data:`sim_${item.id}_${type}` }
          ]
        ]
      }
    });
  }
}
 
// 🎬 HAUPTMENÜ
function showMenu(chatId){

  return tg("sendPhoto",{
    chat_id:chatId,
    photo:getDynamicBanner("main"),
    caption:`🔥 𝐋𝐈𝐁𝐑𝐀𝐑𝐘 𝐎𝐅 𝐋𝐄𝐆𝐄𝐍𝐃𝐒

Dein Streaming Hub 👇`,
    reply_markup:{
      inline_keyboard:[

        [
          {text:"▶️ Weiter schauen",callback_data:"continue"}
        ],

        [
          {text:"🔥 Trending",callback_data:"net_trending"},
          {text:"📈 Popular",callback_data:"net_popular"}
        ],

        [
          {text:"🧠 Für dich",callback_data:"top_picks"},
          {text:"⭐ Favoriten",callback_data:"favorites"}
        ],

        [
          {text:"🎬 Filme",callback_data:"browse_movies"},
          {text:"📺 Serien",callback_data:"browse_series"}
        ],

        [
          {text:"🎭 Kategorien",callback_data:"open_genres"}
        ]
      ]
    }
  });
}


// 🎬 LISTEN VIEW (NETFLIX STYLE)
async function sendResultsList(chatId, heading, list, page = 0){

  if(!list || !list.length){
    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Keine Ergebnisse"
    });
  }

  const perPage = 4;
  const totalPages = Math.ceil(list.length / perPage);

  const start = page * perPage;
  const slice = list.slice(start, start + perPage);

  USER_STATE[chatId] = {
    list,
    heading,
    page
  };

  const buttons = [];

  for (let i = 0; i < slice.length; i += 2) {

    const row = [];

    const a = slice[i];
    const b = slice[i + 1];

    if (a) {
      row.push({
        text: `🎬 ${a.title || a.name}`,
        callback_data: `search_${a.id}_${a.media_type || "movie"}`
      });
    }

    if (b) {
      row.push({
        text: `🎬 ${b.title || b.name}`,
        callback_data: `search_${b.id}_${b.media_type || "movie"}`
      });
    }

    buttons.push(row);
  }

  const navRow = [];

  if(page > 0){
    navRow.push({ text:"⬅️", callback_data:`page_${page-1}` });
  }

  if(page < totalPages - 1){
    navRow.push({ text:"➡️", callback_data:`page_${page+1}` });
  }

  return tg("sendMessage",{
    chat_id:chatId,
    text:`📂 ${heading}`,
    reply_markup:{
      inline_keyboard:[
        ...buttons,
        ...(navRow.length ? [navRow] : []),
        [{text:"🏠 Menü",callback_data:"menu"}]
      ]
    }
  });
}

// ================= UPLOAD =================
async function handleUpload(msg){

  const file = msg.document || msg.video;
const width = msg.video?.width;
const height = msg.video?.height;
if(!file) return;

// 🔥 DUPLICATE CHECK (HIER HIN!)
const exists = CACHE.find(x => x.file_id === file.file_id);

if(exists){
  return tg("sendMessage",{
    chat_id: msg.chat.id,
    text: "⚠️ Datei bereits vorhanden"
  });
}

  const fileName = file.file_name || "";

  const parsed = parseFileName(fileName);
  
  const isSeries = parsed.type === "tv";

  // 🔥 JAHR EXTRAHIEREN
  const yearMatch = fileName.match(/(19|20)\d{2}/);
  const fileYear = yearMatch ? parseInt(yearMatch[0]) : null;

  // ================= TMDB MATCHING BLOCK =================

// 🔥 CLEAN TITLE
const clean = ultraCleanTitle(fileName);
console.log("🧹 CLEAN TITLE:", clean);

// 🔥 SEARCH VARIANTE (Top 3 Wörter)
const searchTitle = clean.split(" ").slice(0, 3).join(" ");

// 🔍 MAIN SEARCH
let result = null;

result = await searchTMDBUltra(
  searchTitle,
  fileYear,
  parsed.type === "tv" ? "tv" : "movie"
);

// 🔁 FALLBACK 1 (FULL)
if (!result) {
  result = await searchTMDBUltra(
    clean,
    fileYear,
    parsed.type === "tv" ? "tv" : "movie"
  );
}

// 🔁 FALLBACK 2 (SHORT)
if (!result) {
  const short = clean.split(" ").slice(0, 2).join(" ");
  result = await searchTMDBUltra(
    short,
    fileYear,
    parsed.type === "tv" ? "tv" : "movie"
  );
}

// 🔁 FALLBACK 3 (DIRECT API)
if (!result) {
  const search = await tmdbFetch(
    `https://api.themoviedb.org/3/search/${parsed.type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(clean)}&language=de-DE`
  );

  result = search?.results?.[0] || null;
}

// ❗ FINAL FAIL SAFE
if (!result) {
  console.log("❌ FINAL FAIL:", clean);
}

// ❗ DEBUG
console.log("🎯 FILE:", fileName);
console.log("🔎 CLEAN:", clean);
console.log("🎬 MATCH:", result?.title || result?.name || "NOT FOUND");

  let details = null;

  if(result?.id){
    const type =
    result.media_type === "tv" || parsed.type === "tv"
      ? "tv"
      : "movie";
    details = await getDetails(result.id, type);
  }

  const safeData = details || result || {
  title: clean,
  overview: "Keine Beschreibung verfügbar.",
  vote_average: 0,
  genres: []
};

  let genreIds = [];

if(result?.genre_ids){
  genreIds = result.genre_ids;
}else if(details?.genres){
  genreIds = details.genres.map(g => g.id);
}

// 🔥 HIER MUSS ES HIN
const id = generateNextId();
const categoryId = generateCategoryId(genreIds);

// ================= COVER =================
let cover = getCover(safeData);

if(!cover){
  cover = buildStyledCover(parsed.title);
}

cover = await uploadToCloudinary(
  cover,
  genreIds,
  safeData.vote_average || 0
);

cover += "?v=1";

// ================= CAPTION =================
const caption = buildCard(
  safeData,
  fileName,
  id,
  categoryId,
  width,
  height
);

if(isSeries){

  const cleanTitle = safeData.title || parsed.title;

  const seriesKey = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9]/g,"_");

  const seriesThread = await ensureSeriesThread(cleanTitle);

  const seasonThread = await ensureSeasonThread(
    seriesKey,
    parsed.season
  );

  if(!SERIES_DB[seriesKey]) SERIES_DB[seriesKey] = {};
  if(!SERIES_DB[seriesKey][parsed.season]) SERIES_DB[seriesKey][parsed.season] = {};

  SERIES_DB[seriesKey][parsed.season][parsed.episode] = {
    file_id: file.file_id,
    display_id: id
  };

  saveSeriesDB(SERIES_DB);

  await tg("sendPhoto",{
    chat_id: GROUP_ID,
    message_thread_id: seasonThread,
    photo: cover,
    caption: caption,
    reply_markup:{
      inline_keyboard:[
        [{ text:"▶️ Episode", callback_data:`play_${id}` }],
        [{ text:"📺 Serie", callback_data:`series_${seriesKey}` }]
      ]
    }
  });

  return;
}

  // ================= COVER FIX =================
// 🎬 COVER
let cover = getCover(safeData);

if(!cover){
  cover = buildStyledCover(parsed.title);
}

cover = await uploadToCloudinary(
  cover,
  genreIds,
  safeData.vote_average || 0
);

cover += "?v=1";

// ================= COLLECTION + ORDER =================

// 🎬 COLLECTION NAME ERMITTELN
let collectionName = null;

// 1. TMDB Collection (beste Quelle)
if (safeData.belongs_to_collection?.name) {
  collectionName = safeData.belongs_to_collection.name;
}

// 2. FALLBACK → eigene Detection
if (!collectionName) {
  collectionName = detectCollection(
    safeData.title || clean
  );
}

// 3. CLEAN (wichtig für Buttons + IDs)
if (collectionName) {
  collectionName = collectionName
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/gi, "")
    .toLowerCase();
    
    collectionName = collectionName.slice(0, 40).trim();
}

// 🔢 COLLECTION ORDER (Teil 1,2,3...)
const order = getCollectionOrder(
  safeData.title || clean
);

const item = {
  display_id: id,
  tmdb_id: result?.id || null,
  title: safeData.title || clean,
  collection: collectionName,        // ✅ HIER WIRD ES VERWENDET
  collection_order: order,           // ✅ SORTIERUNG
  category_id: categoryId,
  file_id: file.file_id,
  media_type: isSeries ? "tv" : "movie",
  genres: genreIds,
  cover: cover
};

// ✅ UND JETZT ERST SPEICHERN
CACHE.unshift(item);
saveDB(CACHE);

if(!cover || cover.includes("null")){
  cover = "https://dummyimage.com/500x750/000/fff&text=No+Image";
}

  if(!details && result){
    details = result;
  }

// 🎯 BUTTONS
const buttons = [
  [{ text:"▶️ Stream", url: playerUrl("play", id) }],
  [{ text:"🔥 Ähnliche", url: playerUrl("sim", id) }],
  [{ text:"🏠 Menü", url: `https://t.me/${BOT_USERNAME}` }]
];

if(item.collection){
  buttons.push([
    {
      text:"🎞 Collection",
      url: playerUrl("collection", item.collection)
    }
  ]);
}

// 🎯 THREAD
const threadId = isSeries
  ? THREADS.series
  : getThreadByGenre(genreIds);

// ================= SEND =================

// 📺 CHANNEL
await tg("sendPhoto",{
  chat_id: targetChannel,
  photo: cover,
  caption: caption,
  reply_markup:{
    inline_keyboard:[
      [
        {
          text:"💬 Zum Hub",
          url:"https://t.me/LibraryOfLegendsHubs"
        }
      ]
    ]
  }
});

// 💬 GROUP THREAD
await tg("sendPhoto",{
  chat_id: GROUP_ID,
  message_thread_id: threadId,
  photo: cover,
  caption: caption,
  reply_markup:{
    inline_keyboard: buttons
  }
});

  return tg("sendMessage",{
    chat_id: msg.chat.id,
    text: `✅ ${isSeries ? "Serie" : "Film"} gespeichert

🎬 ${safeData.title || clean}
🆔 ${id}`
  });
}

// ================= WEBHOOK =================
app.post(`/bot${TOKEN}`, async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  const msg = body.message;

  // 🔥 HIER EINFÜGEN
  console.log("MSG DEBUG:", JSON.stringify(msg, null, 2));

  try {

    // ================= CALLBACK =================
    if (body.callback_query) {

  const data = body.callback_query.data;
  const chatId = body.callback_query.message.chat.id;

  await tg("answerCallbackQuery", {
    callback_query_id: body.callback_query.id
  });

  // ================= BASIC NAV =================

  if (data === "home") {
    return showNetflixHome(chatId);
  }

  if (data === "net_trending") {

  const list = await getTrending();

  await tg("sendMessage",{
    chat_id: GROUP_ID,
    message_thread_id: THREADS.trending,
    text: "🔥 Trending"
  });

  return sendResultsList(
    GROUP_ID,
    "🔥 Trending",
    list,
    0
  );
}

  if (data === "net_popular") {
    return sendResultsList(chatId, "📈 Popular", await getPopular(), 0);
  }

  if (data === "browse_movies") {

  return sendResultsList(
    GROUP_ID,
    "🎬 Filme",
    CACHE,
    0
  );
}

  if (data === "browse_series") {

  const list = [];

  for (const [title, seasons] of Object.entries(SERIES_DB)) {
    for (const [season, episodes] of Object.entries(seasons)) {
      for (const [episode, data] of Object.entries(episodes)) {

        list.push({
  id: data.display_id,
  display_id: data.display_id, // 🔥 FIX
  title: `${title.replace(/_/g," ")} • S${season}E${episode}`,
  media_type: "tv"
});

      }
    }
  }

  if(!list.length){
    return tg("sendMessage",{
      chat_id: chatId,
      text: "❌ Keine Serien vorhanden"
    });
  }

  return sendResultsList(
    chatId,
    "📺 Serien",
    list,
    0
  );
}

  if (data === "menu") {
    return showMenu(chatId);
  }
  
  if (data === "open_genres") {
    return showGenres(chatId);
  }

  // ⭐ FAVORITEN
if (data === "favorites") {

  return sendResultsList(
    chatId,
    "⭐ Deine Favoriten",
    getFavorites(chatId),
    0
  );
}

// 🧠 TOP PICKS
if (data === "top_picks") {

  const picks = getTopPicks(chatId);

  if(!picks.length){
    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Noch keine Daten"
    });
  }

  return sendResultsList(
    chatId,
    "🧠 Für dich",
    picks,
    0
  );
}

// ▶️ CONTINUE
if (data === "continue") {

  const history = readHistory(chatId);

  if (!history.length) {
    return tg("sendMessage",{
      chat_id: chatId,
      text: "❌ Kein Verlauf vorhanden"
    });
  }

  const last = history[0];

  return tg("sendMessage",{
    chat_id: chatId,
    text:`▶️ Weiter schauen\n\n🎬 ${last.title || "Film"}`,
    reply_markup:{
      inline_keyboard:[
        [{ text: "▶️ Fortsetzen", callback_data: `play_${last.id}` }],
        [{ text: "🏠 Menü", callback_data: "menu" }]
      ]
    }
  });
}

  // ================= GENRE =================

  if (data.startsWith("genre_") && !data.startsWith("genre_local_")) {

  const genre = data.split("_")[1];

  await tg("sendPhoto",{
    chat_id:chatId,
    photo:getDynamicBanner("genre", genre),
    caption:`🔥 Kategorie`
  });

  return sendResultsList(
    chatId,
    "📂 Kategorie",
    await getByGenre(genre),
    0
  );
}

  if (data.startsWith("genre_local_")) {

  const genre = data.split("_")[2];

  // 🔥 BANNER SENDEN
  await tg("sendPhoto",{
    chat_id:chatId,
    photo:getDynamicBanner("genre", genre),
    caption:`🎬 ${GENRE_MAP[genre] || "Kategorie"}`
  });

  return sendResultsList(
    chatId,
    "📂 Deine Filme",
    getLocalByGenre(genre),
    0
  );
}

  if (data === "movies_az") {
    return sendResultsList(chatId, "🔤 A–Z", sortAZ(await getPopular()), 0);
  }

  // ================= PAGINATION =================

  if (data.startsWith("page_")) {
    const page = parseInt(data.split("_")[1]);
    const state = USER_STATE[chatId];
    if (!state) return;

    return sendResultsList(chatId, state.heading, state.list, page);
  }

  // ================= SIMILAR =================

  if (data.startsWith("sim_")) {

    const [, id, type] = data.split("_");

    const details = await getDetails(id, type);
    const safeData = details || {};

    const smart = getSmartRecommendations(safeData);

    if(smart.length){
      return sendResultsList(chatId, "🔥 Für dich", smart, 0);
    }

    const res = await tmdbFetch(
      `https://api.themoviedb.org/3/${type}/${id}/similar?api_key=${TMDB_KEY}`
    );

    return sendResultsList(chatId, "🔥 Ähnliche", res?.results || [], 0);
  }

  // ================= SWIPE =================

  if (data.startsWith("next_") || data.startsWith("prev_")) {

    const [dir, id, type] = data.split("_");
    const state = USER_STATE[chatId];
    if (!state) return;

    const list = state.list;
    const index = list.findIndex(x => String(x.id) === id);
    if (index === -1) return;

    const newIndex = dir === "next" ? index + 1 : index - 1;
    if (!list[newIndex]) return;

    const item = list[newIndex];
    const details = await getDetails(item.id, type);
    const safeData = details || item || {};

    return tg("sendPhoto",{
      chat_id: chatId,
      photo: getCover(safeData),
      caption: buildCard(safeData, "", item.id),
      reply_markup: buildSwipeNav(item.id, type)
    });
  }

  // ================= PLAY =================

if (data.startsWith("fav_")) {

  const id = data.replace("fav_", "");
  const item = CACHE.find(x => x.display_id === id);

  if(!item){
    return tg("sendMessage",{ chat_id:chatId, text:"❌ Nicht gefunden" });
  }

  addFavorite(chatId, item);

  return tg("sendMessage",{
    chat_id:chatId,
    text:"⭐ Zu Favoriten hinzugefügt"
  });
}

  if (data.startsWith("play_")) {

    const id = data.replace("play_", "");
    const item = CACHE.find(x => x.display_id === id);

    if(!item){
      return tg("sendMessage",{ chat_id:chatId, text:"❌ Nicht gefunden" });
    }

    await tg("sendMessage",{
      chat_id:chatId,
      text:"🎬 Starte Stream..."
    });

    return sendFileById(chatId,item);
  }
  
  // ================= SERIES SYSTEM =================

if (data.startsWith("series_")) {

  const key = data.replace("series_","");
  const series = SERIES_DB[key];

  if(!series){
    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Serie nicht gefunden"
    });
  }

  const buttons = [];

  for(const season of Object.keys(series)){
    buttons.push([
      {
        text:`📀 Staffel ${season}`,
        callback_data:`season_${key}_${season}`
      }
    ]);
  }

  return tg("sendMessage",{
    chat_id:chatId,
    text:`📺 ${key.replace(/_/g," ").toUpperCase()}`,
    reply_markup:{
      inline_keyboard:[
        ...buttons,
        [{text:"🏠 Menü",callback_data:"menu"}]
      ]
    }
  });
}

if (data.startsWith("season_")) {

  const [, key, season] = data.split("_");

  const episodes = SERIES_DB[key]?.[season];

  if(!episodes){
    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Keine Episoden"
    });
  }

  const buttons = Object.entries(episodes)
    .sort((a,b)=>a[0]-b[0])
    .map(([ep,data]) => ([
      {
        text:`▶️ Folge ${ep}`,
        callback_data:`play_${data.display_id}`
      }
    ]));

  return tg("sendMessage",{
    chat_id:chatId,
    text:`📀 Staffel ${season}`,
    reply_markup:{
      inline_keyboard:[
        ...buttons,
        [{text:"🔙 Serie",callback_data:`series_${key}`}]
      ]
    }
  });
}

  // ================= COLLECTION =================

  if (data.startsWith("collection_")) {

    const name = data.replace("collection_", "");
    const items = getCollectionItems(name);

    if(!items.length){
      return tg("sendMessage",{
        chat_id: chatId,
        text: "❌ Keine Collection gefunden"
      });
    }

    const hero = getCollectionHero(items);

    if(hero){
  await tg("sendPhoto",{
    chat_id: chatId,
    photo: hero,
    caption: `🎞 COLLECTION\n${name.toUpperCase()}`,
    reply_markup:{
      inline_keyboard:[
        [{text:"▶️ Alle abspielen", callback_data:`play_${items[0].display_id}`}]
      ]
    }
  });
}

    const featured = items[0];

    await tg("sendMessage",{
      chat_id: chatId,
      text:`⭐ Highlight\n🎬 ${featured.title}`,
      reply_markup:{
        inline_keyboard:[
          [{text:"▶️ Jetzt abspielen", callback_data:`play_${featured.display_id}`}]
        ]
      }
    });

    for(let i = 1; i < items.length; i++){

      const item = items[i];

      await tg("sendPhoto",{
        chat_id: chatId,
        photo: item.cover || "https://dummyimage.com/500x750/000/fff&text=No+Image",
        caption: `🎬 ${item.title}`,
        reply_markup:{
          inline_keyboard:[
            [{text:"▶️ Abspielen", callback_data:`play_${item.display_id}`}]
          ]
        }
      });
    }

    return tg("sendMessage",{
      chat_id: chatId,
      text:"🏠 Navigation",
      reply_markup:{
        inline_keyboard:[
          [{text:"🏠 Menü", callback_data:"menu"}]
        ]
      }
    });
  }

  // ================= SEARCH (FIXED POSITION) =================

  if (data.startsWith("search_")) {

    const [, id, type] = data.split("_");

    const details = await getDetails(id, type);
    const safeData = details || {};

    return tg("sendPhoto",{
      chat_id: chatId,
      photo: getBanner(safeData),
      caption: buildNetflixBanner(safeData),
      reply_markup: buildSwipeNav(id, type)
    });
  }

  // ✅ GANZ WICHTIG → verhindert Folgefehler
  return;
}
    
  // ================= COMMANDS =================

if (msg?.text?.startsWith("/delete")) {

  const id = msg.text.split(" ")[1];

  CACHE = CACHE.filter(x => x.display_id !== id);
  saveDB(CACHE);

  return tg("sendMessage",{
    chat_id: msg.chat.id,
    text:`🗑 Gelöscht: ${id}`
  });
}


// 🔥 HIER DEIN NEUER START BLOCK
if (msg?.text?.startsWith("/start")) {
  
  if (msg?.text === "/test") {

  return tg("sendMessage",{
    chat_id: GROUP_ID,
    message_thread_id: 609,
    text: "TEST THREAD"
  });
}

  const param = msg.text.split(" ")[1];

  console.log("START PARAM:", param); // 🔥 DEBUG

  if(param){

    const [action, id] = param.split("_");
    
    if(action === "collection"){

  const items = getCollectionItems(id);

  if(!items.length){
    return tg("sendMessage",{
      chat_id: msg.chat.id,
      text:"❌ Keine Collection gefunden"
    });
  }

  for(const item of items){
    await tg("sendPhoto",{
      chat_id: msg.chat.id,
      photo: item.cover,
      caption:`🎬 ${item.title}`,
      reply_markup:{
        inline_keyboard:[
          [{ text:"▶️ Play", callback_data:`play_${item.display_id}` }]
        ]
      }
    });
  }

  return;
}

    // ▶️ STREAM
    if(action === "play"){
      const item = CACHE.find(x => x.display_id === id);
      return sendFileById(msg.chat.id, item);
    }

    // 🔥 ÄHNLICHE
    if(action === "sim"){
      const item = CACHE.find(x => x.display_id === id);

      if(!item){
        return tg("sendMessage",{
          chat_id:msg.chat.id,
          text:"❌ Nicht gefunden"
        });
      }

      const fakeData = { genres: item.genres };
      const list = getSmartRecommendations(fakeData);

      return sendResultsList(msg.chat.id, "🔥 Ähnliche", list, 0);
    }
  }

  // 🏠 FALLBACK
  return showMenu(msg.chat.id);
}


// Upload bleibt unverändert
if (msg?.document || msg?.video) {
  return handleUpload(msg);
}

  } catch (e) {
    console.error("❌ WEBHOOK ERROR:", e.message, e.stack);
  }
});

// ================= SERVER =================
app.listen(process.env.PORT || 3000, () => {
  console.log("🔥 FULL FINAL SYSTEM RUNNING");
});