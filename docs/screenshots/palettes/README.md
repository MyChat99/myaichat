# One layout, seven palettes

Same route, same data, same viewport. The only thing that differs is the stored
palette — `verify:structure` proves that by loading all seven in both modes and
comparing computed borders, radii, shadows, fonts and spacing across seventeen
structural elements.

| palette | stock | first ink | second ink |
| --- | --- | --- | --- |
| **Riso** (default) | newsprint, green undertone | Federal Blue | Fluorescent Pink + yellow pill |
| **Newsprint** | grey | black | one loud red |
| **Blueprint** | deep blue — the paper *is* the ink | white | cyan |
| **Pulp** | warm tan | brown | vermilion |
| **Neon** | near-black | electric green | magenta |
| **Botanical** | cream | deep forest green | terracotta |
| **Mono** | pure white | pure black | a single yellow |

Blueprint is the one palette whose *light* variant is dark: a cyanotype is white
lines on deep blue, and the layout has to survive that. Neon is the reverse —
it lives in the dark, and its light variant is the same two hues taken down
until they are legible on pale stock.

Regenerate:

```bash
for t in riso newsprint blueprint pulp neon botanical mono; do
  for m in light dark; do
    npm run shoot -- --theme=$t --scheme=$m --out=docs/screenshots/palettes
  done
done
```
