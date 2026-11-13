/**
 * Identifiant de CE chargement de page : tiré une fois à l'évaluation du module, il change à chaque
 * rechargement. Il marque l'état de navigation posé au lancement d'une partie (`useLaunchGame`).
 *
 * Pourquoi : l'état de navigation (`location.state`) est rangé dans l'historique du navigateur et
 * survit à un rechargement, alors que l'autorité d'hôte, liée à la socket, n'y survit pas. L'écran
 * hôte ne peut donc pas déduire de la seule présence de cet état que sa socket tient la partie :
 * il compare l'identifiant porté par l'état à celui du chargement en cours (voir `HostLive`).
 *
 * Ce n'est pas un secret : un simple marqueur de durée de vie de page.
 */
export const PAGE_LOAD_ID: string = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
