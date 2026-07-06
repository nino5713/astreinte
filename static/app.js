/* ===================================================================
   SOCOM · Astreinte — logique front
=================================================================== */
const INTERVALLE = 12000; // rafraîchissement (ms)

/* ---------- Utilitaires ---------- */
async function api(url, methode = "GET", corps = null) {
  const opt = { method: methode, headers: {} };
  if (corps) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(corps); }
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { throw new Error(data.erreur || "Erreur serveur"); }
  return data;
}

function ech(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LIB_STATUT = {
  disponible: "Disponible", en_depannage: "En dépannage",
  repos: "Repos", indisponible: "Indisponible",
};
const LIB_STATUT_DEP = { nouveau: "Nouveau", assigne: "Assigné", en_cours: "En cours" };

function fmtH(h) {
  const heures = Math.floor(h);
  const min = Math.round((h - heures) * 60);
  return `${heures}h${String(min).padStart(2, "0")}`;
}

function fmtHeure(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function chrono(depuisIso) {
  const dep = new Date(depuisIso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - dep) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function horloge() {
  const el = document.getElementById("horloge");
  if (el) el.textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function jaugeHTML(lab, valeur, max, etat) {
  const pct = Math.min(100, (valeur / max) * 100);
  const cls = etat === "depasse" ? "depasse" : (etat === "attention" ? "attention" : "");
  return `<div class="jauge ${cls}">
    <div class="ligne"><span class="lab">${lab}</span><span class="val">${fmtH(valeur)} / ${max}h</span></div>
    <div class="piste"><div class="rempli" style="width:${pct}%"></div></div>
  </div>`;
}

/* niveau d'alerte d'un technicien selon jour+semaine et les plafonds courants */
function niveauTech(t, pl) {
  if (t.heures_jour >= pl.max_jour || t.heures_semaine >= pl.max_semaine) return "depasse";
  if (t.heures_jour >= pl.alerte_jour || t.heures_semaine >= pl.alerte_semaine) return "attention";
  return "ok";
}

function ouvrir(id) { document.getElementById(id).classList.add("ouvert"); }
function fermer(id) { document.getElementById(id).classList.remove("ouvert"); }
function brancherFermetures() {
  document.querySelectorAll("[data-fermer]").forEach((b) => {
    b.addEventListener("click", () => b.closest(".overlay").classList.remove("ouvert"));
  });
  document.querySelectorAll(".overlay").forEach((o) => {
    o.addEventListener("click", (e) => { if (e.target === o) o.classList.remove("ouvert"); });
  });
}

/* =====================================================================
   TABLEAU DE BORD (dispatcher)
===================================================================== */
let _etat = null;
let _assignCible = null;

function demarrerDashboard() {
  brancherFermetures();
  horloge(); setInterval(horloge, 1000);

  document.getElementById("btn-nouveau").addEventListener("click", ouvrirNouveauDep);
  document.getElementById("btn-creer-dep").addEventListener("click", creerDepannage);
  document.getElementById("btn-confirmer-assign").addEventListener("click", confirmerAssign);

  rafraichirDashboard();
  setInterval(rafraichirDashboard, INTERVALLE);
  setInterval(majChronos, 1000); // met à jour les compteurs d'intervention
}

async function rafraichirDashboard() {
  try {
    _etat = await api("/api/etat");
    rendreTechniciens(_etat);
    rendreDepannagesDispatch(_etat);
  } catch (e) { console.error(e); }
}


function rendreTechniciens(etat) {
  const g = document.getElementById("grille-tech");
  document.getElementById("compte-tech").textContent = etat.techniciens.length;
  if (!etat.techniciens.length) {
    g.innerHTML = `<div class="vide">Personne n'est d'astreinte en ce moment. Composez le planning dans l'onglet Planning.</div>`;
    return;
  }
  g.innerHTML = etat.techniciens.map((t) => {
    const niv = t.etat;
    const postes = (t.gardes || []).map((x) =>
      `<span class="poste-tag" style="border-color:${x.couleur_equipe};color:${x.couleur_equipe}">${ech(x.equipe_nom)} · ${x.slot === "backup" ? "Back-up" : "Titulaire"}</span>`).join("");
    return `<div class="carte-tech st-${t.statut}" style="border-left-color:${t.couleur}">
      <div class="tete">
        <div><div class="nom"><span class="pt-dot" style="background:${t.couleur}"></span>${ech(t.nom)}</div>
        <div class="tel">${ech(t.telephone || "")}</div></div>
        <span class="pastille ${t.statut}">${LIB_STATUT[t.statut]}</span>
      </div>
      ${postes ? `<div class="postes">${postes}</div>` : ""}
      <div class="jauges">
        ${jaugeHTML("Jour", t.heures_jour, etat.plafonds.max_jour, jJour(t, etat.plafonds))}
        ${jaugeHTML("Semaine", t.heures_semaine, etat.plafonds.max_semaine, jSem(t, etat.plafonds))}
      </div>
      ${niv !== "ok" ? `<div style="margin-top:10px"><span class="badge-etat ${niv}">${niv === "depasse" ? "Plafond atteint" : "Proche du plafond"}</span></div>` : ""}
    </div>`;
  }).join("");
}
function jJour(t, pl) { return t.heures_jour >= pl.max_jour ? "depasse" : (t.heures_jour >= pl.alerte_jour ? "attention" : "ok"); }
function jSem(t, pl) { return t.heures_semaine >= pl.max_semaine ? "depasse" : (t.heures_semaine >= pl.alerte_semaine ? "attention" : "ok"); }

function rendreDepannagesDispatch(etat) {
  const l = document.getElementById("liste-dep");
  const actifs = etat.depannages.filter((d) => d.statut !== "termine" && d.statut !== "annule");
  document.getElementById("compte-dep").textContent = actifs.length;
  if (!actifs.length) { l.innerHTML = `<div class="vide">Aucun dépannage en cours. Tout est calme.</div>`; return; }

  l.innerHTML = actifs.map((d) => {
    let actions = "";
    if (d.statut === "nouveau") {
      actions = `<button class="btn primaire" onclick="ouvrirAssign(${d.id})">Assigner</button>`;
    } else if (d.statut === "assigne") {
      actions = `<button class="btn" onclick="ouvrirAssign(${d.id})">Réassigner</button>`;
    } else if (d.statut === "en_cours") {
      actions = `<span class="chrono-dep" data-depuis="${d.date_debut}" style="font-variant-numeric:tabular-nums;font-weight:700;color:var(--depann)">${chrono(d.date_debut)}</span>`;
    }
    const tech = d.technicien_nom ? `<span class="meta"><b>Tech.</b> ${ech(d.technicien_nom)}</span>` : "";
    return `<div class="carte-dep pri-${d.priorite}">
      <div class="bande"></div>
      <div class="infos">
        <div class="haut">
          <span class="client">${ech(d.client)}</span>
          <span class="tag pri-${d.priorite}">${d.priorite}</span>
          <span class="tag st-${d.statut}">${LIB_STATUT_DEP[d.statut] || d.statut}</span>
        </div>
        ${d.lieu ? `<div class="lieu">${ech(d.lieu)}</div>` : ""}
        ${d.desc || d.description ? `<div class="desc">${ech(d.description || "")}</div>` : ""}
        <div class="meta">
          <span>Créé à ${fmtHeure(d.date_creation)}</span>
          ${d.date_debut ? `<span>Démarré à ${fmtHeure(d.date_debut)}</span>` : ""}
          ${d.technicien_nom ? `<span><b>Tech.</b> ${ech(d.technicien_nom)}</span>` : ""}
        </div>
      </div>
      <div class="actions">
        ${actions}
        <button class="btn fantome" onclick="annulerDep(${d.id})">Annuler</button>
      </div>
    </div>`;
  }).join("");
}

function majChronos() {
  document.querySelectorAll(".chrono-dep").forEach((el) => {
    el.textContent = chrono(el.dataset.depuis);
  });
  document.querySelectorAll(".chrono[data-depuis]").forEach((el) => {
    el.textContent = chrono(el.dataset.depuis);
  });
}

function ouvrirNouveauDep() {
  document.getElementById("f-client").value = "";
  document.getElementById("f-lieu").value = "";
  document.getElementById("f-desc").value = "";
  document.querySelector('#f-priorite input[value="normale"]').checked = true;
  const sel = document.getElementById("f-tech");
  sel.innerHTML = `<option value="">— Laisser non assigné —</option>` +
    (_etat ? _etat.techniciens.map((t) => `<option value="${t.id}">${ech(t.nom)} — ${LIB_STATUT[t.statut]}</option>`).join("") : "");
  ouvrir("modale-dep");
  document.getElementById("f-client").focus();
}

async function creerDepannage() {
  const client = document.getElementById("f-client").value.trim();
  if (!client) { document.getElementById("f-client").focus(); return; }
  const corps = {
    client,
    lieu: document.getElementById("f-lieu").value.trim(),
    description: document.getElementById("f-desc").value.trim(),
    priorite: document.querySelector('#f-priorite input:checked').value,
    technicien_id: document.getElementById("f-tech").value || null,
  };
  try { await api("/api/depannage", "POST", corps); fermer("modale-dep"); rafraichirDashboard(); }
  catch (e) { alert(e.message); }
}

function ouvrirAssign(id) {
  _assignCible = id;
  const sel = document.getElementById("a-tech");
  sel.innerHTML = _etat.techniciens.map((t) => {
    const alerte = t.etat === "depasse" ? " ⛔" : (t.etat === "attention" ? " ⚠" : "");
    return `<option value="${t.id}">${ech(t.nom)} — ${LIB_STATUT[t.statut]} (${fmtH(t.heures_jour)} auj.)${alerte}</option>`;
  }).join("");
  sel.onchange = majAvertAssign;
  majAvertAssign();
  ouvrir("modale-assign");
}

function majAvertAssign() {
  const id = document.getElementById("a-tech").value;
  const t = _etat.techniciens.find((x) => String(x.id) === String(id));
  const av = document.getElementById("a-avert");
  if (t && t.etat === "depasse") {
    av.style.display = "block"; av.style.color = "var(--depasse)";
    av.textContent = `⛔ ${t.nom} a atteint un plafond horaire (${fmtH(t.heures_jour)} aujourd'hui, ${fmtH(t.heures_semaine)} cette semaine).`;
  } else if (t && t.etat === "attention") {
    av.style.display = "block"; av.style.color = "var(--attention)";
    av.textContent = `⚠ ${t.nom} approche du plafond (${fmtH(t.heures_jour)} aujourd'hui, ${fmtH(t.heures_semaine)} cette semaine).`;
  } else { av.style.display = "none"; }
}

async function confirmerAssign() {
  const tech = document.getElementById("a-tech").value;
  try { await api(`/api/depannage/${_assignCible}/assigner`, "POST", { technicien_id: tech }); fermer("modale-assign"); rafraichirDashboard(); }
  catch (e) { alert(e.message); }
}

async function annulerDep(id) {
  if (!confirm("Annuler ce dépannage ?")) return;
  try { await api(`/api/depannage/${id}/annuler`, "POST", {}); rafraichirDashboard(); }
  catch (e) { alert(e.message); }
}

/* =====================================================================
   VUE TECHNICIEN (mobile)
===================================================================== */
function demarrerTechnicien() {
  horloge(); setInterval(horloge, 1000);
  document.querySelectorAll("#mes-boutons-statut button").forEach((b) => {
    b.addEventListener("click", () => changerMonStatut(b.dataset.statut));
  });
  rafraichirTech();
  setInterval(rafraichirTech, INTERVALLE);
  setInterval(majChronosTech, 1000);
}

async function rafraichirTech() {
  try {
    const etat = await api("/api/etat");
    _etat = etat;
    if (etat.moi) rendreMonStatut(etat.moi, etat.plafonds);
    rendreMesDepannages(etat);
  } catch (e) { console.error(e); }
}

function rendreMonStatut(moi, pl) {
  document.getElementById("mon-nom").textContent = moi.nom;
  const carte = document.getElementById("mon-statut");
  carte.className = "mon-statut st-" + moi.statut;
  const p = document.getElementById("ma-pastille");
  p.className = "pastille grande-pastille " + moi.statut;
  p.textContent = LIB_STATUT[moi.statut];

  document.getElementById("mes-jauges").innerHTML =
    jaugeHTML("Aujourd'hui", moi.heures_jour, pl.max_jour, jJour(moi, pl)) +
    jaugeHTML("Cette semaine", moi.heures_semaine, pl.max_semaine, jSem(moi, pl));

  document.querySelectorAll("#mes-boutons-statut button").forEach((b) => {
    b.classList.toggle("actif", b.dataset.statut === moi.statut);
    // désactiver le changement manuel si une intervention est en cours
    b.disabled = (moi.statut === "en_depannage");
  });
}

function rendreMesDepannages(etat) {
  const miens = etat.depannages.filter((d) => d.technicien_id === window.MOI && (d.statut === "assigne" || d.statut === "en_cours"));
  const libres = etat.depannages.filter((d) => d.statut === "nouveau");

  document.getElementById("compte-mes-dep").textContent = miens.length;
  document.getElementById("compte-libres").textContent = libres.length;

  const mesEl = document.getElementById("mes-depannages");
  mesEl.innerHTML = miens.length ? miens.map((d) => carteDepTech(d, true)).join("")
    : `<div class="vide">Aucune intervention assignée.</div>`;

  const libEl = document.getElementById("depannages-libres");
  libEl.innerHTML = libres.length ? libres.map((d) => carteDepTech(d, false)).join("")
    : `<div class="vide">Rien à prendre pour le moment.</div>`;
}

function carteDepTech(d, estMien) {
  let action = "";
  if (d.statut === "en_cours") {
    action = `<div class="chrono" data-depuis="${d.date_debut}">${chrono(d.date_debut)}</div>
      <button class="btn danger grand" onclick="terminerDep(${d.id})">Terminer l'intervention</button>`;
  } else if (d.statut === "assigne" && estMien) {
    action = `<button class="btn succes grand" onclick="demarrerDep(${d.id})">Démarrer l'intervention</button>`;
  } else if (d.statut === "nouveau") {
    action = `<button class="btn primaire grand" onclick="prendreDep(${d.id})">Prendre &amp; démarrer</button>`;
  }
  return `<div class="carte-dep-tech pri-${d.priorite}">
    <div class="haut">
      <div><div class="client">${ech(d.client)}</div>
      ${d.lieu ? `<div class="lieu">${ech(d.lieu)}</div>` : ""}</div>
      <span class="tag pri-${d.priorite}">${d.priorite}</span>
    </div>
    ${d.description ? `<div class="desc">${ech(d.description)}</div>` : ""}
    ${action}
  </div>`;
}

function majChronosTech() {
  document.querySelectorAll(".chrono[data-depuis]").forEach((el) => { el.textContent = chrono(el.dataset.depuis); });
}

async function demarrerDep(id) {
  try { await api(`/api/depannage/${id}/demarrer`, "POST", {}); rafraichirTech(); }
  catch (e) { alert(e.message); }
}
async function prendreDep(id) {
  // un non-assigné : le démarrer se l'assigne automatiquement
  try { await api(`/api/depannage/${id}/demarrer`, "POST", {}); rafraichirTech(); }
  catch (e) { alert(e.message); }
}
async function terminerDep(id) {
  if (!confirm("Terminer cette intervention ? L'heure de fin sera enregistrée.")) return;
  try { await api(`/api/depannage/${id}/terminer`, "POST", {}); rafraichirTech(); }
  catch (e) { alert(e.message); }
}
async function changerMonStatut(statut) {
  try { await api(`/api/technicien/${window.MOI}/statut`, "POST", { statut }); rafraichirTech(); }
  catch (e) { alert(e.message); }
}

/* =====================================================================
   PLANNING — vue mensuelle, une colonne par équipe (+ Back-up éventuel)
===================================================================== */
let _moisCourant = null;
let _equipesPlanning = [];
let _gardeCtx = null;   // { equipe, jour, slot }

function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), j = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${j}`;
}
function premierDuMois(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function nbJoursMois(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

async function demarrerPlanning() {
  brancherFermetures();
  horloge(); setInterval(horloge, 1000);
  _moisCourant = premierDuMois(new Date());
  try { _equipesPlanning = await api("/api/equipes"); } catch (e) {}

  document.getElementById("mois-prec").addEventListener("click", () => { _moisCourant = new Date(_moisCourant.getFullYear(), _moisCourant.getMonth() - 1, 1); rendrePlanning(); });
  document.getElementById("mois-suiv").addEventListener("click", () => { _moisCourant = new Date(_moisCourant.getFullYear(), _moisCourant.getMonth() + 1, 1); rendrePlanning(); });
  document.getElementById("mois-auj").addEventListener("click", () => { _moisCourant = premierDuMois(new Date()); rendrePlanning(); });

  const bx = document.getElementById("btn-export");
  if (bx) bx.addEventListener("click", exporterPlanning);
  const bi = document.getElementById("btn-import");
  const fi = document.getElementById("fichier-import");
  if (bi && fi) {
    bi.addEventListener("click", () => fi.click());
    fi.addEventListener("change", importerPlanning);
  }

  rendrePlanning();
}

function moisCode() {
  return `${_moisCourant.getFullYear()}-${String(_moisCourant.getMonth() + 1).padStart(2, "0")}`;
}

function exporterPlanning() {
  window.location.href = `/api/planning/export?mois=${moisCode()}`;
}

async function importerPlanning(ev) {
  const f = ev.target.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append("fichier", f);
  try {
    const r = await fetch("/api/planning/import", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) { alert(d.erreur || "Import impossible."); }
    else {
      let msg = `${d.importes} garde(s) importée(s).`;
      if (d.nb_ignores) msg += `\n${d.nb_ignores} ligne(s) ignorée(s) :\n- ` + d.ignores.join("\n- ");
      alert(msg);
      rendrePlanning();
    }
  } catch (e) { alert("Import impossible : " + e.message); }
  ev.target.value = "";
}

async function rendrePlanning() {
  const an = _moisCourant.getFullYear(), mo = _moisCourant.getMonth();
  const nb = nbJoursMois(_moisCourant);
  document.getElementById("mois-titre").textContent =
    _moisCourant.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const debut = isoDate(new Date(an, mo, 1));
  const fin = isoDate(new Date(an, mo, nb));
  let gardes = [];
  try { gardes = await api(`/api/gardes?debut=${debut}&fin=${fin}`); } catch (e) {}

  // index : "equipeId|jour|slot" -> { nom, couleur } du technicien
  const idx = {};
  gardes.forEach((g) => { idx[g.equipe_id + "|" + g.jour + "|" + g.slot] = { nom: g.technicien_nom, couleur: g.technicien_couleur }; });

  const estAdmin = window.MON_ROLE === "admin";
  const equipes = _equipesPlanning;
  const info = document.getElementById("planning-info");

  if (!equipes.length) {
    document.getElementById("planning-mois").innerHTML = "";
    info.innerHTML = `<div class="vide">Aucune équipe. ${estAdmin
      ? "Créez des équipes dans l'onglet Administration pour composer le planning."
      : "L'administrateur n'a pas encore créé d'équipe."}</div>`;
    return;
  }
  info.innerHTML = estAdmin
    ? `<div class="planning-aide">Cliquez une case pour choisir le technicien d'astreinte (titulaire ou back-up).</div>`
    : "";

  // Deux lignes d'en-tête : équipes, puis sous-postes pour les équipes en double colonne.
  let h1 = `<tr><th class="coin" rowspan="2">Jour</th>`;
  let h2 = `<tr>`;
  equipes.forEach((e) => {
    if (e.deux_colonnes) {
      h1 += `<th class="col-eq" colspan="2" style="border-top:3px solid ${e.couleur}">${ech(e.nom)}</th>`;
      h2 += `<th class="sous">Titulaire</th><th class="sous back">Back-up</th>`;
    } else {
      h1 += `<th class="col-eq" rowspan="2" style="border-top:3px solid ${e.couleur}">${ech(e.nom)}</th>`;
    }
  });
  h1 += `</tr>`; h2 += `</tr>`;

  const auj = isoDate(new Date());
  let body = "";
  for (let j = 1; j <= nb; j++) {
    const dt = new Date(an, mo, j);
    const ds = isoDate(dt);
    const dow = dt.getDay();
    const we = (dow === 0 || dow === 6);
    const nomJour = dt.toLocaleDateString("fr-FR", { weekday: "short" });
    let tds = "";
    equipes.forEach((e) => {
      const slots = e.deux_colonnes ? ["titulaire", "backup"] : ["titulaire"];
      slots.forEach((slot) => {
        const g = idx[e.id + "|" + ds + "|" + slot];
        const rempli = g
          ? `<span class="pt-nom" style="background:${g.couleur}">${ech(g.nom)}</span>`
          : (estAdmin ? `<span class="pt-vide">+</span>` : "");
        const clic = estAdmin ? `onclick="ouvrirGarde(${e.id},'${ds}','${slot}')"` : "";
        const cls = "cell" + (estAdmin ? " editable" : "") + (slot === "backup" ? " backup" : "");
        tds += `<td class="${cls}" ${clic}>${rempli}</td>`;
      });
    });
    body += `<tr class="jour-row ${we ? "we" : ""} ${ds === auj ? "auj" : ""}">
      <th class="jour-cell"><span class="jnum">${j}</span> <span class="jnom">${nomJour}</span></th>${tds}</tr>`;
  }
  document.getElementById("planning-mois").innerHTML =
    `<table class="mois-table"><thead>${h1}${h2}</thead><tbody>${body}</tbody></table>`;
}

function ouvrirGarde(eid, jour, slot) {
  const eq = _equipesPlanning.find((e) => e.id === eid);
  if (!eq) return;
  _gardeCtx = { equipe: eq, jour, slot };
  const d = new Date(jour + "T00:00:00");
  const libSlot = slot === "backup" ? "Back-up" : "Titulaire";
  document.getElementById("garde-titre").textContent =
    `${eq.nom} · ${libSlot}`;
  document.getElementById("garde-sous").textContent =
    d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  const liste = document.getElementById("garde-membres");
  if (!eq.membres.length) {
    liste.innerHTML = `<div class="vide">Cette équipe n'a aucun technicien. Ajoutez-en dans l'onglet Administration.</div>`;
  } else {
    liste.innerHTML = eq.membres.map((m) =>
      `<button class="btn choix-tech" onclick="definirGarde(${m.id})"><span class="pt-dot" style="background:${m.couleur || '#64748B'}"></span>${ech(m.nom)}</button>`).join("");
  }
  setDuree(1);
  ouvrir("modale-garde");
}

function setDuree(n) {
  const inp = document.getElementById("garde-jours");
  if (inp) inp.value = n;
  document.querySelectorAll("#modale-garde .duree-chips .chip").forEach((c) =>
    c.classList.toggle("actif", parseInt(c.dataset.n) === n));
}

function lireDuree() {
  const v = parseInt(document.getElementById("garde-jours").value, 10);
  return isNaN(v) || v < 1 ? 1 : Math.min(v, 62);
}

async function definirGarde(techId) {
  const c = _gardeCtx;
  try {
    await api("/api/garde", "POST", { equipe_id: c.equipe.id, jour: c.jour, slot: c.slot, technicien_id: techId, jours: lireDuree() });
    fermer("modale-garde"); rendrePlanning();
  } catch (e) { alert(e.message); }
}

async function retirerGarde() {
  const c = _gardeCtx;
  try {
    await api("/api/garde", "POST", { equipe_id: c.equipe.id, jour: c.jour, slot: c.slot, technicien_id: null, jours: lireDuree() });
    fermer("modale-garde"); rendrePlanning();
  } catch (e) { alert(e.message); }
}


/* =====================================================================
   ADMINISTRATION DES UTILISATEURS
===================================================================== */
const LIB_ROLE = { technicien: "Technicien", dispatcher: "Dispatcher", admin: "Administrateur" };
let _pinCible = null;

function demarrerAdmin() {
  brancherFermetures();
  horloge(); setInterval(horloge, 1000);
  document.getElementById("btn-nouvel-user").addEventListener("click", ouvrirNouvelUser);
  document.getElementById("btn-creer-user").addEventListener("click", creerUser);
  document.getElementById("btn-confirmer-pin").addEventListener("click", confirmerPin);
  document.getElementById("btn-confirmer-couleur").addEventListener("click", confirmerCouleur);
  document.querySelectorAll('#u-role input').forEach((r) => r.addEventListener("change", majAideRole));
  document.getElementById("btn-nouvelle-equipe").addEventListener("click", ouvrirNouvelleEquipe);
  document.getElementById("btn-enregistrer-equipe").addEventListener("click", enregistrerEquipe);
  chargerUsers();
  chargerEquipes();
}

const COULEURS_TECH = [
  "#2563EB", "#16A34A", "#EA580C", "#DC2626", "#7C3AED", "#0891B2",
  "#CA8A04", "#DB2777", "#059669", "#4F46E5", "#B45309", "#0D9488",
  "#9333EA", "#65A30D", "#E11D48", "#0369A1", "#C026D3", "#15803D",
];
let _couleurUserCible = null;
let _couleurUserChoix = COULEURS_TECH[0];
let _couleurCreation = COULEURS_TECH[0];

const COULEURS_EQUIPE = ["#1E3A8A", "#16A34A", "#EA580C", "#DC2626", "#7C3AED", "#0891B2", "#CA8A04", "#DB2777"];
let _equipeEdit = null;      // id en cours d'édition, ou null pour création
let _techsDispo = [];        // techniciens sélectionnables
let _couleurChoisie = COULEURS_EQUIPE[0];

async function chargerEquipes() {
  let equipes = [];
  try { equipes = await api("/api/admin/equipes"); } catch (e) { return; }
  document.getElementById("compte-equipes").textContent = equipes.length;
  const l = document.getElementById("liste-equipes");
  if (!equipes.length) {
    l.innerHTML = `<div class="vide">Aucune équipe. Créez-en une pour pouvoir l'affecter au planning.</div>`;
    return;
  }
  l.innerHTML = equipes.map((e) => {
    const membres = e.membres.length
      ? e.membres.map((m) => `<span class="membre-puce">${ech(m.nom)}</span>`).join("")
      : `<span style="color:var(--ardoise-clair);font-size:13px">Aucun technicien</span>`;
    const badge = e.deux_colonnes ? `<span class="eq-badge">Titulaire + Back-up</span>` : "";
    const badgeH = e.heures_jour ? `<span class="eq-badge heures">${(+e.heures_jour).toString().replace('.', ',')} h/jour</span>` : "";
    return `<div class="carte-equipe" style="border-left:5px solid ${e.couleur}">
      <div class="eq-tete">
        <div class="eq-nom">${ech(e.nom)} ${badge} ${badgeH}</div>
        <div class="eq-actions">
          <button class="btn" onclick="ouvrirEditionEquipe(${e.id})">Modifier</button>
          <button class="btn danger" onclick="supprimerEquipe(${e.id}, '${ech(e.nom).replace(/'/g, "\\'")}')">Supprimer</button>
        </div>
      </div>
      <div class="eq-membres">${membres}</div>
    </div>`;
  }).join("");
}

async function ouvrirNouvelleEquipe() {
  _equipeEdit = null;
  document.getElementById("equipe-titre").textContent = "Nouvelle équipe";
  document.getElementById("e-nom").value = "";
  document.getElementById("e-deux").checked = false;
  document.getElementById("e-heures").value = "";
  _couleurChoisie = COULEURS_EQUIPE[0];
  await rendreSelecteurEquipe([]);
  ouvrir("modale-equipe");
  document.getElementById("e-nom").focus();
}

async function ouvrirEditionEquipe(id) {
  let equipes = [];
  try { equipes = await api("/api/admin/equipes"); } catch (e) { return; }
  const eq = equipes.find((x) => x.id === id);
  if (!eq) return;
  _equipeEdit = id;
  document.getElementById("equipe-titre").textContent = "Modifier l'équipe";
  document.getElementById("e-nom").value = eq.nom;
  document.getElementById("e-deux").checked = !!eq.deux_colonnes;
  document.getElementById("e-heures").value = eq.heures_jour ? eq.heures_jour : "";
  _couleurChoisie = eq.couleur;
  await rendreSelecteurEquipe(eq.membres.map((m) => m.id));
  ouvrir("modale-equipe");
}

async function rendreSelecteurEquipe(idsSelectionnes) {
  // pastilles de couleur
  document.getElementById("e-couleurs").innerHTML = COULEURS_EQUIPE.map((c) =>
    `<button type="button" class="pastille-couleur ${c === _couleurChoisie ? "actif" : ""}"
      style="background:${c}" data-couleur="${c}" onclick="choisirCouleur('${c}')"></button>`).join("");
  // liste des techniciens (cases à cocher)
  try { _techsDispo = await api("/api/techniciens"); } catch (e) { _techsDispo = []; }
  const set = new Set(idsSelectionnes);
  document.getElementById("e-membres").innerHTML = _techsDispo.length
    ? _techsDispo.map((t) => `<label class="membre-choix">
        <input type="checkbox" value="${t.id}" ${set.has(t.id) ? "checked" : ""}>
        <span>${ech(t.nom)}</span></label>`).join("")
    : `<span style="color:var(--ardoise-clair);font-size:13px">Aucun technicien. Créez d'abord des utilisateurs de rôle technicien.</span>`;
}

function choisirCouleur(c) {
  _couleurChoisie = c;
  document.querySelectorAll("#e-couleurs .pastille-couleur").forEach((b) => {
    b.classList.toggle("actif", b.dataset.couleur === c);
  });
}

async function enregistrerEquipe() {
  const nom = document.getElementById("e-nom").value.trim();
  if (!nom) { document.getElementById("e-nom").focus(); return; }
  const membres = Array.from(document.querySelectorAll("#e-membres input:checked")).map((c) => parseInt(c.value));
  const corps = {
    nom, couleur: _couleurChoisie, membres,
    deux_colonnes: document.getElementById("e-deux").checked ? 1 : 0,
    heures_jour: document.getElementById("e-heures").value || 0,
  };
  const url = _equipeEdit ? `/api/admin/equipe/${_equipeEdit}` : "/api/admin/equipe";
  try { await api(url, "POST", corps); fermer("modale-equipe"); chargerEquipes(); }
  catch (e) { alert(e.message); }
}

async function supprimerEquipe(id, nom) {
  if (!confirm(`Supprimer l'équipe « ${nom} » ? Ses affectations de planning seront aussi retirées.`)) return;
  try { await api(`/api/admin/equipe/${id}`, "DELETE"); chargerEquipes(); }
  catch (e) { alert(e.message); }
}

async function chargerUsers() {
  let users = [];
  try { users = await api("/api/admin/utilisateurs"); } catch (e) { alert(e.message); return; }
  document.getElementById("compte-users").textContent = users.length;
  const l = document.getElementById("liste-users");
  l.innerHTML = users.map((u) => {
    const inactif = u.actif ? "" : " inactif";
    const estTech = u.role === "technicien";
    const dot = estTech ? `<span class="pt-dot" style="background:${u.couleur || '#64748B'}"></span>` : "";
    const btnCouleur = estTech
      ? `<button class="btn" onclick="ouvrirCouleur(${u.id}, '${ech(u.nom).replace(/'/g, "\\'")}', '${u.couleur || '#64748B'}')">Couleur</button>` : "";
    return `<div class="carte-user${inactif}">
      <div class="u-ident">
        <div class="u-nom">${dot}${ech(u.nom)}${u.actif ? "" : ' <span class="u-tag-inactif">désactivé</span>'}</div>
        <div class="u-meta">
          <span class="u-role r-${u.role}">${LIB_ROLE[u.role] || u.role}</span>
          ${u.telephone ? `<span class="u-tel">${ech(u.telephone)}</span>` : ""}
        </div>
      </div>
      <div class="u-actions">
        ${btnCouleur}
        <button class="btn" onclick="ouvrirPin(${u.id}, '${ech(u.nom).replace(/'/g, "\\'")}')">PIN</button>
        ${u.actif
          ? `<button class="btn" onclick="basculerActif(${u.id}, false)">Désactiver</button>`
          : `<button class="btn succes" onclick="basculerActif(${u.id}, true)">Réactiver</button>`}
        <button class="btn danger" onclick="supprimerUser(${u.id}, '${ech(u.nom).replace(/'/g, "\\'")}')">Supprimer</button>
      </div>
    </div>`;
  }).join("");
}

function paletteHTML(containerId, couleurActive, cb) {
  document.getElementById(containerId).innerHTML = COULEURS_TECH.map((c) =>
    `<button type="button" class="pastille-couleur ${c === couleurActive ? "actif" : ""}"
      style="background:${c}" data-couleur="${c}" onclick="${cb}('${c}')"></button>`).join("");
}

function choisirCouleurCreation(c) {
  _couleurCreation = c;
  document.querySelectorAll("#u-couleurs .pastille-couleur").forEach((b) => b.classList.toggle("actif", b.dataset.couleur === c));
}

function ouvrirCouleur(id, nom, couleur) {
  _couleurUserCible = id;
  _couleurUserChoix = couleur;
  document.getElementById("couleur-titre").textContent = "Couleur — " + nom;
  paletteHTML("c-couleurs", couleur, "choisirCouleurUser");
  ouvrir("modale-couleur");
}

function choisirCouleurUser(c) {
  _couleurUserChoix = c;
  document.querySelectorAll("#c-couleurs .pastille-couleur").forEach((b) => b.classList.toggle("actif", b.dataset.couleur === c));
}

async function confirmerCouleur() {
  try {
    await api(`/api/admin/utilisateur/${_couleurUserCible}/couleur`, "POST", { couleur: _couleurUserChoix });
    fermer("modale-couleur"); chargerUsers();
  } catch (e) { alert(e.message); }
}

function majAideRole() {
  const role = document.querySelector('#u-role input:checked').value;
  const aides = {
    technicien: "Accède à ses interventions, démarre/termine les dépannages, voit ses heures.",
    dispatcher: "Accède au tableau de bord, crée et assigne les dépannages, gère le planning.",
    admin: "Accès complet, dont cette page de gestion des utilisateurs.",
  };
  document.getElementById("u-aide").textContent = aides[role] || "";
}

function ouvrirNouvelUser() {
  document.getElementById("u-nom").value = "";
  document.getElementById("u-tel").value = "";
  document.getElementById("u-pin").value = "";
  document.querySelector('#u-role input[value="technicien"]').checked = true;
  _couleurCreation = COULEURS_TECH[0];
  paletteHTML("u-couleurs", _couleurCreation, "choisirCouleurCreation");
  majAideRole();
  ouvrir("modale-user");
  document.getElementById("u-nom").focus();
}

async function creerUser() {
  const corps = {
    nom: document.getElementById("u-nom").value.trim(),
    telephone: document.getElementById("u-tel").value.trim(),
    role: document.querySelector('#u-role input:checked').value,
    pin: document.getElementById("u-pin").value.trim(),
    couleur: _couleurCreation,
  };
  if (!corps.nom) { document.getElementById("u-nom").focus(); return; }
  if (corps.pin.length < 4) { alert("Le code PIN doit faire au moins 4 chiffres."); return; }
  try { await api("/api/admin/utilisateur", "POST", corps); fermer("modale-user"); chargerUsers(); }
  catch (e) { alert(e.message); }
}

function ouvrirPin(id, nom) {
  _pinCible = id;
  document.getElementById("pin-titre").textContent = "Réinitialiser le PIN — " + nom;
  document.getElementById("p-nouveau-pin").value = "";
  ouvrir("modale-pin");
  document.getElementById("p-nouveau-pin").focus();
}

async function confirmerPin() {
  const pin = document.getElementById("p-nouveau-pin").value.trim();
  if (pin.length < 4) { alert("Le code PIN doit faire au moins 4 chiffres."); return; }
  try { await api(`/api/admin/utilisateur/${_pinCible}/pin`, "POST", { pin }); fermer("modale-pin"); }
  catch (e) { alert(e.message); }
}

async function basculerActif(id, actif) {
  try { await api(`/api/admin/utilisateur/${id}/actif`, "POST", { actif }); chargerUsers(); }
  catch (e) { alert(e.message); }
}

async function supprimerUser(id, nom) {
  if (!confirm(`Supprimer l'utilisateur « ${nom} » ?`)) return;
  try {
    const r = await api(`/api/admin/utilisateur/${id}`, "DELETE");
    if (r.info) alert(r.info);
    chargerUsers();
  } catch (e) { alert(e.message); }
}
