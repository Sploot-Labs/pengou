# Résultats du test de charge, 31 octobre 2026

Ce document rend compte d'une campagne de mesure du serveur Pengou (une partie en direct de 50 à 300 joueurs, puis dix parties simultanées), suivie d'une correction du compteur de réponses et d'une seconde campagne (section « Après correction »), puis d'une troisième campagne après suppression des copies d'état de la partie (section « Réponse à coût constant ») et d'une quatrième après coalescence de la diffusion du lobby (section « Diffusion du lobby coalescée »). Le chiffre annoncé passe à 640 joueurs par partie (80 avant la première correction, puis 160). Le calcul est donné en fin de document.

## Configuration

Le serveur testé tourne dans deux conteneurs locaux (application et PostgreSQL 16) lancés par `docker-compose.charge.yml`, projet `pengou-charge`, à l'adresse `http://localhost:3000`, sur le commit 5a93a13 pour la première campagne, 823364f pour la seconde, 1a8b03b pour la troisième et 9011613 pour la quatrième. La cible est `localhost` et non `127.0.0.1` parce que Better Auth ne fait confiance qu'à l'origine `http://localhost:3000` et répond 403 INVALID_ORIGIN pour `127.0.0.1` ; les deux adresses arrivent sur le même conteneur Docker. L'image est celle du Dockerfile du dépôt, avec les mêmes variables que `docker-compose.prod.yml` (même `NODE_ENV`, même limitation de débit, même niveau de journalisation), sauf `MAX_PLAYERS_PER_SESSION` fixé à 5000 pour que le plafond ne fausse pas les paliers.

La taille du VPS vient du README d'exploitation du propriétaire : « VPS Hostinger sous Ubuntu 26.04 LTS (4 vCPU, 15 Go de RAM) ». Les limites appliquées à chaque conteneur sont donc 4 CPU, 15360 Mo de mémoire et 15360 Mo de mémoire plus swap. Le swap du VPS est inconnu, il a été supposé nul. Le résultat de `lscpu` du VPS et un relevé `docker stats` de production n'étaient pas disponibles.

Le poste qui héberge le serveur et le générateur est un portable AMD Ryzen 9 4900HS (8 cœurs, 16 threads), 31,4 Go de RAM. Docker Desktop y dispose de 16 CPU et d'environ 15,3 Gio. La limite de 15 Go par conteneur n'est donc pas atteignable en pratique : c'est le RSS mesuré qui compte (environ 270 à 300 Mo pour l'application, 50 à 95 Mo pour la base).

Le générateur tourne sur le même poste, les parties ne passent que par la boucle locale, sans reverse proxy ni TLS. Protocole de chaque passage : base neuve (`down -v` puis `up -d`), attente de `/health` puis 30 s, aucune autre charge sur le poste, 10 questions, échantillonnage Docker. Chaque palier est joué deux fois ; il est réussi si les deux passages sont `reussi`. Les critères `zeroErreur` (aucune erreur du générateur) et `toutesReponses` (réponses acceptées égales aux rejoints fois le nombre de questions) ont été ajoutés au verdict après la campagne ; tous les passages `reussi` les satisfont déjà (vérifié sur les JSON bruts : 0 erreur, réponses acceptées = rejoints × 10).

Biais connus, presque tous dans le sens optimiste :

- Les deux conteneurs reçoivent chacun la taille complète du VPS, alors qu'en production ils la partagent, avec Caddy et les autres services de la machine.
- Les cœurs d'un Ryzen 9 4900HS peuvent être plus rapides que les vCPU du VPS.
- Pas de latence réseau, pas de TLS, pas de reverse proxy : le coût réseau réel des joueurs n'est pas mesuré.
- Le générateur et le serveur se partagent le poste, ce qui joue plutôt contre le serveur. Le lag du générateur est resté sous 25 ms (seuil 100 ms) sur tous les passages des deux premières campagnes, entre 20 et 28 ms sur ceux de la troisième et entre 20 et 22 ms sur ceux de la quatrième, les mesures sont valides.

Un incident de procédure est à signaler : une première exécution automatisée a été lancée deux fois en parallèle par erreur, et un passage `p50-2` est tombé sur une erreur réseau. Les deux exécutions ont été arrêtées, les fichiers produits pendant le chevauchement supprimés, puis `p50-2` et les paliers suivants rejoués une seule fois, sans autre charge. `p50-1` était antérieur et n'est pas concerné.

## Résultats par palier

Une partie, cadence d'arrivée de 25 joueurs par seconde, 10 questions. Les durées sont en millisecondes. Les colonnes CPU app et db sont le maximum relevé par Docker (100 % égale un cœur). Les JSON bruts sont dans `docs/charge/brut/`.

| Palier | Essai | Rejoints | Déconnexions | Réponse p95 | Diffusion p95 | Diffusion max | Lag serveur p99 max | RSS max (Mo) | CPU app max | CPU db max | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 1 | 50/50 | 0 | 47,8 | 47 | 47 | 84,6 | 268,7 | 100 % | 37 % | reussi |
| 50 | 2 | 50/50 | 0 | 21,5 | 28 | 28 | 25,1 | 267,9 | 27 % | 12 % | reussi |
| 100 | 1 | 100/100 | 0 | 26,7 | 25 | 25 | 31,2 | 268,9 | 79 % | 14 % | reussi |
| 100 | 2 | 100/100 | 0 | 30,2 | 30 | 30 | 34,8 | 269,6 | 77 % | 8 % | reussi |
| 200 | 1 | 200/200 | 0 | 1662,4 | 76 | 76 | 1625,3 | 273,8 | 132 % | 40 % | echoue |
| 200 | 2 | 200/200 | 0 | 1151,5 | 53 | 53 | 1211,1 | 272,9 | 138 % | 37 % | echoue |
| 300 | 1 | 300/300 | 0 | 5184,9 | 186 | 186 | 988,8 | 275,3 | 122 % | 45 % | echoue |

Le palier 300 n'a été joué qu'une fois : l'échec du palier 200 est confirmé par ses deux passages, et un passage du palier suivant suffit à documenter la dégradation. Les paliers 500 à 1000 n'ont pas été joués. Les critères en échec sont la latence de réponse (seuil p95 300 ms) et le lag de l'event loop (seuil p99 200 ms). La diffusion de la question, les arrivées et les déconnexions restent bonnes jusqu'à 300.

Le premier passage à 50 joueurs montre un lag de 84,6 ms et un CPU à 100 % : c'est le démarrage à froid du serveur, sans conséquence sur le verdict.

Deux passages de contrôle supplémentaires (`chk100` et `chk200`, même protocole, avec une lecture périodique de la base pendant la partie, voir « Cohérence de la base ») ne comptent ni pour ni contre. `chk100` est `reussi` (réponse p95 33 ms, lag 41 ms) et `chk200` `echoue` (réponse p95 2094 ms, lag 1349 ms), ce qui confirme le palier 100 et l'échec du palier 200.

## Scénario établissement

Dix parties simultanées de 30 joueurs (300 connexions), cadence de 25 arrivées par seconde, 10 questions, 3 processus générateur. Deux passages, tous deux `reussi`.

Le premier donne une réponse p95 de 24,7 ms, une diffusion p95 de 75 ms (max 108 ms), un lag serveur p99 de 36,2 ms, un CPU application de 62 % et un RSS de 303 Mo. Le second donne 26,8 ms, 66 ms (max 94 ms), 55,3 ms, 95 % et 304 Mo. Aucune déconnexion, aucun refus.

Une charge de 300 joueurs répartis en dix salles de 30 est donc largement supportée, alors que 200 joueurs dans une seule salle ne le sont pas. Le coût vient de la taille de la salle (diffusions et accusés proportionnels au nombre de joueurs d'une même partie), pas du nombre de connexions.

## Rafale

Cent joueurs (le plus haut palier réussi) arrivant à 250 par seconde au lieu de 25, une seule partie. Verdict `reussi`, 100 rejoints sur 100, aucune déconnexion. Le délai de join monte à 601 ms au p95 (contre 14 à 27 ms en cadence normale), mais la réponse p95 reste à 36 ms et le lag serveur à 55 ms. Une arrivée en masse de 100 joueurs (QR projeté dans un amphithéâtre) ralentit donc les arrivées sans dégrader le jeu. Ce passage est informatif, il ne change pas le chiffre annoncé.

## Cohérence de la base

Après chaque passage, pour chaque partie, les lignes de `session_player` et d'`answer_record` ont été comptées. Sur tous les passages, `session_player` est égal au nombre de joueurs rejoints et `answer_record` égal au nombre d'accusés `player:answer` acceptés (joueurs multipliés par 10 questions : 500 pour 50 joueurs, 1000 pour 100, 2000 pour 200, 3000 pour 300, 300 par partie pour le scénario établissement). Aucun écart, y compris sur les paliers en échec : la lenteur n'a fait perdre aucune réponse et n'en a pas rejeté.

Le décompte « moteur » du brief (`engine_state->'players'`) n'est pas exploitable après la partie : le serveur met `engine_state` à null au podium (`clearEngineState` dans `doAdvance`, comportement voulu, le rapport final reste lisible par `session_player` et `answer_record`). Les relevés a posteriori donnent donc 0 sur les parties de 200 et 300 joueurs. Sur les parties de 100 joueurs et moins, la valeur est restée égale au nombre de joueurs, ce qui s'explique ainsi : après la remise à null de `engine_state` au podium (`game-gateway.ts:274`), une déconnexion ou une reconnexion de joueur appelle `store.save`. Le champ `connected` ne fait pas partie de `signature()` (`packages/game`, `persistent-store.ts:47-51`), la sauvegarde est donc traitée comme « réponses seules » et `scheduleFlush` réécrit l'état complet 250 ms plus tard. L'état est effacé de nouveau à l'éviction, 10 minutes plus tard. C'est un défaut antérieur à la branche, de gravité faible (le pseudo et le `join_token` restent conservés dans `session_player`), dont la correction est prévue à part.

Pour obtenir la vraie comparaison, une lecture périodique a été faite pendant les deux passages de contrôle : la partie `active` contient 100 joueurs dans le moteur à 100 joueurs et 200 à 200 joueurs, avec 100 et 200 lignes `session_player`. Lignes, moteur et joueurs rejoints concordent donc. Les relevés sont dans `docs/charge/brut/*.coherence.txt` et `chk*.moteur.txt`.

Les noms de tables et de colonnes du brief (`session_player`, `game_session.engine_state`, `answer_record`, colonnes `session_id`) correspondent au schéma de `packages/db`, aucune adaptation n'a été nécessaire.

## Goulot identifié

Le premier palier en échec est 200 joueurs. Il casse pendant les questions, pas pendant les arrivées : au palier 200 le join reste à 18,5 ms au p95 et 43 ms au p99 (comme à 100 joueurs), les 200 joueurs rejoignent sans refus, et la diffusion de la question est rapide (76 ms au plus). La dégradation apparaît quand les 200 joueurs répondent presque en même temps (dans le générateur, chaque joueur répond après un délai tiré entre 0,5 et 3 s, constante `PLAGE_REPONSE_MS` de `apps/server/charge/charge.mjs`) : la réponse p95 passe à 1,1 à 1,7 s et le lag de l'event loop à 1,2 à 1,6 s. Au palier 300, les arrivées commencent aussi à souffrir (join p95 274 ms), mais le critère le plus touché reste la réponse (p95 5,2 s).

Au moment de l'échec, le CPU de l'application dépasse 130 % (un thread JavaScript saturé, plus la collecte de mémoire et les threads annexes) tandis que Postgres reste sous 45 % et la mémoire à 275 Mo pour une limite de 15 Go. Ce n'est donc ni la base, ni la mémoire, ni le réseau : le goulot est l'event loop de l'application pendant le traitement des réponses d'une salle nombreuse.

Pour la tâche optionnelle de coalescence de `lobby:update` : les arrivées ne sont pas le premier goulot (palier 200 sain à l'arrivée, rafale à 250 par seconde sans dégradation du jeu), la dégradation survient pendant les questions.

## Après correction

Cause identifiée à l'issue de la première campagne : à chaque réponse acceptée, le handler `player:answer` diffusait `screen:progress` à toute la salle de la partie, joueurs compris. N réponses faisaient donc N diffusions vers N+2 sockets, soit un nombre d'envois quadratique par question. Seuls l'écran de l'hôte et le grand écran lisent cet événement. La correction (commit `perf(server): compteur de réponses réservé à l'hôte et au grand écran`) ajoute une room `viewers:<sessionId>` que rejoignent uniquement les sockets hôte (création, reprise) et grand écran (jonction, reprise), et y émet `screen:progress`. Aucun autre événement n'a changé de room.

Même protocole que la première campagne (pile reconstruite sur le code corrigé, base neuve avant chaque passage, 30 s d'attente après `/health`, 10 questions, cadence de 25 arrivées par seconde, un seul générateur à la fois, cible `localhost:3000`). Les libellés sont suffixés `-apres`. Le premier passage 100 a été joué sur la pile fraîchement démarrée sans nouvelle remise à zéro, après une tentative avortée (refus d'origine à l'inscription, aucune partie créée).

| Palier | Essai | Rejoints | Déconnexions | Réponse p95 | Diffusion p95 | Diffusion max | Lag serveur p99 max | RSS max (Mo) | CPU app max | CPU db max | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 1 | 100/100 | 0 | 12,2 | 26 | 26 | 21,7 | 269,4 | 42 % | 12 % | reussi |
| 100 | 2 | 100/100 | 0 | 12,4 | 25 | 25 | 20,8 | 269,0 | 26 % | 13 % | reussi |
| 200 | 1 | 200/200 | 0 | 60,1 | 43 | 43 | 111,6 | 274,1 | 96 % | 26 % | reussi |
| 200 | 2 | 200/200 | 0 | 44,1 | 35 | 35 | 70,1 | 275,9 | 73 % | 28 % | reussi |
| 300 | 1 | 300/300 | 0 | 1767,8 | 90 | 90 | 972,0 | 277,8 | 101 % | 43 % | echoue |
| 300 | 2 | 300/300 | 0 | 1800,7 | 279 | 279 | 978,8 | 275,3 | 110 % | 41 % | echoue |
| 500 | 1 | 500/500 | 0 | 7913,7 | 6404 | 6404 | 1254,1 | 280,2 | 111 % | 23 % | echoue |

À 200 joueurs, la réponse p95 passe de 1151 à 1662 ms avant correction à 44 à 60 ms après, et le lag serveur p99 de 1211 à 1625 ms à 70 à 112 ms. Le palier 200 passe deux fois sur deux. Le palier 300 échoue deux fois sur deux (réponse p95 environ 1,8 s, lag environ 0,97 s), le palier 500 échoue au passage joué pour documenter la dégradation : 85 accusés hors délai, diffusion p95 de 6,4 s, et un join p95 de 3 s. Les paliers 750 et 1000 n'ont pas été joués, l'échec étant confirmé à 300. Le premier échec (300) tombe à 100 du plus haut palier réussi (200), il n'y a donc pas de palier intermédiaire à jouer.

Scénario établissement (dix parties de 30 joueurs, 3 processus) : deux passages `etab-apres-1` et `etab-apres-2`, tous deux `reussi`. Réponse p95 de 8,0 et 8,5 ms, diffusion p95 de 65 et 61 ms (max 100 et 97 ms), lag serveur p99 de 16,2 et 20,3 ms, aucune déconnexion. Les chiffres avant correction étaient du même ordre pour la diffusion (75 et 66 ms) et la réponse passe d'environ 25 ms à environ 8 ms.

Rafale (`rafale-apres`, 200 joueurs, le plus haut palier réussi, 250 arrivées par seconde, 2 processus) : `reussi`, 200 rejoints sur 200, aucune déconnexion. Le join p95 monte à 1004 ms (contre 16 ms en cadence normale), la réponse p95 reste à 63 ms et le lag serveur à 131 ms. Comme avant correction, une arrivée en masse ralentit l'arrivée sans dégrader le jeu. Passage informatif.

Cohérence de la base sur la rafale à 200 joueurs : `session_player` 200, moteur 200, `answer_record` 2000, égaux aux joueurs rejoints et aux 2000 accusés acceptés comptés par le générateur. La valeur « moteur » est encore lue après la fin de partie, ce qui confirme que `engine_state` est réécrit après son effacement par la sauvegarde qui suit une déconnexion ou une reconnexion, mécanisme décrit plus haut. Cette vérification n'a été faite que sur ce passage, les bases étant remises à zéro avant chaque passage. Relevé : `docs/charge/brut/rafale-apres.coherence.txt`.

Nouveau premier échec : 300 joueurs, pendant les questions. L'event loop de l'application sature encore (lag de 0,97 s, réponse p95 de 1,8 s, CPU app de 100 à 110 % d'un cœur, Postgres sous 45 %, mémoire stable), ce qui indique un coût par réponse qui croît encore avec la taille de la salle, non analysé ici. Les arrivées commencent aussi à souffrir (join p95 de 161 à 415 ms), le critère décisif reste la réponse.

## Réponse à coût constant

Cause traitée : à chaque réponse de joueur, le serveur copiait en profondeur la session entière (joueurs, réponses déjà données) pour la lire, puis encore pour l'enregistrer, ce qui rendait le coût d'une réponse proportionnel à la taille de la salle. La branche `perf/copies-etat-partie` supprime ces copies sur ce chemin : `peek` renvoie l'objet en cache en lecture seule et `recordAnswer` ne copie que la réponse soumise (commits `perf(game): lecture sans copie et enregistrement ciblé d'une réponse dans le store` et `perf(game): réponse de joueur sans copie de l'état de la partie`). Le comportement fonctionnel est inchangé.

Même protocole que les campagnes précédentes (pile reconstruite sur le code de la branche, commit 1a8b03b, base neuve avant chaque passage, `/health` puis 30 s, 10 questions, cadence de 25 arrivées par seconde, un seul générateur à la fois, cible `localhost:3000`, environ un processus générateur par 100 joueurs). Les libellés sont suffixés `-cc`. Le lag du générateur est resté entre 20 et 28 ms sur tous les passages, les mesures sont valides. Un premier passage à 500 joueurs a été interrompu par le générateur (la commande `host:start` n'a pas reçu d'accusé en 10 s, aucun JSON produit) ; il a été rejoué une fois, c'est ce second passage qui figure ci-dessous.

| Palier | Essai | Rejoints | Déconnexions | Réponse p95 | Diffusion p95 | Diffusion max | Lag serveur p99 max | RSS max (Mo) | CPU app max | CPU db max | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 200 | 1 | 200/200 | 0 | 20,9 | 146 | 146 | 62,8 | 279,5 | 130 % | 55 % | reussi |
| 200 | 2 | 200/200 | 0 | 6,1 | 298 | 298 | 120,8 | 283,7 | 114 % | 38 % | reussi |
| 300 | 1 | 300/300 | 0 | 8,1 | 140 | 140 | 119,5 | 290,8 | 106 % | 45 % | reussi |
| 300 | 2 | 300/300 | 0 | 6,3 | 888 | 888 | 231,6 | 293,3 | 103 % | 52 % | echoue |
| 300 | 3 | 300/300 | 0 | 5,1 | 1646 | 1646 | 334,8 | 298,5 | 149 % | 48 % | echoue |
| 500 | 1 | 500/500 | 0 | 4,7 | 9920 | 9920 | 190,7 | 310,9 | 123 % | 48 % | echoue |

Le palier 200 passe deux fois sur deux. Le palier 300 a été joué trois fois : un passage réussi, deux échoués (le troisième est un passage supplémentaire, joué après celui de 500 pour confirmer l'échec, le deuxième étant déjà `echoue` avec un lag de 231,6 ms). Selon la règle du protocole (voir « Configuration »), 300 est donc en échec. Le palier 500 a été joué une fois pour documenter la dégradation, il échoue. Les paliers 750 et 1000 n'ont pas été joués, l'échec étant établi à 300. L'écart entre le plus haut palier réussi (200) et le premier échec (300) est de 100, il n'y a pas de palier intermédiaire à jouer.

Le coût d'une réponse ne dépend plus de la taille de la salle : la réponse p95 est de 4,7 à 8,1 ms à 300 et 500 joueurs (1,8 s à 300 joueurs avant cette correction), et le critère de réponse n'échoue plus à aucun palier. Le critère de réponse passe de 44 à 60 ms à 200 joueurs après la correction du compteur à 6 à 21 ms.

Scénario établissement (dix parties de 30 joueurs, 3 processus) : `etab-cc-1` et `etab-cc-2`, tous deux `reussi`. Réponse p95 de 5,6 et 6,2 ms, diffusion p95 de 86 et 90 ms (max 144 et 139 ms), lag serveur p99 de 18,6 et 17,6 ms, aucune déconnexion.

Rafale (`rafale-cc`, 200 joueurs, le plus haut palier réussi, 250 arrivées par seconde, 2 processus) : `reussi`, 200 rejoints sur 200, aucune déconnexion. Le join p95 monte à 3453 ms (1004 ms avant cette correction) et le lag serveur p99 à 199,9 ms, juste sous le seuil de 200 ms ; la réponse p95 reste à 5,4 ms. Une arrivée en masse ralentit l'arrivée et touche de près le lag, sans dégrader les réponses. Passage informatif.

Le plus haut palier réussi (200) n'atteint pas 1000, le passage `etab1000-cc` (30 parties de 35 joueurs) n'a donc pas été joué.

Nouveau premier échec : 300 joueurs, et le goulot a changé de phase. Les réponses ne sont plus en cause (p95 de 5 à 8 ms, CPU db sous 55 %, RSS de 291 à 299 Mo). Ce qui sature l'event loop de l'application (lag p99 de 232 et 335 ms, CPU app de 103 à 149 % d'un cœur) est vraisemblablement la phase d'arrivée et le premier envoi de question (la diffusion n'est mesurée que par un p95 sur 10 questions, la première ne peut pas être isolée) : le join p95 est de 249 ms à 1,6 s à 300 joueurs (join p95 de 40 ms sur p200-cc-1 et de 1,26 s sur p200-cc-2 à 200 joueurs), et la diffusion de la question atteint 0,9 à 1,6 s à 300 joueurs et 9,9 s à 500. La cause probable est la diffusion de `lobby:update` à toute la salle à chaque arrivée (coût quadratique en nombre de joueurs), déjà notée comme tâche optionnelle ; elle n'a pas été analysée ici. La dispersion entre passages d'un même palier est forte (join p50 de 12 à 236 ms à 200 joueurs), ce qui laisse penser que la marge du palier 200 est plus étroite que ce que les médianes suggèrent.

## Diffusion du lobby coalescée

Cause traitée : à chaque arrivée ou reconnexion de joueur, le serveur diffusait `lobby:update` (liste complète des joueurs) à toute la salle, joueurs compris. Remplir une salle de N joueurs coûtait donc N diffusions d'une liste de taille N vers N sockets, un coût quadratique. La branche `perf/diffusion-lobby` (commits `perf(server): diffusion du lobby coalescée et réservée à l'hôte et à l'écran` et `test(server): attente bornée de l'état final du lobby et éviction pendant une diffusion différée`) remplace ces émissions par une diffusion coalescée par partie sur une fenêtre de 250 ms : immédiate si rien n'est parti depuis 250 ms, sinon une seule diffusion différée en fin de fenêtre, qui relit l'état courant. La liste complète `lobby:update` ne part plus qu'à la room `viewers:<id>` (hôte et grand écran) ; les joueurs reçoivent `lobby:count` (`{ count }`, nombre de joueurs connectés), seule information que leur écran affichait.

Même protocole que les campagnes précédentes (pile reconstruite sur le code de la branche, commit 9011613, base neuve avant chaque passage, `/health` puis 30 s, 10 questions, cadence de 25 arrivées par seconde, un seul générateur à la fois, cible `localhost:3000`, un processus générateur par 100 joueurs). Les libellés sont suffixés `-lb`. Le lag du générateur est resté entre 20 et 22 ms sur tous les passages. Le palier 1000 ayant échoué deux fois alors que 750 passait deux fois, l'écart (250) dépassait 100 : les paliers 800 et 900 ont été joués deux fois chacun.

| Palier | Essai | Rejoints | Déconnexions | Réponse p95 | Diffusion p95 | Diffusion max | Lag serveur p99 max | RSS max (Mo) | CPU app max | CPU db max | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 300 | 1 | 300/300 | 0 | 3,4 | 49 | 49 | 30,1 | 286,2 | 75 % | 40 % | reussi |
| 300 | 2 | 300/300 | 0 | 3,6 | 51 | 51 | 30,8 | 281,4 | 72 % | 38 % | reussi |
| 500 | 1 | 500/500 | 0 | 4,1 | 77 | 77 | 54,4 | 296,2 | 56 % | 46 % | reussi |
| 500 | 2 | 500/500 | 0 | 4,3 | 82 | 82 | 58,9 | 295,8 | 56 % | 40 % | reussi |
| 750 | 1 | 750/750 | 0 | 5,7 | 129 | 129 | 79,7 | 407,0 | 75 % | 57 % | reussi |
| 750 | 2 | 750/750 | 0 | 6,5 | 153 | 153 | 136,4 | 396,0 | 123 % | 55 % | reussi |
| 800 | 1 | 800/800 | 0 | 5,9 | 149 | 149 | 83,1 | 388,5 | 89 % | 60 % | reussi |
| 800 | 2 | 800/800 | 0 | 6,4 | 142 | 142 | 109,7 | 388,3 | 91 % | 58 % | reussi |
| 900 | 1 | 900/900 | 0 | 7,1 | 156 | 156 | 118,0 | 396,1 | 96 % | 63 % | reussi |
| 900 | 2 | 900/900 | 0 | 8,3 | 253 | 253 | 428,1 | 405,5 | 92 % | 76 % | echoue |
| 1000 | 1 | 1000/1000 | 0 | 26,0 | 494 | 494 | 697,3 | 414,4 | 124 % | 95 % | echoue |
| 1000 | 2 | 1000/1000 | 0 | 6,5 | 175 | 175 | 405,8 | 412,5 | 72 % | 60 % | echoue |

Les paliers 300, 500, 750 et 800 passent deux fois sur deux. Le palier 900 passe une fois sur deux, il est donc en échec selon la règle du protocole, et le palier 1000 échoue deux fois sur deux. Tous les passages, y compris en échec, ont zéro erreur du générateur et des réponses acceptées égales aux rejoints fois 10 (critères `zeroErreur` et `toutesReponses`). Le seul critère en échec est le lag de l'event loop (seuil p99 200 ms).

Les arrivées ne coûtent plus rien de mesurable : le join p95 est de 18 ms à 300 joueurs (249 ms à 1,6 s avant cette correction), de 20 à 24 ms à 500, de 32 à 37 ms à 800 et de 41 à 102 ms à 1000. Une seule exception, p750-lb-2 (join p95 de 337 ms), sans effet sur le verdict. La diffusion de la question, qui atteignait 0,9 à 1,6 s à 300 joueurs et 9,9 s à 500, tombe à 50 ms à 300 et 80 ms à 500.

Scénario établissement (dix parties de 30 joueurs, 3 processus) : `etab-lb-1` et `etab-lb-2`, tous deux `reussi`. Réponse p95 de 3,7 et 3,9 ms, diffusion p95 de 67 et 81 ms (max 102 et 105 ms), lag serveur p99 de 14,4 et 15,3 ms, aucune déconnexion.

Rafale (`rafale-lb`, 800 joueurs, le plus haut palier réussi, 250 arrivées par seconde, 8 processus) : `reussi`, 800 rejoints sur 800, aucune déconnexion. Le join p95 monte à 1423 ms (p50 636 ms) pour une arrivée de 800 joueurs en 3,2 s, la réponse p95 reste à 12 ms et le lag serveur p99 à 105,8 ms. Passage informatif. Le plus haut palier réussi (800) n'atteint pas 1000, le passage `etab1000-lb` n'a donc pas été joué.

Cohérence de la base : sur tous les passages, `session_player` est égal aux joueurs rejoints et `answer_record` aux réponses acceptées, mais seulement après un délai. Lue juste après la sortie du générateur, la base ne contient que 9 questions sur 10 (par exemple 4500 lignes au lieu de 5000 à 500 joueurs) ; les lignes de la dernière question arrivent ensuite (comptes complets relus 45 s plus tard sur tous les passages). C'est le défaut d'écriture différée des scores en fin de partie, antérieur à cette branche et traité à part sur la branche `fix/course-persistance-scores`, qui n'est pas incluse ici. Aucune réponse n'est perdue.

Nouveau premier échec : 900 joueurs, pendant les questions et non plus pendant les arrivées. Le join reste à 45 ms au p95 et la réponse sous 9 ms, mais l'event loop de l'application subit des pics (lag p99 de 428 ms à 900 joueurs, 406 à 697 ms à 1000) en même temps que la diffusion de la question s'allonge (253 ms à 900, 175 à 494 ms à 1000), avec un CPU app de 72 à 124 % d'un cœur, un CPU db de 60 à 95 % et un RSS stable vers 410 Mo : le coût restant est vraisemblablement celui des diffusions par question à toute la salle (question, correction, classement) et de l'écriture des réponses, non analysé ici. Le critère casse sur un pic isolé (le lag retenu est le maximum des p99 par seconde), d'où la forte dispersion entre passages d'un même palier.

## Chiffre annoncé

Après la diffusion du lobby coalescée, le plus haut palier réussi est 800 joueurs (`p800-lb-1` et `p800-lb-2`, deux passages réussis sur deux) : le palier 900 échoue (un passage réussi, un échoué) et le palier 1000 échoue deux fois. 800 est déjà une centaine ronde. On retire une marge de 20 % : 800 multiplié par 0,8 égale 640. Le chiffre annoncé est de 640 joueurs par partie, et le défaut de `MAX_PLAYERS_PER_SESSION` est aligné sur 640.

La marge à 800 est réelle mais pas large : lag serveur de 83 et 110 ms pour un seuil de 200, alors que 900 passe une fois sur deux. Les biais connus restant surtout optimistes (voir « Configuration », en particulier l'absence de réseau réel et de TLS, dont le coût croît avec le nombre de joueurs), ne pas dépasser le palier mesuré reste prudent.

Les valeurs précédentes sont conservées ci-dessous comme historique : 80 joueurs avant la première correction, puis 160 après la correction du compteur de réponses et après la réponse à coût constant.

Après correction, le plus haut palier réussi est 200 joueurs (deux passages réussis sur deux, `p200-apres-1` et `p200-apres-2`). Il s'arrondit à 200 (centaine inférieure). On retire une marge de 20 % : 200 multiplié par 0,8 égale 160. Le chiffre annoncé est de 160 joueurs par partie.

Avant correction, le plus haut palier réussi était 100, soit 100 multiplié par 0,8 égal 80 joueurs. Cette valeur reste mentionnée comme chiffre avant correction.

Le palier 200 passe avec une marge modérée (réponse p95 de 44 à 60 ms pour un seuil de 300, lag serveur de 70 à 112 ms pour un seuil de 200), et l'échec se produit entre 200 et 300. Comme les biais connus sont surtout optimistes (voir « Configuration »), ne pas dépasser le palier mesuré reste prudent. Le défaut de `MAX_PLAYERS_PER_SESSION` avait alors été aligné sur 160. Le scénario établissement montre par ailleurs que 300 connexions réparties en dix salles de 30 sont supportées, avant comme après correction.

Après la réponse à coût constant, le plus haut palier réussi reste 200 joueurs (`p200-cc-1` et `p200-cc-2`, deux passages réussis sur deux) : le palier 300 échoue (un passage réussi, deux échoués) et le palier 500 échoue. Le calcul est inchangé : 200 multiplié par 0,8 égale 160, le chiffre annoncé restait de 160 joueurs par partie et le défaut de `MAX_PLAYERS_PER_SESSION` n'avait pas été modifié. L'amélioration mesurée porte sur le coût des réponses, qui ne limite plus la salle ; la limite est désormais l'arrivée des joueurs et le premier envoi de question, au-delà de 200. La cause de ce goulot aux arrivées n'a pas été analysée, et la marge à 200 est étroite : join p95 de 1,26 s sur p200-cc-2, lag serveur de 199,9 ms pour un seuil de 200 sur rafale-cc.
