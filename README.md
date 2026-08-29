# World Travel Flows

An interactive, animated map of **every cross-border trip on Earth, 1995–2022**
— tourism, business, family visits, short-term work: any journey under
12 months. The sibling of
[World Migration Flows](https://code-4you.github.io/world-migration-flows/),
which covers moves *over* 12 months; together the two maps tile all
international human movement.

**Live map: <https://code-4you.github.io/world-travel-flows/>**

Animated particles show trips between countries. Circles show each country's
inbound (blue) vs outbound (red) travel volume, nested with the smaller flow
on top — half-and-half when balanced. Click any country to isolate it, play
through single years (watch world travel collapse in 2020 and roar back), or
replay events like the COVID-19 shutdown and the SARS outbreak. Views are
shareable via URL (`?c=FR`, `?e=covid`, `?p=2010_2020`, `&play=years`).

## Data

- **Source:** [Global Transnational Mobility Dataset 2.0](https://zenodo.org/records/18496028)
  (Recchi, Deutschmann & Vespe; EUI Migration Policy Centre with the EC Joint
  Research Centre; CC BY 4.0) — over 150 billion estimated bilateral trips,
  1995–2022, for 230+ countries, modeled from global tourism statistics, air
  passenger data and migration statistics.
- **What counts as a trip:** any border crossing with a stay under
  12 months, whatever the purpose — including same-day visits, which is why
  volumes exceed headline "tourist arrival" figures. Stays over 12 months
  are migration (see the sibling map).
- All values are model-based estimates, not direct counts.

Regenerate the data files with:

```bash
python scripts/process_gtmd.py
```

after downloading `GTMD2_trips.csv` from Zenodo into `raw/`.

## Running locally

Any static file server works (`python -m http.server 8000`), then open
<http://localhost:8000/>. Opening `index.html` directly won't work — the app
fetches its JSON data over HTTP.

## Contributing

Issues and pull requests welcome —
[open an issue](https://github.com/code-4you/world-travel-flows/issues).
Events are one-line entries in the `EVENTS` array in [app.js](app.js).
The app is dependency-free vanilla JS (MapLibre GL vendored in `vendor/`,
two canvas overlays); it shares its engine with
[world-migration-flows](https://github.com/code-4you/world-migration-flows).

## Credits

- Data: Recchi, E., Deutschmann, E. & Vespe, M. — *Global Transnational
  Mobility Dataset 2.0* (Zenodo, CC BY 4.0)
- Creator: [Michael van Diermen](https://mvandiermen.com/)
- Basemap: [Natural Earth](https://www.naturalearthdata.com/) (public domain)
- Map rendering: [MapLibre GL JS](https://maplibre.org/) (BSD)

Code is MIT licensed (see [LICENSE](LICENSE)).
