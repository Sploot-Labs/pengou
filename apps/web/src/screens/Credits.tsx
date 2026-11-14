import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n/useT'
import { AppHeader } from '../ui/AppHeader'

const licenseUrl = (lang: string) => `https://creativecommons.org/licenses/by-sa/4.0/deed.${lang}`
const CATALOG_URL = 'https://github.com/Sploot-Labs/pengou/blob/main/packages/library/catalog'

/** Fichier de licence d'un dossier du catalogue : attribution détaillée et modifications. */
function LicenseFile({ folder, children }: { folder: string; children: string }) {
  return (
    <a href={`${CATALOG_URL}/${folder}/LICENSE.md`} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

/**
 * Crédits et licences des questions de la bibliothèque. Les mentions de l'interface (étiquettes
 * des cartes, aperçu, éditeur) restent courtes et renvoient ici, par section : CC BY-SA 4.0 admet
 * une attribution par lien vers une page qui donne auteurs, licence et modifications.
 * Publique : le lien doit marcher pour tout le monde, joueurs compris. Le détail par quiz source
 * est dans les LICENSE.md de `packages/library/catalog/`, liés depuis la page et à garder en
 * accord avec elle.
 */
export function Credits() {
  const { t, lang } = useT()
  // Arrivée par un lien d'étiquette (/credits#openquizzdb) : la page est rendue après le
  // chargement du script, trop tard pour le défilement automatique du navigateur.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])

  return (
    <div className="ab-shell">
      <AppHeader />
      <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
        <section className="home-hero">
          <div>
            <h1>{t('Crédits et licences')}</h1>
            <p className="home-hero__sub">
              {t(
                'Les questions de la bibliothèque viennent de bases libres, écrites par des bénévoles. Merci à elles et à eux.',
              )}
            </p>
          </div>
          <Link className="ab-button ab-button--ghost" to="/">
            {t("Retour à l'accueil")}
          </Link>
        </section>

        <div className="credits">
          <section id="openquizzdb" aria-labelledby="credits-openquizzdb">
            <h2 id="credits-openquizzdb">OpenQuizzDB</h2>
            <p>
              {t("Les questions en français viennent d'")}
              <a href="https://www.openquizzdb.org" target="_blank" rel="noreferrer">
                OpenQuizzDB
              </a>
              {t(
                ", fournisseur de contenu libre coordonné par Philippe Bresoux. Le rédacteur de chaque quiz et le lien vers sa page d'origine figurent dans l'aperçu du quiz et dans l'éditeur.",
              )}
            </p>
            <p>
              {t(
                "Pengou a adapté ces quiz : format de Pengou, classement par thème, difficulté et public, regroupement en quiz de 10 à 20 questions, retrait des anecdotes et des questions en double, dépassées ou erronées. Le texte des questions et des propositions n'est pas modifié. La liste des quiz repris, avec leur rédacteur, est dans le",
              )}{' '}
              <LicenseFile folder="openquizzdb">{t("fichier de licence d'OpenQuizzDB")}</LicenseFile>.
            </p>
          </section>

          <section id="opentdb" aria-labelledby="credits-opentdb">
            <h2 id="credits-opentdb">Open Trivia Database</h2>
            <p>
              {t("Les questions en anglais viennent de l'")}
              <a href="https://opentdb.com" target="_blank" rel="noreferrer">
                Open Trivia Database
              </a>
              {t(', base contributive créée par PIXELTAIL GAMES LLC et ses contributeurs.')}
            </p>
            <p>
              {t(
                "Pengou a adapté ces questions : format de Pengou, classement par thème, difficulté et public, regroupement en quiz de 15 questions, retrait des questions en double. Le texte des questions et des réponses n'est pas modifié. Le détail est dans le",
              )}{' '}
              <LicenseFile folder="opentdb">{t("fichier de licence de l'Open Trivia Database")}</LicenseFile>.
            </p>
          </section>

          <section id="traductions" aria-labelledby="credits-traductions">
            <h2 id="credits-traductions">{t('Traductions')}</h2>
            <p>
              {t(
                "Sploot Labs traduit une partie de ces questions, avec l'aide d'une IA : celles de l'Open Trivia Database en français, celles d'OpenQuizzDB en anglais. Le type, le thème, la difficulté et la bonne réponse restent ceux de l'original. Les questions qui n'ont pas de sens une fois traduites (jeux de mots, orthographe) sont écartées. Voir les fichiers de licence des traductions",
              )}{' '}
              <LicenseFile folder="opentdb-fr">{t('en français')}</LicenseFile>
              {t(' et ')}
              <LicenseFile folder="openquizzdb-en">{t('en anglais')}</LicenseFile>.
            </p>
          </section>

          <section id="licence" aria-labelledby="credits-licence">
            <h2 id="credits-licence">{t('Licence')}</h2>
            <p>
              {t('Ces questions, leurs adaptations et leurs traductions sont sous licence')}{' '}
              <a href={licenseUrl(lang)} target="_blank" rel="noreferrer">
                CC BY-SA 4.0
              </a>
              .{' '}
              {t(
                'Vous pouvez les copier, les modifier et les partager, y compris dans vos propres quiz, à condition de citer leur source et de partager vos modifications sous la même licence.',
              )}
            </p>
            <p>
              {t(
                "Quand vous copiez un quiz ou des questions de la bibliothèque, Pengou garde la source de chaque question et l'affiche dans l'éditeur. En fin de partie, le grand écran crédite les bases d'où viennent les questions. Le code de Pengou est sous licence Apache-2.0, qui ne s'applique pas aux questions.",
              )}
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
