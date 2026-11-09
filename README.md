# Grayscale World (Foundry VTT v13)

Noir et blanc (nuances de gris). **Désactivé par défaut** : activer le module ne change rien, tout se règle dans *Configuration des réglages > Grayscale World*.

## Réglages (MJ)
- Activer le noir et blanc
- Saturation minimale 0–100 % (0 = gris total)
- Appliquer à la carte et aux tokens (filtre PIXI)
- Appliquer à l'interface (expérimental, décocher si un HUD disparaît)
- Zones de lumière : suivre les murs

Chaque utilisateur peut utiliser sa propre saturation.

## Zones de couleur (MJ)
- **Lumière** : config de la lumière, onglet *Basique* > « Zone de couleur ». Suit la forme réelle de la lumière (murs inclus).
- **Token** : config du token, onglet *Apparence* > « Token en couleur » + rayon optionnel.

## Secours si l'affichage est cassé
Console du navigateur (F12) :
`game.settings.set("grayscale-world","enabled",false)`
