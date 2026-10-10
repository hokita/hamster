// Match the frontend's English/Japanese rendering policy. Use the completed detailed summary,
// whose prose has already selected the article's language, rather than noisy page navigation.
const JAPANESE_SCRIPT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/g

export function textLanguage(text: string): 'ja' | 'en' {
  const characters = text.replace(/\s/g, '')
  const japanese = characters.match(JAPANESE_SCRIPT)?.length ?? 0
  return characters.length > 0 && japanese / characters.length >= 0.2 ? 'ja' : 'en'
}

// Rendering's binary script heuristic is not proof of an output language. Japanese
// prose needs kana (Han alone may be Chinese); English must be classified among
// all supported languages, rather than only compared against Japanese.
// Ambiguous short text fails closed and can be retried by the caller.
export function matchesSummaryLanguage(text: string, language: 'ja' | 'en'): boolean {
  if (language === 'ja') {
    return /[\u3040-\u30ff\uff66-\uff9f]/u.test(text) && textLanguage(text) === 'ja'
  }
  return franc(text) === 'eng'
}
import { franc } from 'franc-min'
