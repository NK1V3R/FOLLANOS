// ===== LiveBet — demo de apuestas con saldo virtual =====
// API pública (gratis, sin key): ESPN scoreboard
//   https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard

const fmt = n => "$" + Math.round(n).toLocaleString("es-CO");

let saldo = +(localStorage.getItem("lb_saldo") ?? 100000);
let misApuestas = JSON.parse(localStorage.getItem("lb_bets") || "[]");
let sport = "basketball", league = "nba";
let timer = null;
let apuestaActual = null; // { matchId, label, odd }

const $ = id => document.getElementById(id);

function pintarSaldo(){ $("balance").textContent = fmt(saldo); }

// Cuota pseudo-aleatoria pero ESTABLE por partido (hash del id)
function hash(str){ let h=0; for(const c of str) h=(h*31+c.charCodeAt(0))>>>0; return h; }
function cuotas(id){
  const h = hash(id);
  const local  = (1.4 + (h%160)/100).toFixed(2);       // 1.40 - 2.99
  const visit  = (1.4 + ((h>>8)%160)/100).toFixed(2);
  const empate = (2.8 + ((h>>16)%120)/100).toFixed(2);  // 2.80 - 3.99
  return { local:+local, visit:+visit, empate:+empate };
}

// ===== Traer partidos =====
async function cargarPartidos(){
  $("status").textContent = "Cargando partidos…";
  $("matches").innerHTML = "";
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    pintarPartidos(data.events || []);
  }catch(err){
    console.error(err);
    $("status").innerHTML =
      "No se pudo conectar con la API en vivo (posible CORS o sin partidos). " +
      "Mostrando partidos de ejemplo.";
    pintarPartidos(ejemplo(), true);
  }
}

function ejemplo(){
  const mk = (id,h,a,hs,as,state) => ({
    id, status:{type:{state, shortDetail: state==="in"?"2do cuarto":state==="post"?"Final":"Hoy 8:00 PM"}},
    competitions:[{competitors:[
      {homeAway:"home",team:{displayName:h,logo:""},score:hs},
      {homeAway:"away",team:{displayName:a,logo:""},score:as}
    ]}]
  });
  return [
    mk("ex1","Lakers","Celtics","88","79","in"),
    mk("ex2","Warriors","Suns","0","0","pre"),
    mk("ex3","Heat","Bucks","102","110","post"),
  ];
}

function pintarPartidos(events, esEjemplo){
  if(!events.length){ $("status").textContent = "No hay partidos programados ahora."; return; }
  if(!esEjemplo) $("status").textContent = "";
  const cont = $("matches");
  cont.innerHTML = "";

  events.forEach(ev => {
    const comp = ev.competitions[0];
    const home = comp.competitors.find(c=>c.homeAway==="home");
    const away = comp.competitors.find(c=>c.homeAway==="away");
    const st = ev.status.type;
    const c = cuotas(ev.id);
    const terminado = st.state === "post";
    const esFutbol = sport === "soccer";

    const badge = st.state==="in"
      ? `<span class="badge-live">EN VIVO · ${st.shortDetail||""}</span>`
      : terminado
        ? `<span class="badge-final">Finalizado</span>`
        : `<span>${st.shortDetail||"Próximamente"}</span>`;

    const fila = (t) => `
      <div class="team-row">
        ${t.team.logo ? `<img src="${t.team.logo}" alt="">` : `<span style="width:28px">🏀</span>`}
        <span class="team-name">${t.team.displayName}</span>
        <span class="team-score">${t.score ?? "-"}</span>
      </div>`;

    const odd = (lbl, key, texto) =>
      `<div class="odd ${terminado?"disabled":""}" data-match="${ev.id}"
            data-label="${texto}" data-odd="${c[key]}">
        <span>${lbl}</span><strong>${c[key].toFixed(2)}</strong>
      </div>`;

    const oddsHtml = esFutbol
      ? odd("Local","local",`Gana ${home.team.displayName}`) +
        odd("Empate","empate","Empate") +
        odd("Visita","visit",`Gana ${away.team.displayName}`)
      : odd("Gana local","local",`Gana ${home.team.displayName}`) +
        odd("Gana visita","visit",`Gana ${away.team.displayName}`);

    const div = document.createElement("div");
    div.className = "match";
    div.innerHTML = `
      <div class="match-top"><span>${ev.shortName||league.toUpperCase()}</span>${badge}</div>
      <div class="teams">${fila(home)}${fila(away)}</div>
      <div class="odds">${oddsHtml}</div>`;
    cont.appendChild(div);
  });
}

// ===== Abrir / confirmar apuesta =====
$("matches").addEventListener("click", e => {
  const o = e.target.closest(".odd");
  if(!o || o.classList.contains("disabled")) return;
  apuestaActual = { matchId:o.dataset.match, label:o.dataset.label, odd:+o.dataset.odd };
  $("modalPick").textContent = apuestaActual.label;
  $("modalOdd").textContent = apuestaActual.odd.toFixed(2);
  $("stake").value = 10000;
  calcGanancia();
  abrirModal();
});

function calcGanancia(){
  const stake = +$("stake").value || 0;
  $("modalWin").textContent = fmt(stake * (apuestaActual?.odd || 0));
}
$("stake").addEventListener("input", calcGanancia);

$("confirmBet").addEventListener("click", () => {
  const stake = +$("stake").value || 0;
  if(stake < 1000){ alert("Monto mínimo: $1.000"); return; }
  if(stake > saldo){ alert("Saldo insuficiente."); return; }
  saldo -= stake;
  const win = stake * apuestaActual.odd;
  // Resultado simulado: probabilidad de ganar ligada a la cuota (cuota baja = más probable)
  const prob = Math.min(0.9, 1/apuestaActual.odd);
  const gano = Math.random() < prob;
  if(gano) saldo += win;
  misApuestas.unshift({
    label: apuestaActual.label, stake, odd: apuestaActual.odd,
    win: gano ? Math.round(win) : 0, estado: gano ? "won" : "lost"
  });
  guardar();
  cerrarModal();
  setTimeout(()=>alert(gano
    ? `✅ ¡Ganaste! +${fmt(win)}`
    : `❌ Perdiste ${fmt(stake)}. ¡Suerte la próxima!`), 100);
});

function abrirModal(){ $("modal").classList.add("open"); $("modalOverlay").classList.add("open"); }
function cerrarModal(){ $("modal").classList.remove("open"); $("modalOverlay").classList.remove("open"); }
$("cancelBet").addEventListener("click", cerrarModal);
$("modalOverlay").addEventListener("click", cerrarModal);

// ===== Mis apuestas =====
function pintarMisApuestas(){
  const c = $("myBets");
  if(!misApuestas.length){ c.innerHTML = '<p class="bet-empty">Aún no has apostado.</p>'; return; }
  c.innerHTML = misApuestas.map(b => `
    <div class="bet-card ${b.estado}">
      <div>
        <div>${b.label}</div>
        <small style="color:var(--muted)">Apostado ${fmt(b.stake)} · cuota ${b.odd.toFixed(2)}</small>
      </div>
      <span class="bet-tag ${b.estado}">
        ${b.estado==="won" ? "Ganada +"+fmt(b.win) : "Perdida"}
      </span>
    </div>`).join("");
}

function guardar(){
  localStorage.setItem("lb_saldo", saldo);
  localStorage.setItem("lb_bets", JSON.stringify(misApuestas));
  pintarSaldo();
  pintarMisApuestas();
}

// ===== Ligas / refresco =====
document.querySelectorAll(".league").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelector(".league.active").classList.remove("active");
    btn.classList.add("active");
    sport = btn.dataset.sport; league = btn.dataset.league;
    $("leagueTitle").textContent = "Partidos · " + btn.textContent.trim();
    cargarPartidos();
  });
});
$("refresh").addEventListener("click", cargarPartidos);

// Auto-refresco cada 30s (marcadores en vivo)
function autoRefrescar(){ clearInterval(timer); timer = setInterval(cargarPartidos, 30000); }

// Init
pintarSaldo();
pintarMisApuestas();
cargarPartidos();
autoRefrescar();
