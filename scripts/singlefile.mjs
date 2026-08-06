// Bundle dist/ into one self-contained HTML file that runs from a double-click (file://).
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
let html = readFileSync(resolve(dist, 'index.html'), 'utf8')

let scripts = 0
let styles = 0

html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+)"[^>]*><\/script>/g, (_, path) => {
  scripts++
  // "</script>" inside the bundle would end the inline tag early and truncate the app
  const js = readFileSync(resolve(dist, path), 'utf8').replace(/<\/script/gi, '<\\/script')
  return `<script type="module">\n${js}\n</script>`
})
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+)"[^>]*>/g, (_, path) => {
  styles++
  const css = readFileSync(resolve(dist, path), 'utf8')
  return `<style>\n${css}\n</style>`
})
// preload hints point at files that no longer ship separately
html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '')

if (scripts === 0 || styles === 0) {
  throw new Error(
    `singlefile: expected to inline at least 1 script and 1 stylesheet, got ${scripts}/${styles} — Vite's output shape changed, update the regexes.`,
  )
}
if (/(?:src|href)="\.\/assets\//.test(html)) {
  throw new Error('singlefile: output still references ./assets/ — an asset tag was not inlined.')
}

const out = resolve(root, 'Founder Mode.html')
writeFileSync(out, html)
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} kB, ${scripts} script + ${styles} style inlined)`)
