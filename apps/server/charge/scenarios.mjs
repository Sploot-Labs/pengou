// Scénarios de campagne : chaque passage est joué `essais` fois, sur une base neuve à chaque fois.
// Changer un passage (joueurs, parties, cadence) change sa clé d'historique : il ne sera plus
// comparé aux campagnes précédentes.

const palier = (joueurs, essais) => ({ libelle: `p${joueurs}`, joueurs, parties: 1, cadence: 25, essais })
const etab = (essais) => ({ libelle: 'etab', joueurs: 30, parties: 10, cadence: 25, essais })

export const SCENARIOS = {
  // Une dizaine de minutes : le chiffre annoncé (640), le plus haut palier tenu (800) et dix salles.
  rapide: [palier(640, 1), palier(800, 1), etab(1)],
  // Tailles de classe et d'amphithéâtre, une partie chacune : le chiffre « testé à N joueurs » que
  // le site vitrine peut citer pour une salle ordinaire. Quelques minutes.
  paliers: [palier(30, 1), palier(50, 1), palier(100, 1), palier(200, 1)],
  // Le protocole du rapport du 31 octobre 2026 : toute l'échelle, deux essais par palier.
  complet: [
    palier(300, 2),
    palier(500, 2),
    palier(750, 2),
    palier(800, 2),
    palier(900, 2),
    palier(1000, 2),
    etab(2),
    { libelle: 'rafale', joueurs: 800, parties: 1, cadence: 250, essais: 1 },
  ],
}
