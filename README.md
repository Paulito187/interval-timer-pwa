# Interval Timer PWA (simple v2)

## Ajouts demandés
- ✅ Échauffement manuel (option) : chrono général démarre, puis bouton “Commencer la séance”
- ✅ Bips (option)
- ✅ Alerte 3..2..1 (option)
- ✅ Temps total programmé (hors échauffement manuel)
- ✅ Wake Lock (anti-verrouillage écran)

## Lancer en local
```bash
npx serve .
```
ou
```bash
python -m http.server 8080
```

## Installer sur Android
1. Ouvre l’URL dans Chrome
2. Menu ⋮ → **Installer l’application**

## Notes importantes
- Les bips (WebAudio) peuvent demander une interaction utilisateur (bouton “Démarrer”) pour être autorisés.
- Wake Lock dépend d’Android/Chrome : si non supporté, un indicateur “Wake Lock indisponible” s’affiche en haut.
- L’app est offline après la première visite (service worker).


## Si tu as une ancienne version en cache
Si tu avais installé/visité une ancienne version, fais : Chrome → Paramètres du site → **Effacer les données** (ou ré-installe l'app) pour forcer la mise à jour du service worker.


## Version 8
- Pause/Reprendre corrigé
- Échauffement manuel centré
- Champs sans valeurs par défaut
- Fin de séance : bouton Terminer + récapitulatif


## v8b
- Bouton « Nouvelle séance » ajouté (retour paramètres sans recharger)
- Pause/Reprendre reste actif après la fin : met en pause / reprend le chrono général


## v9
- Un seul bouton ⏯ Pause / reprendre (sans mini notifications)
- Fin: ⏯ puis Terminer
- Terminer: stop chrono + récap + Nouvelle séance uniquement
- Récap ordre: échauffement, séries, temps total


## v9.2 (rebuild)
- Après « Terminer » : le bouton ⏯ est forcé à hidden (endWorkout) et la vue récap ne l'affiche pas.


## v1.1
- Stop → « Retour aux paramètres » (même action)
- Ajout du bouton « Terminer » pendant la séance (arrête et affiche le récap)


## v1.1.1
- « Terminer » arrête aussi les intervalles et le chrono général
- Suppression du bouton « Pause / Reprendre » pendant l'entraînement et après « Terminer »


## v1.1.2
- Retour du bouton « Pause/Reprendre » pendant les intervalles uniquement
- Toujours absent pendant l’échauffement et après « Terminer »

# Déploiement GitHub Pages (important)

Cette version est déjà configurée pour le repo **interval-timer-pwa** (chemins `start_url` et `scope`).
1) Uploade tous les fichiers **à la racine** du repo GitHub.
2) Settings → Pages → Deploy from branch → main / (root)
3) URL: https://paulito187.github.io/interval-timer-pwa/

## Installation Android
Ouvre l’URL dans Chrome → menu ⋮ → **Installer l’application**.

## Mise à jour (cache PWA)
Si tu ne vois pas les changements : désinstalle l’app, puis efface le stockage du site (cadenas → Paramètres du site → Stockage → Effacer), recharge et réinstalle.
