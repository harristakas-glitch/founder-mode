// Bundle dist/ into one self-contained HTML file that runs from a double-click (file://).
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
let html = readFileSync(resolve(dist, 'index.html'), 'utf8')

html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+)"><\/script>/, (_, path) => {
  const js = readFileSync(resolve(dist, path), 'utf8')
  return `<script type="module">\n${js}\n</script>`
})
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+)">/, (_, path) => {
  const css = readFileSync(resolve(dist, path), 'utf8')
  return `<style>\n${css}\n</style>`
})

const out = resolve(root, 'Founder Mode.html')
writeFileSync(out, html)
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} kB)`)
