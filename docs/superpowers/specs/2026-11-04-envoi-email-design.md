# Envoi d'e-mails transactionnels

Date : 2026-11-04. Statut : validé en conversation, relu, en attente de relecture par l'utilisateur.

## Intention

Aujourd'hui, un utilisateur de app.pengou.fr qui oublie son mot de passe est bloqué : l'écran de connexion n'offre aucun recours et Pengou n'envoie aucun e-mail. Les utilisateurs sont réels et leurs adresses sont bonnes. Combler ce trou est le besoin principal. L'invitation à un espace de travail par e-mail vient en complément du lien copiable qui existe déjà, et la confirmation d'adresse sert à freiner les comptes de spam sur un service dont l'inscription est ouverte (mode multi).

Pengou est open source et auto-hébergeable. Tout ce qui suit doit fonctionner sans prestataire d'e-mail : un auto-hébergeur sans SMTP garde une application complète, simplement sans envoi.

Côté Brevo, le domaine pengou.fr est authentifié (DKIM, DMARC, sous-domaine de marque `mail.pengou.fr` réservé aux liens de suivi et au return-path). L'expéditeur est `Pengou <contact@pengou.fr>` ; les réponses arrivent dans la boîte Proton de contact@pengou.fr, indépendante de Brevo.

## Objectifs

1. Un module d'envoi isolé derrière une interface `Mailer`, avec quatre implémentations : SMTP générique (nodemailer), API transactionnelle Brevo (appel HTTP direct), mémoire (tests) et journal (repli sans configuration).
2. La réinitialisation du mot de passe de bout en bout : lien « Mot de passe oublié » sur l'écran de connexion, écran de demande, e-mail, écran de choix du nouveau mot de passe.
3. L'envoi de l'e-mail d'invitation à la création et au renvoi, le lien restant copiable comme aujourd'hui.
4. Une confirmation d'adresse douce : e-mail envoyé à l'inscription, bandeau dans l'app tant que l'adresse n'est pas confirmée, et une seule restriction, un seul quiz actif possédé.
5. Le refus des adresses jetables et des domaines incapables de recevoir du courrier, à l'inscription et à l'invitation.
6. Une aide à la saisie sur les champs e-mail (« Vouliez-vous dire gmail.com ? »), jamais bloquante.
7. Des gabarits en français, texte et HTML, conformes au RGAA, dans l'habillage « Banquise claire » validé sur maquette.
8. Mailpit en développement, des tests sans aucun secret ni réseau en CI, et la documentation d'exploitation.
9. Le déploiement sur app.pengou.fr via splootlabs-ops, avec l'API Brevo comme transport de production.

## Non-objectifs

- Vérification d'adresse bloquante : l'utilisateur non vérifié se connecte, joue et anime normalement.
- Changement d'adresse e-mail par l'utilisateur, connexion par lien magique, e-mails de notification ou marketing.
- Webhooks Brevo (rebonds, plaintes), statistiques d'ouverture, file d'attente persistante avec reprise.
- Normalisation des alias : `prenom+pengou@gmail.com` et `pre.nom@gmail.com` restent des adresses distinctes, acceptées telles quelles.
- Utilisation du SDK `@getbrevo/brevo` (décision de l'utilisateur : `fetch` direct).

## Anti-objectifs

- Révéler si un compte existe : la demande de réinitialisation renvoie la même réponse, dans le même délai perceptible, que l'adresse soit connue ou non.
- Faire planter le démarrage d'un auto-hébergement parce qu'aucun prestataire d'e-mail n'est configuré.
- Brider un auto-hébergeur sans envoi : la limite d'un quiz ne s'applique que si l'envoi est configuré.
- Écrire un token, un lien d'action complet, une clé API ou un mot de passe SMTP dans les journaux.
- Insérer une donnée utilisateur non échappée dans le HTML d'un e-mail.
- Bloquer une inscription légitime parce que le DNS est lent ou injoignable.
- Casser le flux d'invitation actuel : si l'envoi échoue, l'invitation est quand même créée et le lien reste copiable.

## Décisions de l'utilisateur

Transport. SMTP et API Brevo sont tous deux implémentés derrière la même interface. SMTP est le transport documenté pour les auto-hébergeurs et celui de Mailpit en dev ; la production app.pengou.fr utilise l'API Brevo, appelée par `fetch` sans SDK.

Vérification d'adresse. Douce : l'utilisateur peut jouer tout de suite et est invité à confirmer plus tard. Tant que l'adresse n'est pas confirmée, il ne peut pas posséder plus d'un quiz actif. Cette limite n'existe que si l'envoi est configuré et en mode multi. Accepter une invitation réellement reçue par e-mail, avec le compte de l'adresse invitée, vaut confirmation.

Contrôle des adresses. On refuse les domaines jetables et les domaines qui ne peuvent pas recevoir de courrier. On autorise les alias.

Apparence. Piste « Banquise claire » : fond clair, logo couleur, les quatre formes de réponse en clin d'œil au-dessus du titre, bouton bleu nuit à texte blanc, lien de secours en clair, pied de page invitant à répondre. Le logo est obligatoire. Le tout doit rester conforme au RGAA.

## Conception

### Le module d'envoi

Un nouveau paquet `packages/mail` (`@splootlabs/mail`), consommé par `packages/auth` et `apps/server`. Il contient l'interface, les transports, les gabarits et les contrôles d'adresse côté serveur.

```ts
export type OutgoingMail = {
  to: string
  subject: string
  text: string
  html: string
  /** Nom de gabarit, pour les journaux et les tests (jamais le contenu). */
  kind: 'invitation' | 'reset-password' | 'verify-email'
}

export interface Mailer {
  /** true si un vrai transport est configuré (smtp ou brevo). */
  readonly enabled: boolean
  send(mail: OutgoingMail): Promise<void>
}
```

`send` lève une `MailError` en cas d'échec ; chaque appelant décide quoi en faire (voir plus bas). L'expéditeur (`MAIL_FROM`) et l'adresse de réponse (`MAIL_REPLY_TO`) sont fixés à la construction du transport, pas à chaque envoi.

`SmtpMailer` s'appuie sur nodemailer, avec `secure` déduit du port (465 implicite, sinon STARTTLS exigé via `requireTLS`), délais de connexion et d'envoi bornés (10 s). `BrevoMailer` fait un `POST https://api.brevo.com/v3/smtp/email` avec l'en-tête `api-key`, un corps `{ sender, to, replyTo, subject, htmlContent, textContent }`, un délai de 10 s via `AbortSignal.timeout`, et transforme toute réponse non 2xx en `MailError` portant le statut et le code Brevo, jamais l'en-tête. Le suivi des clics de Brevo réécrit les liens par `mail.pengou.fr` ; il reste à la configuration du compte Brevo, le code ne le pilote pas. `MemoryMailer` empile les messages dans un tableau consultable par les tests. `LogMailer` (repli) journalise le destinataire, le sujet et le type de gabarit, plus, hors production uniquement, le corps texte avec les tokens masqués (les 6 premiers caractères suivis de `…`).

Une fabrique `createMailer(config, logger)` choisit le transport.

### Configuration

Nouvelles variables, validées dans `packages/shared/src/config.ts` et exposées dans `AppConfig.mail` :

- `MAIL_TRANSPORT` : `smtp`, `brevo`, ou absente (repli journal).
- `MAIL_FROM` : obligatoire dès qu'un transport est choisi, au format `Nom <adresse>` ou adresse seule.
- `MAIL_REPLY_TO` : optionnelle.
- `SMTP_HOST`, `SMTP_PORT` (défaut 587), `SMTP_USER`, `SMTP_PASSWORD` : `SMTP_HOST` obligatoire si `MAIL_TRANSPORT=smtp` ; utilisateur et mot de passe optionnels ensemble (Mailpit n'en demande pas), mais l'un sans l'autre est refusé.
- `BREVO_API_KEY` : obligatoire si `MAIL_TRANSPORT=brevo`.
- `EMAIL_DOMAIN_CHECK` : `auto` par défaut (contrôle DNS actif seulement si un transport est configuré), `true` pour le forcer, `false` pour le couper (réseau isolé, DNS interne qui ne résout pas l'extérieur). Mon choix, après relecture : un auto-hébergeur sans envoi derrière un DNS d'intranet verrait sinon toutes ses inscriptions refusées.

Une incohérence (transport choisi sans ses paramètres) fait échouer `loadConfig` avec un message en français, comme pour `BETTER_AUTH_SECRET`. L'absence de transport n'est jamais une erreur : en production, le serveur démarre et journalise un avertissement unique expliquant que la réinitialisation de mot de passe, l'envoi d'invitations et la confirmation d'adresse sont désactivés. Le mot de passe SMTP et la clé Brevo ne sont jamais journalisés, y compris dans l'erreur de validation zod (on vérifie que le message d'erreur n'en contient pas la valeur).

Les liens des e-mails sont absolus et construits sur `config.authUrl` (`BETTER_AUTH_URL`), jamais sur l'en-tête `Host` de la requête.

### Ce que le web sait de l'envoi

`GET /api/me` renvoie déjà `emailVerified` (c'est l'utilisateur Better Auth tel quel) : il suffit de l'ajouter au type `User` de `apps/web/src/api/auth.tsx`. Une nouvelle route publique `GET /api/auth-features` renvoie `{ mailEnabled: boolean }` (aucune donnée sensible, pas de détail sur le transport). Le web s'en sert pour afficher ou masquer le lien « Mot de passe oublié », le bandeau de confirmation et la mention « e-mail envoyé » dans les invitations.

### Réinitialisation du mot de passe

Better Auth 1.7 fournit `/request-password-reset` et `/reset-password`. On configure `emailAndPassword.sendResetPassword` pour envoyer le gabarit `reset-password`, `resetPasswordTokenExpiresIn: 3600` (1 heure, mon choix) et `revokeSessionsOnPasswordReset: true` (mon choix : un changement de mot de passe déconnecte les autres appareils). Si le mailer n'est pas activé, `sendResetPassword` n'est pas branché et le lien est masqué côté web.

Pour ne pas révéler l'existence d'un compte, l'envoi est lancé sans être attendu par la réponse HTTP (`void mailer.send(...).catch(log)`), pour que le temps de réponse dépende le moins possible de l'existence de l'adresse. Better Auth 1.7.12 renvoie le même corps dans les deux cas (vérifié), mais la branche « adresse connue » insère en plus une valeur de vérification en base : l'écart de temps est réduit, pas annulé, ce qu'on accepte (la limite de débit rend l'énumération par chronométrage peu praticable). Un test e2e garantit même statut et même corps.

Écrans web : `/forgot-password` (champ e-mail avec aide à la saisie, puis message neutre « Si un compte existe pour cette adresse, un e-mail vient de partir. Pensez à vérifier les indésirables. ») et `/reset-password?token=…` (nouveau mot de passe et confirmation, mêmes règles de longueur que l'inscription, message clair si le lien a expiré avec un lien vers une nouvelle demande, puis redirection vers la connexion). Le lien de l'e-mail est celui que Better Auth construit (`${authUrl}/api/auth/reset-password/<token>?callbackURL=…`) ; le client passe `redirectTo: '/reset-password'` à `/request-password-reset`, et Better Auth redirige vers `/reset-password?token=…` ou `/reset-password?error=INVALID_TOKEN`. L'écran traite donc à la fois `?error=INVALID_TOKEN` et le refus 400 du `POST /reset-password` comme un lien expiré ou invalide. Les écrans reprennent le style et les règles d'accessibilité de `Login.tsx` (focus sur le résumé d'erreur, libellés explicites).

### Invitations

Dans `apps/server/src/routes/invitations.ts`, la création et le renvoi envoient le gabarit `invitation` une fois l'invitation enregistrée, puis répondent comme aujourd'hui en ajoutant `emailSent: boolean`. L'envoi est attendu (l'administrateur veut savoir s'il est parti), mais un échec n'annule rien : l'invitation existe, `emailSent` vaut `false`, l'erreur est journalisée sans le token. Le lien d'invitation est `${authUrl}/invitations/${token}`.

`WorkspaceSettings.tsx` garde le lien copiable et affiche « Invitation envoyée à … » ou, si `emailSent` est faux alors que l'envoi est activé, « L'e-mail n'a pas pu partir, copiez le lien ci-dessous ». Sans envoi configuré, l'écran reste exactement celui d'aujourd'hui. En mode multi, un invitant dont l'adresse n'est pas confirmée n'envoie pas d'e-mail : l'invitation est créée ou renvoyée, la réponse porte `emailSent: false` et `emailSkipped: 'inviter_unverified'`, `emailed_at` reste nul, et l'écran affiche « Confirmez votre adresse pour envoyer les invitations par e-mail. En attendant, copiez le lien ci-dessous. » (décision du contrôleur, validée en revue finale).

Accepter une invitation confirme l'adresse (décision de l'utilisateur), à deux conditions : l'invitation est réellement partie par e-mail, et l'adresse du compte qui accepte est celle de l'invitation (comparaison insensible à la casse, sans normalisation des alias). Pour savoir qu'elle est partie, la table `invitation` gagne une colonne `emailed_at` (horodatage nullable, migration Drizzle), posée quand l'envoi de la création ou du renvoi réussit et remise à nul au renvoi avant le nouvel essai, puisque le token change. `acceptInvitation` met alors `user.emailVerified` à `true` dans la même transaction. Un lien copié à la main ne confirme rien.

Le gabarit nomme la personne qui invite (nom d'affichage, à défaut l'e-mail), l'espace et le rôle, et donne la date d'expiration en français.

### Confirmation d'adresse

Si le mailer est activé, on configure `emailVerification` de Better Auth : `sendOnSignUp: true`, `sendVerificationEmail` vers le gabarit `verify-email`, `expiresIn: 86400` (24 heures, mon choix), `autoSignInAfterVerification: true`, et `emailAndPassword.requireEmailVerification` reste à `false`. Le lien ramène sur l'app, qui affiche une confirmation : le client envoie `callbackURL: '/?email-verifie=1'` dans le corps de `/sign-up/email` et de `/send-verification-email` (Better Auth ne le fixe pas côté serveur et retombe sinon sur `/`). Better Auth attend `sendVerificationEmail` pendant l'inscription, après création du compte : le gabarit est envoyé dans un `try/catch` qui journalise l'échec sans le propager, pour qu'une panne d'envoi ne fasse pas échouer une inscription dont le compte existe déjà (l'utilisateur pourra redemander l'e-mail depuis le bandeau).

Les comptes existants ne sont pas marqués vérifiés d'office (mon choix) : ils voient le bandeau et peuvent demander l'e-mail, rien ne les bloque hormis la limite de quiz pour en créer un nouveau. Les comptes Google, Facebook ou GitHub reçoivent `emailVerified` du fournisseur, comportement standard de Better Auth.

Bandeau : affiché dans l'`AppShell` quand l'utilisateur connecté n'est pas vérifié et que l'envoi est activé. Texte « Confirmez votre adresse pour créer plus d'un quiz. » et bouton « Renvoyer l'e-mail » qui appelle `/send-verification-email` puis affiche « E-mail envoyé ». C'est une région `role="status"`, contraste au moins 4,5:1, fermable pour la session.

### Limite d'un quiz pour les comptes non vérifiés

Règle : si `mailer.enabled`, que `TENANCY_MODE` vaut `multi` (décision de l'utilisateur : la limite vise l'inscription ouverte, pas une instance mono-espace où l'administrateur invite ses collègues) et que l'utilisateur n'est pas vérifié, il ne peut pas créer de quiz s'il possède déjà au moins un quiz non archivé (`quiz.ownerId = user.id`, `archivedAt` nul, tous espaces confondus). Elle s'applique à toutes les routes qui créent un quiz : `POST /api/quizzes`, la duplication et la composition depuis la bibliothèque, et toute autre route de création que le constructeur trouvera (à recenser par recherche des insertions dans `quiz`). Refus en `403` avec `{ error: "Confirmez votre adresse e-mail pour créer d'autres quiz.", code: 'email_unverified_quiz_limit' }`. Le web reconnaît ce code et propose le renvoi de l'e-mail sur place. Désarchiver un quiz est soumis à la même règle (mon choix, sinon on contourne la limite).

La vérification se fait dans une fonction partagée côté serveur, testée seule, appelée par chaque route.

### Contrôle des adresses

Une fonction `checkEmailDeliverable(email, { resolver })` dans `packages/mail` renvoie `ok`, `disposable` ou `undeliverable`. Domaines jetables : liste du paquet npm `disposable-email-domains` (mon choix), chargée une fois en mémoire, comparée au domaine en minuscules et à ses domaines parents. Domaine : `resolveMx`, puis à défaut `resolve4`/`resolve6` (règle du MX implicite) ; `undeliverable` seulement sur réponse DNS négative franche (`ENOTFOUND`, `ENODATA`, MX nul `.`). Délai dépassé, `ESERVFAIL`, `ECONNREFUSED` et toute autre erreur laissent passer (`ok`) avec un avertissement journalisé sans l'adresse complète. Délai total 3 s. `EMAIL_DOMAIN_CHECK=false` saute la partie DNS, la liste des jetables reste active. Le résolveur est injecté pour que les tests n'utilisent jamais le réseau.

Points d'application : l'inscription e-mail et mot de passe (hook `before` de Better Auth sur `/sign-up/email`, qui lève une `APIError` 400 au message clair : « Les adresses e-mail jetables ne sont pas acceptées. » ou « Ce domaine ne semble pas pouvoir recevoir d'e-mails. Vérifiez l'adresse. ») et la création d'invitation. Pas à la connexion ni à la demande de réinitialisation (on ne doit ni bloquer un compte existant ni révéler quoi que ce soit).

### Aide à la saisie

Une fonction pure `suggestEmailDomain(email)` dans `packages/shared`, utilisée par le web : distance d'édition (au plus 2) entre le domaine saisi et une courte liste de domaines courants en France (gmail.com, outlook.fr, outlook.com, hotmail.fr, hotmail.com, live.fr, yahoo.fr, yahoo.com, orange.fr, wanadoo.fr, free.fr, sfr.fr, laposte.net, icloud.com, protonmail.com, proton.me), et sur l'extension (`.con`, `.fr.`, `.cm`). Elle renvoie l'adresse corrigée ou `null`, et ne touche jamais la partie locale. Le web l'affiche sous le champ à la perte de focus, dans une région `aria-live="polite"`, sous la forme « Vouliez-vous dire camille@gmail.com ? » avec un bouton qui applique la correction. Champs concernés : inscription, mot de passe oublié, invitation.

### Gabarits

Trois gabarits, chacun une fonction pure `(données) => { subject, text, html }`, dans `packages/mail/src/templates`. Un gabarit de base partagé fournit la structure HTML : document `lang="fr"`, tableaux de mise en page avec `role="presentation"`, largeur 560 px maximum, styles en ligne, texte au moins 16 px, logo PNG couleur en hauteur 40 px avec `alt="Pengou"`, les quatre formes de réponse en petits blocs décoratifs `aria-hidden="true"`, un `<h1>`, un bouton bleu nuit #0B2545 à texte blanc (contraste 15:1), le lien de secours en clair souligné, le pied de page « Pengou, des quiz en direct pour la classe. Une question ? Répondez à cet e-mail. ». Une préentête masquée résume le message. Les couleurs viennent du kit (`docs/pengou-logo-kit/LISEZMOI.md`) ; le corail reste réservé au bec du logo, conformément à ses règles.

Toutes les valeurs dynamiques (noms, espace, adresse, URL) passent par une fonction d'échappement HTML unique ; les URL sont en plus validées comme commençant par `config.authUrl`. Le constructeur peut choisir d'écrire les gabarits en chaînes de caractères balisées ou avec un petit moteur, mais sans dépendance lourde de type MJML.

Le logo est servi par l'app : copie de `pengou-logo-horizontal-couleur-h128.png` dans `apps/web/public/email/logo.png`, référencé en absolu (`${authUrl}/email/logo.png`). Gmail n'affichant pas le SVG, on n'en utilise pas.

Contenus : ceux des maquettes, avec le titre « Une invitation vous attend ! » pour l'invitation, « Choisir un nouveau mot de passe » et « Confirmez votre adresse e-mail ». Pas de point médian ni d'écriture inclusive abrégée. Les sujets : « Camille Martin vous invite sur Pengou », « Réinitialiser votre mot de passe Pengou », « Confirmez votre adresse e-mail Pengou ».

### Limitation de débit

Better Auth 1.7.12 a déjà une règle intégrée pour `/request-password-reset` et `/send-verification-email` (3 requêtes par 60 s et par IP). On la remplace par une `customRules` plus stricte, 3 requêtes par 10 minutes et par IP (mon choix) ; une règle personnalisée remplace celle d'origine pour ce chemin, elle ne s'y ajoute pas. Le limiteur ne tourne qu'en `development` et `production` : pour les tests dédiés, `AuthConfig` gagne une option `rateLimitEnabled` qui force son activation. Invitations : `config.rateLimit` de `@fastify/rate-limit` sur la création et le renvoi, 20 par heure et par utilisateur connecté (clé : identifiant utilisateur). Les deux restent désactivées en test, comme l'existant, sauf dans les tests dédiés qui les activent explicitement.

### Journaux

On journalise le type de gabarit, le transport, le domaine du destinataire (pas l'adresse complète) et le résultat. Jamais de token, d'URL d'action, de clé ni de mot de passe. Un test vérifie, avec un journal capturé, qu'un envoi d'invitation et de réinitialisation ne laisse pas passer le token.

### Développement local

`docker-compose.yml` gagne un service `mailpit` (`axllent/mailpit`, version figée), interface web publiée sur le port 8025, SMTP 1025 non publié. Le service `app` reçoit `MAIL_TRANSPORT: ${MAIL_TRANSPORT:-smtp}`, `SMTP_HOST: mailpit`, `SMTP_PORT: 1025`, `MAIL_FROM: Pengou <contact@pengou.fr>`. Pour le développement hors conteneur (`pnpm dev`), `.env.example` documente les mêmes valeurs avec `localhost`. La documentation (`docs/devops.md` et le README) explique comment ouvrir http://localhost:8025.

### Tests

Unitaires : validation de configuration (chaque combinaison incohérente refusée, secrets absents des messages), `createMailer`, `BrevoMailer` avec un `fetch` factice (corps envoyé, en-tête, erreurs 4xx et 5xx, délai), `SmtpMailer` avec un transport nodemailer factice ou `jsonTransport`, échappement des gabarits (injection d'un nom contenant `<script>` et `"`), présence des versions texte et HTML, `checkEmailDeliverable` avec résolveur factice (jetable, sans MX avec A, sans rien, délai dépassé), `suggestEmailDomain`, la règle de limite de quiz.

E2e serveur (testcontainers comme l'existant, `MemoryMailer` injecté) : invitation créée et renvoyée avec e-mail reçu contenant le bon lien, `emailSent: false` si le mailer échoue ; réinitialisation complète (demande, extraction du lien depuis le `MemoryMailer`, nouveau mot de passe, connexion avec l'ancien refusée) ; réponse identique pour une adresse inconnue et aucun e-mail envoyé ; inscription avec domaine jetable refusée ; confirmation d'adresse puis limite de quiz levée ; limite de quiz absente quand le mailer est le repli journal et en mode single ; acceptation d'une invitation envoyée par e-mail qui confirme l'adresse, et d'une invitation non envoyée ou pour une autre adresse qui ne la confirme pas ; limite de débit atteinte sur la demande de réinitialisation.

Web : tests Vitest des nouveaux écrans et du bandeau, à la manière des tests existants.

La CI ne reçoit aucune variable de messagerie : le repli et le `MemoryMailer` suffisent.

### Documentation

`docs/devops.md` : une section « Envoi d'e-mails » avec les variables, les deux transports, l'exemple Brevo (SMTP et API), le comportement sans configuration, le réglage « IP autorisées » de Brevo qui peut bloquer les appels API, Mailpit en dev. README : une ligne qui y renvoie. `.env.example` mis à jour.

## Côté splootlabs-ops

Dans `stacks/pengou/compose.yml`, l'ancre `x-app-env` reçoit :

```yaml
  MAIL_TRANSPORT: brevo
  MAIL_FROM: Pengou <contact@pengou.fr>
  MAIL_REPLY_TO: contact@pengou.fr
  BREVO_API_KEY: ${BREVO_API_KEY:?Définissez BREVO_API_KEY (clé API Brevo) dans stacks/pengou/.env}
```

`BREVO_API_KEY` est obligatoire pour cette stack (service public, l'envoi doit marcher), alors que l'image Pengou la traite comme optionnelle. Un commentaire précise, comme pour les variables existantes, qu'une image antérieure ignore ces variables. `stacks/pengou/.env.example` documente `BREVO_API_KEY` avec la marche à suivre dans Brevo (Paramètres, SMTP et API, onglet Clés API, « Générer une nouvelle clé », nommée par exemple `pengou-prod`) et rappelle le réglage des IP autorisées. Les tests `tests/run.sh` doivent passer.

Ordre de mise en production, parce que la variable est obligatoire : release Pengou d'abord, ajout de `BREVO_API_KEY` dans le `.env` du serveur ensuite, puis une seule PR splootlabs-ops qui contient le changement de compose et le bump de `stacks/pengou/VERSION`. Fusionner avant d'avoir complété le `.env` ferait échouer le déploiement à l'interpolation, sans casser le service en place. Le service `migrate` partage l'ancre `x-app-env` : il exigera lui aussi `BREVO_API_KEY`, ce qui est cohérent avec cet ordre.

## Laissé au constructeur

L'organisation interne du paquet `packages/mail`, le style d'écriture des gabarits, le découpage exact des composants web, le recensement complet des routes de création de quiz, la forme du test d'égalité des réponses de réinitialisation, et l'ajout éventuel d'un transport `brevo` dans les tests e2e (non requis).

## Vérification finale

Après déploiement, envoi réel d'une invitation vers une adresse Gmail, puis « Afficher l'original » : SPF, DKIM et DMARC doivent être à PASS, et l'expéditeur affiché `Pengou <contact@pengou.fr>`. Puis une réinitialisation de mot de passe réelle sur un compte de test.
