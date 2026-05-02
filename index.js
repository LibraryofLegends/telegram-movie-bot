// ================= IMPORTS =================
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

// ================= APP INIT =================
const app = express();
app.use(express.json());

// ================= ENV =================
const TOKEN = process.env.TOKEN;
const TMDB_KEY = process.env.TMDB_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const BOT_USERNAME = process.env.BOT_USERNAME || "LIBRARY_OF_LEGENDS_Bot";
const GROUP_ID = -1002008329218;

// ================= THREADS =================
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

// ================= FILES =================
const DB_FILE = "films.json";
const SERIES_DB_FILE = "series.json";
const HISTORY_FILE = "history.json";
const FAVORITES_FILE = "favorites.json";
const CONTINUE_FILE = "continue.json";
const SERIES_THREADS_FILE = "series_threads.json";

// ================= STATE =================
const USER_STATE = {};
const TMDB_CACHE = {};

// ================= LOAD / SAVE =================
function safeReadJSON(file, fallback){
  if(!fs.existsSync(file)) return fallback;
  try{
    return JSON.parse(fs.readFileSync(file, "utf8") || JSON.stringify(fallback));
  }catch{
    return fallback;
  }
}

function safeWriteJSON(file, data){
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ================= FILM DB =================
let CACHE = safeReadJSON(DB_FILE, []);

function saveDB(data){
  CACHE = data;
  safeWriteJSON(DB_FILE, data);
}

// ================= SERIES DB =================
let SERIES_DB = safeReadJSON(SERIES_DB_FILE, {});

function saveSeriesDB(data){
  SERIES_DB = data;
  safeWriteJSON(SERIES_DB_FILE, data);
}

// ================= SERIES THREADS =================
let SERIES_THREADS = safeReadJSON(SERIES_THREADS_FILE, {});

function saveSeriesThreads(data){
  SERIES_THREADS = data;
  safeWriteJSON(SERIES_THREADS_FILE, data);
}

// ================= HISTORY =================
function saveHistory(userId, entry){

  let h = safeReadJSON(HISTORY_FILE, {});

  if(!h[userId]) h[userId] = [];

  h[userId] = [
    entry,
    ...h[userId].filter(x => x.id !== entry.id)
  ].slice(0,15);

  safeWriteJSON(HISTORY_FILE, h);
}

function readHistory(userId){
  const h = safeReadJSON(HISTORY_FILE, {});
  return h[userId] || [];
}

// ================= FAVORITES =================
function loadFavorites(){
  return safeReadJSON(FAVORITES_FILE, {});
}

function saveFavorites(data){
  safeWriteJSON(FAVORITES_FILE, data);
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
  return safeReadJSON(CONTINUE_FILE, {});
}

function saveContinue(data){
  safeWriteJSON(CONTINUE_FILE, data);
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
async function tg(method, body){

  try{
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if(!data.ok){
      console.log("❌ TG ERROR:", data);
    }

    return data;

  }catch(err){
    console.log("❌ TG FETCH FAIL:", err.message);
    return { ok:false };
  }
}

// ================= SERIES HELPERS =================
function getNextEpisode(seriesKey, season, episode){

  const eps = SERIES_DB[seriesKey]?.[season];
  if(!eps) return null;

  const nextEp = parseInt(episode) + 1;

  if(eps[nextEp]){
    return {
      season,
      episode: nextEp,
      data: eps[nextEp]
    };
  }

  const nextSeason = parseInt(season) + 1;
  const nextSeasonData = SERIES_DB[seriesKey]?.[nextSeason];

  if(nextSeasonData){

    const firstEp = Object.keys(nextSeasonData)
      .map(x => parseInt(x))
      .sort((a,b)=>a-b)[0];

    return {
      season: nextSeason,
      episode: firstEp,
      data: nextSeasonData[firstEp]
    };
  }

  return null;
}

// ================= THREAD CREATION =================
async function ensureSeriesThread(seriesKey){

  if(SERIES_THREADS[seriesKey]){
    return SERIES_THREADS[seriesKey];
  }

  const res = await tg("createForumTopic",{
    chat_id: GROUP_ID,
    name: `📺 ${seriesKey.replace(/_/g," ")}`
  });

  const threadId = res?.result?.message_thread_id;

  if(!threadId){
    console.log("❌ Series Thread Error");
    return null;
  }

  SERIES_THREADS[seriesKey] = {
    main: threadId,
    seasons: {}
  };

  saveSeriesThreads(SERIES_THREADS);

  return SERIES_THREADS[seriesKey];
}

async function ensureSeasonThread(seriesKey, season){

  if(!SERIES_THREADS[seriesKey]){
    SERIES_THREADS[seriesKey] = {
      main:null,
      seasons:{}
    };
  }

  const series = SERIES_THREADS[seriesKey];

  if(series.seasons[season]){
    return series.seasons[season];
  }

  const res = await tg("createForumTopic",{
    chat_id: GROUP_ID,
    name: `📀 Staffel ${season}`
  });

  const threadId = res?.result?.message_thread_id;

  if(!threadId){
    console.log("❌ Season Thread Error");
    return null;
  }

  series.seasons[season] = threadId;

  saveSeriesThreads(SERIES_THREADS);

  return threadId;
}

// ================= TMDB CORE =================

async function tmdbFetch(url){

  try{

    if(TMDB_CACHE[url]){
      return TMDB_CACHE[url];
    }

    const res = await fetch(url);

    if(!res.ok){
      console.log("❌ TMDB ERROR:", res.status, url);
      return null;
    }

    const data = await res.json();

    TMDB_CACHE[url] = data;

    return data;

  }catch(err){
    console.log("❌ TMDB FETCH FAIL:", err.message);
    return null;
  }
}

// ================= DETAILS =================
async function getDetails(id, type){

  if(!id) return null;

  const safeType = type === "tv" ? "tv" : "movie";

  return await tmdbFetch(
    `https://api.themoviedb.org/3/${safeType}/${id}?api_key=${TMDB_KEY}&append_to_response=credits,release_dates&language=de-DE`
  );
}

// ================= ULTRA SEARCH =================
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

// ================= TRENDING =================
async function getTrending(){
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_KEY}`
  );
  return data?.results?.slice(0,10) || [];
}

// ================= POPULAR =================
async function getPopular(){
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=de-DE`
  );
  return data?.results?.slice(0,10) || [];
}

// ================= GENRE =================
async function getByGenre(genreId){

  if(!genreId) return [];

  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_genres=${genreId}&language=de-DE`
  );

  return data?.results?.slice(0,10) || [];
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

// ================= AI CLEAN =================
function aiNormalize(title = ""){

  let t = title.toLowerCase();

  t = t
    .replace(/furios/g, "furious")
    .replace(/furius/g, "furious")
    .replace(/avnger/g, "avenger")
    .replace(/avngers/g, "avengers")
    .replace(/harry poter/g, "harry potter");

  t = t.replace(/\b(fullhd|hdrip|kino|stream|film|movie|1080p|720p|4k)\b/gi, "");

  t = t.replace(/[^\w\s]/g, " ");

  t = t.replace(/\s+/g," ").trim();

  return normalizeTitle(t);
}

// ================= CLEAN TITLE =================
function ultraCleanTitle(name = "") {

  return name
    .replace(/\.(mp4|mkv|avi|mov)$/i, "")
    .replace(/@[\w\d_]+/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([^\)]*?(subs|dub|rip|1080|720)[^\)]*\)/gi, "")
    .replace(/^\d{4}/, "")
    .replace(/\b(2160p|1080p|720p|4k|uhd)\b/gi, "")
    .replace(/\b(x264|x265|h264|h265|hevc)\b/gi, "")
    .replace(/\b(bluray|bdrip|webrip|hdrip)\b/gi, "")
    .replace(/\b(german|deutsch|dual|dl)\b/gi, "")
    .replace(/[._\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ================= VARIANTS =================
function buildSearchVariants(title){

  const variants = new Set();

  variants.add(title);

  const numMatch = title.match(/(\d+)/);

  if(numMatch){
    variants.add(`${title} ${numMatch[1]}`);
    variants.add(`${title} Part ${numMatch[1]}`);
  }

  variants.add(title.replace(/[^\w\s]/g,""));

  return Array.from(variants);
}

// ================= FRANCHISE =================
function detectFranchise(title = ""){

  const t = title.toLowerCase();

  if(t.includes("fast & furious")) return { base:"Fast & Furious" };
  if(t.includes("harry potter")) return { base:"Harry Potter" };
  if(t.includes("avengers")) return { base:"Avengers" };
  if(t.includes("john wick")) return { base:"John Wick" };

  return null;
}

// ================= COLLECTION SMART =================
function detectCollectionSmart(title = ""){

  const t = title.toLowerCase();

  const collections = [
    { key:"fast_furious", match:["fast","furious"] },
    { key:"harry_potter", match:["harry","potter"] },
    { key:"avengers", match:["avengers"] },
    { key:"john_wick", match:["john","wick"] }
  ];

  for(const c of collections){
    if(c.match.every(m => t.includes(m))){
      return c.key;
    }
  }

  return null;
}

// ================= COLLECTION =================
function detectCollection(title = ""){

  const t = title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\w\s]/g, "");

  const patterns = [
    { key:"john_wick", aliases:["john wick"] },
    { key:"fast_furious", aliases:["fast and furious"] },
    { key:"harry_potter", aliases:["harry potter"] },
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

  return 1;
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

// ================= IDS =================

function generateNextId(){

  if(!CACHE.length) return "0001";

  const maxId = Math.max(
    ...CACHE.map(x => parseInt(x.display_id || "0"))
  );

  return String(maxId + 1).padStart(4,"0");
}

function generateCategoryId(genres=[]){

  if(!genres.length) return "GEN000";

  const main = genres[0];
  const code = GENRE_CODE[main] || "GEN";

  const same = CACHE.filter(x =>
    x.genres?.includes(main)
  );

  const next = same.length + 1;

  return `${code}${String(next).padStart(3,"0")}`;
}

// ================= MEDIA =================

function getCover(data = {}){

  if(data?.poster_path){
    return `https://image.tmdb.org/t/p/original${data.poster_path}`;
  }

  return null;
}

function getBanner(data = {}){

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

  return `https://image.pollinations.ai/prompt/${t}%20movie%20poster%20cinematic%20dark%20background`;
}

// ================= CLOUDINARY =================

async function uploadToCloudinary(url, genres = [], rating = 0){

  if(!cloudinary) return url;

  try{

    const transform = [
      { effect: "brightness:-10" },
      { effect: "contrast:18" },
      { effect: "sharpen:40" }
    ];

    if([28,53].includes(genres[0])){
      transform.push({ effect: "saturation:15" });
    }

    if(genres[0] === 27){
      transform.push({ effect: "saturation:-20" });
    }

    if(rating >= 7.5){
      transform.push({ effect: "contrast:25" });
    }

    const res = await cloudinary.uploader.upload(url,{
      folder:"library_of_legends",
      transformation: transform
    });

    return res.secure_url;

  }catch(err){
    console.log("❌ Cloudinary:", err.message);
    return url;
  }
}

// ================= NETFLIX BANNER =================

function buildNetflixBanner(data){

  const title = (data.title || data.name || "").toUpperCase();
  const year = (data.release_date || data.first_air_date || "").slice(0,4);

  const rating = data.vote_average
    ? `⭐ ${data.vote_average.toFixed(1)}`
    : "";

  return `🎬 ${title} ${year}\n${rating}`;
}

// ================= CARD =================

function buildCard(data, fileName="", id="0001", categoryId="GEN000", width=null, height=null, isSeries=false){

  const titleRaw = (data.title || data.name || "UNBEKANNT");
  const title = titleRaw.toUpperCase();

  const year = (data.release_date || data.first_air_date || "").slice(0,4);

  const genresArr = (data.genres || []).slice(0,2);
  const genres = genresArr.map(g => g.name).join(" • ") || "-";

  let quality = "HD";

  if(height){
    if(height >= 2160) quality = "4K";
    else if(height >= 1080) quality = "1080p";
    else if(height >= 720) quality = "720p";
  }

  const rating = data.vote_average || 0;

  const stars = "★".repeat(Math.round(rating / 2)) +
                "☆".repeat(5 - Math.round(rating / 2));

  const story = (data.overview || "Keine Beschreibung").slice(0,300);

  return `━━━━━━━━━━━━━━━━━━
🎬 ${title} (${year})
━━━━━━━━━━━━━━━━━━
🔥 ${quality} • ${genres}
━━━━━━━━━━━━━━━━━━
⭐ ${stars} • ${rating.toFixed(1)}
━━━━━━━━━━━━━━━━━━
📖 ${story}
━━━━━━━━━━━━━━━━━━
▶️ PLAY • #${categoryId} • #${id}
━━━━━━━━━━━━━━━━━━
@LibraryOfLegends`;
}

// ================= NAV =================

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
        {text:"🏠 Menü",callback_data:"menu"}
      ]
    ]
  };
}

// ================= POSTER ROW =================

async function sendPosterRow(chatId, heading, list){

  if(!list?.length) return;

  await tg("sendMessage",{
    chat_id:chatId,
    text:`🔥 ${heading}`
  });

  for(const item of list.slice(0,5)){

    const title = item.title || item.name || "Film";
    const type = item.media_type || "movie";

    await tg("sendPhoto",{
      chat_id:chatId,
      photo:getCover(item),
      caption:`🎬 ${title}`,
      reply_markup:{
        inline_keyboard:[
          [
            {text:"▶️",callback_data:`search_${item.id}_${type}`},
            {text:"🔥",callback_data:`sim_${item.id}_${type}`}
          ]
        ]
      }
    });
  }
}

// ================= HOME =================

async function showNetflixHome(chatId){

  const trending = await getTrending();

  if(!trending.length){
    return tg("sendMessage",{ chat_id:chatId, text:"❌ Keine Daten" });
  }

  const first = trending[0];
  const type = first.media_type === "tv" ? "tv" : "movie";

  const details = await getDetails(first.id, type) || first;

  await tg("sendPhoto",{
    chat_id:chatId,
    photo:getBanner(details),
    caption:buildNetflixBanner(details),
    reply_markup:{
      inline_keyboard:[
        [
          {text:"🔍 Details",callback_data:`search_${first.id}_${type}`}
        ]
      ]
    }
  });

  const rows = [
    {title:"🔥 Trending", data: trending},
    {title:"📈 Popular", data: await getPopular()}
  ];

  for(const row of rows){
    await sendPosterRow(chatId, row.title, row.data);
  }

  return tg("sendMessage",{
    chat_id:chatId,
    text:"🏠 Home",
    reply_markup:{
      inline_keyboard:[
        [{text:"🔄 Refresh",callback_data:"home"}],
        [{text:"🎬 Menü",callback_data:"menu"}]
      ]
    }
  });
}

// ================= MENU =================

function showMenu(chatId){

  return tg("sendPhoto",{
    chat_id:chatId,
    photo:getBanner({}),
    caption:"🔥 LIBRARY OF LEGENDS",
    reply_markup:{
      inline_keyboard:[
        [
          {text:"🔥 Trending",callback_data:"net_trending"},
          {text:"📈 Popular",callback_data:"net_popular"}
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

// ================= ULTRA UI =================

async function renderUltraCard(chatId, messageId, item, type, index, total){

  const details = await getDetails(item.tmdb_id || item.id, type);
  const safe = details || item;

  return tg("editMessageMedia",{
    chat_id:chatId,
    message_id:messageId,
    media:{
      type:"photo",
      media:item.cover || getCover(safe),
      caption:buildCard(safe,"",item.display_id)
    },
    reply_markup:{
      inline_keyboard:[
        [
          {text:"⬅️",callback_data:"ultra_prev"},
          {text:`${index+1}/${total}`,callback_data:"noop"},
          {text:"➡️",callback_data:"ultra_next"}
        ],
        [
          {text:"▶️ Play",callback_data:`play_${item.display_id}`}
        ]
      ]
    }
  });
}

async function startUltraUI(chatId, list){

  USER_STATE[chatId] = {
    list,
    index:0,
    mode:"ultra"
  };

  const first = list[0];

  const msg = await tg("sendPhoto",{
    chat_id:chatId,
    photo:first.cover,
    caption:buildCard(first,"",first.display_id),
    reply_markup:{
      inline_keyboard:[
        [
          {text:"⬅️",callback_data:"ultra_prev"},
          {text:`1/${list.length}`,callback_data:"noop"},
          {text:"➡️",callback_data:"ultra_next"}
        ],
        [
          {text:"▶️ Play",callback_data:`play_${first.display_id}`}
        ]
      ]
    }
  });

  USER_STATE[chatId].messageId = msg?.result?.message_id;
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

// ================= LOCAL =================

function getLocalByGenre(genreId){
  return CACHE.filter(x => x.genres?.includes(parseInt(genreId)));
}

function getCollectionItems(name){

  return CACHE
    .filter(x => x.collection === name)
    .sort((a,b)=>{

      const A = a.collection_order || 0;
      const B = b.collection_order || 0;

      if(A !== B) return A - B;

      return (a.title || "").localeCompare(b.title || "");
    });
}

// ================= META =================

function detectQuality(n=""){
  return /4k|2160/i.test(n) ? "4K"
       : /1080/.test(n) ? "1080p"
       : /720/.test(n) ? "720p"
       : "HD";
}

// ================= PLAYER =================

function playerUrl(mode,id){
  return `https://t.me/${BOT_USERNAME}?start=${mode}_${id}`;
}

// ================= UPLOAD =================

async function handleUpload(msg){

  const file = msg.document || msg.video;
  const width = msg.video?.width;
  const height = msg.video?.height;

  if(!file) return;

  // ================= DUPLICATE =================
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
  const fixed = aiNormalize(clean);

  const yearMatch = fileName.match(/(19|20)\d{2}/);
  const fileYear = yearMatch ? parseInt(yearMatch[0]) : null;

  console.log("🧹 CLEAN:", clean);

  // ================= TMDB MATCH =================
  let result = null;

  const variants = buildSearchVariants(fixed);

  for(const v of variants){

    result = await searchTMDBUltra(
      v,
      fileYear,
      isSeries ? "tv" : "movie"
    );

    if(result){
      console.log("✅ MATCH:", v);
      break;
    }
  }

  // FALLBACK
  if(!result){
    const fallback = await tmdbFetch(
      `https://api.themoviedb.org/3/search/${isSeries ? "tv" : "movie"}?api_key=${TMDB_KEY}&query=${encodeURIComponent(clean)}`
    );
    result = fallback?.results?.[0] || null;
  }

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

  if(!cover){
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

    if(!seriesThread || !seasonThread){
      return tg("sendMessage",{
        chat_id: msg.chat.id,
        text:"❌ Thread Fehler"
      });
    }

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
          [{text:"▶️ Episode",callback_data:`play_${id}`}],
          [{text:"📺 Serie",callback_data:`series_${seriesKey}`}]
        ]
      }
    });

    return tg("sendMessage",{
      chat_id: msg.chat.id,
      text:`✅ Episode gespeichert\n🎬 ${safeData.title}\n🆔 ${id}`
    });
  }

  // ================= COLLECTION =================
  let collectionName =
    detectCollectionSmart(safeData.title || clean)
    || detectCollection(safeData.title || clean);

  if(collectionName){
    collectionName = collectionName
      .replace(/\s+/g,"_")
      .replace(/[^a-z0-9_]/gi,"")
      .toLowerCase()
      .slice(0,40);
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
    text:`✅ Film gespeichert\n🎬 ${safeData.title}\n🆔 ${id}`
  });
}

// ================= WEBHOOK =================
app.post(`/bot${TOKEN}`, async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  const msg = body.message;

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
        if(!state || state.mode !== "ultra") return;

        if(data === "ultra_next"){
          state.index++;
        } else {
          state.index--;
        }

        if(state.index < 0) state.index = state.list.length - 1;
        if(state.index >= state.list.length) state.index = 0;

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

      if (data === "home") {
        return showNetflixHome(chatId);
      }

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

      if (data === "menu") {
        return showMenu(chatId);
      }

      if (data === "open_genres") {
        return showGenres(chatId);
      }

      // ================= FAVORITES =================

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
              }
            }
          }
        }

        let item = CACHE.find(x => x.display_id === id);

        if(found){
          item = {
            file_id: found.data.file_id,
            display_id: id,
            media_type: "tv"
          };
        }

        if(!item){
          return tg("sendMessage",{ chat_id:chatId, text:"❌ Nicht gefunden" });
        }

        if(found){
          setContinue(chatId,{
            seriesKey: found.seriesKey,
            season: found.season,
            episode: found.episode,
            display_id: id,
            timestamp: Date.now()
          });
        }

        await tg("sendVideo", {
          chat_id: chatId,
          video: item.file_id,
          supports_streaming: true
        });

        if(found){
          const next = getNextEpisode(
            found.seriesKey,
            found.season,
            found.episode
          );

          if(next){
            await tg("sendMessage",{
              chat_id: chatId,
              text: `➡️ Nächste Folge (S${next.season}E${next.episode})`,
              reply_markup:{
                inline_keyboard:[
                  [{
                    text:"▶️ Weiter",
                    callback_data:`play_${next.data.display_id}`
                  }]
                ]
              }
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
          return tg("sendMessage",{ chat_id:chatId, text:"❌ Serie nicht gefunden" });
        }

        const seasons = Object.keys(series);
        const buttons = [];

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
          text:`📺 ${key.replace(/_/g," ").toUpperCase()}`,
          reply_markup:{ inline_keyboard: buttons }
        });
      }

      if (data.startsWith("season_")) {

        const [, key, season] = data.split("_");
        const episodes = SERIES_DB[key]?.[season];

        if(!episodes){
          return tg("sendMessage",{ chat_id:chatId, text:"❌ Keine Episoden" });
        }

        const buttons = Object.entries(episodes)
          .map(([ep,data]) => ([
            {
              text:`▶️ Folge ${ep}`,
              callback_data:`play_${data.display_id}`
            }
          ]));

        return tg("sendMessage",{
          chat_id:chatId,
          text:`📀 Staffel ${season}`,
          reply_markup:{ inline_keyboard: buttons }
        });
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
          return startUltraUI(msg.chat.id, items);
        }

        if(action === "play"){
          const item = CACHE.find(x => x.display_id === id);
          return sendFileById(msg.chat.id, item);
        }

        if(action === "sim"){
          const item = CACHE.find(x => x.display_id === id);
          const list = getSmartRecommendations(item || {});
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
    console.error("❌ WEBHOOK ERROR:", e.message);
  }
});

// ================= SERVER =================
app.listen(process.env.PORT || 3000, () => {
  console.log("🔥 ULTRA FINAL BUILD RUNNING");
});