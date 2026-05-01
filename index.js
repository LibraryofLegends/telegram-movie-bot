// ================= CORE IMPORTS =================

const fetch = global.fetch || require("node-fetch");
const express = require("express");
const fs = require("fs");

// ================= APP INIT =================

const app = express();
app.use(express.json());

// ================= ENV =================

const TOKEN = process.env.TOKEN;
const TMDB_KEY = process.env.TMDB_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const BOT_USERNAME = process.env.BOT_USERNAME || "LIBRARY_OF_LEGENDS_Bot";
const GROUP_ID = -1002008329218;

// ================= CLOUDINARY =================

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

// ================= GLOBAL CONFIG =================

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

const DB_FILE = "films.json";
const HISTORY_FILE = "history.json";
const SERIES_DB_FILE = "series.json";
const FAVORITES_FILE = "favorites.json";
const CONTINUE_FILE = "continue.json";

const USER_STATE = {};
const TMDB_CACHE = {};

// ================= DB =================

// 🔢 GENERATE IDS
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


// ================= MAIN DB =================

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
    try {
      h = JSON.parse(fs.readFileSync(HISTORY_FILE));
    } catch {}
  }

  if (!h[userId]) h[userId] = [];

  h[userId] = [
    entry,
    ...h[userId].filter(x => x.id !== entry.id)
  ].slice(0, 15);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
}

function readHistory(userId) {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE))[userId] || [];
}


// ================= FAVORITES =================

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


// ================= CONTINUE WATCHING =================

function loadContinue(){
  if (!fs.existsSync(CONTINUE_FILE)) return {};
  return JSON.parse(fs.readFileSync(CONTINUE_FILE));
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
    return await res.json();
  } catch {
    return { ok: false };
  }
}

// ================= HELPERS =================

// ================= COVER / BANNER =================

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


// ================= BANNER SYSTEM =================

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


// ================= COLLECTION =================

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


// ================= TITLE CLEANING =================

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


// ================= SORT =================

function sortAZ(list){

  if(!Array.isArray(list)) return [];

  return list.sort((a,b)=>{

    const A = (a.title || a.name || "").toLowerCase();
    const B = (b.title || b.name || "").toLowerCase();

    return A.localeCompare(B);
  });
}


// ================= PLAYER =================

function playerUrl(mode,id){
  return `https://t.me/${BOT_USERNAME}?start=${mode}_${id}`;
}

// ================= TMDB =================

// 🔥 CACHE WRAPPER
async function tmdbFetch(url){

  try{

    // CACHE HIT
    if(TMDB_CACHE[url]){
      return TMDB_CACHE[url];
    }

    const res = await fetch(url);

    if(!res.ok){
      console.log("❌ TMDB ERROR:", res.status, url);
      return null;
    }

    const data = await res.json();

    // CACHE SAVE
    TMDB_CACHE[url] = data;

    return data;

  }catch(err){
    console.log("❌ TMDB FETCH FAIL:", err.message);
    return null;
  }
}


// 🎬 DETAILS (MIT CREDITS)
async function getDetails(id, type){

  if(!id) return null;

  const safeType = type === "tv" ? "tv" : "movie";

  return await tmdbFetch(
    `https://api.themoviedb.org/3/${safeType}/${id}?api_key=${TMDB_KEY}&append_to_response=credits,release_dates&language=de-DE`
  );
}


// 🔍 ULTRA SEARCH (SMART MATCH)
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


// 🔥 TRENDING (ALL)
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

// ================= ULTRA UI =================

// 🎬 RENDER (Message wird ersetzt – KEIN SPAM)
async function renderUltraCard(chatId, messageId, item, type, index, total){

  const details = await getDetails(item.id, type);
  const safeData = details || item;

  return tg("editMessageMedia",{
    chat_id: chatId,
    message_id: messageId,
    media:{
      type:"photo",
      media: getCover(safeData),
      caption: buildCard(safeData, "", item.id)
    },
    reply_markup:{
      inline_keyboard:[

        [
          { text:"⬅️", callback_data:`ultra_prev` },
          { text:`${index+1}/${total}`, callback_data:"noop" },
          { text:"➡️", callback_data:`ultra_next` }
        ],

        [
          { text:"▶️ Play", callback_data:`play_${item.id}` },
          { text:"⭐ Favorit", callback_data:`fav_${item.id}` }
        ],

        [
          { text:"🔥 Ähnliche", callback_data:`sim_${item.id}_${type}` }
        ],

        [
          { text:"🏠 Menü", callback_data:"menu" }
        ]
      ]
    }
  });
}


// 🚀 START ULTRA UI (erste Message senden)
async function startUltraUI(chatId, list){

  if(!list || !list.length){
    return tg("sendMessage",{
      chat_id: chatId,
      text:"❌ Keine Inhalte"
    });
  }

  USER_STATE[chatId] = {
    list,
    index: 0,
    mode: "ultra"
  };

  const first = list[0];
  const type = first.media_type || "movie";

  const msg = await tg("sendPhoto",{
    chat_id: chatId,
    photo: getCover(first),
    caption: buildCard(first, "", first.id),
    reply_markup:{
      inline_keyboard:[

        [
          { text:"⬅️", callback_data:`ultra_prev` },
          { text:`1/${list.length}`, callback_data:"noop" },
          { text:"➡️", callback_data:`ultra_next` }
        ],

        [
          { text:"▶️ Play", callback_data:`play_${first.id}` },
          { text:"⭐ Favorit", callback_data:`fav_${first.id}` }
        ],

        [
          { text:"🔥 Ähnliche", callback_data:`sim_${first.id}_${type}` }
        ],

        [
          { text:"🏠 Menü", callback_data:"menu" }
        ]
      ]
    }
  });

  // 🔥 WICHTIG → Message ID speichern (für Updates)
  USER_STATE[chatId].messageId = msg?.result?.message_id;
}

// ================= FEATURES =================


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


// 🎬 NETFLIX HOME
async function showNetflixHome(chatId){

  try{

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

    const rows = await buildHomeRows();

    if(rows && rows.length){
      for(const row of rows){
        if(row?.data?.length){
          await sendPosterRow(chatId,row.title,row.data);
        }
      }
    }

    const localRows = buildLocalRows();

    if(localRows.length){
      for(const row of localRows){
        await sendPosterRow(chatId,row.title,row.data);
      }
    } else {
      await tg("sendMessage",{
        chat_id:chatId,
        text:"📂 Noch keine eigenen Filme einsortiert"
      });
    }

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


// 🎬 POSTER ROW (Netflix Style Reihen)
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


// 🎬 LIST VIEW (Pagination)
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

  // ================= DUPLICATE CHECK =================
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

  // ================= CLEAN TITLE =================
  const clean = ultraCleanTitle(fileName);
  const searchTitle = clean;

  const yearMatch = fileName.match(/(19|20)\d{2}/);
  const fileYear = yearMatch ? parseInt(yearMatch[0]) : null;

  console.log("🧹 CLEAN:", clean);

  // ================= TMDB SEARCH =================

  const fixedSearch = aiNormalize(searchTitle);
  const variants = buildSearchVariants(fixedSearch);

  let result = null;

  for(const v of variants){

    console.log("🔍 TRY:", v);

    result = await searchTMDBUltra(
      v,
      fileYear,
      isSeries ? "tv" : "movie"
    );

    if(result){
      console.log("✅ MATCH VIA:", v);
      break;
    }
  }

  // FALLBACK
  if(!result){

    const fixedClean = aiNormalize(clean);
    const fallbackVariants = buildSearchVariants(fixedClean);

    for(const v of fallbackVariants){

      console.log("🆘 FALLBACK TRY:", v);

      result = await searchTMDBUltra(
        v,
        fileYear,
        isSeries ? "tv" : "movie"
      );

      if(result){
        console.log("✅ FALLBACK MATCH VIA:", v);
        break;
      }
    }
  }

  // LAST RESORT
  if(!result){

    console.log("⚠️ LAST RESORT SEARCH");

    const fallback = await tmdbFetch(
      `https://api.themoviedb.org/3/search/${isSeries ? "tv" : "movie"}?api_key=${TMDB_KEY}&query=${encodeURIComponent(clean)}&language=de-DE`
    );

    result = fallback?.results?.[0] || null;
  }

  console.log("🎬 FINAL MATCH:", result?.title || result?.name || "NOT FOUND");

  // ================= DETAILS =================
  let details = null;

  if(result?.id){
    details = await getDetails(result.id, isSeries ? "tv" : "movie");
  }

  const safeData = details || result || {
    title: clean,
    overview: "Keine Beschreibung verfügbar.",
    vote_average: 0,
    genres: []
  };

  // ================= GENRES =================
  let genreIds = [];

  if(result?.genre_ids){
    genreIds = result.genre_ids;
  } else if(details?.genres){
    genreIds = details.genres.map(g => g.id);
  }

  // ================= IDS =================
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

  if(!cover || cover.includes("null")){
    cover = "https://dummyimage.com/500x750/000/fff&text=No+Image";
  }

  // ================= CAPTION =================
  const caption = buildCard(
    safeData,
    fileName,
    id,
    categoryId,
    width,
    height,
    isSeries
  );

  // ================= SERIES =================
  if(isSeries){

    const cleanTitle = safeData.title || parsed.title;

    const seriesKey = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]/g,"_");

    const seriesThread = await ensureSeriesThread(seriesKey);
    const seasonThread = await ensureSeasonThread(seriesKey, parsed.season);

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

    return tg("sendMessage",{
      chat_id: msg.chat.id,
      text:`✅ Episode gespeichert\n\n🎬 ${safeData.title}\n🆔 ${id}`
    });
  }

  // ================= COLLECTION =================
  let collectionName = null;

  if(safeData.belongs_to_collection?.name){
    collectionName = safeData.belongs_to_collection.name;
  }

  if(!collectionName){
    collectionName =
      detectCollectionSmart(safeData.title || clean) ||
      detectCollection(safeData.title || clean);
  }

  if(collectionName){
    collectionName = collectionName
      .replace(/\s+/g,"_")
      .replace(/[^a-z0-9_]/gi,"")
      .toLowerCase()
      .slice(0,40)
      .trim();
  }

  const order = getCollectionOrder(safeData.title || clean);

  const item = {
    display_id: id,
    tmdb_id: result?.id || null,
    title: safeData.title || clean,
    collection: collectionName,
    collection_order: order,
    category_id: categoryId,
    file_id: file.file_id,
    media_type: isSeries ? "tv" : "movie",
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

  const targetChannel = getTargetChannel(genreIds);
  const threadId = getThreadByGenre(genreIds);

  // ================= SEND =================

  await tg("sendPhoto",{
    chat_id: targetChannel,
    photo: cover,
    caption: caption
  });

  await tg("sendPhoto",{
    chat_id: GROUP_ID,
    message_thread_id: threadId,
    photo: cover,
    caption: caption,
    reply_markup:{ inline_keyboard: buttons }
  });

  return tg("sendMessage",{
    chat_id: msg.chat.id,
    text:`✅ Film gespeichert\n\n🎬 ${safeData.title}\n🆔 ${id}`
  });
}

// ================= WEBHOOK =================

app.post(`/bot${TOKEN}`, async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  const msg = body.message;

  console.log("MSG DEBUG:", JSON.stringify(msg, null, 2));

  try {

    // ================= CALLBACK =================
    if (body.callback_query) {

      const data = body.callback_query.data;
      const chatId = body.callback_query.message.chat.id;

      await tg("answerCallbackQuery", {
        callback_query_id: body.callback_query.id
      });

      // ================= ULTRA UI =================
      if (data === "ultra_next" || data === "ultra_prev") {

        const state = USER_STATE[chatId];
        if (!state || state.mode !== "ultra") return;

        if (data === "ultra_next") state.index++;
        else state.index--;

        if (state.index < 0) state.index = 0;
        if (state.index >= state.list.length) state.index = state.list.length - 1;

        const item = state.list[state.index];
        const type = item.media_type || "movie";

        return renderUltraCard(
          chatId,
          state.messageId,
          item,
          type,
          state.index,
          state.list.length
        );
      }

      // ================= NAV =================
      if (data === "home") return showNetflixHome(chatId);
      if (data === "menu") return showMenu(chatId);

      if (data === "net_trending") {
        return sendResultsList(chatId, "🔥 Trending", await getTrending(), 0);
      }

      if (data === "net_popular") {
        return sendResultsList(chatId, "📈 Popular", await getPopular(), 0);
      }

      if (data === "browse_movies") {
        return sendResultsList(chatId, "🎬 Filme", CACHE, 0);
      }

      if (data === "browse_series") {

        const list = [];

        for (const [title, seasons] of Object.entries(SERIES_DB)) {
          for (const [season, episodes] of Object.entries(seasons)) {
            for (const [episode, data] of Object.entries(episodes)) {
              list.push({
                id: data.display_id,
                display_id: data.display_id,
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
        return sendResultsList(chatId, "⭐ Favoriten", getFavorites(chatId), 0);
      }

      if (data.startsWith("fav_")) {

        const id = data.replace("fav_", "");
        const item = CACHE.find(x => x.display_id === id);

        if(!item){
          return tg("sendMessage",{ chat_id:chatId, text:"❌ Nicht gefunden" });
        }

        addFavorite(chatId, item);

        return tg("sendMessage",{
          chat_id:chatId,
          text:"⭐ Gespeichert"
        });
      }

      // ================= PLAY =================
      if (data.startsWith("play_")) {

        const id = data.replace("play_", "");

        let item = CACHE.find(x => x.display_id === id);

        if(!item){
          return tg("sendMessage",{ chat_id:chatId, text:"❌ Nicht gefunden" });
        }

        return tg("sendVideo", {
          chat_id: chatId,
          video: item.file_id,
          supports_streaming: true
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

        await startUltraUI(chatId, items);
        return;
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
          if(!item) return;

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

// ================= SERVER =================

app.listen(process.env.PORT || 3000, () => {
  console.log("🔥 BOT RUNNING");
});