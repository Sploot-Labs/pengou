# Pengou — kit logo « Croissant » (F2)

Le pengouin est sous-entendu : un rond bleu nuit (le dos), un rond blanc décalé (le ventre), un bec corail.

## Contenu

| Dossier | Usage |
|---|---|
| `svg/` | **Fichiers maîtres vectoriels.** Symbole, logo horizontal, logo vertical, logotype seul, favicon redessiné. Texte vectorisé : aucune police requise. |
| `png/` | Exports web à fond transparent. Symbole de 16 à 1024 px ; logos par hauteur (h32 à h1024). |
| `web/` | Prêt à déposer à la racine d'un site : `favicon.ico`, `favicon.svg` (s'adapte au mode sombre), `apple-touch-icon.png`, icônes Android, icône *maskable*, `site.webmanifest`, `og-image.png` et `head-snippet.html` à coller dans le `<head>`. |
| `social/` | Image de partage 1200×630 (sombre et clair), bannière 1500×500, avatars 512 px (sombre, clair, cyan), à recadrer en cercle sans perte. |
| `print/pdf-vectoriel/` | Tous les logos en PDF vectoriel, pour l'imprimeur ou la PAO. |
| `print/png-300dpi/` | PNG 300 dpi aux largeurs d'impression courantes (20 à 200 mm), pour Word, Canva, etc. |

## Les cinq déclinaisons

- **couleur** : la version principale, sur fond blanc ou clair.
- **inverse** : sur fond bleu nuit ou foncé. Le ventre est découpé et laisse voir le fond.
- **bleu-nuit**, **noir**, **blanc** : monochromes, pour la gravure, le tampon, le fax, les fonds photo ou les impressions en une couleur.

Les petites tailles (≤ 48 px) utilisent un dessin **favicon redessiné** : croissant plus épais et bec plus grand, pour rester lisible à 16 px.

## Couleurs

| Nom | Hex | RVB | CMJN indicatif* |
|---|---|---|---|
| Bleu nuit polaire | `#0B2545` | 11 · 37 · 69 | 84 · 46 · 0 · 73 |
| Corail bec | `#FF7A3C` | 255 · 122 · 60 | 0 · 52 · 76 · 0 |
| Cyan banquise | `#00A6CC` | 0 · 166 · 204 | 100 · 19 · 0 · 20 |
| Blanc | `#FFFFFF` | 255 · 255 · 255 | 0 · 0 · 0 · 0 |

\* Conversion mathématique simple, à faire valider par l'imprimeur avec un profil (ex. FOGRA39) et une épreuve. Aucune référence Pantone n'a encore été choisie.

## Règles d'usage

- **Zone de protection** : laisser autour du logo un espace vide au moins égal à **¼ du diamètre du symbole**.
- **Tailles minimales** : symbole 16 px / 6 mm ; logo horizontal 80 px / 20 mm de large.
- Le corail est réservé au bec : ne pas recolorer le symbole, ne pas ajouter d'ombre, de contour ni de dégradé.
- Sur fond cyan ou photo chargée, utiliser la version **couleur** (ventre blanc plein) ou une **monochrome**, jamais l'inverse.
- Ne pas déformer, pivoter ni réécrire « pengou » dans une autre police. Le logotype est en Nunito ExtraBold vectorisé (police libre, SIL OFL).

## Régénérer

Le kit est produit par un script à partir d'une seule géométrie : modifier une cote change tous les fichiers d'un coup.
