# Icon export

The finished mark: a round speech bubble whose circle doubles as a clock dial.
The bubble carries a green-gold-red ramp (pass, pending, fail); the hour hand is
cream; the minute hand, pointing at the deadline, is the fail red.

| File | Use |
| --- | --- |
| `icon-store.svg` | 512 square, no corner radius. Play Store applies its own. Rasterise to 512 PNG. |
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
