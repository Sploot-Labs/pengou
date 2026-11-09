# Licence de Pengou, en clair

Pengou est **open source**, sous **Apache License 2.0** (`Apache-2.0`). Le texte qui fait foi est
le fichier [`LICENSE`](./LICENSE) ; cette page l'explique en langage courant et **n'a aucune
valeur juridique** en cas de divergence.

> **En une phrase :** faites ce que vous voulez avec Pengou — self-host, modification, usage
> commercial, intégration dans un autre produit, redistribution — gratuitement. Gardez juste la
> mention de licence et d'attribution.

## Pourquoi Apache-2.0

Objectif n°1 : **que le plus grand nombre puisse en profiter**. Une licence permissive maximise
l'adoption, les contributions et la réutilisation, sans friction pour personne — particuliers,
écoles, associations, entreprises, intégrateurs. Apache-2.0 (plutôt que MIT) ajoute une **clause
de brevets explicite** qui protège les utilisateurs, ce qui en fait le standard permissif le plus
sûr pour un projet destiné à durer et à attirer des contributeurs entreprise.

## Ce que vous POUVEZ faire ✅ (c.-à-d. tout)

- **Self-héberger** Pengou — pour vous, votre organisation, vos clients — gratuitement, sans limite.
- **Modifier, forker, redistribuer**, y compris à des fins commerciales.
- **Intégrer Pengou** comme composant d'un produit plus large (CRM, LMS/formation, etc.).
- **Proposer Pengou en service hébergé**, y compris payant. Oui, y compris un concurrent — c'est le
  prix, assumé, d'une ouverture réelle : ses utilisateurs aussi profitent de Pengou.

## Vos seules obligations (légères)

1. **Inclure une copie de la licence** (`LICENSE`) avec toute redistribution.
2. **Conserver les mentions** de copyright, brevets, marques et attribution présentes dans les
   sources (dont le fichier [`NOTICE`](./NOTICE)).
3. **Signaler les fichiers que vous modifiez** (mention « changed »).
4. **Ne pas utiliser la marque/le nom « Pengou » ou « Sploot Labs »** pour endosser ou promouvoir
   votre version dérivée (au-delà de la mention d'origine). Le code est libre ; la marque ne l'est
   pas.

## Données du catalogue de questions

Le catalogue de questions livré avec Pengou (dossier `packages/library/catalog/`) n'est pas
couvert par la licence Apache-2.0 du code. Chaque source y a son propre dossier, avec un fichier
`LICENSE.md` qui fait foi pour ses données et liste l'attribution à reprendre.

Les questions d'OpenQuizzDB (`catalog/openquizzdb/`, en français) et d'Open Trivia Database
(`catalog/opentdb/`, en anglais) sont sous licence Creative Commons BY-SA 4.0. Vous pouvez les
copier, les modifier et les utiliser, y compris commercialement, à deux conditions : citer la
source (nom, licence, lien) et diffuser les questions modifiées sous la même licence. Pengou garde
cette attribution sur chaque question copiée depuis la bibliothèque et l'affiche dans la
bibliothèque et l'éditeur.

Les dossiers `catalog/opentdb-fr/` (Open Trivia Database traduit en français) et
`catalog/openquizzdb-en/` (OpenQuizzDB traduit en anglais) sont des adaptations : des traductions
assistées par IA, produites par Sploot Labs, sous la même licence Creative Commons BY-SA 4.0. Chacun
a son fichier `LICENSE.md`. Les tables de traduction (`packages/library/translations/`) sont aussi
sous CC BY-SA 4.0 et n'entrent pas dans la licence Apache-2.0.

La liste des thèmes (`catalog/themes.json`) et les scripts de conversion, de sélection et de
traduction (`packages/library/scripts/`, dont `curate-opentdb.ts` et `translate-catalog.ts`)
relèvent d'Apache-2.0, comme le reste du code.

## Communication de marque

Ici, dire **« open source »** est exact : Apache-2.0 est une licence approuvée par l'OSI. Le badge
et le pitch « open source » de Sploot Labs sont pleinement justifiés pour Pengou.

## Et le modèle économique alors ?

Il n'y en a pas, au sens commercial. Le service hébergé par Sploot Labs sur
[app.pengou.fr](https://app.pengou.fr) est gratuit pour tout le monde, sans offre payante ni
version premium, et le code reste entièrement libre : pas d'édition entreprise fermée, pas
d'open core. Les fonctionnalités arrivent dans le même code pour tous.

Le serveur et le temps passé sont financés par les dons de celles et ceux qui le souhaitent, sur
le principe « offrir un café ». Si ce choix devait changer un jour, il serait annoncé ici et dans
le journal des nouveautés, et ce qui est gratuit aujourd'hui le resterait.

## Contribuer : DCO (recommandé)

Bonne pratique pour la traçabilité des contributions : signer chaque commit avec `git commit -s`
(`Signed-off-by:`), attestant le Developer Certificate of Origin. Voir le futur `CONTRIBUTING.md`.
Avec une licence permissive, aucun CLA lourd n'est nécessaire.

---

> ℹ️ **Note :** le choix de licence n'a pas fait l'objet d'une revue par un avocat. Apache-2.0
> étant un standard permissif largement éprouvé, le risque est faible, mais une relecture
> juridique avant publication publique reste recommandée (notamment si vous ajoutez plus tard une
> édition entreprise / open core).
