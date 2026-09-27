#!/usr/bin/env python3
"""demande_autorisation — le pont entre les scripts Node (viem) et le garde-fou crypto.

Pourquoi ce fichier existe
--------------------------
Le reglement dit : AUCUN SCRIPT NE SIGNE SANS APPELER `verifie()` D'ABORD. Mes scripts
de deploiement sont en Node (viem), et le garde-fou est en Python. Ce petit pont fait
le lien : le script Node lui envoie son intention, il repond autorise/refuse, et le
script Node ne signe que si la reponse est « autorise ».

Usage
-----
    echo '<intention json>' | python3 demande_autorisation.py verifie
    echo '<intention json>' | python3 demande_autorisation.py resultat <statut> <tx>

Sortie : la decision en JSON sur la derniere ligne.
Code retour : 0 = autorise / enregistre, 3 = refuse (le script appelant doit s'arreter).
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, "/opt/data/projets/agent-crypto")

from garde_wallet import enregistre_resultat, verifie  # noqa: E402


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "verifie"
    brut = sys.stdin.read().strip()
    if not brut:
        print(json.dumps({"decision": "refuse", "raison": "intention-vide"}))
        return 3
    try:
        intention = json.loads(brut)
    except Exception as erreur:
        print(json.dumps({"decision": "refuse", "raison": f"intention-illisible: {erreur}"}))
        return 3

    if mode == "resultat":
        statut = sys.argv[2] if len(sys.argv) > 2 else "inconnu"
        tx = sys.argv[3] if len(sys.argv) > 3 else ""
        enregistre_resultat(intention, statut, tx)
        print(json.dumps({"enregistre": True, "statut": statut, "tx": tx}))
        return 0

    decision = verifie(intention)
    print(json.dumps(decision, ensure_ascii=False))
    return 0 if decision.get("decision") == "autorise" else 3


if __name__ == "__main__":
    raise SystemExit(main())