# Contribuer à Pengou 🐧

Bienvenue. Vraiment. Que tu sois mainteneur chevronné ou que ce soit ta **toute première
contribution open source**, tu es à ta place ici.

## La règle numéro un

**On accueille avant de corriger.** Aucune question n'est bête, aucune PR n'est « trop petite ».
Si tu bloques, ouvre une [discussion](https://github.com/Sploot-Labs/pengou/discussions), on
répond, on n'explique pas de haut.

## Première contribution ?

1. Cherche une issue [`good first issue`](https://github.com/Sploot-Labs/pengou/labels/good%20first%20issue), choisies pour démarrer en douceur.
2. Commente « je prends » pour qu'on te la réserve.
3. Fork → branche → code → PR. **Dis dans la description que c'est ta première** : on te déroule le tapis.

## Le flow

```bash
# 1. Fork + clone
git clone https://github.com/<toi>/pengou.git
cd pengou

# 2. Installe + vérifie que tout passe AVANT de coder
pnpm install
pnpm typecheck && pnpm lint
pnpm test            # les tests DB/e2e utilisent testcontainers → Docker requis

# 3. Branche parlante
git checkout -b fix/accents-export

# 4. Code, teste, commit (signé DCO — voir plus bas)
pnpm test
git commit -s -m "fix: les accents ne sautent plus à l'export CSV"
```

Pour lancer l'app en local (serveur + SPA), voir la section **Développement local** du
[README](./README.md).

## Ce qu'on regarde en review

- **Les tests passent** — c'est la douceur ET l'exigence. Ajoute des tests pour tout comportement nouveau ou corrigé.
- **`pnpm typecheck` et `pnpm lint` sont verts** — la CI les rejoue de toute façon.
- **Le code se lit** — un·e débutant·e doit pouvoir suivre. On garde le style du fichier voisin (single quotes, pas de semicolons).
- **Un changement = une PR** — plus facile à accueillir et à merger.

On laisse des suggestions inline, jamais des ordres. Rien n'est bloquant sans qu'on explique pourquoi.

## DCO — signe tes commits

Les contributions sont acceptées sous [Developer Certificate of Origin](https://developercertificate.org/) :
ajoute `-s` à tes commits (`git commit -s`), ce qui appose une ligne `Signed-off-by:` attestant
que tu as le droit de contribuer ce code. Pas de CLA lourd.

## Sécurité

Tu penses avoir trouvé une faille ? **Ne l'ouvre pas en issue publique** — suis
[SECURITY.md](./SECURITY.md).

## Code de conduite

Bienveillance, zéro gatekeeping, zéro élitisme. On célèbre les contributions plutôt que les
egos. Voir [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

---

<sub>Merci de poser tes pattes ici. On te fait de la place. Sploot Labs 🐾</sub>
