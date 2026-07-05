"""
SOCOM - Gestion des astreintes
Application standalone : planning d'astreinte, demandes de dépannage,
statut temps réel des techniciens et compteur horaire (10h/jour, 48h/semaine).

Stack : Flask + SQLite. Conçu pour un déploiement gunicorn + nginx (VPS).
"""

import os
import sqlite3
from datetime import datetime, timedelta, time as dtime
from functools import wraps
from zoneinfo import ZoneInfo

from flask import (
    Flask, g, request, session, redirect, url_for,
    render_template, jsonify, abort, send_from_directory, Response
)
from werkzeug.security import generate_password_hash, check_password_hash

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "astreinte.db")
TZ = ZoneInfo("Europe/Luxembourg")

# Plafonds légaux (modifiables). Le seuil "alerte" déclenche l'avertissement.
MAX_H_JOUR = 10.0
MAX_H_SEMAINE = 48.0
ALERTE_H_JOUR = 8.0        # ambre au-delà
ALERTE_H_SEMAINE = 40.0    # ambre au-delà

STATUTS_TECH = ["disponible", "en_depannage", "repos", "indisponible"]
STATUTS_DEP = ["nouveau", "assigne", "en_cours", "termine", "annule"]
PRIORITES = ["normale", "urgente", "critique"]
ROLES = ["technicien", "dispatcher", "admin"]

app = Flask(__name__)
app.secret_key = os.environ.get("ASTREINTE_SECRET", "change-me-en-production")


# --------------------------------------------------------------------------
# Base de données
# --------------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS techniciens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            telephone TEXT,
            role TEXT NOT NULL DEFAULT 'technicien',   -- 'technicien' | 'dispatcher'
            pin_hash TEXT NOT NULL,
            statut TEXT NOT NULL DEFAULT 'disponible',
            actif INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS depannages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client TEXT NOT NULL,
            lieu TEXT,
            description TEXT,
            priorite TEXT NOT NULL DEFAULT 'normale',
            statut TEXT NOT NULL DEFAULT 'nouveau',
            technicien_id INTEGER REFERENCES techniciens(id),
            date_creation TEXT NOT NULL,
            date_debut TEXT,      -- clic "Démarrer l'intervention"
            date_fin TEXT,        -- clic "Terminer"
            cree_par INTEGER REFERENCES techniciens(id)
        );

        CREATE TABLE IF NOT EXISTS astreintes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            technicien_id INTEGER NOT NULL REFERENCES techniciens(id),
            date_debut TEXT NOT NULL,   -- date ISO (jour)
            date_fin TEXT NOT NULL,     -- date ISO (jour), incluse
            libelle TEXT
        );
        """
    )
    # Jeu de données initial (uniquement si vide)
    n = db.execute("SELECT COUNT(*) AS c FROM techniciens").fetchone()["c"]
    if n == 0:
        seed = [
            ("Dispatch", "", "dispatcher", "0000"),
            ("Marco Ferreira", "+352 621 000 001", "technicien", "1111"),
            ("Luc Weber", "+352 621 000 002", "technicien", "2222"),
            ("Ana Silva", "+352 621 000 003", "technicien", "3333"),
            ("Tom Klein", "+352 621 000 004", "technicien", "4444"),
        ]
        for nom, tel, role, pin in seed:
            db.execute(
                "INSERT INTO techniciens (nom, telephone, role, pin_hash) VALUES (?,?,?,?)",
                (nom, tel, role, generate_password_hash(pin)),
            )
        db.commit()
    db.close()


# --------------------------------------------------------------------------
# Utilitaires temps / compteur horaire
# --------------------------------------------------------------------------
def now_tz():
    return datetime.now(TZ)


def iso(dt):
    return dt.isoformat()


def parse(s):
    if not s:
        return None
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt


def _overlap_heures(deb, fin, borne_debut, borne_fin):
    """Durée (heures) de l'intersection [deb,fin] ∩ [borne_debut,borne_fin]."""
    start = max(deb, borne_debut)
    end = min(fin, borne_fin)
    if end <= start:
        return 0.0
    return (end - start).total_seconds() / 3600.0


def bornes_jour(ref_date):
    debut = datetime.combine(ref_date, dtime.min, tzinfo=TZ)
    return debut, debut + timedelta(days=1)


def bornes_semaine(ref_date):
    # Semaine ISO : lundi -> dimanche
    lundi = ref_date - timedelta(days=ref_date.isoweekday() - 1)
    debut = datetime.combine(lundi, dtime.min, tzinfo=TZ)
    return debut, debut + timedelta(days=7)


def heures_technicien(db, tech_id, ref=None):
    """Retourne les heures travaillées sur le jour et la semaine en cours.

    Calcul basé sur les interventions (date_debut -> date_fin). Une
    intervention en cours compte jusqu'à maintenant. Les interventions à
    cheval sur minuit sont découpées correctement (clipping)."""
    if ref is None:
        ref = now_tz()
    ref_date = ref.date()
    jd, jf = bornes_jour(ref_date)
    sd, sf = bornes_semaine(ref_date)

    rows = db.execute(
        """SELECT date_debut, date_fin FROM depannages
           WHERE technicien_id = ? AND date_debut IS NOT NULL
             AND statut IN ('en_cours', 'termine')""",
        (tech_id,),
    ).fetchall()

    h_jour = h_sem = 0.0
    for r in rows:
        deb = parse(r["date_debut"])
        fin = parse(r["date_fin"]) if r["date_fin"] else now_tz()
        h_jour += _overlap_heures(deb, fin, jd, jf)
        h_sem += _overlap_heures(deb, fin, sd, sf)
    return {"jour": round(h_jour, 2), "semaine": round(h_sem, 2)}


def etat_horaire(h_jour, h_sem):
    """Niveau d'alerte global : ok / attention / depasse."""
    if h_jour >= MAX_H_JOUR or h_sem >= MAX_H_SEMAINE:
        return "depasse"
    if h_jour >= ALERTE_H_JOUR or h_sem >= ALERTE_H_SEMAINE:
        return "attention"
    return "ok"


# --------------------------------------------------------------------------
# Authentification
# --------------------------------------------------------------------------
def courant(db):
    uid = session.get("uid")
    if not uid:
        return None
    return db.execute("SELECT * FROM techniciens WHERE id = ?", (uid,)).fetchone()


def login_requis(f):
    @wraps(f)
    def wrap(*a, **kw):
        if not session.get("uid"):
            if request.path.startswith("/api/"):
                return jsonify({"erreur": "non authentifié"}), 401
            return redirect(url_for("login"))
        return f(*a, **kw)
    return wrap


def dispatcher_requis(f):
    @wraps(f)
    def wrap(*a, **kw):
        db = get_db()
        u = courant(db)
        if not u:
            return redirect(url_for("login"))
        # L'admin est un super-utilisateur : il passe aussi les portes dispatcher.
        if u["role"] not in ("dispatcher", "admin"):
            if request.path.startswith("/api/"):
                return jsonify({"erreur": "réservé au dispatcher"}), 403
            return redirect(url_for("vue_technicien"))
        return f(*a, **kw)
    return wrap


def admin_requis(f):
    @wraps(f)
    def wrap(*a, **kw):
        db = get_db()
        u = courant(db)
        if not u:
            return redirect(url_for("login"))
        if u["role"] != "admin":
            if request.path.startswith("/api/"):
                return jsonify({"erreur": "réservé à l'administrateur"}), 403
            return redirect(url_for("index"))
        return f(*a, **kw)
    return wrap


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    db = get_db()
    u = courant(db)
    if not u:
        return redirect(url_for("login"))
    if u["role"] == "admin":
        return redirect(url_for("admin"))
    if u["role"] == "dispatcher":
        return redirect(url_for("dashboard"))
    return redirect(url_for("vue_technicien"))


@app.route("/login", methods=["GET", "POST"])
def login():
    db = get_db()
    erreur = None
    if request.method == "POST":
        uid = request.form.get("technicien_id")
        pin = request.form.get("pin", "")
        row = db.execute(
            "SELECT * FROM techniciens WHERE id = ? AND actif = 1", (uid,)
        ).fetchone()
        if row and check_password_hash(row["pin_hash"], pin):
            session["uid"] = row["id"]
            return redirect(url_for("index"))
        erreur = "Code PIN incorrect."
    techs = db.execute(
        "SELECT id, nom, role FROM techniciens WHERE actif = 1 ORDER BY role DESC, nom"
    ).fetchall()
    return render_template("login.html", techniciens=techs, erreur=erreur)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/dashboard")
@dispatcher_requis
def dashboard():
    db = get_db()
    return render_template("dashboard.html", utilisateur=courant(db),
                           priorites=PRIORITES)


@app.route("/technicien")
@login_requis
def vue_technicien():
    db = get_db()
    return render_template("technicien.html", utilisateur=courant(db))


@app.route("/planning")
@login_requis
def planning():
    db = get_db()
    return render_template("planning.html", utilisateur=courant(db))


@app.route("/admin")
@admin_requis
def admin():
    db = get_db()
    return render_template("admin.html", utilisateur=courant(db), roles=ROLES)


# --------------------------------------------------------------------------
# API — administration des utilisateurs (réservé admin)
# --------------------------------------------------------------------------
LIB_ROLE = {"technicien": "Technicien", "dispatcher": "Dispatcher", "admin": "Administrateur"}


@app.route("/api/admin/utilisateurs")
@admin_requis
def api_admin_liste():
    db = get_db()
    rows = db.execute(
        "SELECT id, nom, telephone, role, statut, actif FROM techniciens ORDER BY actif DESC, role DESC, nom"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/admin/utilisateur", methods=["POST"])
@admin_requis
def api_admin_creer():
    db = get_db()
    data = request.get_json(force=True)
    nom = (data.get("nom") or "").strip()
    role = data.get("role", "technicien")
    pin = (data.get("pin") or "").strip()
    tel = (data.get("telephone") or "").strip()
    if not nom:
        return jsonify({"erreur": "Le nom est obligatoire."}), 400
    if role not in ROLES:
        return jsonify({"erreur": "Rôle invalide."}), 400
    if len(pin) < 4:
        return jsonify({"erreur": "Le code PIN doit faire au moins 4 caractères."}), 400
    existe = db.execute("SELECT 1 FROM techniciens WHERE nom = ? AND actif = 1", (nom,)).fetchone()
    if existe:
        return jsonify({"erreur": "Un utilisateur actif porte déjà ce nom."}), 400
    cur = db.execute(
        "INSERT INTO techniciens (nom, telephone, role, pin_hash, statut, actif) VALUES (?,?,?,?, 'disponible', 1)",
        (nom, tel, role, generate_password_hash(pin)),
    )
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.route("/api/admin/utilisateur/<int:uid>/pin", methods=["POST"])
@admin_requis
def api_admin_pin(uid):
    db = get_db()
    pin = (request.get_json(force=True).get("pin") or "").strip()
    if len(pin) < 4:
        return jsonify({"erreur": "Le code PIN doit faire au moins 4 caractères."}), 400
    if not db.execute("SELECT 1 FROM techniciens WHERE id = ?", (uid,)).fetchone():
        abort(404)
    db.execute("UPDATE techniciens SET pin_hash = ? WHERE id = ?", (generate_password_hash(pin), uid))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/utilisateur/<int:uid>/role", methods=["POST"])
@admin_requis
def api_admin_role(uid):
    db = get_db()
    u = courant(db)
    role = request.get_json(force=True).get("role")
    if role not in ROLES:
        return jsonify({"erreur": "Rôle invalide."}), 400
    cible = db.execute("SELECT * FROM techniciens WHERE id = ?", (uid,)).fetchone()
    if not cible:
        abort(404)
    # Ne pas rétrograder le dernier admin actif.
    if cible["role"] == "admin" and role != "admin" and _compte_admins(db, sauf=uid) == 0:
        return jsonify({"erreur": "Impossible : c'est le dernier administrateur actif."}), 400
    db.execute("UPDATE techniciens SET role = ? WHERE id = ?", (role, uid))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/utilisateur/<int:uid>/actif", methods=["POST"])
@admin_requis
def api_admin_actif(uid):
    db = get_db()
    u = courant(db)
    actif = 1 if request.get_json(force=True).get("actif") else 0
    cible = db.execute("SELECT * FROM techniciens WHERE id = ?", (uid,)).fetchone()
    if not cible:
        abort(404)
    if not actif and uid == u["id"]:
        return jsonify({"erreur": "Vous ne pouvez pas désactiver votre propre compte."}), 400
    if not actif and cible["role"] == "admin" and _compte_admins(db, sauf=uid) == 0:
        return jsonify({"erreur": "Impossible : c'est le dernier administrateur actif."}), 400
    db.execute("UPDATE techniciens SET actif = ? WHERE id = ?", (actif, uid))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/utilisateur/<int:uid>", methods=["DELETE"])
@admin_requis
def api_admin_supprimer(uid):
    db = get_db()
    u = courant(db)
    cible = db.execute("SELECT * FROM techniciens WHERE id = ?", (uid,)).fetchone()
    if not cible:
        abort(404)
    if uid == u["id"]:
        return jsonify({"erreur": "Vous ne pouvez pas supprimer votre propre compte."}), 400
    if cible["role"] == "admin" and _compte_admins(db, sauf=uid) == 0:
        return jsonify({"erreur": "Impossible : c'est le dernier administrateur actif."}), 400
    # Si l'utilisateur a un historique (dépannages / astreintes), on désactive au lieu de supprimer.
    lien = db.execute(
        "SELECT (SELECT COUNT(*) FROM depannages WHERE technicien_id=?) + (SELECT COUNT(*) FROM astreintes WHERE technicien_id=?) AS n",
        (uid, uid),
    ).fetchone()["n"]
    if lien > 0:
        db.execute("UPDATE techniciens SET actif = 0 WHERE id = ?", (uid,))
        db.commit()
        return jsonify({"ok": True, "desactive": True,
                        "info": "Compte lié à un historique : désactivé plutôt que supprimé."})
    db.execute("DELETE FROM techniciens WHERE id = ?", (uid,))
    db.commit()
    return jsonify({"ok": True, "supprime": True})


def _compte_admins(db, sauf=None):
    if sauf is None:
        return db.execute("SELECT COUNT(*) AS c FROM techniciens WHERE role='admin' AND actif=1").fetchone()["c"]
    return db.execute(
        "SELECT COUNT(*) AS c FROM techniciens WHERE role='admin' AND actif=1 AND id != ?", (sauf,)
    ).fetchone()["c"]


# --------------------------------------------------------------------------
# PWA : service worker (racine), manifeste, page hors-ligne
# --------------------------------------------------------------------------
@app.route("/sw.js")
def service_worker():
    # Servi depuis la racine pour couvrir tout le périmètre de l'app.
    resp = send_from_directory(os.path.join(BASE_DIR, "static"), "sw.js")
    resp.headers["Content-Type"] = "application/javascript"
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/manifest.webmanifest")
def manifest():
    resp = send_from_directory(os.path.join(BASE_DIR, "static"), "manifest.webmanifest")
    resp.headers["Content-Type"] = "application/manifest+json"
    return resp


@app.route("/offline")
def offline():
    return render_template("offline.html")


# --------------------------------------------------------------------------
# API — état global (polling)
# --------------------------------------------------------------------------
def serialise_depannage(r):
    d = dict(r)
    return d


@app.route("/api/etat")
@login_requis
def api_etat():
    db = get_db()
    u = courant(db)

    techs = db.execute(
        "SELECT * FROM techniciens WHERE actif = 1 ORDER BY role DESC, nom"
    ).fetchall()

    techs_out = []
    for t in techs:
        if t["role"] != "technicien":
            continue
        h = heures_technicien(db, t["id"])
        techs_out.append({
            "id": t["id"],
            "nom": t["nom"],
            "telephone": t["telephone"],
            "statut": t["statut"],
            "heures_jour": h["jour"],
            "heures_semaine": h["semaine"],
            "etat": etat_horaire(h["jour"], h["semaine"]),
        })

    deps = db.execute(
        """SELECT d.*, t.nom AS technicien_nom
           FROM depannages d LEFT JOIN techniciens t ON d.technicien_id = t.id
           WHERE d.statut != 'termine' OR d.date_fin >= ?
           ORDER BY
             CASE d.statut WHEN 'en_cours' THEN 0 WHEN 'assigne' THEN 1
                           WHEN 'nouveau' THEN 2 ELSE 3 END,
             CASE d.priorite WHEN 'critique' THEN 0 WHEN 'urgente' THEN 1 ELSE 2 END,
             d.date_creation DESC""",
        (iso(now_tz() - timedelta(hours=12)),),
    ).fetchall()

    # Astreinte du jour
    aujourdhui = now_tz().date().isoformat()
    astreinte = db.execute(
        """SELECT a.*, t.nom AS technicien_nom FROM astreintes a
           JOIN techniciens t ON a.technicien_id = t.id
           WHERE a.date_debut <= ? AND a.date_fin >= ? ORDER BY t.nom""",
        (aujourdhui, aujourdhui),
    ).fetchall()

    return jsonify({
        "maintenant": iso(now_tz()),
        "utilisateur": {"id": u["id"], "nom": u["nom"], "role": u["role"]},
        "techniciens": techs_out,
        "depannages": [serialise_depannage(d) for d in deps],
        "astreinte_jour": [dict(a) for a in astreinte],
        "plafonds": {
            "max_jour": MAX_H_JOUR, "max_semaine": MAX_H_SEMAINE,
            "alerte_jour": ALERTE_H_JOUR, "alerte_semaine": ALERTE_H_SEMAINE,
        },
    })


# --------------------------------------------------------------------------
# API — dépannages
# --------------------------------------------------------------------------
@app.route("/api/depannage", methods=["POST"])
@dispatcher_requis
def api_creer_depannage():
    db = get_db()
    u = courant(db)
    data = request.get_json(force=True)
    client = (data.get("client") or "").strip()
    if not client:
        return jsonify({"erreur": "Le client est obligatoire."}), 400
    priorite = data.get("priorite", "normale")
    if priorite not in PRIORITES:
        priorite = "normale"
    tech_id = data.get("technicien_id") or None
    statut = "assigne" if tech_id else "nouveau"
    cur = db.execute(
        """INSERT INTO depannages
           (client, lieu, description, priorite, statut, technicien_id,
            date_creation, cree_par)
           VALUES (?,?,?,?,?,?,?,?)""",
        (client, data.get("lieu", ""), data.get("description", ""),
         priorite, statut, tech_id, iso(now_tz()), u["id"]),
    )
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.route("/api/depannage/<int:did>/assigner", methods=["POST"])
@dispatcher_requis
def api_assigner(did):
    db = get_db()
    data = request.get_json(force=True)
    tech_id = data.get("technicien_id")
    dep = db.execute("SELECT * FROM depannages WHERE id = ?", (did,)).fetchone()
    if not dep:
        abort(404)
    if dep["statut"] in ("termine", "annule"):
        return jsonify({"erreur": "Dépannage déjà clôturé."}), 400
    db.execute(
        "UPDATE depannages SET technicien_id = ?, statut = 'assigne' WHERE id = ?",
        (tech_id, did),
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/depannage/<int:did>/demarrer", methods=["POST"])
@login_requis
def api_demarrer(did):
    db = get_db()
    u = courant(db)
    dep = db.execute("SELECT * FROM depannages WHERE id = ?", (did,)).fetchone()
    if not dep:
        abort(404)
    # Un technicien ne démarre que ses propres interventions ; le dispatcher peut tout.
    if u["role"] != "dispatcher":
        if dep["technicien_id"] and dep["technicien_id"] != u["id"]:
            return jsonify({"erreur": "Ce dépannage est assigné à un autre technicien."}), 403
        tech_id = u["id"]
    else:
        tech_id = dep["technicien_id"]
        if not tech_id:
            return jsonify({"erreur": "Assignez d'abord un technicien."}), 400
    if dep["statut"] in ("termine", "annule"):
        return jsonify({"erreur": "Dépannage déjà clôturé."}), 400
    if dep["statut"] == "en_cours":
        return jsonify({"erreur": "Intervention déjà démarrée."}), 400

    db.execute(
        """UPDATE depannages SET statut = 'en_cours', technicien_id = ?,
           date_debut = ? WHERE id = ?""",
        (tech_id, iso(now_tz()), did),
    )
    db.execute("UPDATE techniciens SET statut = 'en_depannage' WHERE id = ?", (tech_id,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/depannage/<int:did>/terminer", methods=["POST"])
@login_requis
def api_terminer(did):
    db = get_db()
    u = courant(db)
    dep = db.execute("SELECT * FROM depannages WHERE id = ?", (did,)).fetchone()
    if not dep:
        abort(404)
    if u["role"] != "dispatcher" and dep["technicien_id"] != u["id"]:
        return jsonify({"erreur": "Intervention d'un autre technicien."}), 403
    if dep["statut"] != "en_cours":
        return jsonify({"erreur": "Aucune intervention en cours sur ce dépannage."}), 400

    tech_id = dep["technicien_id"]
    db.execute(
        "UPDATE depannages SET statut = 'termine', date_fin = ? WHERE id = ?",
        (iso(now_tz()), did),
    )
    # Le technicien redevient disponible s'il n'a plus d'intervention en cours.
    reste = db.execute(
        "SELECT COUNT(*) AS c FROM depannages WHERE technicien_id = ? AND statut = 'en_cours'",
        (tech_id,),
    ).fetchone()["c"]
    if reste == 0:
        db.execute("UPDATE techniciens SET statut = 'disponible' WHERE id = ?", (tech_id,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/depannage/<int:did>/annuler", methods=["POST"])
@dispatcher_requis
def api_annuler(did):
    db = get_db()
    dep = db.execute("SELECT * FROM depannages WHERE id = ?", (did,)).fetchone()
    if not dep:
        abort(404)
    if dep["statut"] == "en_cours" and dep["technicien_id"]:
        reste = db.execute(
            "SELECT COUNT(*) AS c FROM depannages WHERE technicien_id = ? AND statut = 'en_cours' AND id != ?",
            (dep["technicien_id"], did),
        ).fetchone()["c"]
        if reste == 0:
            db.execute("UPDATE techniciens SET statut = 'disponible' WHERE id = ?",
                       (dep["technicien_id"],))
    db.execute("UPDATE depannages SET statut = 'annule' WHERE id = ?", (did,))
    db.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# API — statut technicien
# --------------------------------------------------------------------------
@app.route("/api/technicien/<int:tid>/statut", methods=["POST"])
@login_requis
def api_statut_tech(tid):
    db = get_db()
    u = courant(db)
    if u["role"] != "dispatcher" and u["id"] != tid:
        return jsonify({"erreur": "Non autorisé."}), 403
    data = request.get_json(force=True)
    statut = data.get("statut")
    if statut not in STATUTS_TECH:
        return jsonify({"erreur": "Statut invalide."}), 400
    # On ne force pas "disponible/repos" si une intervention est en cours.
    en_cours = db.execute(
        "SELECT COUNT(*) AS c FROM depannages WHERE technicien_id = ? AND statut = 'en_cours'",
        (tid,),
    ).fetchone()["c"]
    if en_cours and statut != "en_depannage":
        return jsonify({"erreur": "Terminez l'intervention en cours d'abord."}), 400
    db.execute("UPDATE techniciens SET statut = ? WHERE id = ?", (statut, tid))
    db.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# API — planning d'astreinte
# --------------------------------------------------------------------------
@app.route("/api/astreintes")
@login_requis
def api_liste_astreintes():
    db = get_db()
    debut = request.args.get("debut")
    fin = request.args.get("fin")
    q = ("""SELECT a.*, t.nom AS technicien_nom FROM astreintes a
            JOIN techniciens t ON a.technicien_id = t.id""")
    params = []
    if debut and fin:
        q += " WHERE a.date_fin >= ? AND a.date_debut <= ?"
        params = [debut, fin]
    q += " ORDER BY a.date_debut, t.nom"
    rows = db.execute(q, params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/astreinte", methods=["POST"])
@dispatcher_requis
def api_creer_astreinte():
    db = get_db()
    data = request.get_json(force=True)
    tech_id = data.get("technicien_id")
    d1 = data.get("date_debut")
    d2 = data.get("date_fin") or d1
    if not (tech_id and d1):
        return jsonify({"erreur": "Technicien et date requis."}), 400
    if d2 < d1:
        d1, d2 = d2, d1
    cur = db.execute(
        "INSERT INTO astreintes (technicien_id, date_debut, date_fin, libelle) VALUES (?,?,?,?)",
        (tech_id, d1, d2, data.get("libelle", "")),
    )
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.route("/api/astreinte/<int:aid>", methods=["DELETE"])
@dispatcher_requis
def api_suppr_astreinte(aid):
    db = get_db()
    db.execute("DELETE FROM astreintes WHERE id = ?", (aid,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/techniciens")
@login_requis
def api_techniciens():
    db = get_db()
    rows = db.execute(
        "SELECT id, nom, telephone, role, statut FROM techniciens WHERE actif = 1 AND role = 'technicien' ORDER BY nom"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# --------------------------------------------------------------------------
init_db()

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5001)
