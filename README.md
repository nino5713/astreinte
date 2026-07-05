# SOCOM · Gestion des astreintes

Application standalone (Flask + SQLite) pour piloter les astreintes :
planning, demandes de dépannage, statut temps réel des techniciens et
compteur horaire avec plafonds légaux (10 h/jour, 48 h/semaine).

## Ce que fait l'application

- **Tableau de bord dispatcher** : statut temps réel de chaque technicien
  (disponible / en dépannage / repos / indisponible), jauges horaires
  jour + semaine avec code couleur (vert → ambre → rouge), liste des
  dépannages en cours, création et assignation de dépannages.
- **Vue technicien (mobile-first)** : mon statut, mes interventions avec
  gros boutons **Démarrer** / **Terminer**, chronomètre en direct, mon
  compteur horaire, dépannages libres « à prendre ».
- **Planning d'astreinte** : vue semaine, affectation des techniciens par
  plage de dates (réservé au dispatcher).

## Comptes de démonstration

| Nom      | Rôle       | PIN  |
|----------|------------|------|
| Dispatch | dispatcher | 0000 |
| Marco    | technicien | 1111 |
| Luc      | technicien | 2222 |
| Ana      | technicien | 3333 |
| Tom      | technicien | 4444 |

> Les PIN sont hachés (werkzeug). En production, crée un compte admin
> (voir ci-dessous), puis gère tes vrais utilisateurs depuis l'interface
> et supprime ces comptes de démonstration.

## Administration des utilisateurs

L'application a trois rôles : **technicien** (ses interventions),
**dispatcher** (tableau de bord, dépannages, planning) et **admin**
(accès complet + gestion des utilisateurs).

### Créer le premier admin

Aucun admin n'existe au départ. Lance le script une fois sur le serveur,
avec le Python de l'environnement virtuel :

```bash
sudo -u www-data /opt/astreinte/venv/bin/python /opt/astreinte/init_admin.py
```

Il demande un nom, un téléphone (facultatif) et un code PIN (saisi deux
fois, masqué), et crée un compte de rôle **admin**.

### Ensuite

Connecte-toi avec ce compte → onglet **Administration**. Tu peux créer
des utilisateurs (technicien / dispatcher / admin), réinitialiser un PIN,
désactiver ou réactiver un compte, et supprimer les comptes de démo. Un
compte lié à un historique (dépannages, astreintes) est désactivé plutôt
que supprimé, pour préserver les données. Le dernier admin actif ne peut
pas être supprimé ni rétrogradé.

## Équipes et planning

Sur la page **Administration**, section *Équipes d'astreinte*, l'admin
crée des équipes (nom + couleur) regroupant un ou plusieurs techniciens.
Une équipe peut donc mettre plusieurs techniciens d'astreinte en même
temps.

Le **planning** affecte une équipe à une période. L'astreinte du jour
affichée sur le tableau de bord liste alors tous les membres de l'équipe
de garde. **Seul un administrateur peut éditer le planning** : les
techniciens et dispatchers le voient en lecture seule (pas de bouton
d'ajout ni de suppression).

## Lancer en local

```bash
pip install -r requirements.txt
python app.py                # http://127.0.0.1:5001
```

La base `astreinte.db` se crée automatiquement au premier démarrage,
avec le jeu de comptes de démo.

## Déploiement VPS (gunicorn + nginx + systemd)

```bash
pip install -r requirements.txt
export ASTREINTE_SECRET="une-vraie-clef-secrete"
gunicorn -w 2 -b 127.0.0.1:5001 app:app
```

Service systemd (ex. `/etc/systemd/system/astreinte.service`) :

```ini
[Unit]
Description=SOCOM Astreinte
After=network.target

[Service]
WorkingDirectory=/opt/astreinte
Environment=ASTREINTE_SECRET=une-vraie-clef-secrete
ExecStart=/usr/bin/gunicorn -w 2 -b 127.0.0.1:5001 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

Bloc nginx (reverse proxy) :

```nginx
location / {
    proxy_pass http://127.0.0.1:5001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## Application mobile (PWA)

L'application est une **PWA installable** : sur le téléphone d'un
technicien, elle s'ajoute à l'écran d'accueil et s'ouvre en plein écran,
comme une vraie app — sans passer par un store.

- **Android / Chrome** : un bouton « ↓ Installer » apparaît dans la barre,
  ou menu ⋮ → « Ajouter à l'écran d'accueil ».
- **iPhone / Safari** : bouton Partager → « Sur l'écran d'accueil ».

Le service worker (`/sw.js`) met en cache le shell (CSS, JS, icônes) pour
un démarrage instantané. Les données (`/api/...`) sont toujours récupérées
en direct — jamais servies périmées. Hors connexion, une page « Pas de
connexion » invite à réessayer.

> **Important** : une PWA n'est installable **qu'en HTTPS** (ou sur
> `localhost`). Sur ton VPS, assure-toi que nginx sert le site en HTTPS
> (Let's Encrypt) pour que l'installation et le service worker
> fonctionnent.

Régénérer les icônes (si tu changes le visuel) :

```bash
python gen_icones.py
```

## Réglages

Dans `app.py`, en haut du fichier :

```python
MAX_H_JOUR = 10.0        # plafond dur / jour
MAX_H_SEMAINE = 48.0     # plafond dur / semaine
ALERTE_H_JOUR = 8.0      # passage en ambre
ALERTE_H_SEMAINE = 40.0
```

## Comment le compteur horaire est calculé

Chaque intervention porte une `date_debut` (clic **Démarrer**) et une
`date_fin` (clic **Terminer**). Les heures d'un technicien sont la somme
des durées d'intervention, découpées proprement par jour civil et par
semaine ISO (lundi → dimanche). Une intervention en cours compte jusqu'à
l'instant présent ; une intervention à cheval sur minuit est répartie sur
les deux jours. Seul le temps d'intervention active est comptabilisé —
conforme à ce que tu m'as décrit.

## Pistes Phase 2

- Page d'administration des techniciens (créer / désactiver / changer PIN).
- Export mensuel des heures par technicien (CSV / PDF) pour la paie.
- Historique des dépannages clôturés + statistiques.
- Notifications (SMS / push) au technicien d'astreinte à la création d'un
  dépannage critique.
- Rattachement au GMAO existant (client, matériel UPS, bon d'intervention).
