const fetch = global.fetch || require("node-fetch");
const express = require("express");
const fs = require("fs");

// 🔥 HIER EINFÜGEN
process.env.NODE_OPTIONS = "--max-old-space-size=512";

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
const MOVIE_GROUP_ID = -1002352553086;   // 🎬 deine Filmgruppe
const SERIES_GROUP_ID = -1002008329218;  // 📺 deine Seriengruppe

// ================= THREADS =================

const STATIC_THREADS = {
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

// ================= SERIES THREAD FILE =================

const SERIES_THREADS_FILE = "series_threads.json";

function loadSeriesThreads(){
  if(!fs.existsSync(SERIES_THREADS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SERIES_THREADS_FILE));
  } catch {
    return {};
  }
}

function saveSeriesThreads(data){
  fs.writeFileSync(SERIES_THREADS_FILE, JSON.stringify(data, null, 2));
}

let SERIES_THREADS = loadSeriesThreads();

// ================= BANNERS =================

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

// ================= FILES =================

const DB_FILE = "films.json";
const HISTORY_FILE = "history.json";
const SERIES_DB_FILE = "series.json";
const FAVORITES_FILE = "favorites.json";
const CONTINUE_FILE = "continue.json";

// ================= STATE =================

const USER_STATE = {};
const THREAD_LOCK = {};   // 🔥 HIER EINZUFÜGEN

const TMDB_CACHE = new Map();
const TMDB_TTL = 1000 * 60 * 60;

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

// ================= SERIES DB =================

function loadSeriesDB() {
  try {

    if (!fs.existsSync(SERIES_DB_FILE)) {
      console.log("📦 SERIES_DB_FILE nicht gefunden → erstelle neue DB");
      return {};
    }

    const raw = fs.readFileSync(SERIES_DB_FILE, "utf8");

    if (!raw || raw.trim() === "") {
      console.log("⚠️ SERIES_DB leer → starte mit leerem Objekt");
      return {};
    }

    const parsed = JSON.parse(raw);

    // Safety: nur Objekt erlauben
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      console.log("❌ SERIES_DB beschädigt → Reset");
      return {};
    }

    return parsed;

  } catch (err) {
    console.log("❌ SERIES_DB LOAD ERROR:", err.message);
    return {};
  }
}

// ================= MEMORY CACHE =================

let SERIES_DB = loadSeriesDB();

// ================= SAVE =================

function saveSeriesDB(data) {
  try {

    if (!data || typeof data !== "object") {
      console.log("❌ SERIES_DB SAVE BLOCKED (invalid data)");
      return false;
    }

    SERIES_DB = data;

    fs.writeFileSync(
      SERIES_DB_FILE,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    return true;

  } catch (err) {
    console.log("❌ SERIES_DB SAVE ERROR:", err.message);
    return false;
  }
}

// ================= HISTORY =================

function saveHistory(userId, entry) {
  let h = {};
  
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      h = JSON.parse(fs.readFileSync(HISTORY_FILE));
    } catch (e) {
      console.log("History Parse Error");
    }
  }

  if (!h[userId]) h[userId] = [];

  h[userId] = [entry, ...h[userId].filter(x => x.id !== entry.id)].slice(0, 15);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
}

function readHistory(userId) {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE))[userId] || [];
  } catch {
    return [];
  }
}

// ================= FAVORITES =================

function loadFavorites(){
  if (!fs.existsSync(FAVORITES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FAVORITES_FILE));
  } catch {
    return {};
  }
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

// ================= CONTINUE =================

function loadContinue(){
  if (!fs.existsSync(CONTINUE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONTINUE_FILE));
  } catch {
    return {};
  }
}

function saveContinue(data){
  fs.writeFileSync(CONTINUE_FILE, JSON.stringify(data, null, 2));
}

function setContinue(userId, payload){
  const data = loadContinue();
  data[userId] = payload;
  saveContinue(data);
}

function getContinue(userId){
  const data = loadContinue();
  return data[userId] || null;
}

// ================= TELEGRAM =================

async function tg(method, body) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if(!data.ok){
      console.log("❌ TG API ERROR:", data);
    }

    return data;

  } catch (err) {
    console.log("❌ TG FETCH ERROR:", err.message);
    return { ok: false };
  }
}

// ================= HELPERS =================

// 🔥 NEXT EPISODE (smart + stabil)
function getNextEpisode(seriesKey, season, episode){

  if(!seriesKey) return null;

  const s = parseInt(season);
  const e = parseInt(episode);

  const series = SERIES_DB[seriesKey];
  if(!series) return null;

  // ================= SAME SEASON =================
  const currentSeason = series[s];
  if(currentSeason){

    const nextEp = e + 1;

    if(currentSeason[nextEp]){
      return {
        season: s,
        episode: nextEp,
        data: currentSeason[nextEp]
      };
    }
  }

  // ================= NEXT SEASON =================
  const nextSeason = s + 1;
  const nextSeasonData = series[nextSeason];

  if(nextSeasonData){

    const firstEp = Object.keys(nextSeasonData)
      .map(x => parseInt(x))
      .sort((a,b)=>a-b)[0];

    if(firstEp){
      return {
        season: nextSeason,
        episode: firstEp,
        data: nextSeasonData[firstEp]
      };
    }
  }

  return null;
}


// 🔥 SORT ALL EPISODES (für später / optional)
function getSortedEpisodes(seriesKey){

  const series = SERIES_DB[seriesKey];
  if(!series) return [];

  const result = [];

  Object.keys(series)
    .map(s => parseInt(s))
    .sort((a,b)=>a-b)
    .forEach(season => {

      Object.keys(series[season])
        .map(e => parseInt(e))
        .sort((a,b)=>a-b)
        .forEach(ep => {

          result.push({
            season,
            episode: ep,
            data: series[season][ep]
          });

        });

    });

  return result;
}

// ================= TMDB =================

async function tmdbFetch(url){

  const cached = TMDB_CACHE.get(url);

  if(cached && (Date.now() - cached.time < TMDB_TTL)){
    return cached.data;
  }

  try{
    const res = await fetch(url);
    if(!res.ok) return null;

    const data = await res.json();

    TMDB_CACHE.set(url, {
      data,
      time: Date.now()
    });

    return data;

  }catch(err){
    console.log("TMDB ERROR:", err.message);
    return null;
  }
}

// ================= DETAILS =================

async function getDetails(id, type){

  if(!id) return null;

  const safeType = type === "tv" ? "tv" : "movie";

  return await tmdbFetch(
    `https://api.themoviedb.org/3/${safeType}/${id}?api_key=${TMDB_KEY}&append_to_response=credits&language=de-DE`
  );
}

// ================= EPISODE DETAILS =================

async function getEpisodeDetails(tvId, season, episode){

  if(!tvId || !season || !episode) return null;

  try {
    return await tmdbFetch(
      `https://api.themoviedb.org/3/tv/${tvId}/season/${season}/episode/${episode}?api_key=${TMDB_KEY}&language=de-DE`
    );
  } catch (err) {
    console.log("❌ EPISODE FETCH ERROR:", err.message);
    return null;
  }
}

// ================= SEARCH =================

async function searchTMDBUltra(title, year=null, type=null){

  const res = await tmdbFetch(
    `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=de-DE`
  );

  if(!res?.results) return null;

  return res.results.find(x =>
    (!type || x.media_type === type)
  ) || res.results[0];
}

// ================= DISCOVERY =================

async function getTrending(){
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_KEY}`
  );
  return data?.results?.slice(0,10) || [];
}

async function getPopular(){
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=de-DE`
  );
  return data?.results?.slice(0,10) || [];
}

async function getByGenre(genreId){
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_genres=${genreId}`
  );
  return data?.results?.slice(0,10) || [];
}

// ================= RECOMMENDATION =================

function getSmartRecommendations(current, limit = 10){

  if(!current?.genres) return [];

  const genreIds = current.genres.map(g => g.id || g);

  return CACHE.filter(x =>
    x.genres?.some(g => genreIds.includes(g))
  ).slice(0, limit);
}

function getTopPicks(userId){

  const history = readHistory(userId);
  if(!history.length) return [];

  const genres = {};

  for(const h of history){
    const item = CACHE.find(x => x.display_id === h.id);
    if(!item) continue;

    for(const g of item.genres || []){
      genres[g] = (genres[g] || 0) + 1;
    }
  }

  const sorted = Object.entries(genres)
    .sort((a,b)=>b[1]-a[1])
    .map(x => parseInt(x[0]));

  return CACHE.filter(x =>
    x.genres?.some(g => sorted.includes(g))
  ).slice(0,10);
}

// ================= UI LIST =================

async function sendResultsList(chatId, heading, list, page = 0){

  if(!list.length){
    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Keine Ergebnisse"
    });
  }

  const perPage = 4;
  const start = page * perPage;
  const slice = list.slice(start, start + perPage);

  USER_STATE[chatId] = {
    list,
    heading,
    page
  };

  const buttons = slice.map(item => ([
    {
      text:`🎬 ${item.title || item.name}`,
      callback_data:`search_${item.id}_${item.media_type || "movie"}`
    }
  ]));

  return tg("sendMessage",{
    chat_id:chatId,
    text:`📂 ${heading}`,
    reply_markup:{
      inline_keyboard:[
        ...buttons,
        [{text:"🏠 Menü",callback_data:"menu"}]
      ]
    }
  });
}

// ================= GENRES =================

async function showGenres(chatId){

  return tg("sendMessage",{
    chat_id:chatId,
    text:"🎭 Wähle Genre",
    reply_markup:{
      inline_keyboard:[
        [{text:"🔥 Action",callback_data:"genre_28"}],
        [{text:"👻 Horror",callback_data:"genre_27"}],
        [{text:"😂 Comedy",callback_data:"genre_35"}],
        [{text:"🎭 Drama",callback_data:"genre_18"}],
        [{text:"🏠 Menü",callback_data:"menu"}]
      ]
    }
  });
}

// ================= HOME =================

async function showNetflixHome(chatId){

  const list = await getTrending();

  if(!list.length){
    return tg("sendMessage",{ chat_id:chatId, text:"❌ Kein Content" });
  }

  const first = list[0];

  return tg("sendPhoto",{
    chat_id:chatId,
    photo:getBanner(first),
    caption: buildNetflixBanner(first),
    reply_markup: buildSwipeNav(first.id, first.media_type)
  });
}

// ================= NETFLIX BANNER =================

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

// ================= NETFLIX TEXT =================

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

// ================= LOGO SETTINGS =================

function getSmartLogoSettings(genres = [], rating = 0){

  let size = 60;
  let opacity = 35;
  let effect = "brightness:10";

  const g = genres[0];

  if([28,53].includes(g)){
    opacity = 45;
    effect = "brightness:20";
  }

  if(g === 27){
    opacity = 55;
    effect = "brightness:30";
  }

  if(g === 35){
    opacity = 25;
    effect = "contrast:-20";
  }

  if(g === 18){
    opacity = 30;
  }

  if(rating >= 7.5){
    opacity += 5;
  }

  return {
    width: size,
    opacity,
    effect
  };
}

// ================= VISUAL STYLE =================

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

// ================= CLOUDINARY =================

async function uploadToCloudinary(url, genres = [], rating = 0){

  if(!cloudinary) return url;

  try{

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

        ...baseTransform,

        {
          overlay: "library_of_legendes_logo"
        },

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

    if(!res?.secure_url){
      console.log("❌ CLOUDINARY NO URL");
      return url;
    }

    console.log("🖼 FINAL COVER:", res.secure_url);

    return res.secure_url;

  }catch(err){

    console.log("❌ Cloudinary Upload Fehler:", err.message);
    return url;
  }
}

// ================= COVER =================

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

function getThreadByGenre(genres = []) {

  if (!Array.isArray(genres) || genres.length === 0) {
    return STATIC_THREADS.movies;
  }

  const map = {
    28: STATIC_THREADS.action,
    27: STATIC_THREADS.horror,
    35: STATIC_THREADS.comedy,
    18: STATIC_THREADS.drama,
    878: STATIC_THREADS.scifi,
    53: STATIC_THREADS.thriller
  };

  for (const g of genres) {
    if (map[g]) return map[g];
  }

  return STATIC_THREADS.movies;
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

  let match = clean.match(/S(\d{1,2})E(\d{1,2})/i);

  if (match) {
    return {
      type: "tv",
      title: clean.replace(match[0], "").trim(),
      season: parseInt(match[1]),
      episode: parseInt(match[2])
    };
  }

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

// ================= TITLE NORMALIZER =================

function normalizeTitle(title = ""){

  let t = title.toLowerCase();

  t = t.replace(/\band\b/gi, "&");

  if(t.includes("fast") && t.includes("furious")){
    t = t.replace(/fast\s*&?\s*furious/i, "Fast & Furious");
  }

  if(t.includes("harry potter")){
    t = t.replace(/harry\s*potter/i, "Harry Potter");
  }

  if(t.includes("avengers")){
    t = t.replace(/the avengers/i, "Avengers");
  }

  return t
    .replace(/\s+/g," ")
    .trim()
    .replace(/\b\w/g, l => l.toUpperCase());
}

// ================= AI NORMALIZER =================

function aiNormalize(title = ""){

  let t = title.toLowerCase();

  t = t
    .replace(/furios/g, "furious")
    .replace(/furius/g, "furious")
    .replace(/avnger/g, "avenger")
    .replace(/avngers/g, "avengers")
    .replace(/harry poter/g, "harry potter")
    .replace(/harry pottr/g, "harry potter");

  t = t.replace(/\b(fullhd|hdrip|kino|stream|film|movie|1080p|720p|4k)\b/gi, "");

  t = t.replace(/[^\w\s]/g, " ");

  t = t.replace(/\s+/g," ").trim();

  return normalizeTitle(t);
}

// ================= FRANCHISE DETECTION =================

function detectFranchise(title = ""){

  const t = title.toLowerCase();

  if(t.includes("fast & furious")){
    return { base: "Fast & Furious" };
  }

  if(t.includes("harry potter")){
    return { base: "Harry Potter" };
  }

  if(t.includes("avengers")){
    return { base: "Avengers" };
  }

  if(t.includes("john wick")){
    return { base: "John Wick" };
  }

  return null;
}

// ================= COLLECTION SMART =================

function detectCollectionSmart(title = ""){

  const t = title.toLowerCase();

  const collections = [
    { key:"fast_furious", base:"Fast & Furious", match:["fast","furious"] },
    { key:"harry_potter", base:"Harry Potter", match:["harry","potter"] },
    { key:"avengers", base:"Avengers", match:["avengers"] },
    { key:"john_wick", base:"John Wick", match:["john","wick"] }
  ];

  for(const c of collections){
    if(c.match.every(m => t.includes(m))){
      return c.base;
    }
  }

  return null;
}

// ================= SEARCH VARIANTS =================

function buildSearchVariants(title){

  const variants = new Set();

  variants.add(title);

  const franchise = detectFranchise(title);

  if(franchise){

    variants.add(franchise.base);

    const numMatch = title.match(/(\d+)/);

    if(numMatch){
      variants.add(`${franchise.base} ${numMatch[1]}`);
      variants.add(`${franchise.base} Part ${numMatch[1]}`);
    }
  }

  variants.add(title.replace(/[^\w\s]/g,""));

  return Array.from(variants);
}

// ================= ULTRA CLEAN =================

function ultraCleanTitle(name = "") {

  return name
    .replace(/\.(mp4|mkv|avi|mov)$/i, "")
    .replace(/@[\w\d_]+/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([^\)]*?(subs|dub|rip|1080|720)[^\)]*\)/gi, "")
    .replace(/^\d{4}[.\-_ ]\d{2}[.\-_ ]\d{2}/, "")
    .replace(/^\d{2}[.\-_ ]\d{2}[.\-_ ]\d{4}/, "")
    .replace(/^\d{4}/, "")
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd)\b/gi, "")
    .replace(/\b(x264|x265|h264|h265|hevc)\b/gi, "")
    .replace(/\b(10bit|8bit)\b/gi, "")
    .replace(/\b(bluray|bdrip|brrip|web[-_. ]?dl|webrip|hdrip|dvdrip)\b/gi, "")
    .replace(/\b(german|deutsch|english|eng|dual|dl)\b/gi, "")
    .replace(/\b(aac|dts|ac3|atmos|truehd)\b/gi, "")
    .replace(/\b(proper|repack|extended|uncut|remastered)\b/gi, "")
    .replace(/\d{3,4}x\d{3,4}/g, "")
    .replace(/-([A-Za-z0-9]+)$/g, "")
    .replace(/[._\-]+/g, " ")
    .replace(/^\d+\s+/, "")
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

// ================= COLLECTION ORDER =================

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

// ================= LEGACY COLLECTION =================

function detectCollection(title = ""){

  const t = title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\w\s]/g, "");

  const patterns = [
    { key:"john_wick", aliases:["john wick"] },
    { key:"fast_furious", aliases:["fast and furious","fast furious"] },
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

  return null;
}

// ================= SWIPE NAV =================

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

// ================= VIDEO PLAYER =================

async function sendFileById(chatId,item){

  if(!item){
    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Datei nicht gefunden"
    });
  }

  // 🧠 HISTORY SAVE
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

// ================= PLAYER URL =================

function playerUrl(mode,id){
  return `https://t.me/${BOT_USERNAME}?start=${mode}_${id}`;
}

// ================= CARD =================

function buildCard(
  data,
  fileName="",
  id="0001",
  categoryId="GEN000",
  width=null,
  height=null,
  isSeries=false
){

  const titleRaw = (data.title || data.name || "UNBEKANNT");
  
  let episodeTitle = "";

if(isSeries){
  episodeTitle = data.episode_name
    ? ` • ${data.episode_name}`
    : "";
}
  const title = titleRaw.toUpperCase();

  const year = (data.release_date || data.first_air_date || "").slice(0,4);

  const isTV = isSeries || data.first_air_date;

  const line = "━━━━━━━━━━━━━━━━━━";

  // ================= STYLED TITLE =================

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

  // ================= GENRES =================

  const genresArr = (data.genres || []).slice(0,2);
  const genres = genresArr.map(g => g.name).join(" • ") || "-";

  // ================= AUDIO =================

  let audio = "Deutsch • Englisch";
  const name = fileName.toLowerCase();

  if(/deutsch|german/.test(name)) audio = "Deutsch";
  if(/english|\beng\b/.test(name)) audio = "Englisch";
  if(/multi|dual|dl/.test(name)) audio = "Deutsch • Englisch";

  // ================= SOURCE =================

  const source =
    /bluray/i.test(fileName) ? "BluRay" :
    /web[-_. ]?dl/i.test(fileName) ? "WEB-DL" :
    /webrip/i.test(fileName) ? "WEBRip" :
    "WEB";

  // ================= QUALITY =================

  let quality = "HD";

  if(width && height){
    if(height >= 2160) quality = "4K";
    else if(height >= 1080) quality = "1080p";
    else if(height >= 720) quality = "720p";
  } else {
    if(/2160|4k/i.test(fileName)) quality = "4K";
    else if(/1080/i.test(fileName)) quality = "1080p";
    else if(/720/i.test(fileName)) quality = "720p";
  }

  // ================= RATING =================

  const ratingValue = Number(
    data.episode_rating ?? data.vote_average ?? 0
  );

  const stars =
    "★".repeat(Math.round(ratingValue / 2)) +
    "☆".repeat(5 - Math.round(ratingValue / 2));

  // ================= RUNTIME =================

  const runtime = data.runtime ? `${data.runtime} Min` : "-";

  // ================= DIRECTOR =================

  const director = (data.credits?.crew || [])
    .find(c => c.job === "Director")?.name || "-";

  // ================= CREATOR (SERIES) =================

  let creator = "-";

  if(isTV){
    creator = (data.created_by || [])
      .map(c => c.name)
      .slice(0,2)
      .join(" • ") || "-";
  }

  // ================= CAST =================

  const cast = (data.credits?.cast || [])
    .slice(0,3)
    .map(c => c.name)
    .join(" • ") || "-";

  // ================= STORY =================

  let story = (
  data.episode_overview ||
  data.overview ||
  "Keine Beschreibung verfügbar."
).trim();

  if(story.length > 300){
    story = story.slice(0,300) + "...";
  }

  // ================= SERIES INFO =================

let seasonInfo = "";

if(isTV){

  const seasonNumber = data.season_number || "?";
  const totalSeasons = data.number_of_seasons || "?";

  // 🔥 Netflix Style Staffel Header
  seasonInfo = `📀 𝐒𝐓𝐀𝐅𝐅𝐄𝐋 ${seasonNumber}`;
}


// ================= TAGS =================

const tags = genresArr
  .map(g => `#${g.name.replace(/\s/g,"")}`)
  .join(" ");


// ================= FINAL =================

return `${line}
${isTV ? "📺" : "🎬"} ${titleStyled}${data.episode_code || ""}${episodeTitle}
${isTV ? seasonInfo : `(${year})`}
${line}
🔥 ${quality} • ${source} • ${genres}
🎧 ${audio}
${line}
⭐ ${stars} • ${ratingValue.toFixed(1)}
${isTV ? `🎬 ${creator}` : `🎥 ${director}`}
👥 ${cast}
${line}
📖 𝐒𝐓𝐎𝐑𝐘
${story}
${line}
${isTV ? "▶️ Staffel wählen" : `▶️ PLAY • #${categoryId} • #${id}`}
${line}
${tags}
@LibraryOfLegends`;
}

// ================= ULTRA UI =================

async function renderUltraCard(chatId, messageId, item, type, index, total){

  try {

    if(!item){
      return tg("sendMessage",{
        chat_id: chatId,
        text: "❌ Item nicht gefunden"
      });
    }

    // ================= DETAILS =================

    const details = await getDetails(
      item.tmdb_id || item.id,
      type || item.media_type || "movie"
    );

    const safeData = details || item || {};

    // ================= COVER FALLBACK =================

    const cover =
      item.cover ||
      getCover(safeData) ||
      "https://dummyimage.com/1280x720/000/fff&text=No+Image";

    // ================= CAPTION SAFE =================

    const caption = buildCard(
      safeData,
      "",
      item.display_id || "0000"
    ) || "❌ Keine Daten verfügbar";

    // ================= MESSAGE UPDATE =================

    return tg("editMessageMedia",{
      chat_id: chatId,
      message_id: messageId,

      media:{
        type: "photo",
        media: cover,
        caption: caption
      },

      reply_markup:{
        inline_keyboard:[

          // ================= NAV =================
          [
            { text:"⬅️", callback_data:`ultra_prev` },
            {
              text:`${(index ?? 0) + 1}/${total || 1}`,
              callback_data:"noop"
            },
            { text:"➡️", callback_data:`ultra_next` }
          ],

          // ================= ACTIONS =================
          [
            {
              text:"▶️ Play",
              callback_data:`play_${item.display_id}`
            },
            {
              text:"⭐ Favorit",
              callback_data:`fav_${item.display_id}`
            }
          ],

          // ================= SIMILAR =================
          [
            {
              text:"🔥 Ähnliche",
              callback_data:`sim_${item.tmdb_id || item.id || ""}_${item.media_type || type || "movie"}`
            }
          ],

          // ================= MENU =================
          [
            { text:"🏠 Menü", callback_data:"menu" }
          ]
        ]
      }

    });

  } catch (err) {

    console.log("❌ ULTRA UI ERROR:", err.message);

    return tg("sendMessage",{
      chat_id: chatId,
      text: "❌ Fehler beim Laden der Karte"
    });
  }
}

// ================= MENU =================

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

// ================= ULTRA START =================

async function startUltraUI(chatId, list){

  USER_STATE[chatId] = {
    list,
    index: 0,
    mode: "ultra"
  };

  const first = list[0];

  const msg = await tg("sendPhoto",{
    chat_id: chatId,
    photo: first.cover,
    caption: buildCard(first, "", first.display_id),
    reply_markup:{
      inline_keyboard:[

        [
          { text:"⬅️", callback_data:`ultra_prev` },
          { text:`1/${list.length}`, callback_data:"noop" },
          { text:"➡️", callback_data:`ultra_next` }
        ],

        [
          { text:"▶️ Play", callback_data:`play_${first.display_id}` },
          { text:"⭐ Favorit", callback_data:`fav_${first.display_id}` }
        ],

        [
          { text:"🔥 Ähnliche", callback_data:`sim_${first.tmdb_id}_${first.media_type}` }
        ],

        [
          { text:"🏠 Menü", callback_data:"menu" }
        ]
      ]
    }
  });

  USER_STATE[chatId].messageId = msg?.result?.message_id;
}

// ================= UPLOAD =================

async function handleUpload(msg) {
  try {

    const file = msg.document || msg.video;
    if (!file) return;

    const width = msg.video?.width;
    const height = msg.video?.height;

    // ================= DUPLICATE CHECK =================

    const exists = CACHE.find(x => x.file_id === file.file_id);

    if (exists) {
      return tg("sendMessage", {
        chat_id: msg.chat.id,
        text: "⚠️ Datei bereits vorhanden"
      });
    }

    // ================= FILE PARSE =================

    const fileName = file.file_name || "";
    const parsed = parseFileName(fileName);
    const isSeries = parsed.type === "tv";

    const clean = ultraCleanTitle(fileName);
    const yearMatch = fileName.match(/(19|20)\d{2}/);
    const fileYear = yearMatch ? parseInt(yearMatch[0]) : null;

    console.log("🧹 CLEAN:", clean);

    // ================= SEARCH PREP =================

    let fixedSearch = aiNormalize(clean)
      .replace(/s\d{1,2}e\d{1,2}/gi, "")
      .replace(/\d{1,2}x\d{1,2}/gi, "")
      .trim();

    const variants = buildSearchVariants(fixedSearch);

    let result = null;

    // ================= PRIMARY SEARCH =================

    for (const v of variants) {

      console.log("🔍 TRY:", v);

      result = await searchTMDBUltra(
        v,
        fileYear,
        isSeries ? "tv" : null
      );

      if (result) {
        console.log("✅ MATCH VIA:", v);
        break;
      }
    }

    // ================= FALLBACK =================

    if (!result) {

      console.log("🆘 FALLBACK SEARCH");

      for (const v of variants) {

        result = await searchTMDBUltra(
          v,
          fileYear,
          isSeries ? "tv" : null
        );

        if (result) break;
      }
    }

    // ================= LAST RESORT =================

    if (!result) {

      console.log("⚠️ LAST RESORT");

      const fallback = await tmdbFetch(
        `https://api.themoviedb.org/3/search/${isSeries ? "tv" : "movie"}?api_key=${TMDB_KEY}&query=${encodeURIComponent(fixedSearch)}&language=de-DE`
      );

      result = fallback?.results?.[0] || null;
    }

    console.log("🎬 FINAL:", result?.title || result?.name || "NOT FOUND");

    // ================= DETAILS =================

    let details = null;
    let episodeDetails = null;

    if (result?.id) {
      details = await getDetails(result.id, isSeries ? "tv" : "movie");
    }

    // ================= EPISODE =================

    if (isSeries && result?.id) {

      episodeDetails = await getEpisodeDetails(
        result.id,
        parsed.season,
        parsed.episode
      );

      console.log("📺 EP:", episodeDetails?.name || "N/A");
    }

    // ================= SAFE DATA =================

    const safeData = details || result || {
      title: clean,
      overview: "Keine Beschreibung verfügbar.",
      vote_average: 0,
      genres: []
    };

    // ================= GENRES =================

    let genreIds = [];

    if (result?.genre_ids) {
      genreIds = result.genre_ids;
    } else if (details?.genres) {
      genreIds = details.genres.map(g => g.id);
    }

    // ================= IDS =================

    const id = generateNextId();
    const categoryId = generateCategoryId(genreIds);

    // ================= COVER =================

    let cover = getCover(safeData);

    if (!cover) {
      cover = buildStyledCover(parsed.title);
    }

    cover = await uploadToCloudinary(
      cover,
      genreIds,
      safeData.vote_average || 0
    );

    if (!cover || cover.includes("null")) {
      cover = "https://dummyimage.com/500x750/000/fff&text=No+Image";
    }

    // ================= CAPTION =================

    const mergedData = {
      ...safeData,
      episode_name: episodeDetails?.name,
      episode_overview: episodeDetails?.overview,
      episode_rating: episodeDetails?.vote_average,
      episode_code: isSeries
        ? ` S${String(parsed.season).padStart(2, "0")}E${String(parsed.episode).padStart(2, "0")}`
        : ""
    };

    const caption = buildCard(
      mergedData,
      fileName,
      id,
      categoryId,
      width,
      height,
      isSeries
    );

    // ================= SERIES =================

    if (isSeries) {

      const cleanTitle = safeData.name || safeData.title || parsed.title;

      const seriesKey = cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_");

      const threadId = await ensureSeriesThread(seriesKey);

      if (!SERIES_DB[seriesKey]) SERIES_DB[seriesKey] = {};
      if (!SERIES_DB[seriesKey][parsed.season]) SERIES_DB[seriesKey][parsed.season] = {};

      SERIES_DB[seriesKey][parsed.season][parsed.episode] = {
        file_id: file.file_id,
        display_id: id
      };

      saveSeriesDB(SERIES_DB);

      await tg("sendVideo", {
        chat_id: SERIES_GROUP_ID,
        message_thread_id: threadId,
        video: file.file_id,
        caption: caption,
        supports_streaming: true
      });

      return tg("sendMessage", {
        chat_id: msg.chat.id,
        text: `✅ Episode gespeichert\n\n📺 ${cleanTitle}\n🆔 ${id}`
      });
    }

    // ================= MOVIE =================

    const item = {
      display_id: id,
      tmdb_id: result?.id || null,
      title: safeData.title || clean,
      category_id: categoryId,
      file_id: file.file_id,
      media_type: "movie",
      genres: genreIds,
      cover: cover
    };

    CACHE.unshift(item);
    saveDB(CACHE);

    // ================= SEND =================

    await sendToChannel({
      cover,
      caption,
      buttons: [
        [{ text: "▶️ Stream", url: playerUrl("play", id) }],
        [{ text: "🔥 Ähnliche", url: playerUrl("sim", id) }]
      ],
      genreIds
    });

    return tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `✅ Film gespeichert\n\n🎬 ${item.title}\n🆔 ${id}`
    });

  } catch (e) {
    console.error("❌ UPLOAD ERROR:", e);
  }
}

// ================= SERIES THREAD =================

async function ensureSeriesThread(seriesKey){

  if(SERIES_THREADS[seriesKey]){
    return SERIES_THREADS[seriesKey];
  }

  if(THREAD_LOCK[seriesKey]){
    return THREAD_LOCK[seriesKey];
  }

  THREAD_LOCK[seriesKey] = (async () => {

    const res = await tg("createForumTopic",{
      chat_id: SERIES_GROUP_ID,
      name: `📺 ${seriesKey.replace(/_/g," ")}`
    });

    let threadId = res?.result?.message_thread_id;

    if(!threadId){
      console.log("⚠️ Thread fallback aktiv");
      threadId = STATIC_THREADS.movies;
    }

    SERIES_THREADS[seriesKey] = threadId;
    saveSeriesThreads(SERIES_THREADS);

    delete THREAD_LOCK[seriesKey];

    return threadId;
  })();

  return THREAD_LOCK[seriesKey];
}

  // ================= SERIES SYSTEM =================

if(isSeries){

  const cleanTitle = safeData.name || safeData.title || parsed.title;

  const seriesKey = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9]/g,"_");

  // 🔥 THREAD
  const seriesThread = await ensureSeriesThread(seriesKey);

  // 🔥 SAFE INIT DB
  if(!SERIES_DB[seriesKey]) SERIES_DB[seriesKey] = {};
  if(!SERIES_DB[seriesKey][parsed.season]) SERIES_DB[seriesKey][parsed.season] = {};

  // 🔥 SPEICHERN
  SERIES_DB[seriesKey][parsed.season][parsed.episode] = {
    file_id: file.file_id,
    display_id: id
  };

  saveSeriesDB(SERIES_DB);

  // ================= OPTIONAL STAFFEL HEADER =================

  if(!SERIES_DB[seriesKey][parsed.season]._headerSent){

    await tg("sendMessage",{
      chat_id: SERIES_GROUP_ID,
      message_thread_id: seriesThread,
      text:`📀 𝐒𝐓𝐀𝐅𝐅𝐄𝐋 ${parsed.season}\n━━━━━━━━━━`
    });

    SERIES_DB[seriesKey][parsed.season]._headerSent = true;
    saveSeriesDB(SERIES_DB);
  }

  // ================= SEND VIDEO =================

  await tg("sendVideo",{
    chat_id: SERIES_GROUP_ID,
    message_thread_id: seriesThread,

    video: file.file_id,
    caption: caption,

    supports_streaming: true
  });

  return tg("sendMessage",{
    chat_id: msg.chat.id,
    text:`✅ Episode gespeichert\n\n📺 ${cleanTitle}\n🆔 ${id}`
  });
}

// ================= COLLECTION =================

let collectionName = null;

if(safeData.belongs_to_collection?.name){
  collectionName = safeData.belongs_to_collection.name;
}

if(!collectionName){
  collectionName =
    detectCollectionSmart(safeData.title || clean)
    || detectCollection(safeData.title || clean);
}

// 🔥 CLEAN NAME
if(collectionName){
  collectionName = collectionName
    .replace(/\s+/g,"_")
    .replace(/[^a-z0-9_]/gi,"")
    .toLowerCase()
    .slice(0,40)
    .trim();
}

// 🔢 ORDER
const order = getCollectionOrder(safeData.title || clean);

// 🎬 ITEM
const item = {
  display_id: id,
  tmdb_id: result?.id || null,
  title: safeData.title || clean,
  collection: collectionName,
  collection_order: order,
  category_id: categoryId,
  file_id: file.file_id,
  media_type: "movie",
  genres: genreIds,
  cover: cover
};

CACHE.unshift(item);
saveDB(CACHE);

// ================= BUTTONS =================

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

// ================= TARGET =================

async function sendToChannel({
  cover,
  caption,
  buttons,
  genreIds
}) {

  try {

    const targetChannel = getTargetChannel(genreIds);
    const threadId = getThreadByGenre(genreIds);

    return await tg("sendPhoto", {
      chat_id: targetChannel,
      message_thread_id: threadId,
      photo: cover,
      caption: caption,
      reply_markup: {
        inline_keyboard: buttons
      }
    });

  } catch (err) {
    console.log("❌ SEND CHANNEL ERROR:", err.message);
  }
}

// ================= WEBHOOK =================

app.post(`/bot${TOKEN}`, async (req, res) => {

  // 🔥 sofort ACK an Telegram (wichtig für Speed & Retry-Vermeidung)
  res.sendStatus(200);

  try {

    const body = req.body || {};
    const msg = body.message;
    const callback = body.callback_query;

    // ================= DEBUG =================

    console.log("📩 UPDATE RECEIVED:");
    console.log(JSON.stringify(body, null, 2));

    // ================= BASIC VALIDATION =================

    if (!body) {
      console.log("⚠️ EMPTY BODY RECEIVED");
      return;
    }

    // ================= STATE INIT =================

    if (!msg && !callback) {
      console.log("⚠️ NO MESSAGE OR CALLBACK");
      return;
    }

    // ================= CALLBACK =================

    if (body.callback_query) {

      const data = body.callback_query.data;
      const chatId = body.callback_query.message.chat.id;

      // 🔥 ACK (wichtig für Telegram UI)
      await tg("answerCallbackQuery", {
        callback_query_id: body.callback_query.id
      });

      // ================= ULTRA NAV =================

      if (data === "ultra_next" || data === "ultra_prev") {

        const state = USER_STATE[chatId];

        if (!state || state.mode !== "ultra") return;

        if (data === "ultra_next") {
          state.index++;
        } else {
          state.index--;
        }

        // 🔁 LOOP SAFE
        if (state.index < 0) state.index = state.list.length - 1;
        if (state.index >= state.list.length) state.index = 0;

        const item = state.list[state.index];

        return renderUltraCard(
          chatId,
          state.messageId,
          item,
          item.media_type || "movie",
          state.index,
          state.list.length
        );
      }

      // ================= BASIC NAV =================

      if (data === "home") return showNetflixHome(chatId);

      if (data === "menu") return showMenu(chatId);

      if (data === "open_genres") return showGenres(chatId);

      // ================= TRENDING =================

      if (data === "net_trending") {

  const list = await getTrending();

  const GROUP_ID = MOVIE_GROUP_ID;

  await tg("sendMessage",{
    chat_id: GROUP_ID,
    message_thread_id: STATIC_THREADS.trending,
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

      // ================= BROWSE =================

      if (data === "browse_movies") {

  const GROUP_ID = MOVIE_GROUP_ID;

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
            for (const [episode, epData] of Object.entries(episodes)) {

              list.push({
                id: epData.display_id,
                display_id: epData.display_id,
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

        return sendResultsList(chatId, "📺 Serien", list, 0);
      }

      // ================= FAVORITES =================

      if (data === "favorites") {

        return sendResultsList(
          chatId,
          "⭐ Deine Favoriten",
          getFavorites(chatId),
          0
        );
      }

      // ================= TOP PICKS =================

      if (data === "top_picks") {

        const picks = getTopPicks(chatId);

        if(!picks.length){
          return tg("sendMessage",{
            chat_id:chatId,
            text:"❌ Noch keine Daten"
          });
        }

        return sendResultsList(chatId, "🧠 Für dich", picks, 0);
      }

      // ================= CONTINUE =================

      if (data === "continue") {

        const cont = getContinue(chatId);

        if(!cont){
          return tg("sendMessage",{
            chat_id: chatId,
            text: "❌ Kein Fortschritt vorhanden"
          });
        }

        return tg("sendMessage",{
          chat_id: chatId,
          text:`▶️ Weiter schauen

📺 ${cont.seriesKey.replace(/_/g," ")}
📀 Staffel ${cont.season} • Folge ${cont.episode}`,
          reply_markup:{
            inline_keyboard:[
              [{ text:"▶️ Fortsetzen", callback_data:`play_${cont.display_id}` }],
              [{ text:"🏠 Menü", callback_data:"menu"}]
            ]
          }
        });
      }

      // ================= GENRES =================

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

      // ================= FAVORITE ADD =================

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

      // ================= PLAY =================

if (data.startsWith("play_")) {

  const id = data.replace("play_", "");

  let found = null;

  // ================= SERIES SEARCH =================
  outer:
  for(const [seriesKey, seasons] of Object.entries(SERIES_DB)){
    for(const [season, episodes] of Object.entries(seasons)){
      for(const [ep, epData] of Object.entries(episodes)){
        if(epData.display_id === id){
          found = {
            seriesKey,
            season: parseInt(season),
            episode: parseInt(ep),
            data: epData
          };
          break outer; // 🔥 sofort stoppen (Performance)
        }
      }
    }
  }

  // ================= ITEM RESOLVE =================
  let item = CACHE.find(x => x.display_id === id);

  if(found){
    item = {
      file_id: found.data.file_id,
      display_id: id,
      media_type: "tv"
    };
  }

  if(!item){
    return tg("sendMessage",{
      chat_id: chatId,
      text:"❌ Datei nicht gefunden"
    });
  }

  // ================= CONTINUE SAVE =================
  if(found){
    setContinue(chatId,{
      seriesKey: found.seriesKey,
      season: found.season,
      episode: found.episode,
      display_id: id,
      timestamp: Date.now()
    });
  }

  // ================= PLAY =================
  await tg("sendVideo",{
    chat_id: chatId,
    video: item.file_id,
    supports_streaming:true
  });

  // ================= AUTO NEXT =================
  if(found){

    const next = getNextEpisode(
      found.seriesKey,
      found.season,
      found.episode
    );

    if(next){

      const nextLabel = `S${String(next.season).padStart(2,"0")}E${String(next.episode).padStart(2,"0")}`;

      await tg("sendMessage",{
        chat_id: chatId,
        text:`➡️ Nächste Folge (${nextLabel})`,
        reply_markup:{
          inline_keyboard:[
            [{
              text:"▶️ Weiter",
              callback_data:`play_${next.data.display_id}`
            }]
          ]
        }
      });

    } else {

      await tg("sendMessage",{
        chat_id: chatId,
        text:`✅ Staffel abgeschlossen`
      });

    }
  }

  return;
}

      // ================= SERIES =================

      if (data.startsWith("series_")) {

        const key = data.replace("series_","");
        const series = SERIES_DB[key];

        if(!series){
          return tg("sendMessage",{
            chat_id:chatId,
            text:"❌ Serie nicht gefunden"
          });
        }

        const seasons = Object.keys(series);
        const buttons = [];

        const firstSeason = seasons[0];
        const firstEpisode = Object.keys(series[firstSeason])[0];

        buttons.push([
          {
            text:"▶️ Starten",
            callback_data:`play_${series[firstSeason][firstEpisode].display_id}`
          }
        ]);

        for(const season of seasons){
          buttons.push([
            {
              text:`📀 Staffel ${season}`,
              callback_data:`season_${key}_${season}`
            }
          ]);
        }

        buttons.push([{text:"🏠 Menü",callback_data:"menu"}]);

        return tg("sendMessage",{
          chat_id:chatId,
          text:`📺 ${key.replace(/_/g," ").toUpperCase()}

🔥 ${Object.keys(series).length} Staffeln verfügbar

👇 Wähle deine Staffel`,
          reply_markup:{ inline_keyboard: buttons }
        });
      }

      // ================= SEASON =================

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
          .sort((a,b)=>parseInt(a[0]) - parseInt(b[0]))
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

        return startUltraUI(chatId, items);
      }

      // ================= SEARCH =================

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

    // ================= START =================

    if (msg?.text?.startsWith("/start")) {

      const param = msg.text.split(" ")[1];

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

          return startUltraUI(msg.chat.id, items);
        }

        if(action === "play"){
          const item = CACHE.find(x => x.display_id === id);
          return sendFileById(msg.chat.id, item);
        }

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

      return showMenu(msg.chat.id);
    }

    // ================= UPLOAD =================

    if (msg?.document || msg?.video) {
      return handleUpload(msg);
    }

  } catch (e) {
    console.error("❌ WEBHOOK ERROR:", e.message, e.stack);
  }
});

// ================= GLOBAL ERROR SAFETY =================

// ❌ Unhandled Promise Errors verhindern Crash
process.on("unhandledRejection", (err) => {
  console.error("🔥 UNHANDLED REJECTION:", err);
});

// ❌ Sync Errors verhindern Crash
process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
});

// ================= HEALTH CHECK =================

app.get("/", (req, res) => {
  res.send("🔥 Library Of Legends läuft stabil");
});

// ================= START SERVER =================

const PORT = process.env.PORT || 3000;

function startServer() {

  const server = app.listen(PORT, () => {
    console.log(`
🔥 =====================================
🔥 LIBRARY OF LEGENDS ONLINE
🔥 PORT: ${PORT}
🔥 MODE: ULTRA STABLE
🔥 =====================================
`);
  });

  server.keepAliveTimeout = 120000;
  server.headersTimeout = 120000;

  return server;
}

// ================= GLOBAL SAFETY =================

process.on("unhandledRejection", (err) => {
  console.error("🔥 UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
});

// ================= SAFE START =================

startServer();