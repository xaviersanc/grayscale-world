# Grayscale World (Foundry VTT v13)

Noir et blanc (nuances de gris) pour tous les utilisateurs : interface, carte, tokens, images.

## Réglages
- **MJ (monde)** : activer, saturation minimale 0–100 % (0 = gris total).
- **Chaque utilisateur** : « Utiliser ma propre saturation » + sa valeur.

## Zones de couleur (MJ)
- **Lumière** : config de la lumière, onglet *Basique* → « Zone de couleur ». La zone (rayon max dim/bright) reste en couleur.
- **Token** : config du token, onglet *Apparence* → « Token en couleur » + rayon de couleur optionnel.

## Installation sur Forge
1. Remplacer `VOTRE-COMPTE` dans `module.json` (url/manifest/download).
2. Publier `module.json` et `grayscale-world.zip` dans une release GitHub.
3. Forge : Bazaar → Modules → Install Module → coller l'URL du manifest.
