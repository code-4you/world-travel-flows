"""Build all data files for World Travel Flows from the Global Transnational
Mobility Dataset 2.0 (Recchi, Deutschmann & Vespe; CC BY 4.0).

Input:  raw/GTMD2_trips.csv from https://zenodo.org/records/18496028
        (bilateral estimated cross-border trips, any purpose, 1995-2022)
Output: data/flows_<y>_<y+1>.json  yearly trips (flows[A][B] = trips B->A)
        data/flows_1995_2000.json, 2000_2010, 2010_2020, 2020_2023  periods
        data/flows_1995_2023.json  all-years total

Same file format as World Migration Flows so the app is shared unchanged.
"""
import csv
import json
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "raw")
OUT = os.path.join(HERE, "..", "data")

Y0, Y1 = 1995, 2022  # inclusive trip years; file ids use y_(y+1)
YEAR_THRESHOLD = 2000  # trips/yr below this are dropped from the files
PERIODS = {"1995_2000": (1995, 1999), "2000_2010": (2000, 2009),
           "2010_2020": (2010, 2019), "2020_2023": (2020, 2022),
           "1995_2023": (1995, 2022)}
PERIOD_THRESHOLD = 10000


def find_col(header, *cands):
    low = [h.lower().strip() for h in header]
    for cand in cands:
        for i, h in enumerate(low):
            if cand in h:
                return i
    raise KeyError(f"none of {cands} in {header}")


def main():
    with open(os.path.join(RAW, "iso3166.json"), encoding="utf8") as f:
        iso = json.load(f)
    iso3to2 = {e["alpha-3"]: e["alpha-2"] for e in iso}
    iso3to2["XKX"] = "XK"
    with open(os.path.join(OUT, "countries.json"), encoding="utf8") as f:
        known = set(json.load(f))

    # gross[year][dest][orig] = trips orig->dest
    gross = {y: defaultdict(lambda: defaultdict(float)) for y in range(Y0, Y1 + 1)}
    unmatched = set()
    path = os.path.join(RAW, "GTMD2_trips.csv")
    with open(path, newline="", encoding="utf8", errors="replace") as f:
        r = csv.reader(f)
        header = next(r)
        # GTMD 2.0 columns: iso2 codes direct; flow direction is i -> j.
        # Series 2 (s2) = Series 1 plus imputations for missing points.
        ci_src = header.index("iso2code_i")
        ci_dst = header.index("iso2code_j")
        ci_year = header.index("year")
        ci_s1 = header.index("gtmd2_trips_s1")
        ci_s2 = header.index("gtmd2_trips_s2")
        for row in r:
            try:
                y = int(row[ci_year])
            except ValueError:
                continue
            if not (Y0 <= y <= Y1):
                continue
            v = row[ci_s2] or row[ci_s1]
            if not v:
                continue
            src, dst = row[ci_src].strip(), row[ci_dst].strip()
            if src == dst:
                continue
            if src not in known or dst not in known:
                unmatched.add(src if src not in known else dst)
                continue
            fv = float(v)
            if fv > 0:
                gross[y][dst][src] += fv
    if unmatched:
        print("unmatched codes (skipped):", sorted(unmatched)[:20])

    def write(pathname, g, threshold):
        flows = defaultdict(dict)
        totals = defaultdict(float)
        for a in g:
            for b, v in g[a].items():
                totals[a] += v
                totals[b] -= v
                if v >= threshold:
                    flows[a][b] = round(v)
        for c, t in totals.items():
            if flows[c] or abs(t) >= threshold:
                flows[c][c] = round(t)
        flows = {k: v for k, v in flows.items() if v}
        with open(pathname, "w", encoding="utf8") as f:
            json.dump(flows, f, separators=(",", ":"))
        return len(flows), os.path.getsize(pathname)

    total_bytes = 0
    for y in range(Y0, Y1 + 1):
        n, size = write(os.path.join(OUT, f"flows_{y}_{y + 1}.json"), gross[y], YEAR_THRESHOLD)
        total_bytes += size
    print(f"wrote {Y1 - Y0 + 1} yearly files, {total_bytes // 1024} KB total")

    for pid, (a, b) in PERIODS.items():
        agg = defaultdict(lambda: defaultdict(float))
        for y in range(a, b + 1):
            for d in gross[y]:
                for s, v in gross[y][d].items():
                    agg[d][s] += v
        n, size = write(os.path.join(OUT, f"flows_{pid}.json"), agg, PERIOD_THRESHOLD)
        print(f"flows_{pid}.json: {n} countries, {size // 1024} KB")


if __name__ == "__main__":
    main()
