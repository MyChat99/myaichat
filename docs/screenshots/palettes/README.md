# One layout, eight palettes

Every image is the same route, the same data, the same viewport. The only thing
that differs is the stored palette.

That is the claim `verify:structure` proves rather than asserts: it loads all
eight in both modes and compares the computed border widths, radii, shadows,
fonts, spacing and display of seventeen structural elements. Sixteen renders,
all identical.

Regenerate:

```bash
for t in riso default midnight ocean forest sunset rose mono; do
  for m in light dark; do
    npm run shoot -- --theme=$t --scheme=$m --out=docs/screenshots/palettes
  done
done
```
