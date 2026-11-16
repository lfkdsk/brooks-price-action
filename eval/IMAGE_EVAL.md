# Screenshot eval and swing annotation extraction

This track compares a reading of the actual daily chart against the existing daily reference, avoiding continuous-contract OHLC roll offsets. Preprocessing and extraction run offline with Pillow + numpy. No model calls were made during implementation. The operator runs the expensive candidate/judge commands.

## Prepare and inspect

From the repository root:

```bash
.venv/bin/python eval/image_prep.py --out eval/runs/images
.venv/bin/python eval/extract_swing_labels.py \
  --manifest eval/runs/images/manifest.json --out eval/runs/swing_labels.json
.venv/bin/python -m unittest discover -s eval -p test_image_eval.py
```

`image_prep.py` maps each case URL basename (URL-decoded, query excluded) to `data/images/<id>/<basename>`. It accepts exactly one recognizable daily filename (`daily`, `d1*`, or `es-d*`); ambiguous, missing, and unrecognized cases are recorded as skipped, never silently replaced by weekly/intraday charts. PNG sources are supported as well as JPG.

Full-width blue row runs identify title/footer bars independently of resolution. Both bars must be detected; unsupported layouts fail closed. Outputs are `<id>_labels.png` (only bars cropped) and `<id>_clean.png` (also removes red-dominant pixels, dilated by two pixels). The fill is the median, near-white background. Axes remain. Coordinates, source/output paths, removal counts, warnings and blind eligibility are in `manifest.json`.

Grey dashed lines and shaded boxes are **retained**. White candles have thin grey antialiased outlines; deleting grey pixels can destroy candles. Red dilation can erase small parts of a candle/EMA when a label overlaps it, and white fill leaves a patch over shaded regions. This is conservative color masking, not reconstruction of hidden chart data.

## Run the eval (operator only)

```bash
.venv/bin/python eval/run_image_eval.py --n 12 --seed 2 --split dev \
  --conditions image_clean,image_labels,image_clean_skill \
  --manifest eval/runs/images/manifest.json --judges 3 --workers 3 \
  --out eval/runs/image_dev

# Existing OHLC track: defaults to one judge for backward compatibility.
.venv/bin/python eval/run_eval.py --n 12 --split dev --judges 3 \
  --conditions skill,baseline --out eval/runs/ohlc_3judge
```

Image conditions use the clean chart, cropped annotated chart, or clean chart plus the existing skill in screenshot mode. The candidate receives a neutral `chart.png` path, no source filename, post title, reference, URL, or OHLC. The prompt asks it to Read the PNG, read the last visible daily bar, avoid browsing/retrieval, and stay below 500 words. Only `Read` is allowed; the skill directory is added only in the skill condition. Skill files are unchanged. The screenshot prompt excludes historical examples/retrieval and asks for methodology/glossary instead.

The runner imports the exact `JUDGE`, scoring dimensions and shared judge implementation from `run_eval.py`. Each judge is a separate `codex exec --skip-git-repo-check -o ...` invocation. Image default is three calls; OHLC default remains one. `score.json` retains top-level dimension means for existing summaries, and adds `mean`, population `std` (ddof=0), `judge_scores`, `judges`, and `valid_judges`. Raw judge outputs are retained. Incomplete/invalid judge panels are marked as errors and excluded from summaries rather than silently scored as zero. Total remains six dimensions minus hallucination penalty. Within-case judge dispersion is not a confidence interval or between-case uncertainty.

Case selection uses the same split/seed/since approach, selecting `n` before checking preparation availability. Missing/ineligible images are written to `skipped.json`, without replacement. Use fresh output directories when images, prompts, skill contents, or case selection change: cached successful scores are reused when judge count matches. A changed judge count reuses the saved candidate and rejudges it. Summaries average case means, not individual judge votes.

## Leakage controls and limits

Removing title/footer is essential: titles directly state the analyst thesis. Some older images also contain colored prose **inside the plot**. A conservative dense-colored-row heuristic flags these as `blind_eligible: false`; the image runner excludes them from every condition. Prepared previews remain available for inspection. This heuristic can both miss annotations and reject legitimate dense colored lines. Inspect samples and the manifest before interpreting a run as blind; neither color masking nor eligibility detection proves that every thesis cue is gone. Black prose is not detected.

`image_labels` deliberately exposes analyst-selected swing labels; even clean charts retain analyst-drawn grey trend lines and range boxes. These are annotation ablations, not raw-market screenshots free of analyst influence. Month/date labels can also permit historical recall. The judge sees references only after candidate generation. The supplied CLI tool permissions and prompt are behavioral controls, not a filesystem security boundary; the shared repository contains references and skill examples. For stronger isolation, run candidates in a separate environment containing only prepared charts and the allowed skill material. No web or other data-fetching code is used by preparation/extraction.

## Swing labels: provisional anchors, not verified ground truth

`extract_swing_labels.py` reads cropped annotated PNGs, finds red pixels, dilates to join adjacent characters, and emits connected groups with bounding boxes and center x/y. It classifies a group as `swing_high` when the nearest dark pixels in a narrow x window lie below it, `swing_low` when they lie above, or `unknown` when ambiguous/distant. Distances and heuristic confidence are included. Source coordinates are recovered by adding the manifest crop offset.

There is no OCR, month parsing, reliable candle segmentation, bar-index inference or date mapping: `bar_index` and `date` are explicitly null. Nearby dates may merge; thin glyphs may split; red arrows/prose/shading can produce false groups; labels may be horizontally displaced from their anchors. Grey white-candle outlines may not meet the dark-pixel threshold. Thus counts/positions and high/low suggestions are useful starting points for manual anchor ground truth, not validated swing events or an accuracy benchmark. No extraction precision/recall is claimed.

## Offline verification performed

Ten locally available charts spanning 2018–2026 were prepared (one per year, plus a second 2026 chart). The 2016–2017 cases tried had no unambiguously recognizable daily filename; three other layouts failed blue-bar detection. The year-sampling run logged 29 skips and nine successes; the tenth chart was added separately. Four prepared older samples (2018–2021) were excluded by the internal colored-text heuristic. Six newer samples were eligible.

For all ten images, checks confirmed no remaining red-dominant pixels and exact preservation of every cropped pixel outside the dilated red mask. Visual checks of older charts revealed internal thesis annotations; a newer before/after pair showed title/footer and red-label removal with axes, candles and blue EMA retained. Four offline unit tests cover crop detection, EMA/candle preservation, unsupported layouts, URL resolution, mocked judge mean/std and failures, and candidate prompt/command boundaries. CLI help also passed. No CLI model execution or end-to-end LLM behavior was tested.

Local source/clean pairs, prepared charts, manifest, extraction output and pixel-check results are in git-ignored `eval/image_prep_samples/`. Recreate the year sample with:

```bash
.venv/bin/python eval/image_prep.py --sample-years --out eval/image_prep_samples
```
