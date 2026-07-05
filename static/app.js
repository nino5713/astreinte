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
    rendreBandeau(_etat);
    rendreTechniciens(_etat);
    rendreDepannagesDispatch(_etat);
  } catch (e) { console.error(e); }
}

function rendreBandeau(etat) {
  const el = document.getElementById("bandeau-astreinte");
  const noms = etat.astreinte_jour.map((a) => `<span class="puce">${ech(a.technicien_nom)}</span>`).join("");
  el.innerHTML = `<div class="bandeau-astreinte">
    <div><div class="etiq">Astreinte du jour</div>
    <div class="noms">${noms || "<span style='color:#C7D2FE;font-weight:500'>Aucune astreinte planifiée aujourd'hui</span>"}</div></div>
  </div>`;
}

function rendreTechniciens(etat) {
  const g = document.getElementById("grille-tech");
  document.getElementById("compte-tech").textContent = etat.techniciens.length;
  g.innerHTML = etat.techniciens.map((t) => {
    const niv = t.etat;
    return `<div class="carte-tech st-${t.statut}">
      <div class="tete">
        <div><div class="nom">${ech(t.nom)}</div>
        <div class="tel">${ech(t.telephone || "")}</div></div>
        <span class="pastille ${t.statut}">${LIB_STATUT[t.statut]}</span>
      </div>
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
    const moi = etat.techniciens.find((t) => t.id === window.MOI);
    if (moi) rendreMonStatut(moi, etat.plafonds);
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
   PLANNING
===================================================================== */
let _lundiCourant = null;
let _techsCache = [];
let _jourCible = null;

function lundiDe(date) {
  const d = new Date(date);
  const j = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - j); d.setHours(0, 0, 0, 0);
  return d;
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function ajouterJours(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

async function demarrerPlanning() {
  brancherFermetures();
  horloge(); setInterval(horloge, 1000);
  _lundiCourant = lundiDe(new Date());
  try { _techsCache = await api("/api/techniciens"); } catch (e) {}

  document.getElementById("sem-prec").addEventListener("click", () => { _lundiCourant = ajouterJours(_lundiCourant, -7); rendrePlanning(); });
  document.getElementById("sem-suiv").addEventListener("click", () => { _lundiCourant = ajouterJours(_lundiCourant, 7); rendrePlanning(); });
  document.getElementById("sem-auj").addEventListener("click", () => { _lundiCourant = lundiDe(new Date()); rendrePlanning(); });
  const btnCreer = document.getElementById("btn-creer-astreinte");
  if (btnCreer) btnCreer.addEventListener("click", creerAstreinte);

  rendrePlanning();
}

async function rendrePlanning() {
  const debut = isoDate(_lundiCourant);
  const fin = isoDate(ajouterJours(_lundiCourant, 6));
  document.getElementById("sem-titre").textContent =
    `${_lundiCourant.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} – ${ajouterJours(_lundiCourant, 6).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;

  let astreintes = [];
  try { astreintes = await api(`/api/astreintes?debut=${debut}&fin=${fin}`); } catch (e) {}

  const auj = isoDate(new Date());
  const dispatcher = window.MON_ROLE === "dispatcher";
  const g = document.getElementById("planning-grille");
  let html = "";
  for (let i = 0; i < 7; i++) {
    const jour = ajouterJours(_lundiCourant, i);
    const ds = isoDate(jour);
    const we = (i >= 5);
    const dujour = astreintes.filter((a) => a.date_debut <= ds && a.date_fin >= ds);
    const puces = dujour.map((a) => `<span class="puce-astreinte">${ech(a.technicien_nom)}
        ${dispatcher ? `<button class="x" onclick="suppAstreinte(${a.id})" title="Retirer">×</button>` : ""}</span>`).join("");
    html += `<div class="jour-ligne ${we ? "we" : ""} ${ds === auj ? "aujourdhui" : ""}">
      <div class="date">${jour.getDate()}<small>${jour.toLocaleDateString("fr-FR", { weekday: "long" })}</small></div>
      <div class="affectations">
        ${puces || `<span style="color:var(--ardoise-clair);font-size:13px">Personne</span>`}
        ${dispatcher ? `<button class="btn fantome" style="padding:4px 10px" onclick="ouvrirAstreinte('${ds}')">＋</button>` : ""}
      </div>
    </div>`;
  }
  g.innerHTML = html;
}

function ouvrirAstreinte(ds) {
  _jourCible = ds;
  const sel = document.getElementById("p-tech");
  sel.innerHTML = _techsCache.map((t) => `<option value="${t.id}">${ech(t.nom)}</option>`).join("");
  document.getElementById("p-debut").value = ds;
  document.getElementById("p-fin").value = ds;
  document.getElementById("p-libelle").value = "";
  ouvrir("modale-astreinte");
}

async function creerAstreinte() {
  const corps = {
    technicien_id: document.getElementById("p-tech").value,
    date_debut: document.getElementById("p-debut").value,
    date_fin: document.getElementById("p-fin").value,
    libelle: document.getElementById("p-libelle").value.trim(),
  };
  if (!corps.technicien_id || !corps.date_debut) return;
  try { await api("/api/astreinte", "POST", corps); fermer("modale-astreinte"); rendrePlanning(); }
  catch (e) { alert(e.message); }
}

async function suppAstreinte(id) {
  if (!confirm("Retirer cette affectation d'astreinte ?")) return;
  try { await api(`/api/astreinte/${id}`, "DELETE"); rendrePlanning(); }
  catch (e) { alert(e.message); }
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
  document.querySelectorAll('#u-role input').forEach((r) => r.addEventListener("change", majAideRole));
  chargerUsers();
}

async function chargerUsers() {
  let users = [];
  try { users = await api("/api/admin/utilisateurs"); } catch (e) { alert(e.message); return; }
  document.getElementById("compte-users").textContent = users.length;
  const l = document.getElementById("liste-users");
  l.innerHTML = users.map((u) => {
    const inactif = u.actif ? "" : " inactif";
    return `<div class="carte-user${inactif}">
      <div class="u-ident">
        <div class="u-nom">${ech(u.nom)}${u.actif ? "" : ' <span class="u-tag-inactif">désactivé</span>'}</div>
        <div class="u-meta">
          <span class="u-role r-${u.role}">${LIB_ROLE[u.role] || u.role}</span>
          ${u.telephone ? `<span class="u-tel">${ech(u.telephone)}</span>` : ""}
        </div>
      </div>
      <div class="u-actions">
        <button class="btn" onclick="ouvrirPin(${u.id}, '${ech(u.nom).replace(/'/g, "\\'")}')">PIN</button>
        ${u.actif
          ? `<button class="btn" onclick="basculerActif(${u.id}, false)">Désactiver</button>`
          : `<button class="btn succes" onclick="basculerActif(${u.id}, true)">Réactiver</button>`}
        <button class="btn danger" onclick="supprimerUser(${u.id}, '${ech(u.nom).replace(/'/g, "\\'")}')">Supprimer</button>
      </div>
    </div>`;
  }).join("");
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
