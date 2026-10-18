import { createContext, useContext, useMemo, useState } from 'react'
import { z } from 'zod'
import { getCookie, setCookie } from '@/lib/cookies'
import { en } from './en'
import { ja } from './ja'
import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'

export type Key = keyof typeof en
export type Dict = Record<Key, string>
type Vars = Record<string, string | number>

// Each label is in its own language, so readers can find theirs.
// eslint-disable-next-line react-refresh/only-export-components
export const languages = [
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'zh-CN', label: '简体中文' },
] as const
export type Lang = (typeof languages)[number]['code']

const dicts: Record<Lang, Dict> = { en, ja, 'zh-TW': zhTW, 'zh-CN': zhCN }
const zodLocales = {
  en: z.locales.en,
  ja: z.locales.ja,
  'zh-TW': z.locales.zhTW,
  'zh-CN': z.locales.zhCN,
}

const LANG_COOKIE_NAME = 'lang'
const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

// Own keys only, so 'constructor' and friends are not mistaken for entries.
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

const isLang = (v: unknown): v is Lang => typeof v === 'string' && has(dicts, v)

// The saved choice, else the first supported browser language, else English.
function detect(): Lang {
  const saved = getCookie(LANG_COOKIE_NAME)
  if (isLang(saved)) return saved
  for (const tag of navigator.languages) {
    const l = tag.toLowerCase()
    if (l.startsWith('ja')) return 'ja'
    if (l.startsWith('zh')) return /hant|tw|hk|mo/.test(l) ? 'zh-TW' : 'zh-CN'
    if (l.startsWith('en')) return 'en'
  }
  return 'en'
}

let current: Lang = 'en'

function apply(lang: Lang) {
  current = lang
  z.config(zodLocales[lang]())
  document.documentElement.lang = lang
  document.title = dicts[lang]['app.title']
}
apply(detect())

const translate = (lang: Lang, key: Key, vars?: Vars) =>
  dicts[lang][key].replace(/\{(\w+)\}/g, (m, k: string) =>
    String(vars?.[k] ?? m)
  )
// API errors and validation messages arrive as keys; anything else is shown as-is.
const translateText = (lang: Lang, text: string) =>
  has(dicts[lang], text) ? dicts[lang][text as Key] : text

// For code outside components (query callbacks, toasts). Components use useI18n
// so that they re-render when the language changes.
// eslint-disable-next-line react-refresh/only-export-components
export const t = (key: Key, vars?: Vars) => translate(current, key, vars)
// eslint-disable-next-line react-refresh/only-export-components
export const tr = (text: string) => translateText(current, text)

type I18nContextType = { lang: Lang; setLang: (lang: Lang) => void }

const I18nContext = createContext<I18nContextType>({
  lang: current,
  setLang: apply,
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, _setLang] = useState(current)

  const setLang = (lang: Lang) => {
    setCookie(LANG_COOKIE_NAME, lang, LANG_COOKIE_MAX_AGE)
    apply(lang)
    _setLang(lang)
  }

  return <I18nContext value={{ lang, setLang }}>{children}</I18nContext>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const { lang, setLang } = useContext(I18nContext)
  // Stable per language, so t can sit in effect dependencies.
  return useMemo(
    () => ({
      lang,
      setLang,
      t: (key: Key, vars?: Vars) => translate(lang, key, vars),
      tr: (text: string) => translateText(lang, text),
    }),
    [lang, setLang]
  )
}

export type I18n = ReturnType<typeof useI18n>
