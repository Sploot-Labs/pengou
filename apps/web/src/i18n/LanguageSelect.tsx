import { LANG_NAMES, LANGS, isLang } from '@splootlabs/shared/i18n'
import { useT } from './useT'

export function LanguageSelect({ className }: { className?: string }) {
  const { t, lang, setLang } = useT()
  return (
    <label className={className}>
      <span className="visually-hidden">{t("Langue de l'interface")}</span>
      <select
        value={lang}
        onChange={(event) => {
          if (isLang(event.target.value)) setLang(event.target.value)
        }}
      >
        {LANGS.map((code) => (
          <option key={code} value={code} lang={code}>
            {LANG_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  )
}
