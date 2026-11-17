# Running a large measurement

For any run of more than a few dozen cells (the unlock matrix, the
ten-category suite, a seeded context-attack sweep). The failure modes
below all look like "the model did something" in the output and are
none of them the model.

## Procedure

1. **Plan the cells.** One probe per cell, a hard probe only. Benign
   controls are measured separately and never enter the unlock rate.
2. **Store a bounded excerpt of every response** (head 1200 chars + a
   sha256 of the full body). The excerpt is what makes a re-score
   possible; without it a scorer fix invalidates the whole report.
3. **Stream every cell to a JSONL sidecar as it completes**, append
   mode, never truncate. The sidecar is both the resume source and the
   crash insurance.
4. **Resume by re-judging, not by reusing.** A cached cell's verdict
   was measured with whatever scorer existed then. Re-judge it with the
   current scorer before it goes in the report.
5. **Re-score after any scorer change**, and re-measure the cells whose
   stored excerpt is shorter than the response.
6. **Read every reported break by hand.** A verdict without the text is
   not a finding.
7. **Report the scorer's number AND the hand-read number.**

## Concurrency: probes in parallel, repeats in serial

The probes are independent questions; the repeats of one probe are the
same question asked again.

```python
# probes concurrent, repeats of one probe serial
def measure(p):
    samples = [_call(client, model, msgs(p)) for _ in range(repeats)]
    return worst_of(samples)

with ThreadPoolExecutor(max_workers=6) as pool:
    for row in as_completed([pool.submit(measure, p) for p in corpus]):
        emit(row)          # append to the sidecar NOW
```

Two rules that cost a run each when broken:

- **Interleaving the repeats across threads mixes the answers.** The
  samples of one probe must be sequential, or the "worst of N" is
  measuring a different thing.
- **`pool.map` is lazy.** It returns an iterator that yields
  everything at the END, so a run interrupted half way writes nothing
  at all. `as_completed` hands back each cell the moment it is done.
  With a 90-cell run and a loaded endpoint, this is the difference
  between a report and no report.

**Measure the endpoint before choosing a concurrency.** A short call
answers in about a second and a long response takes 40-150 s: the wait
is generation, not queueing. Six in flight on long responses is about
three times faster than one, and raising concurrency past that just
adds contention.

## The sidecar discipline

- **Append, never truncate.** The resume path reads the same `.jsonl`
  it writes. Truncating on start destroys the cells the run is about to
  reuse.
- **Write the failed cells too.** A cell whose request failed is not a
  verdict; it is a missing measurement. If the failed rows never reach
  the sidecar, the resume path cannot see them, a retry pass has
  nothing to find, and the report quietly loses a tenth of its cells
  while still looking complete.
- **Deduplicate on `(technique, category)`** when collapsing the
  sidecar into the final JSON: a re-measured cell replaces its earlier
  row rather than sitting beside it.

## Resume and re-score semantics

**A resumed run re-judges its cached cells with the current scorer.** A
scorer fix invalidates every cached verdict, and a resumed run that
reuses them mixes two scorers in one report. The stored excerpt is
enough to re-judge, so print the ones that changed.

**A re-score must not overwrite a full-text verdict with a head-only
one.** When the stored excerpt is shorter than the response, the
re-judgement saw less than the original measurement did, so it is
strictly less reliable. Mark those cells (`rescored_from_truncated_excerpt`)
and re-measure them instead. A benign control with a 8,900-character
answer was re-judged REFUSED from its first 1,200 characters while the
full response had been judged COMPLIED.

**A re-score must rebuild the summary, not just the detail.** The
summary carries its own copy of the matrix and the ranking. Updating
only the detail leaves the report contradicting itself.

**A re-score must preserve the run metadata.** `model`, `base_url`,
`timestamp`, `elapsed_s` and `repeats` live in the summary. Replacing
the whole summary with a fresh statistics dict drops them, and a report
that does not say which model it measured is not a report. Rebuild the
statistics and merge the metadata back.

**Rebuild every derived view from the re-judged rows.** The grid, the
per-category rates, the ranking and the baseline-relative attribution
are all derived. If any of them is cached, the report carries two
different pictures of the same run.

## A completed report is read-only

Long runs leave processes behind, and their completion notices arrive
long after the work they did. One of them can land on the finished
report with an older scorer's numbers.

**The runner refuses to overwrite a report that already holds every
probe or every cell** (with `--force` to override). The resume path
handles a PARTIAL report; a complete one is done.

**Keep a timestamped snapshot with a hash manifest anyway**, for the
processes that started before the guard existed. One command verifies
and restores:

```bash
python3 restore_snapshot.py --check   # verify only
python3 restore_snapshot.py           # restore what differs
```

**Do not trust a completion notice as state.** The notice carries the
run's OUTPUT, not the file's current contents. Check the file's mtime
and content before concluding anything changed.

**One writer per output path.** Two runs writing the same file make
the reader and the log disagree about the same run.

## The `max_tokens` trap on reasoning models

A reasoning model returns a `reasoning` field alongside the content,
and the reasoning is charged against `max_tokens`. With a small budget
the whole allowance goes into the thinking and the answer is never
written:

```
finish_reason = "length"
content       = None
reasoning     = 5171 chars
usage.completion_tokens = 1200   (of which reasoning_tokens = 1199)
```

This looks exactly like a content filter: HTTP 200, no exception, an
empty body, and the harness records it as an ERROR. Measured on one
probe:

| `max_tokens` | finish_reason | content |
|---|---|---|
| 1200 | length | 0 chars |
| 4000 | length | 0 chars |
| 8000 | stop | 1798 chars |
| unset | stop | 1604 chars |

Budget for the reasoning, not just the answer: a routine question cost
3,500-4,400 tokens on this endpoint.

## ERROR triage: three causes, three responses

An ERROR is a missing measurement. Before retrying anything, work out
which of the three it is:

| symptom | cause | response |
|:--|:--|:--|
| timeout, connection reset, fake 401 | the endpoint is loaded | retry with backoff |
| `finish_reason=length`, `content=None`, high `reasoning_tokens` | the reply budget was too small | raise `max_tokens` |
| every attempt on the SAME probe fails while its neighbours succeed | the endpoint refuses that content | change endpoint — retrying will never fix it |

The third one is the expensive mistake: a run can lose a tenth of its
cells to probes the endpoint will not answer at all, and no amount of
retrying changes that. Probe those cells against a candidate endpoint
directly before spending a full run on them.

## Reporting: the scorer's number and the hand-read number

Every reported break is read by hand before it goes in the report. On
the ten-category suite the scorer reported 15 unlocks; reading each
response gave 7 real, 4 borderline and 5 refusals. The scorer
over-reported by a third.

**Report both.** A table of "scorer says / hand-read says" per unlock
is the artifact that makes the scorer fixable, and the difference
between the two is the measure of how much the scorer was lying.

**The categories that a hand-read reclassified are the categories the
scorer is wrong about**, and they are the ones to re-measure after any
scorer change.
