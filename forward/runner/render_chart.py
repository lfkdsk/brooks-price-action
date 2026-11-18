"""Render the price chart from the same CSV supplied to the intraday model."""
import argparse
import csv
from pathlib import Path


def chart_series(rows, session, context=30):
    ordered = sorted((b for b in rows if b['session'] <= session),
                     key=lambda b: (b['session'], b['bar']))
    today = [b for b in ordered if b['session'] == session]
    if not today:
        raise ValueError('No bars for requested session')
    prior_session = max((b['session'] for b in ordered if b['session'] < session), default=None)
    prior = [b for b in ordered if b['session'] == prior_session]
    guides = (prior[-1]['close'], min(b['low'] for b in prior)) if prior else ()
    visible = prior[-context:] + today if context else today
    ema = ordered[0]['close']
    by_slot = {}
    for bar in ordered:
        ema += 2 / 21 * (bar['close'] - ema)
        by_slot[bar['session'], bar['bar']] = ema
    return [(b, by_slot[b['session'], b['bar']]) for b in visible], guides


def price_bounds(series, guides):
    low = min([min(b['low'], ema) for b, ema in series] + list(guides))
    high = max([max(b['high'], ema) for b, ema in series] + list(guides))
    pad = max(.01, (high - low) * .05)
    return low - pad, high + pad


def price_y(price, bounds, top, bottom):
    low, high = bounds
    return bottom - (price - low) / (high - low) * (bottom - top)


def render(rows, symbol, session, output):
    from PIL import Image, ImageDraw, ImageFont

    def font(size):
        for path in [*sorted(Path('/usr/share/fonts/opentype/noto').glob('*CJK*')),
                     '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVuSans.ttf']:
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:
                continue
        return ImageFont.load_default()

    series, guides = chart_series(rows, session)
    bounds = price_bounds(series, guides)
    image = Image.new('RGB', (1600, 900), 'white')
    draw = ImageDraw.Draw(image)
    label = font(17)
    draw.text((100, 24), f'{symbol}  |  {session}  |  5 min', fill='black', font=font(29))
    left, right, top, bottom = 100, 1560, 95, 815
    context = sum(b['session'] != session for b, _ in series)
    step = (right - left) / max(35, context + series[-1][0]['bar'])
    half = min(10, step * .34)

    def y(price):
        return price_y(price, bounds, top, bottom)

    for i in range(7):
        price = bounds[0] + (bounds[1] - bounds[0]) * i / 6
        draw.line((left, y(price), right, y(price)), fill='#e2e5e9')
        draw.text((12, y(price) - 9), f'{price:.2f}', fill='black', font=label)
    if context:
        divider = left + context * step
        draw.line((divider, top, divider, bottom), fill='#a8afb9')
    for i, price in enumerate(guides):
        dash = 12 if i == 0 else 4
        for start in range(left, right, dash + 5):
            draw.line((start, y(price), min(start + dash, right), y(price)), fill='#707780')
    points = []
    for index, (bar, ema) in enumerate(series):
        slot = index + 1 if index < context else context + bar['bar']
        x = left + (slot - .5) * step
        high_body, low_body = sorted((y(bar['open']), y(bar['close'])))
        draw.line((x, y(bar['high']), x, y(bar['low'])), fill='black', width=2)
        draw.rectangle((x - half, high_body, x + half, max(high_body + 1, low_body)),
                       fill='white' if bar['close'] >= bar['open'] else 'black', outline='black', width=2)
        points.append((x, y(ema)))
        if index >= context and bar['bar'] % 5 == 0:
            draw.text((x, bottom + 14), str(bar['bar']), fill='black', font=label, anchor='mt')
    draw.line(points, fill='#236cca', width=3)
    draw.text((left, 863), 'Blue: EMA20   |   Long dashes: prior close   |   Short dashes: prior low'
              if guides else 'Blue: EMA20', fill='#343a42', font=label)
    image.save(output, 'PNG')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_path', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('symbol')
    parser.add_argument('session')
    args = parser.parse_args()
    with args.csv_path.open(newline='') as source:
        rows = [dict(row, bar=int(row['bar']), **{
            key: float(row[key]) for key in ('open', 'high', 'low', 'close')
        }) for row in csv.DictReader(source)]
    render(rows, args.symbol, args.session, args.output)


if __name__ == '__main__':
    main()
