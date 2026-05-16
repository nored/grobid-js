# grobid-js vs upstream GROBID 0.9.0-crf — corpus comparison

Corpus: 5 papers. Upstream is treated as reference.

## 1. Header (title / authors / affiliations / abstract)

| Paper | title sim | authors (up/js, match) | affil (up/js, match) | abstract sim |
|---|---|---|---|---|
| acl-anthology | 100% | 2/2, 100% | 1/1, 100% | 100% |
| arxiv-bert | 100% | 4/4, 100% | 0/0, 100% | 100% |
| arxiv-recent | 100% | 28/28, 100% | 0/0, 100% | 100% |
| openreview | 100% | 1/1, 100% | 0/0, 100% | 100% |
| usenix-prime-probe | 100% | 2/2, 100% | 1/1, 100% | 100% |
| **avg** | 100% | — , 100% | — , 100% | 100% |

## 2. Section hierarchy (head text match @ ≥0.7 Lev. ratio)

| Paper | heads up | heads js | matched |
|---|---|---|---|
| acl-anthology | 21 | 21 | 100% |
| arxiv-bert | 38 | 38 | 100% |
| arxiv-recent | 18 | 18 | 100% |
| openreview | 25 | 25 | 100% |
| usenix-prime-probe | 20 | 20 | 100% |
| **avg** | — | — | 100% |

## 3. Citation markers & linkage to <biblStruct>

| Paper | bibr up/js | resolved up/js | valid-link up/js |
|---|---|---|---|
| acl-anthology | 29/29 | 29/29 | 29/29 |
| arxiv-bert | 91/91 | 76/76 | 76/76 |
| arxiv-recent | 35/35 | 35/35 | 35/35 |
| openreview | 79/79 | 37/37 | 37/37 |
| usenix-prime-probe | 98/98 | 97/97 | 97/97 |
| **total** | 332/332 (100%) | — | — |

## 4. References — per-field hit rate (fraction of refs with field populated)

| Paper | refs up/js | matched | title sim | auth up/js | title up/js | year up/js | journal up/js | DOI up/js |
|---|---|---|---|---|---|---|---|---|
| acl-anthology | 18/18 | 18 | 100% | 100%/100% | 100%/100% | 100%/100% | 61%/61% | 17%/17% |
| arxiv-bert | 55/55 | 55 | 100% | 100%/100% | 98%/98% | 98%/98% | 76%/76% | 2%/2% |
| arxiv-recent | 35/35 | 35 | 100% | 100%/100% | 100%/100% | 100%/100% | 23%/23% | 0%/0% |
| openreview | 39/39 | 39 | 100% | 100%/100% | 100%/100% | 90%/90% | 77%/77% | 41%/41% |
| usenix-prime-probe | 61/61 | 61 | 100% | 92%/92% | 100%/100% | 97%/97% | 75%/75% | 0%/0% |

## 5. Figures + tables

| Paper | figures up/js | tables up/js | caption match |
|---|---|---|---|
| acl-anthology | 4/4 | 1/1 | 100% |
| arxiv-bert | 4/4 | 4/4 | 100% |
| arxiv-recent | 6/6 | 2/2 | 100% |
| openreview | 5/5 | 5/5 | 100% |
| usenix-prime-probe | 9/9 | 3/3 | 100% |
| **avg** | — | — | 100% |

## 6. Coordinate-attribute coverage on body elements

| Paper | p (up%/js%) | head (up%/js%) | ref (up%/js%) | figure (up%/js%) |
|---|---|---|---|---|
| acl-anthology | 93%/93% | 76%/76% | 100%/100% | 100%/100% |
| arxiv-bert | 93%/93% | 79%/79% | 100%/100% | 100%/100% |
| arxiv-recent | 90%/90% | 56%/56% | 100%/100% | 100%/100% |
| openreview | 88%/91% | 60%/60% | 100%/100% | 100%/100% |
| usenix-prime-probe | 99%/100% | 50%/50% | 100%/100% | 100%/100% |
