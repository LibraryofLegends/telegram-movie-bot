const API = "https://telegram-bot-ijgy.onrender.com/api/films";
const BOT_URL = "https://t.me/LIBRARY_OF_LEGENDS_Bot";

let all = [];

// INIT
function initApp(){
  fetch(API)
    .then(r => r.json())
    .then(data => {
      all = data || [];
      renderRows();
    });
}

// ROWS
function renderRows(){
  const html = all.map(x => `
    <div class="card">
      <img src="${x.cover}">
      <h3>${x.title}</h3>
      <button onclick="play('${x.file_id}')">▶️ Play</button>
    </div>
  `).join("");

  document.getElementById("rows").innerHTML = html;
}

// PLAY
function play(id){
  window.location.href = `${BOT_URL}?start=${id}`;
}

// START
initApp();