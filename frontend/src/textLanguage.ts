const JAPANESE_SCRIPT = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/g
const JAPANESE_SHARE = 0.2

export function textLanguage(text: string): 'ja' | 'en' {
  const characters = text.replace(/\s/g, '')
  if (!characters) return 'en'
  const japanese = characters.match(JAPANESE_SCRIPT)?.length ?? 0
  return japanese / characters.length >= JAPANESE_SHARE ? 'ja' : 'en'
}
