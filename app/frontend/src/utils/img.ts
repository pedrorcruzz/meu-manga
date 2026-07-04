// Base pública de cada site, usada pra montar URLs de thumbnail relativas.
const SOURCE_BASE: Record<string, string> = {
  sakura: 'https://sakuramangas.org',
}

// thumbSrc resolve a URL da capa. Thumbnails do Sakura carregam no navegador
// que tem o cookie do Cloudflare (o Dia) — por isso abra o app no Navegador.
export function thumbSrc(source: string, url: string): string {
  if (!url) return ''
  if (url.startsWith('http')) return url
  const base = SOURCE_BASE[source] ?? ''
  return base + url
}
