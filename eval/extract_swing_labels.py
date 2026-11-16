#!/usr/bin/env python3
"""Extract red annotation groups, not OCR dates. Coordinates refer to cropped labels PNG."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from image_prep import red_mask


def components(mask):
    """8-connected components without scipy."""
    seen = mask.copy(); h, w = mask.shape
    for y, x in zip(*np.nonzero(mask)):
        if not seen[y, x]: continue
        stack = [(int(y), int(x))]; seen[y, x] = False; points = []
        while stack:
            yy, xx = stack.pop(); points.append((yy, xx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = yy + dy, xx + dx
                    if 0 <= ny < h and 0 <= nx < w and seen[ny, nx]:
                        seen[ny, nx] = False; stack.append((ny, nx))
        yield np.array(points)


def extract(path):
    a = np.asarray(Image.open(path).convert('RGB')); red = red_mask(a)
    # Join characters within a date, leaving vertically separate labels apart.
    joined = np.asarray(Image.fromarray(red.astype('uint8') * 255).filter(ImageFilter.MaxFilter(9))) > 0
    dark = (a.max(axis=2) < 100)
    h, w = dark.shape
    # Restrict searches away from axes/month labels. Grey/antialiased white candle outlines
    # are deliberately excluded, making classification conservative and sometimes unavailable.
    dark[:5] = False; dark[int(h * .96):] = False; dark[:, :int(w * .035)] = False
    labels = []
    for pts in components(joined):
        y0, x0 = pts.min(axis=0); y1, x1 = pts.max(axis=0) + 1
        ys, xs = np.nonzero(red[y0:y1, x0:x1])
        if len(xs) < 5: continue
        x0, y0, x1, y1 = int(x0 + xs.min()), int(y0 + ys.min()), int(x0 + xs.max() + 1), int(y0 + ys.max() + 1)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        left, right = max(0, int(cx) - 12), min(w, int(cx) + 13)
        yy, xx = np.nonzero(dark[:, left:right])
        above = yy[yy < y0]; below = yy[yy >= y1]
        da = int(y0 - above.max()) if len(above) else None
        db = int(below.min() - y1) if len(below) else None
        kind = 'unknown'
        if db is not None and db < h * .12 and (da is None or db + 8 < da): kind = 'swing_high'
        if da is not None and da < h * .12 and (db is None or da + 8 < db): kind = 'swing_low'
        labels.append({'bbox_xyxy': [x0, y0, x1, y1], 'center_xy': [cx, cy],
                       'kind': kind, 'distance_to_dark_above': da, 'distance_to_dark_below': db,
                       'bar_index': None, 'date': None, 'confidence': 'heuristic' if kind != 'unknown' else 'unknown'})
    return {'count': len(labels), 'labels': sorted(labels, key=lambda v: v['center_xy'][0]),
            'coordinate_system': 'cropped PNG pixels; add manifest crop y offset for source coordinates',
            'reliability': 'Annotation groups only; nearby dates may merge, red non-date marks may count. High/low uses nearest dark pixels, not verified candle anchors. No date/bar mapping.'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', type=Path, default=Path('eval/runs/images/manifest.json'))
    p.add_argument('--out', type=Path, default=Path('eval/runs/swing_labels.json'))
    a = p.parse_args(); records = []
    for r in json.loads(a.manifest.read_text())['records']:
        if r['status'] != 'ok': continue
        try: records.append({'id': r['id'], 'crop_xyxy': r['crop_xyxy'], **extract(r['labels'])})
        except OSError as e: records.append({'id': r['id'], 'error': str(e)})
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(records, indent=2)); print(f'Wrote {len(records)} images to {a.out}')


if __name__ == '__main__': main()
