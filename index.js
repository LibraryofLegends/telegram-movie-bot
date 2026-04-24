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

// ================= EXTRA HELPERS =================

function buildGenreButtons(){
  const genres = [
    {id:28,name:"🔥 Action"},
    {id:35,name:"😂 Comedy"},
    {id:27,name:"👻 Horror"},
    {id:18,name:"🎭 Drama"},
    {id:878,name:"🚀 Sci-Fi"}
  ];

  return genres.map(g => ([
    { text: g.name, callback_data: `genre_${g.id}` }
  ]));
}

function buildSwipeNav(id,type){
  return {
    inline_keyboard:[
      [
        {text:"⬅️",callback_data:`prev_${id}_${type}`},
        {text:"▶️ Stream",callback_data:`play_${id}`},
        {text:"➡️",callback_data:`next_${id}_${type}`}
      ],
      [
        {text:"🔥 Ähnliche",callback_data:`sim_${id}_${type}`}
      ],
      [
        {text:"🏠 Menü",callback_data:"menu"}
      ]
    ]
  };
}

async function sendFileById(chatId,item){
  if(!item) return;

  saveHistory(chatId,{id:item.display_id,type:item.media_type});

  return tg("sendVideo",{
    chat_id:chatId,
    video:item.file_id,
    supports_streaming:true
  });
}

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

// ================= NETFLIX SYSTEM =================

function buildLocalRows(){
  return [
    {title:"🔥 Deine Action Filme", data:getLocalByGenre(28)},
    {title:"😂 Deine Comedy Filme", data:getLocalByGenre(35)}
  ];
}

async function buildHomeRows(){
  return [
    {title:"🔥 Trending", data:await getTrending()},
    {title:"🎬 Beliebt", data:await getPopular()},
    {title:"🔥 Action", data:await getByGenre(28)},
    {title:"😂 Comedy", data:await getByGenre(35)}
  ];
}

async function showNetflixHome(chatId){

  const trending = await getTrending();
  if(!trending.length) return;

  const first = trending[0];

  const details = await getDetails(
    first.id,
    first.media_type === "tv" ? "tv" : "movie"
  );

  const banner = getBanner(details);

  // 🎬 BIG BANNER
  await tg("sendPhoto",{
    chat_id:chatId,
    photo:banner,
    caption:buildCard(details,"",first.id),
    reply_markup: buildSwipeNav(first.id, first.media_type)
  });

  // 🌍 TMDB ROWS
  const rows = await buildHomeRows();

  for(const row of rows){
    await sendResultsList(chatId,row.title,row.data,0);
  }

  // 💾 LOCAL ROWS
  const localRows = buildLocalRows();

  for(const row of localRows){
    if(row.data.length){
      await sendResultsList(chatId,row.title,row.data,0);
    }
  }

  return tg("sendMessage",{
    chat_id:chatId,
    text:"🏠 Home",
    reply_markup:{
      inline_keyboard:[
        [{text:"🔄 Refresh",callback_data:"home"}]
      ]
    }
  });
}

// ================= UI =================
function showMenu(chatId){
  return tg("sendMessage",{
    chat_id:chatId,
    text:`🎬 𝐋𝐈𝐁𝐑𝐀𝐑𝐘 𝐎𝐅 𝐋𝐄𝐆𝐄𝐍𝐃𝐒

Wähle deinen Bereich 👇`,
    reply_markup:{
      inline_keyboard:[
        [{text:"🏠 Home",callback_data:"home"}],
        [{text:"🔥 Trending",callback_data:"net_trending"}],
        [{text:"📈 Popular",callback_data:"net_popular"}],

        [
          {text:"🎬 Filme",callback_data:"browse_movies"},
          {text:"📺 Serien",callback_data:"browse_series"}
        ],

        ...buildGenreButtons(),

        [{text:"▶️ Weiter schauen",callback_data:"continue"}]
      ]
    }
  });
}

async function sendResultsList(chatId, heading, list, page = 0){

  if(!list || !list.length){
    return tg("sendMessage",{chat_id:chatId,text:"❌ Keine Ergebnisse"});
  }

  const perPage = 4;
  const start = page * perPage;
  const slice = list.slice(start, start + perPage);

  USER_STATE[chatId] = { list, heading };

  for(const m of slice){
    const title = m.title || m.name || "Unbekannt";

    await tg("sendPhoto",{
      chat_id:chatId,
      photo:getCover(m),
      caption:`🎬 ${title}`,
      reply_markup:{
        inline_keyboard:[
          [{text:"▶️ Öffnen",callback_data:`search_${m.id}_${m.media_type}`}],
          [{text:"🔥 Ähnliche",callback_data:`sim_${m.id}_${m.media_type}`}]
        ]
      }
    });
  }

  const nav = [];

  if(page > 0){
  nav.push({text:"⬅️",callback_data:`page_${page-1}`});
}

  if(start + perPage < list.length){
    nav.push({text:"➡️",callback_data:`page_${page+1}`});
  }

  return tg("sendMessage",{
    chat_id:chatId,
    text:`📄 ${heading} • Seite ${page+1}`,
    reply_markup:{
      inline_keyboard:[
        ...(nav.length ? [nav] : []),
        [{text:"🏠 Menü",callback_data:"menu"}]
      ]
    }
  });
}

// ================= UPLOAD =================
async function handleUpload(msg){

  const file = msg.document || msg.video;
  if(!file) return;

  const fileName = file.file_name || "";
  const parsed = parseFileName(fileName);
  const clean = cleanTitleAdvanced(parsed.title);

  // 🔥 SEARCH
  let result = await searchTMDB(clean);
  
  if(!result){
  console.log("❌ TMDB NO MATCH:", clean);
}

  // 🔥 fallback search (massiv wichtig)
  if(!result){
    const short = clean.split(" ").slice(0,2).join(" ");
    result = await searchTMDB(short);
  }

  // 🔥 DETAILS (DAS HAT DIR GEFehlt)
  let details = null;

  if(result && result.id){
    details = await getDetails(
      result.id,
      result.media_type === "tv" ? "tv" : "movie"
    );
  }
  
  // 🔥 GENRE SAVE
let genreIds = [];

if(result?.genre_ids){
  genreIds = result.genre_ids;
}

  const id = String(Date.now()).slice(-4);

  // 🔥 SERIES SAVE
  if(parsed.type === "tv"){
    const key = parsed.title.toLowerCase().replace(/\s/g,"_");

    if(!SERIES_DB[key]) SERIES_DB[key]={};
    if(!SERIES_DB[key][parsed.season]) SERIES_DB[key][parsed.season]={};

    SERIES_DB[key][parsed.season][parsed.episode]={
      file_id:file.file_id,
      display_id:id
    };

    saveSeriesDB(SERIES_DB);
  }

  const item={
  display_id:id,
  file_id:file.file_id,
  media_type:result?.media_type || "movie",
  genres: genreIds
};

  CACHE.unshift(item);
  saveDB(CACHE);
  
  // ================= COVER FIX =================
  let cover = getCover(details || result || {});

if(!details && !result){
  cover = buildStyledCover(parsed.title);
}

  try{
    if(!cover || cover.includes("null")) throw new Error();
    const res = await fetch(cover);
    if(!res.ok) throw new Error();
  }catch{
    cover = "https://dummyimage.com/500x750/000/fff&text=No+Image";
  }

  // 🔥 FALLBACK FIX (WICHTIG)
if(!details && result){
  details = result;
}

const safeData = details || result || {};

// ================= CHANNEL POST =================
await tg("sendPhoto",{
  chat_id:getTargetChannel(genreIds),
  photo:cover,
  caption:buildCard(safeData, fileName, id),
  reply_markup:{
    inline_keyboard:[
      [
        {text:"▶️ Stream",url:playerUrl("play",id)}
      ]
    ]
  }
});

  return tg("sendMessage",{
    chat_id:msg.chat.id,
    text:"✅ Upload verarbeitet"
  });
}

// ================= WEBHOOK =================
app.post(`/bot${TOKEN}`, async (req,res)=>{
  res.sendStatus(200);

  const body = req.body;
  const msg = body.message;

  try{

    if(body.callback_query){

  const data = body.callback_query.data;
  const chatId = body.callback_query.message.chat.id;

  await tg("answerCallbackQuery", {
    callback_query_id: body.callback_query.id
  });
  
  // ================= HOME =================
if(data === "home"){
  return showNetflixHome(chatId);
}
  
  // ================= NETFLIX ROWS =================
if(data === "row_trending"){
  return sendResultsList(chatId,"🔥 Trending",await getTrending(),0);
}

if(data === "row_popular"){
  return sendResultsList(chatId,"🎬 Beliebt",await getPopular(),0);
}
  
  // ================= QUICK NAV =================

if(data === "browse_movies"){
  const list = await getPopular();
  return sendResultsList(chatId,"🎬 Filme",list,0);
}

if(data === "browse_series"){
  const keys = Object.keys(SERIES_DB);

  if(!keys.length){
    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Keine Serien vorhanden"
    });
  }

  const buttons = keys.map(k => ([
    {
      text:`📺 ${k.replace(/_/g," ")}`,
      callback_data:`tv_${k}`
    }
  ]));

  buttons.push([{text:"🏠 Menü",callback_data:"menu"}]);

  return tg("sendMessage",{
    chat_id:chatId,
    text:"📺 Serien",
    reply_markup:{inline_keyboard:buttons}
  });
}

  // ================= MENU =================
  if(data === "menu"){
    return showMenu(chatId);
  }
  
  if(data === "series_menu"){

  const keys = Object.keys(SERIES_DB);

  if(!keys.length){
    return tg("sendMessage",{
      chat_id:chatId,
      text:"❌ Keine Serien vorhanden"
    });
  }

  const buttons = keys.map(k => ([
    {
      text: `📺 ${k.replace(/_/g," ")}`,
      callback_data:`tv_${k}`
    }
  ]));

  buttons.push([{text:"🏠 Menü",callback_data:"menu"}]);

  return tg("sendMessage",{
    chat_id:chatId,
    text:"📺 Serien auswählen",
    reply_markup:{inline_keyboard:buttons}
  });
}

  // ================= CONTINUE =================
  if(data === "continue"){
    const history = readHistory(chatId);

    if(!history.length){
      return tg("sendMessage",{
        chat_id:chatId,
        text:"❌ Kein Verlauf vorhanden"
      });
    }

    const last = history[0];

    return tg("sendMessage",{
      chat_id:chatId,
      text:"▶️ Weiter schauen",
      reply_markup:{
        inline_keyboard:[[
          {text:"🎬 Öffnen",callback_data:`play_${last.id}`}
        ]]
      }
    });
  }

  // ================= TRENDING =================
  if(data === "net_trending"){
    const list = await getTrending();
    return sendResultsList(chatId,"🔥 Trending",list,0);
  }

  // ================= POPULAR =================
  if(data === "net_popular"){
    const list = await getPopular();
    return sendResultsList(chatId,"📈 Popular",list,0);
  }
  
  // ================= GENRE =================
if(data.startsWith("genre_")){
  const genre = data.split("_")[1];
  const list = await getByGenre(genre);

  return sendResultsList(chatId,"📂 Kategorie",list,0);
}

// ================= LOCAL GENRE =================
if(data.startsWith("genre_local_")){
  const genre = data.split("_")[2];
  const list = getLocalByGenre(genre);

  return sendResultsList(chatId,"📂 Deine Filme",list,0);
}

// ================= A-Z =================
if(data === "movies_az"){
  const list = await getPopular();
  return sendResultsList(chatId,"🔤 A–Z",sortAZ(list),0);
}

  // ================= PAGINATION =================
  if(data.startsWith("page_")){
    const page = parseInt(data.split("_")[1]);
    const state = USER_STATE[chatId];
    if(!state) return;

    return sendResultsList(chatId,state.heading,state.list,page);
  }

  // ================= SIMILAR =================
  if(data.startsWith("sim_")){
    const [,id,type] = data.split("_");

    const res = await tmdbFetch(
      `https://api.themoviedb.org/3/${type}/${id}/similar?api_key=${TMDB_KEY}`
    );

    return sendResultsList(chatId,"🔥 Ähnliche",res?.results || [],0);
  }
  
  // ================= SWIPE =================
if(data.startsWith("next_") || data.startsWith("prev_")){

  const [dir,id,type] = data.split("_");

  const state = USER_STATE[chatId];
  if(!state) return;

  const list = state.list;
  const index = list.findIndex(x => String(x.id) === id);

  if(index === -1) return;

  const newIndex = dir === "next" ? index+1 : index-1;

  if(!list[newIndex]) return;

  const item = list[newIndex];

  const details = await getDetails(item.id, type);
const safeData = details || item || {};

return tg("sendPhoto",{
  chat_id:chatId,
  photo:getCover(safeData),
  caption:buildCard(safeData,"",item.id),
  reply_markup: buildSwipeNav(item.id,type)
});
}

  // ================= SEARCH =================
  if(data.startsWith("search_")){
  const [,id,type] = data.split("_");

  const details = await getDetails(id,type);
  const safeData = details || {};

  return tg("sendPhoto",{
    chat_id:chatId,
    photo:getCover(safeData),
    caption:buildCard(safeData,"",id),
    reply_markup: buildSwipeNav(id,type)
  });
}

  // ================= SERIES =================
  if(data.startsWith("tv_")){
    const key = data.split("_")[1];
    const seasons = SERIES_DB[key];

    if(!seasons){
      return tg("sendMessage",{
        chat_id:chatId,
        text:"❌ Keine Staffel vorhanden"
      });
    }

    const buttons = Object.keys(seasons)
      .sort((a,b)=>a-b)
      .map(s => ([
        {text:`📺 Staffel ${s}`,callback_data:`season_${key}_${s}`}
      ]));

    buttons.push([{text:"🏠 Menü",callback_data:"menu"}]);

    return tg("sendMessage",{
      chat_id:chatId,
      text:"📺 Staffel wählen",
      reply_markup:{inline_keyboard:buttons}
    });
  }

  if(data.startsWith("season_")){
    const [,key,season] = data.split("_");
    const eps = SERIES_DB[key]?.[season];

    if(!eps){
      return tg("sendMessage",{
        chat_id:chatId,
        text:"❌ Keine Episoden vorhanden"
      });
    }

    const buttons = Object.keys(eps)
      .sort((a,b)=>a-b)
      .map(ep => ([
        {text:`🎬 Episode ${ep}`,callback_data:`episode_${key}_${season}_${ep}`}
      ]));

    buttons.push([
      {text:"⬅️ Zurück",callback_data:`tv_${key}`},
      {text:"🏠 Menü",callback_data:"menu"}
    ]);

    return tg("sendMessage",{
      chat_id:chatId,
      text:`📺 Staffel ${season}`,
      reply_markup:{inline_keyboard:buttons}
    });
  }

  if(data.startsWith("episode_")){
    const [,key,season,ep] = data.split("_");
    const item = SERIES_DB[key]?.[season]?.[ep];

    if(!item){
      return tg("sendMessage",{
        chat_id:chatId,
        text:"❌ Episode nicht gefunden"
      });
    }

    return tg("sendMessage",{
      chat_id:chatId,
      text:`🎬 Episode ${ep}`,
      reply_markup:{
        inline_keyboard:[
          [{text:"▶️ Stream",callback_data:`play_${item.display_id}`}],
          [{text:"⬅️ Zurück",callback_data:`season_${key}_${season}`}],
          [{text:"🏠 Menü",callback_data:"menu"}]
        ]
      }
    });
  }

  // ================= PLAY =================
  if(data.startsWith("play_")){
    const id = data.replace("play_","");
    const item = CACHE.find(x=>x.display_id===id);
    return sendFileById(chatId,item);
  }

  return;
}

    // ================= START =================
    if(msg?.text === "/start"){
      return showMenu(msg.chat.id);
    }

    // ================= UPLOAD =================
    if(msg?.document || msg?.video){
      return handleUpload(msg);
    }

  }catch(e){
    console.error(e);
  }
}); // 🔥 DAS HAT BEI DIR GEFEHLT

// ================= START =================
app.listen(process.env.PORT || 3000, ()=>{
  console.log("🔥 FULL FINAL SYSTEM RUNNING");
});