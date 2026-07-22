# Contribuer à {{PROJECT_NAME}} 🐾

Bienvenue. Vraiment. Que tu sois mainteneur chevronné ou que ce soit ta **toute première contribution open source**, tu es à ta place ici.

## La règle numéro un

**On accueille avant de corriger.** Aucune question n'est bête, aucune PR n'est « trop petite ». Si tu bloques, ouvre une [discussion]({{DISCUSSIONS_URL}}) — on répond, on n'explique pas de haut.

## Première contribution ?

1. Cherche une issue [`good first issue`]({{ISSUES_URL}}) — elles sont choisies pour démarrer en douceur.
2. Commente « je prends » pour qu'on te la réserve.
3. Fork → branche → code → PR. **Dis dans la description que c'est ta première** : on te déroule le tapis.

## Le flow

```bash
# 1. Fork + clone
git clone https://github.com/<toi>/{{PROJECT_NAME}}.git

# 2. Installe + vérifie que tout passe AVANT de coder
{{INSTALL_CMD}}
{{TEST_CMD}}

# 3. Branche parlante
git checkout -b fix/accents-export

# 4. Code, teste, commit
{{TEST_CMD}}
git commit -m "fix: les accents ne sautent plus à l'export CSV"
```

## Ce qu'on regarde en review

- **Les tests passent** — c'est la douceur ET l'exigence.
- **Le code se lit** — un·e débutant·e doit pouvoir suivre.
- **Un changement = une PR** — plus facile à accueillir et à merger.

On laisse des suggestions inline, jamais des ordres. Rien n'est bloquant sans qu'on explique pourquoi.

## Code de conduite

Bienveillance, zéro gatekeeping, zéro élitisme. On célèbre les contributions plutôt que les egos. Voir [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

---

<sub>Merci de poser tes pattes ici. On te fait de la place. — Sploot Labs 🐾</sub>
