# Politique de sécurité

Merci d'aider à garder Pingou sûr pour tout le monde. 🐧

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique pour une faille de sécurité.** Une divulgation publique avant
correctif expose tous les déploiements.

À la place :

- Utilisez **[GitHub Security Advisories](https://github.com/splootlabs/pingou/security/advisories/new)**
  (« Report a vulnerability ») — canal privé, recommandé ; **ou**
- écrivez à **security@splootlabs.dev**.

Merci d'inclure : une description, les étapes de reproduction (ou un PoC), l'impact estimé, et
les versions/configuration concernées.

## Notre engagement

- **Accusé de réception** sous 72 h.
- **Évaluation initiale** sous 7 jours.
- On vous tient informé·e jusqu'au correctif, et on vous crédite dans l'advisory (sauf si vous
  préférez rester anonyme).
- Divulgation coordonnée : on publie l'advisory une fois le correctif disponible.

## Périmètre

Sont particulièrement dans le périmètre : contournement d'authentification, accès inter-tenant
ou inter-utilisateur aux données, injection (SQL/commande), XSS, élévation de privilège,
exposition de secrets. Merci de tester **uniquement contre votre propre instance**.

## Bonnes pratiques de déploiement

- Générez un `BETTER_AUTH_SECRET` fort et **ne le committez jamais** (voir `.env.example`).
- Servez **derrière HTTPS** et fixez `BETTER_AUTH_URL` en `https://` (cookies `Secure`).
- Ajustez `RATE_LIMIT_MAX` selon votre exposition.
