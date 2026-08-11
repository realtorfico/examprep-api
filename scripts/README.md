# Track content pipeline

One reusable script for turning a batch of AI-generated question JSON files into
D1-Console-ready SQL, for any track.

## Steps to add a new track's questions

1. Generate questions with parallel agents (one per topic bucket), each grounded only in that
   topic's handbook excerpt. Have each agent write its bucket to its own `*.json` file (array of
   `{topic, question, choice_a..d, correct_choice, explanation, weight, source_note}`) inside a
   **per-track folder**, e.g. `scratchpad/questions/tx_driver/`.
2. Copy `scripts/tracks/_template.json` to `scripts/tracks/<examType>.json` and fill in
   `examType`, `questionsDir`, `priceCents`, `handbookNote`.
3. Run:
   ```
   node scripts/build-track-batch.js scripts/tracks/<examType>.json
   ```
   This loads, validates, dedupes (exact + near-dup Jaccard within topic), writes the full SQL,
   sanity-checks it (quote parity, field count), splits it into `<examType>_batch1_chunks/`
   (≤40 statements each, since D1 Console rejects very large single pastes), and prints a spot-
   check sample to read against the source handbook before loading.
4. Paste `chunk-00-pricing.sql` then each `chunk-NN.sql` into D1 Console in order.
5. Add the track's `TRACK_COMPLIANCE` entry, `HUB_EXAMS` card, `RESOURCES` link, and
   `EXAM_CONFIGS` entry in the frontend/Worker, flip `active: true`, bump `?v=` cache-bust,
   deploy.

Run again with a second arg (`node scripts/build-track-batch.js scripts/tracks/<examType>.json 2`)
for a batch-2 top-up later — it won't collide with batch 1's question IDs, and the pricing row is
an upsert so re-running is safe.
