# NOESIS brand assets

| File | What it is |
|---|---|
| `noesis-mark.png` | The logo mark (a folded ribbon in the shape of an N), cropped from the supplied logo, transparent background, 266 × 148 px |

## Colour

Sampled from the mark. The values are approximate, taken from pixel statistics of a raster image.

| Role | Value | Notes |
|---|---|---|
| Violet, main | `#9A8DF6` | Most common solid colour in the mark. Too light for text on white (below AA contrast), fine for fills, icons and large shapes. |
| Violet, light | `#BAAEF6` | Highlight of the ribbon |
| Violet, shadow | `#6865AA` | Fold shadow |

For interface use the accent needs shades that pass contrast checks:
- a darker violet for text, links and the primary button on light backgrounds,
- a lighter violet for text and focus rings on dark backgrounds.

These shades are derived from the main violet and must be validated (WCAG AA) before release.

## Wordmark

The supplied wordmark is a very light grey on white and does not have enough contrast to use as an image. The interface sets the name "NOESIS" in text instead, in capitals with wide letter spacing, next to the mark.

## Open items

- A vector (SVG) version of the mark, so it stays sharp at every size.
- A one-colour version for dark backgrounds and favicons.
- Final accent shades after contrast validation.
