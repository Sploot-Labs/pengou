# Direction de design — « Arena Broadcast »

**Date :** 2026-07-22
**Portée :** prototype UI haute-fidélité des écrans clés (audité ensuite par l'équipe marketing/produit/UX/UI/RGAA, 3 itérations).
**Où :** `apps/web/src/prototype/` (React réel, données mockées, sans backend). N'altère pas `/health`, la config, ni Socket.IO.

## Thèse

Le moment le plus caractéristique du produit : **une question en direct** — un décompte, quatre réponses audacieuses codées forme+couleur, une salle qui répond en temps réel. C'est le héros du grand écran. Tout le reste est calme autour de ce moment.

## Concept

Croisement **plateau télé (scoreboard de diffusion)** × **borne d'arcade**. Scène sombre « arène de nuit », boutons-réponses tactiles façon arcade, PIN affiché comme un high-score de borne. Énergie haute mais lisibilité et accessibilité irréprochables (le prototype sera audité RGAA).

## Tokens couleur

```
--stage:        #0E1230   /* fond scène, midnight (pas de noir pur) */
--stage-2:      #161B3E
--surface:      #1E2450   /* panneaux */
--surface-2:    #2A3168
--line:         rgba(255,255,255,.12)
--ink:          #F5F7FF   /* texte sur sombre */
--ink-dim:      #AEB4D8
--ink-strong:   #FFFFFF
--brand:        #FF3D7F   /* rose électrique — la signature */
--brand-2:      #7A5CFF   /* violet, pour dégradés d'accent */
--gold:         #FFC53D   /* vainqueur / podium */
```

Réponses (couleur + **forme** + label — jamais la couleur seule). Valeurs
assombries après mesure RGAA pour tenir ≥4.5:1 avec le texte blanc :
```
--ans-triangle: #C62828  (rouge)   texte blanc   (~5.0:1)
--ans-diamond:  #1D5FB0  (bleu)    texte blanc   (~4.9:1)
--ans-circle:   #F2A900  (ambre)   texte SOMBRE (#0E1230) — contraste
--ans-square:   #0E7C68  (vert)    texte blanc   (~4.6:1)
```

Règles contraste : boutons brand = ink sombre sur rose (~6:1). Tuiles : blanc
sur rouge/bleu/vert **une fois assombri** (les valeurs d'origine #E23B2E/#2E7BD6/#14A38B
étaient sous le seuil — 3,2 à 4,3:1 — et ont été corrigées), ink sombre sur ambre.
Feedback : `--success` (#0E7C68) et `--danger` (#C62828) alignés sur ces valeurs
pour rester lisibles en texte blanc. Texte courant `--ink` sur `--stage` (>12:1).
Rien ne repose sur la couleur seule (forme + label systématiques).

## Typographie

- **Display** : `Bricolage Grotesque` (700/800) — caractériel, large, ni le serif ni le grotesque générique.
- **Body/UI** : `Inter`.
- **Data/PIN/timer** : `JetBrains Mono`.
Échelle : display clamp() jusqu'à ~72px sur grand écran ; PIN en mono très large à interlettrage marqué.

## Élément signature

Le **PIN Marquee** : le code de partie affiché comme un high-score de borne — grands chiffres mono sur panneau segmenté, légère lueur/scanline (désactivée en `prefers-reduced-motion`). Décliné en repère de marque sur tous les écrans de jeu.

## Écrans du prototype

1. **HostEditor** — éditeur de quiz : liste de questions (réordonnable visuellement), formulaire de question avec les 4 options typées, choix du type (QCM / Vrai-Faux / réponse libre / curseur), durée, points. App-shell sombre « backstage ».
2. **Join** — le joueur saisit PIN + pseudo. Minimal, plein écran, PIN Marquee.
3. **PlayerLive** — écran joueur (mobile-first) : les 4 tuiles forme+couleur, états attente / question / résultat (bon/mauvais + points + rang).
4. **BigScreen** — présentateur/vidéoprojecteur : lobby (PIN + joueurs qui affluent), question + distribution des réponses en direct + anneau de décompte.
5. **Podium** — top 3 (or/argent/bronze), classement complet, actions de fin.

Un **sélecteur de prototype** (barre discrète) permet de naviguer entre écrans pour l'audit.

## Plancher qualité + RGAA (à respecter dès la construction)

- `<html lang="fr">`. HTML sémantique (`main`, `header`, `nav`, `ul/li`, `button` réels — jamais de `div` cliquable).
- **Réponses** encodées par forme + label **et** couleur (critère couleur-seule).
- Navigation clavier complète ; `:focus-visible` visible et contrasté partout ; ordre de tabulation logique.
- Régions live ARIA : décompte (`aria-live="polite"` mesuré, pas à chaque seconde), révélation du résultat (`role="status"`), arrivée des joueurs.
- Contrastes AA (≥4.5:1 texte courant, ≥3:1 gros texte/UI) — vérifiés par token.
- `prefers-reduced-motion` : coupe scanline, pulsations, transitions non essentielles.
- Cibles tactiles ≥44px ; formulaires avec `<label>` associés ; états d'erreur explicites et textuels.
- Timer : jamais une info portée par la seule couleur/anim — valeur textuelle présente.

## Copy (voix produit)

Sobre, actif, en français, casse phrase. Boutons = action exacte (« Lancer la partie », « Question suivante », « Rejoindre »). Écrans vides = invitation à agir (« Aucune question. Ajoutez-en une pour commencer. »). Erreurs sans excuse, disent quoi corriger (« PIN introuvable. Vérifiez les 6 chiffres. »).
