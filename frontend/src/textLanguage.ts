// index.html declares the document lang="en", so any Japanese text the app renders — summaries,
// chat questions and answers — needs its own lang or a screen reader reads it with English
// pronunciation rules and, often, an English voice. The backend does not record which language
// the model picked, so derive it here: the prompts only ever produce English or Japanese, and the
// two are far apart by script. Japanese text is nearly all kana and kanji, while English carries
// at most a quoted term or a name, so a share test separates them without taking on a
// language-detection dependency.
// Hiragana and katakana, CJK ideographs (kanji) and their extension A, and halfwidth katakana.
const JAPANESE_SCRIPT = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/g
const JAPANESE_SHARE = 0.2

export function textLanguage(text: string): 'ja' | 'en' {
  const characters = text.replace(/\s/g, '')
  if (!characters) return 'en'
  const japanese = characters.match(JAPANESE_SCRIPT)?.length ?? 0
  return japanese / characters.length >= JAPANESE_SHARE ? 'ja' : 'en'
}
