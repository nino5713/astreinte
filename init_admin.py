#!/usr/bin/env python3
"""
Création du premier compte administrateur — SOCOM Astreinte.

À lancer une seule fois sur le serveur, avec le Python de l'environnement
virtuel de l'application :

    sudo -u www-data /opt/astreinte/venv/bin/python /opt/astreinte/init_admin.py

Le script demande un nom, un téléphone (facultatif) et un code PIN (saisi
deux fois, masqué). Il crée un utilisateur de rôle « admin ». Une fois
connecté à l'interface avec ce compte, l'admin peut créer tous les autres
utilisateurs et supprimer les comptes de démonstration.
"""
import getpass
import sqlite3
import sys

from werkzeug.security import generate_password_hash

# On réutilise le chemin de base défini par l'application.
try:
    from app import DB_PATH
except Exception:
    import os
    DB_PATH = os.path.join(os.path.abspath(os.path.dirname(__file__)), "astreinte.db")


def demander(invite):
    try:
        return input(invite).strip()
    except (EOFError, KeyboardInterrupt):
        print("\nAnnulé.")
        sys.exit(1)


def demander_pin():
    while True:
        try:
            p1 = getpass.getpass("Code PIN (min. 4 caractères, masqué) : ").strip()
            p2 = getpass.getpass("Confirmez le code PIN : ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nAnnulé.")
            sys.exit(1)
        if len(p1) < 4:
            print("  → Trop court (4 caractères minimum). Réessayez.\n")
            continue
        if p1 != p2:
            print("  → Les deux saisies diffèrent. Réessayez.\n")
            continue
        return p1


def main():
    print("=" * 52)
    print("  SOCOM Astreinte — création d'un compte admin")
    print("=" * 52)

    nom = demander("Nom de l'administrateur : ")
    while not nom:
        nom = demander("Le nom est obligatoire. Nom : ")
    tel = demander("Téléphone (facultatif, Entrée pour passer) : ")
    pin = demander_pin()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    exist = conn.execute("SELECT * FROM techniciens WHERE nom = ?", (nom,)).fetchone()
    if exist:
        rep = demander(
            f"Un utilisateur « {nom} » existe déjà. Le passer en admin et "
            f"réinitialiser son PIN ? (o/N) : "
        ).lower()
        if rep not in ("o", "oui", "y", "yes"):
            print("Abandon.")
            conn.close()
            return
        conn.execute(
            "UPDATE techniciens SET role='admin', actif=1, telephone=?, pin_hash=? WHERE id=?",
            (tel, generate_password_hash(pin), exist["id"]),
        )
        conn.commit()
        print(f"\n✔ « {nom} » est maintenant administrateur.")
    else:
        conn.execute(
            "INSERT INTO techniciens (nom, telephone, role, pin_hash, statut, actif) "
            "VALUES (?,?, 'admin', ?, 'disponible', 1)",
            (nom, tel, generate_password_hash(pin)),
        )
        conn.commit()
        print(f"\n✔ Compte administrateur « {nom} » créé.")

    conn.close()
    print("Connectez-vous à l'interface avec ce compte, puis créez vos")
    print("utilisateurs et supprimez les comptes de démonstration.\n")


if __name__ == "__main__":
    main()
