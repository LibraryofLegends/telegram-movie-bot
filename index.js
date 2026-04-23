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
  if (data.poster_path)
    return `https://image.tmdb.org/t/p/w500${data.poster_path}`;
  return "https://via.placeholder.com/500x750?text=No+Image";
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
    .replace(/\b(1080p|720p|2160p|4k)\b/gi, "")
    .replace(/\b(x264|x265)\b/gi, "")
    .replace(/\b(bluray|web)\b/gi, "")
    .replace(/S\d{1,2}E\d{1,2}/gi, "")
    .replace(/[._\-]+/g, " ")
    .trim();
}

function detectQuality(n=""){return /4k|2160/i.test(n)?"4K":/1080/.test(n)?"1080p":/720/.test(n)?"720p":"HD";}
function detectAudio(n=""){return /deutsch|german/i.test(n)?"Deutsch":"EN";}
function detectSource(n=""){return /bluray/i.test(n)?"BluRay":/web/i.test(n)?"WEB":"-";}

// ================= CARD =================
function buildCard(data, fileName="", id="0001"){

  const title = (data.title || data.name || "UNBEKANNT").toUpperCase();
  const year = (data.release_date || data.first_air_date || "").slice(0,4);

  const genres = (data.genres || []).slice(0,2).map(g=>g.name).join(" • ");

  const story = (data.overview || "Keine Beschreibung")
    .slice(0,200)
    .trim() + "...";

  const LINE = "━━━━━━━━━━━━━━━━━━";
  const SOFT = "──────────────";

  return `${LINE}
🎬 𝐋𝐈𝐁𝐑𝐀𝐑𝐘 𝐎𝐅 𝐋𝐄𝐆𝐄𝐍𝐃𝐒
${title} ${year ? `(${year})` : ""}
${SOFT}
🔥 ${detectQuality(fileName)} • ${genres || "-"}
🎧 ${detectAudio(fileName)} • 💿 ${detectSource(fileName)}
${LINE}
📖 HANDLUNG
${story}
${LINE}
▶️ #${id}
${SOFT}
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
  const data = await tmdbFetch(
    `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}`
  );
  return data?.results?.[0] || null;
}

async function getDetails(id,type){
  return await tmdbFetch(
    `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=de-DE`
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

// ================= UI =================
function showMenu(chatId){
  return tg("sendMessage",{
    chat_id:chatId,
    text:"🎬 LIBRARY OF LEGENDS\n\nWähle deinen Bereich 👇",
    reply_markup:{
      inline_keyboard:[
        [{text:"🔥 Trending",callback_data:"net_trending"}],
        [{text:"📈 Popular",callback_data:"net_popular"}],
        [{text:"📺 Serien",callback_data:"series_menu"}],
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

  // 🔥 Cards senden
  for(const m of slice){
    await tg("sendPhoto",{
      chat_id:chatId,
      photo:getCover(m),
      caption:`🎬 ${m.title || m.name}`,
      reply_markup:{
        inline_keyboard:[
          [
            {text:"▶️ Öffnen",callback_data:`search_${m.id}_${m.media_type}`}
          ],
          [
            {text:"🔥 Ähnliche",callback_data:`sim_${m.id}_${m.media_type}`}
          ]
        ]
      }
    });
  }

  // 🔥 Navigation
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

// ================= FILE =================
async function sendFileById(chatId,item){
  if(!item) return;

  saveHistory(chatId,{id:item.display_id,type:item.media_type});

  return tg("sendVideo",{
    chat_id:chatId,
    video:item.file_id,
    supports_streaming:true
  });
}

// ================= UPLOAD =================
async function handleUpload(msg){
  const file = msg.document || msg.video;
  if(!file) return;

  const fileName = file.file_name || "";
  const parsed = parseFileName(fileName);
  const clean = cleanTitleAdvanced(parsed.title);

  const result = await searchTMDB(clean);
  const id = String(Date.now()).slice(-4);

  if(parsed.type==="tv"){
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
    media_type:result?.media_type || "movie"
  };

  CACHE.unshift(item);
  saveDB(CACHE);

  return tg("sendMessage",{chat_id:msg.chat.id,text:"✅ Upload verarbeitet"});
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

  // ================= PAGINATION =================
  if(data.startsWith("page_")){
    const page = parseInt(data.split("_")[1]);

    const state = USER_STATE[chatId];
    if(!state) return;

    return sendResultsList(chatId, state.heading, state.list, page);
  }

  // ================= MENU =================
  if(data === "menu"){
    return showMenu(chatId);
  }

  // ================= SIMILAR =================
  if(data.startsWith("sim_")){
    const [,id,type] = data.split("_");

    const list = await getSimilar(id,type);

    return sendResultsList(chatId,"🔥 Ähnliche",list,0);
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
  if(data==="net_trending"){
    return sendResultsList(chatId,"🔥 Trending",await getTrending());
  }

  // ================= POPULAR =================
  if(data==="net_popular"){
    return sendResultsList(chatId,"📈 Popular",await getPopular());
  }

  // ================= SEARCH =================
  if(data.startsWith("search_")){
    const [,id,type]=data.split("_");
    const details = await getDetails(id,type);

    return tg("sendPhoto",{
      chat_id:chatId,
      photo:getCover(details),
      caption:buildCard(details,"",id),
      reply_markup:{
        inline_keyboard:[
          [
            {text:"▶️ Stream",callback_data:`play_${id}`}
          ],
          [
            {text:"🔥 Ähnliche",callback_data:`sim_${id}_${type}`}
          ],
          [
            {text:"🏠 Menü",callback_data:"menu"}
          ]
        ]
      }
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
          [
            {text:"▶️ Stream",callback_data:`play_${item.display_id}`}
          ],
          [
            {text:"⬅️ Zurück",callback_data:`season_${key}_${season}`}
          ],
          [
            {text:"🏠 Menü",callback_data:"menu"}
          ]
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
app.listen(process.env.PORT || 3000, ()=>{
  console.log("🔥 FULL FINAL SYSTEM RUNNING");
});