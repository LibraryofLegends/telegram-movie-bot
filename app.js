const API = "https://film-finder--tlorenzwupperta.replit.app/api/films";

// 🔐 GEHEIMCODE
const SECRET = "1234"; // ändern!

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

// LOGIN
function checkCode(){
  const input = document.getElementById("codeInput").value;

  if(input === SECRET){
    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "block";
    initApp(); // ← erst hier laden!
  } else {
    alert("Falscher Code");
  }
}

// 🔥 APP START
function initApp(){
  fetch(API)
  .then(r=>r.json())
  .then(data=>{
    all = data;
    renderHero();
    renderRows();
  });
}

// HERO
function renderHero(){
  if(!all.length) return;
  const m = all[0];
  document.getElementById("hero").style.backgroundImage = `url(${m.cover})`;
  document.getElementById("hero").innerHTML = m.title;
}

// ROWS
function renderRows(){
  const movies = all.filter(x=>x.type==="movie");
  const series = groupSeries(all.filter(x=>x.type==="series"));

  const genreGroups = groupByGenre(movies);

  let html = "";

  // 🔥 Neu hinzugefügt
  html += row("🔥 Neu", all.slice(0,20));

  // 🎬 Filme
  html += row("🎬 Filme", movies);

  // 📺 Serien
  html += row("📺 Serien", series);

  // 🎭 GENRES
  Object.keys(genreGroups)
.sort((a,b)=>genreGroups[b].length - genreGroups[a].length)
.forEach(...)

  html += row(`🎭 ${g}`, unique.slice(0,15));
});

  document.getElementById("rows").innerHTML = html;
}

function groupSeries(series){
  const g = {};
  series.forEach(s=>{
    if(!g[s.group]) g[s.group]=s;
  });
  return Object.values(g);
}

function row(title,data){
  return `
    <div class="row">
      <h3>${title}</h3>
      <div class="scroll">
        ${data.map(x=>`
          <div class="card" onclick='openDetail(${JSON.stringify(x)})'>
            <img src="${x.cover || 'https://via.placeholder.com/300x450?text=No+Image'}">
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

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

// DETAIL VIEW
function openDetail(item){
  const d = document.getElementById("detail");
  d.classList.remove("hidden");

  d.innerHTML = `
    <div style="text-align:center;">
      <img src="${item.cover}" style="width:200px;border-radius:10px;">
      <h2>${item.title}</h2>
      <p><b>⭐ ${item.rating || "?"}</b></p>
      <p>${item.overview || "Keine Beschreibung"}</p>

      <button onclick="play('${item.file_id}')">▶️ Abspielen</button>
      <button onclick="closeDetail()">❌ Schließen</button>
    </div>
  `;
}

function closeDetail(){
  document.getElementById("detail").classList.add("hidden");
}

// PLAY
function play(id){
  window.location.href = `https://t.me/DEIN_BOT?start=${id}`;
}

// SEARCH
document.getElementById("search").oninput = e=>{
  const q = e.target.value.toLowerCase();

  if(!q){
    renderRows();
    return;
  }

  const f = all.filter(x=>x.title.toLowerCase().includes(q));

  document.getElementById("rows").innerHTML =
    row("🔍 Ergebnisse", f);
};