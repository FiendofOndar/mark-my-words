# Icon export

The finished mark: a round speech bubble whose circle doubles as a clock dial.
The bubble carries a green-gold-red ramp (pass, pending, fail); the hour hand is
cream; the minute hand, pointing at the deadline, is the fail red.

| File | Use |
| --- | --- |
| `icon-store.svg` | 512 square, no corner radius. Play Store applies its own. |
| `icon-store-512.png` | The same, rasterised. This is the file the Play listing takes. |
| `icon-foreground.svg` | Adaptive icon foreground, 108dp canvas. |
| `icon-background.svg` | Adaptive icon background, flat `#1f1e2b`. |
| `icon-monochrome.svg` | Android 13+ themed icon. The system tints it; the black here is a placeholder. |

## Why the adaptive foreground is smaller than the square icon

Android composites a 108dp foreground and background and then lets the launcher
mask the result — circle, squircle, teardrop, rounded square, the manufacturer
picks. Only the inner 72dp is guaranteed visible and only the inner 66dp circle
is safe. The mark's tail reaches almost to the corner of the square tile, which
is fine in a square and gets amputated by a round mask.

So the foreground is scaled to 0.229 of the 240-unit drawing, which puts the tail
tip exactly on the 66dp safe circle, and translated to `(28.18, 26.749)` so the
composite is centred on its own bounding box rather than on the bubble. Pushing
the scale to 0.250 fills the 72dp guaranteed area instead and risks clipping on
the roundest masks.

## Values

```
ground     #1f1e2b
ramp       #5fbb8c -> #ddb45e -> #d9533a
ramp axis  userSpaceOnUse, (61,70) to (175,181) in 240-unit space
hour hand  #f2e8d8   stroke 14
minute     #f2593a   stroke 14
bubble     stroke 15
pivot      r 8, #f2e8d8
```

The ramp axis is pinned to the mark's own extent rather than the path's bounding
box. The bounding box's corners are empty space, so an axis across it spends
roughly half the gradient outside the drawing and both end colours never appear.


## What is wired into the Android project

These SVGs are the source; `android/app/src/main/res` carries the built form.

| Resource | What it is |
| --- | --- |
| `drawable/brand_mark.xml` | The adaptive foreground, as a VectorDrawable. |
| `drawable/brand_mark_mono.xml` | The Android 13+ themed icon, flattened to one ink. |
| `drawable/ic_stat_icon.xml` | The notification small icon at 24dp. |
| `values/ic_launcher_background.xml` | The tile colour, plus `brand_ink` and `brand_miss`. |
| `mipmap-*/ic_launcher*.png` | Legacy raster icons at all five densities. |

Two things in there are worth knowing before editing any of it.

**The dial is cubics, not an arc.** `drawable/brand_mark.xml` had a comment
from the previous mark saying VectorDrawable's arc support has been uneven
across Android versions. That still holds, so the `A` command is converted to
four cubic segments where the conversion can be checked, rather than trusted to
the platform at runtime. The pivot dot is a circle written the same way.

**Three different insets, and they are not interchangeable.** The mark's
bounding circle is 0.599 of its own box, and each composition divides that into
the room it actually has:

- square, 0.75 — the store composition; a square tile crops nothing
- round, 0.78 — drawn as-is, so it only has to clear its own circle
- foreground, 0.50 — the launcher masks it again and may use a circle, so it
  has to clear the 66dp safe circle of the 108dp canvas

The round icon shipped once at the foreground's inset and came out visibly
small, floating in its own tile. If a composition looks wrong at size, check
this before touching the drawing.

## Fixed on the way through

`capacitor.config.ts` has named `ic_stat_icon` as the notification small icon
since it was written, and no such resource existed, so every notification the
app has posted fell back to the platform default. It exists now.
