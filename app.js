const API = "https://film-finder--tlorenzwupperta.replit.app/api/films";

// 🔐 LOGIN
const SECRET = "1234"; // ändern!

// 🎭 GENRES
const GENRES = {
  28: "Action",
  35: "Comedy",
  27: "Horror",
  53: "Thriller",
  18: "Drama",
  878: "Sci-Fi",
  12: "Adventure",
  16: "Animation"
};

let all = [];
let currentFilter = "Alle";

// ===== LOGIN =====
function checkCode(){
  const input = document.getElementById("codeInput").value;

  if(input === SECRET){
    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "block";
    initApp();
  } else {
    alert("Falscher Code");
  }
}

// ===== INIT =====
function initApp(){
  fetch(API)
  .then(r=>r.json())
  .then(data=>{
    all = data;
    renderHero();
    renderNav();
    renderRows();
  });
}

// ===== HERO =====
function renderHero(){
  if(!all.length) return;

  const m = all[Math.floor(Math.random() * all.length)];

  document.getElementById("hero").style.backgroundImage = `url(${m.cover})`;
  document.getElementById("hero").innerHTML = `
    <div>
      <h2>${m.title}</h2>
      <button onclick="play('${m.file_id}')">▶️ Play</button>
    </div>
  `;
}

// ===== NAVIGATION =====
function renderNav(){
  const nav = document.getElementById("nav");

  const genreGroups = groupByGenre(all.filter(x=>x.type==="movie"));
  const genres = Object.keys(genreGroups);

  let buttons = `<div class="nav-btn ${currentFilter==="Alle" ? "active":""}" onclick="setFilter('Alle')">Alle</div>`;

  genres.forEach(g=>{
    buttons += `<div class="nav-btn ${currentFilter===g ? "active":""}" onclick="setFilter('${g}')">${g}</div>`;
  });

  nav.innerHTML = buttons;
}

function setFilter(filter){
  currentFilter = filter;
  renderNav();
  renderRows();
}

// ===== ROWS =====
function renderRows(){
  let data = [...all];

  if(currentFilter !== "Alle"){
    data = data.filter(m =>
      m.genre_ids?.some(id => GENRES[id] === currentFilter)
    );
  }

  const movies = data.filter(x=>x.type==="movie");
  const series = groupSeries(data.filter(x=>x.type==="series"));

  const genreGroups = groupByGenre(movies);

  let html = "";

  html += row("🔥 Neu", data.slice(0,20));
  html += row("🎬 Filme", movies);
  html += row("📺 Serien", series);

  Object.keys(genreGroups)
    .sort((a,b)=>genreGroups[b].length - genreGroups[a].length)
    .forEach(g=>{
      const unique = [...new Map(
        genreGroups[g].map(m => [m.file_id, m])
      ).values()];

      html += row(`🎭 ${g}`, unique.slice(0,15));
    });

  document.getElementById("rows").innerHTML = html;
}

// ===== GROUP SERIES =====
function groupSeries(series){
  const g = {};
  series.forEach(s=>{
    if(!g[s.group]) g[s.group]=s;
  });
  return Object.values(g);
}

// ===== GROUP GENRES =====
function groupByGenre(movies){
  const groups = {};

  movies.forEach(m=>{
    if(!m.genre_ids) return;

    m.genre_ids.forEach(id=>{
      const name = GENRES[id];
      if(!name) return;

      if(!groups[name]) groups[name] = [];
      groups[name].push(m);
    });
  });

  return groups;
}

// ===== ROW TEMPLATE =====
function row(title,data){
  return `
    <div class="row">
      <h3>${title}</h3>
      <div class="scroll">
        ${data.map(x=>`
          <div class="card" onclick='openDetail(${JSON.stringify(x)})'>
            <img loading="lazy" src="${x.cover || 'https://via.placeholder.com/300x450?text=No+Image'}">
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// ===== DETAIL VIEW =====
function openDetail(item){
  const d = document.getElementById("detail");
  d.classList.remove("hidden");

  d.innerHTML = `
    <div style="text-align:center;">
      <img src="${item.cover}" style="width:200px;border-radius:10px;">
      <h2>${item.title}</h2>
      <p><b>⭐ ${item.rating || "?"}</b> • ${item.year || ""}</p>
      <p>${item.overview || "Keine Beschreibung"}</p>

      <button onclick="play('${item.file_id}')">▶️ Abspielen</button>
      <button onclick="closeDetail()">❌ Schließen</button>
    </div>
  `;
}

function closeDetail(){
  document.getElementById("detail").classList.add("hidden");
}

// ===== PLAY =====
function play(id){
  window.location.href = `https://t.me/DEIN_BOT?start=${id}`;
}

// ===== SEARCH =====
document.getElementById("search").oninput = e=>{
  const q = e.target.value.toLowerCase();

  if(!q){
    renderRows();
    return;
  }

  const f = all.filter(x=>x.title.toLowerCase().includes(q));

  if(f.length === 0){
    document.getElementById("rows").innerHTML = "<p style='padding:10px;'>Keine Filme gefunden</p>";
    return;
  }

  document.getElementById("rows").innerHTML =
    row("🔍 Ergebnisse", f);
};