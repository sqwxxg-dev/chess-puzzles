#!/usr/bin/env python3
"""Build the bundled puzzle database from the Lichess puzzle dump (CC0).

Usage:  python scripts/build_puzzles.py <lichess_db_puzzle.csv.zst>

Produces ios/ChessPuzzles/web/data/puzzles.js with a fixed number of
reservoir-sampled puzzles per difficulty bucket.
"""

import csv
import io
import json
import os
import random
import sys

from compression import zstd

PER_BUCKET = 1100
SEED = 20261117

BUCKETS = [
    (0, 1200),        # easy
    (1200, 1600),     # medium
    (1600, 2000),     # hard
    (2000, 9999),     # very hard
]

MIN_POPULARITY = 85
MIN_PLAYS = 800
MIN_MOVES = 2
MAX_MOVES = 12

# themes that are nice to show on the board, most specific first
THEME_PREF = [
    "mateIn1", "mateIn2", "mateIn3", "smotheredMate", "backRankMate",
    "fork", "pin", "skewer", "discoveredAttack", "doubleCheck",
    "sacrifice", "deflection", "attraction", "clearance", "interference",
    "promotion", "hangingPiece", "trappedPiece", "xRayAttack",
    "capturingDefender", "intermezzo", "quietMove", "zugzwang",
    "endgame", "middlegame", "opening",
]


def bucket_of(rating):
    for i, (lo, hi) in enumerate(BUCKETS):
        if lo <= rating < hi:
            return i
    return None


def main(path):
    random.seed(SEED)
    seen = [0] * len(BUCKETS)
    keep = [[] for _ in BUCKETS]
    games = [set() for _ in BUCKETS]

    with zstd.open(path, "rt", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}
        i_id = idx["PuzzleId"]
        i_fen = idx["FEN"]
        i_mov = idx["Moves"]
        i_rat = idx["Rating"]
        i_pop = idx["Popularity"]
        i_ply = idx["NbPlays"]
        i_thm = idx["Themes"]
        i_url = idx["GameUrl"]

        for row in reader:
            try:
                rating = int(row[i_rat])
                pop = int(row[i_pop])
                plays = int(row[i_ply])
            except (ValueError, IndexError):
                continue
            if pop < MIN_POPULARITY or plays < MIN_PLAYS:
                continue

            moves = row[i_mov].split()
            if not (MIN_MOVES <= len(moves) <= MAX_MOVES):
                continue

            b = bucket_of(rating)
            if b is None:
                continue

            url = row[i_url]
            if url in games[b]:
                continue

            themes = [t for t in row[i_thm].split() if t]
            ordered = [t for t in THEME_PREF if t in themes]
            theme = " ".join(ordered[:2]) if ordered else (themes[0] if themes else "")

            item = {
                "f": row[i_fen],
                "m": " ".join(moves),
                "r": rating,
                "t": theme,
            }

            seen[b] += 1
            if len(keep[b]) < PER_BUCKET:
                keep[b].append((url, item))
                games[b].add(url)
            else:
                j = random.randrange(seen[b])
                if j < PER_BUCKET:
                    old_url, _ = keep[b][j]
                    games[b].discard(old_url)
                    keep[b][j] = (url, item)
                    games[b].add(url)

    out = []
    for bucket in keep:
        random.shuffle(bucket)
        out.extend(item for _, item in bucket)

    for i, bucket in enumerate(keep):
        ratings = [it["r"] for _, it in bucket]
        if ratings:
            print(f"bucket {i}: {len(bucket)} puzzles, rating {min(ratings)}-{max(ratings)}")
    print(f"total: {len(out)}")

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dest = os.path.join(here, "ios", "ChessPuzzles", "web", "data", "puzzles.js")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    payload = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    with io.open(dest, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("window.PUZZLES=")
        fh.write(payload)
        fh.write(";\n")
    print(f"wrote {dest} ({os.path.getsize(dest) / 1024:.0f} KB)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
