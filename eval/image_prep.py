#!/usr/bin/env python3
"""Offline chart preparation. Fail closed when blue header/footer cannot be identified."""
import argparse
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]


def red_mask(a):
    r, g, b = a.astype(np.int16).transpose(2, 0, 1)
    return (r > 120) & (r > g + 45) & (r > b + 35)


def crop_bounds(a):
    r, g, b = a.astype(np.int16).transpose(2, 0, 1)
    blue = (b > 100) & (b > r + 25) & (g > r + 10)
    rows = np.flatnonzero(blue.mean(axis=1) > .60)
    runs = np.split(rows, np.flatnonzero(np.diff(rows) > 1) + 1)
    h = len(a)
    tops = [v for v in runs if len(v) >= 8 and v[0] < h * .08 and v[-1] < h * .25]
    bottoms = [v for v in runs if len(v) >= 8 and v[0] > h * .80 and v[-1] >= h * .97]
    if len(tops) != 1 or len(bottoms) != 1:
        raise ValueError('unsupported layout: no unambiguous full-width blue title/footer bars')
    lo, hi = int(tops[0][-1] + 1), int(bottoms[0][0])
    if hi - lo < h * .6:
        raise ValueError('implausible chart crop')
    return lo, hi


def local_images(case, root=ROOT / 'data/images'):
    return [Path(root) / str(case['id']) / Path(unquote(urlsplit(u).path)).name
            for u in case.get('images', [])]


def select_image(case, root=ROOT / 'data/images'):
    paths = local_images(case, root)
    daily = [p for p in paths if 'daily' in p.name.lower() or p.stem.lower().startswith(('d1', 'es-d'))]
    # Never silently substitute a weekly / intraday chart.
    if len(daily) != 1:
        raise ValueError(f'expected one identifiable daily image, found {len(daily)}')
    if not daily[0].is_file():
        raise ValueError(f'missing local image: {daily[0]}')
    return daily[0]


def prepare(source, clean_path, labels_path):
    a = np.asarray(Image.open(source).convert('RGB'))
    lo, hi = crop_bounds(a)
    chart = a[lo:hi].copy()
    # Dense colored glyph rows reveal older layouts with thesis text inside the plot.
    # A thin EMA/line usually occupies only one or two dense rows, unlike text.
    v = chart.astype(np.int16)
    colored = (v.max(axis=2) - v.min(axis=2) > 65) & ~red_mask(chart)
    dense = colored.sum(axis=1) > chart.shape[1] * .045
    suspect_text = bool(np.any(np.convolve(dense.astype(int), np.ones(24, dtype=int), mode='same') >= 10))
    Image.fromarray(chart).save(labels_path)
    mask = np.asarray(Image.fromarray(red_mask(chart).astype('uint8') * 255).filter(ImageFilter.MaxFilter(5))) > 0
    # White is the modal chart background in supported layouts. Avoid guessing on dark charts.
    bg = np.median(chart.reshape(-1, 3), axis=0).astype('uint8')
    if bg.min() < 225:
        raise ValueError('unsupported non-white chart background')
    clean = chart.copy()
    clean[mask] = bg
    Image.fromarray(clean).save(clean_path)
    return {'crop_xyxy': [0, lo, a.shape[1], hi], 'size': [chart.shape[1], chart.shape[0]],
            'blind_eligible': not suspect_text, 'background': bg.tolist(), 'red_pixels_removed': int(mask.sum()),
            'warnings': (['Possible internal colored thesis text: excluded from blind evaluation.'] if suspect_text else []) + ['Grey trend lines and shaded boxes retained to protect candle outlines.',
                         'Non-red annotations inside chart are not removed; inspect before evaluation.']}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cases', type=Path, default=ROOT / 'eval/es_daily_cases.jsonl')
    p.add_argument('--images', type=Path, default=ROOT / 'data/images')
    p.add_argument('--out', type=Path, default=ROOT / 'eval/runs/images')
    p.add_argument('--n', type=int)
    p.add_argument('--sample-years', action='store_true', help='Try one successful case per year, 2016–2026')
    a = p.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    cases = [json.loads(s) for s in a.cases.read_text().splitlines() if s.strip()]
    if a.n: cases = cases[:a.n]
    records = []; done = set()
    for case in cases:
        year = int(case['date'][:4])
        if a.sample_years and (year not in range(2016, 2027) or year in done): continue
        record = {'id': case['id'], 'date': case['date'], 'status': 'skipped'}
        try:
            source = select_image(case, a.images)
            clean = a.out / f"{case['id']}_clean.png"; labels = a.out / f"{case['id']}_labels.png"
            record.update(prepare(source, clean, labels))
            record.update(status='ok', source=str(source.resolve()), clean=str(clean.resolve()), labels=str(labels.resolve()))
            done.add(year)
        except (ValueError, OSError) as e:
            record['reason'] = str(e)
        records.append(record)
    manifest = {'version': 1, 'records': records}
    if a.sample_years: manifest['unavailable_years'] = sorted(set(range(2016, 2027)) - done)
    (a.out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps({'ok': sum(r['status'] == 'ok' for r in records), 'skipped': sum(r['status'] != 'ok' for r in records), 'unavailable_years': manifest.get('unavailable_years', [])}))


if __name__ == '__main__': main()
