// Port of org.grobid.core.utilities.matching.ReferenceMarkerMatcher.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/matching/ReferenceMarkerMatcher.java

import { ReferenceMarkerMatcherCounters } from "../../engines/counters/reference-marker-matcher-counters.js";
import { BibDataSet } from "../../data/bib-data-set.js";
import { LayoutToken } from "../../layout/layout-token.js";
import { LayoutTokensUtil } from "../layout-tokens-util.js";
import { Pair } from "../pair.js";
import type { CntManager } from "../counters/cnt-manager.js";
import { getLogger } from "../logger.js";

import { LuceneIndexMatcher, type MatcherFunction } from "./lucene-index-matcher.js";
import { LuceneUtil, StandardAnalyzer } from "./lucene-util.js";

const LOGGER = getLogger("ReferenceMarkerMatcher");

/**
 * Matching reference markers to extracted citations
 */
export class ReferenceMarkerMatcher {
  public static readonly YEAR_PATTERN: RegExp = /[12][0-9]{3}[a-d]?/;
  public static readonly YEAR_PATTERN_WITH_LOOK_AROUND: RegExp = /(?<!\d)[12][0-9]{3}(?!\d)[a-d]?/;
  //public static final Pattern AUTHOR_NAME_PATTERN = Pattern.compile("[A-Z][A-Za-z]+");
  public static readonly AUTHOR_NAME_PATTERN: RegExp = /[A-Z][\p{L}]+/u;
  //public static final Pattern NUMBERED_CITATION_PATTERN = Pattern.compile(" *[\\(\\[]? *(?:\\d+[-–]\\d+,|\\d+, *)*[ ]*(?:\\d+[-–]\\d+|\\d+)[\\)\\]]? *");
  public static readonly NUMBERED_CITATION_PATTERN: RegExp = /[\(\[]?\s*(?:\d+[-−–]\d+,|\d+,[ ]*)*[ ]*(?:\d+[-–]\d+|\d+)\s*[\)\]]?/;
  public static readonly AUTHOR_SEPARATOR_PATTERN: RegExp = /;/;
  public static readonly ANALYZER: StandardAnalyzer = new StandardAnalyzer();
  public static readonly MAX_RANGE: number = 20;
  public static readonly NUMBERED_CITATIONS_SPLIT_PATTERN: RegExp = /[,;]/;
  public static readonly AND_WORD_PATTERN: RegExp = /(and)|&/;
  public static readonly FIGURE_TABLES_REF_SEPARATORS: RegExp = /(and)|(&)|(,)/;
  public static readonly DASH_PATTERN: RegExp = /[–−-]/;

  public static readonly IDENTITY: MatcherFunction<string, unknown> = {
    apply(s: string): unknown {
      return s;
    },
  };

  private readonly authorMatcher: LuceneIndexMatcher<BibDataSet, string>;
  private readonly labelMatcher: LuceneIndexMatcher<BibDataSet, string>;
  private cntManager: CntManager;
  private allLabels: Set<string> | null = null;
  private allFirstAuthors: Set<string> | null = null;

  public constructor(bds: BibDataSet[] | null, cntManager: CntManager) {
    this.allLabels = new Set<string>();
    this.allFirstAuthors = new Set<string>();
    if (bds !== null && bds.length > 0) {
      for (const bibDataSet of bds) {
        const refSym = bibDataSet.getRefSymbol();
        if (refSym !== null) this.allLabels.add(refSym);
        //System.out.println(bibDataSet.getRefSymbol());
        const resBib = bibDataSet.getResBib();
        const authorString = resBib === null ? null : resBib.getFirstAuthorSurname();
        if (authorString !== null && authorString.length > 0)
          this.allFirstAuthors.add(authorString);
      }
    }

    this.cntManager = cntManager;
    this.authorMatcher = new LuceneIndexMatcher<BibDataSet, string>(
      {
        apply(bibDataSet: BibDataSet): unknown {
          const resBib = bibDataSet.getResBib();
          let authorString = (resBib === null ? null : resBib.getAuthors()) + " et al";
          if (resBib !== null && resBib.getPublicationDate() !== null) {
            authorString += " " + resBib.getPublicationDate();
          }
          // System.out.println("Indexing: " + authorString);
          return authorString;
        },
      },
      ReferenceMarkerMatcher.IDENTITY,
    );

    this.authorMatcher.setMustMatchPercentage(1.0);
    if (bds !== null) this.authorMatcher.load(bds);

    this.labelMatcher = new LuceneIndexMatcher<BibDataSet, string>(
      {
        apply(bibDataSet: BibDataSet): unknown {
          return bibDataSet.getRefSymbol();
        },
      },
      ReferenceMarkerMatcher.IDENTITY,
    );

    this.labelMatcher.setMustMatchPercentage(1.0);
    if (bds !== null) this.labelMatcher.load(bds);
  }

  public match(refTokens: LayoutToken[]): MatchResult[] {
    this.cntManager.i(ReferenceMarkerMatcherCounters.INPUT_REF_STRINGS_CNT);
    const text = LayoutTokensUtil.toText(
      LayoutTokensUtil.dehyphenize(
        LayoutTokensUtil.enrichWithNewLineInfo(refTokens),
      ),
    );

    if (this.isAuthorCitationStyle(text)) {
      this.cntManager.i(ReferenceMarkerMatcherCounters.STYLE_AUTHORS);
      //System.out.println("STYLE_AUTHORS: " + text);
      return this.matchAuthorCitation(text, refTokens);
    } else if (this.isNumberedCitationReference(text)) {
      this.cntManager.i(ReferenceMarkerMatcherCounters.STYLE_NUMBERED);
      //System.out.println("STYLE_NUMBERED: " + text);
      return this.matchNumberedCitation(text, refTokens);
    } else {
      this.cntManager.i(ReferenceMarkerMatcherCounters.STYLE_OTHER);
      //System.out.println("STYLE_OTHER: " + text);
      //            LOGGER.info("Other style: " + text);
      return [new MatchResult(text, refTokens, null)];
    }
  }

  /*public boolean isAuthorCitationStyle(String text) {
    return ( YEAR_PATTERN.matcher(text.trim()).find() ||
             NUMBERED_CITATION_PATTERN.matcher(text.trim()).find() )
        && AUTHOR_NAME_PATTERN.matcher(text.trim()).find();
  }*/

  public isAuthorCitationStyle(text: string): boolean {
    return (
      ReferenceMarkerMatcher.YEAR_PATTERN.test(text.trim()) &&
      ReferenceMarkerMatcher.AUTHOR_NAME_PATTERN.test(text.trim())
    );
  }

  // relaxed number matching
  /*public static boolean isNumberedCitationReference(String t) {
        return NUMBERED_CITATION_PATTERN.matcher(t.trim()).find();
    }*/

  // number matching for number alone or in combination with author for cases "Naze et al. [5]"
  public isNumberedCitationReference(t: string): boolean {
    const trimmed = t.trim();
    // Java .matches() requires the entire string to match the pattern (anchored).
    const fullMatch = new RegExp(
      "^(?:" + ReferenceMarkerMatcher.NUMBERED_CITATION_PATTERN.source + ")$",
    ).test(trimmed);
    return (
      fullMatch ||
      (ReferenceMarkerMatcher.NUMBERED_CITATION_PATTERN.test(trimmed) &&
        ReferenceMarkerMatcher.AUTHOR_NAME_PATTERN.test(trimmed))
    );
  }

  // string number matching
  /*public static boolean isNumberedCitationReference(String t) {
        return NUMBERED_CITATION_PATTERN.matcher(t.trim()).matches();
    }*/

  private matchNumberedCitation(input: string, refTokens: LayoutToken[]): MatchResult[] {
    void input;
    const labels: Pair<string, LayoutToken[]>[] =
      ReferenceMarkerMatcher.getNumberedLabels(refTokens, true);
    const results: MatchResult[] = [];
    for (const label of labels) {
      const text = label.a!;
      const labelToks = label.b!;
      const matches: BibDataSet[] = this.labelMatcher.match(text);
      if (matches.length === 1) {
        this.cntManager.i(ReferenceMarkerMatcherCounters.MATCHED_REF_MARKERS);
        //                System.out.println("MATCHED: " + text + "\n" + matches.get(0).getRefSymbol() + "\n" + matches.get(0).getRawBib());
        //                System.out.println("-----------");
        results.push(new MatchResult(text, labelToks, matches[0]!));
      } else {
        this.cntManager.i(ReferenceMarkerMatcherCounters.UNMATCHED_REF_MARKERS);
        if (matches.length !== 0) {
          this.cntManager.i(ReferenceMarkerMatcherCounters.MANY_CANDIDATES);
          //                    LOGGER.info("MANY CANDIDATES: " + input + "\n" + text + "\n");
          for (const bds of matches) {
            void bds;
            //                        LOGGER.info("  " + bds.getRawBib());
          }
          //                    LOGGER.info("----------");
        } else {
          this.cntManager.i(ReferenceMarkerMatcherCounters.NO_CANDIDATES);
          //                    LOGGER.info("NO CANDIDATES: " + text + "\n" + text);
          //                    LOGGER.info("++++++++++++");
        }
        results.push(new MatchResult(text, labelToks, null));
      }
    }
    return results;
  }

  public static getNumberedLabels(
    layoutTokens: LayoutToken[],
    addWrappingSymbol: boolean,
  ): Pair<string, LayoutToken[]>[] {
    const split = LayoutTokensUtil.split(
      layoutTokens,
      ReferenceMarkerMatcher.NUMBERED_CITATIONS_SPLIT_PATTERN,
      true,
    );
    const res: Pair<string, LayoutToken[]>[] = [];
    // return [ ] or () depending on (1 - 2) or [3-5])
    const wrappingSymbols = ReferenceMarkerMatcher.getWrappingSymbols(split[0] ?? []);
    for (const s of split) {
      const minusPos = LayoutTokensUtil.tokenPos(s, ReferenceMarkerMatcher.DASH_PATTERN);
      if (minusPos < 0) {
        res.push(new Pair<string, LayoutToken[]>(LayoutTokensUtil.toText(s), s));
      } else {
        try {
          const minusTok = s[minusPos]!;
          const leftNumberToks = s.slice(0, minusPos);
          const rightNumberToks = s.slice(minusPos + 1, s.length);

          // Integer.valueOf(s, 10)
          const aTokens = LuceneUtil.tokenizeString(
            ReferenceMarkerMatcher.ANALYZER,
            LayoutTokensUtil.toText(leftNumberToks),
          );
          const bTokens = LuceneUtil.tokenizeString(
            ReferenceMarkerMatcher.ANALYZER,
            LayoutTokensUtil.toText(rightNumberToks),
          );
          if (aTokens.length === 0 || bTokens.length === 0) {
            throw new Error("empty range bounds");
          }
          const a: number = parseInt(aTokens[0]!, 10);
          const b: number = parseInt(bTokens[0]!, 10);
          if (Number.isNaN(a) || Number.isNaN(b)) {
            throw new Error("non-numeric range bounds");
          }

          if (a < b && b - a < ReferenceMarkerMatcher.MAX_RANGE) {
            for (let i = a; i <= b; i++) {
              let tokPtr: LayoutToken[];
              if (i === a) {
                tokPtr = leftNumberToks;
              } else if (i === b) {
                tokPtr = rightNumberToks;
              } else {
                tokPtr = [minusTok];
              }

              if (addWrappingSymbol)
                res.push(
                  new Pair<string, LayoutToken[]>(
                    wrappingSymbols.a! + String(i) + wrappingSymbols.b!,
                    tokPtr,
                  ),
                );
              else
                res.push(
                  new Pair<string, LayoutToken[]>(String(i), tokPtr),
                );
            }
          }
        } catch (e) {
          LOGGER.debug("Cannot parse citation reference range: " + s, e);
        }
      }
    }
    return res;
  }

  private static getWrappingSymbols(layoutTokens: LayoutToken[]): Pair<string, string> {
    for (const t of layoutTokens) {
      const tt = t.t() ?? "";
      if (LayoutTokensUtil.spaceyToken(tt) || LayoutTokensUtil.newLineToken(tt)) {
        continue;
      }
      if (tt === "(") {
        return new Pair<string, string>("(", ")");
      } else {
        return new Pair<string, string>("[", "]");
      }
    }

    return new Pair<string, string>("[", "]");
  }

  private matchAuthorCitation(text: string, refTokens: LayoutToken[]): MatchResult[] {
    void text;
    const split = ReferenceMarkerMatcher.splitAuthors(refTokens);
    const results: MatchResult[] = [];

    for (const si of split) {
      const c = si.a!;
      const splitItem = si.b!;

      const matches: BibDataSet[] = this.authorMatcher.match(c);
      if (matches.length === 1) {
        this.cntManager.i(ReferenceMarkerMatcherCounters.MATCHED_REF_MARKERS);
        //System.out.println("MATCHED: " + text + "\n" + c + "\n" + matches.get(0).getRawBib());
        results.push(new MatchResult(c, splitItem, matches[0]!));
      } else {
        if (matches.length !== 0) {
          this.cntManager.i(ReferenceMarkerMatcherCounters.MANY_CANDIDATES);
          const filtered: BibDataSet[] = this.postFilterMatches(c, matches);
          if (filtered.length === 1) {
            results.push(new MatchResult(c, splitItem, filtered[0]!));
            this.cntManager.i(ReferenceMarkerMatcherCounters.MATCHED_REF_MARKERS);
            this.cntManager.i(
              ReferenceMarkerMatcherCounters.MATCHED_REF_MARKERS_AFTER_POST_FILTERING,
            );
          } else {
            this.cntManager.i(ReferenceMarkerMatcherCounters.UNMATCHED_REF_MARKERS);
            results.push(new MatchResult(c, splitItem, null));
            if (filtered.length === 0) {
              this.cntManager.i(
                ReferenceMarkerMatcherCounters.NO_CANDIDATES_AFTER_POST_FILTERING,
              );
            } else {
              this.cntManager.i(
                ReferenceMarkerMatcherCounters.MANY_CANDIDATES_AFTER_POST_FILTERING,
              );
              //LOGGER.info("SEVERAL MATCHED REF CANDIDATES: " + text + "\n-----\n" + c + "\n");
              /*for (BibDataSet bds : matches) {
                                LOGGER.info("+++++");
                                LOGGER.info("  " + bds.getRawBib());
                            }*/
            }
          }
        } else {
          results.push(new MatchResult(c, splitItem, null));
          this.cntManager.i(ReferenceMarkerMatcherCounters.NO_CANDIDATES);
          //LOGGER.info("NO MATCHED REF CANDIDATES: " + text + "\n" + c);
          //LOGGER.info("++++++++++++");
        }
      }
    }

    return results;
  }

  // splitting into individual citation references strings like in:
  // Kuwajima et al., 1985; Creighton, 1990; Ptitsyn et al., 1990;
  private static splitAuthors(toks: LayoutToken[]): Pair<string, LayoutToken[]>[] {
    const split = LayoutTokensUtil.split(
      toks,
      ReferenceMarkerMatcher.AUTHOR_SEPARATOR_PATTERN,
      true,
    );
    const result: Pair<string, LayoutToken[]>[] = [];

    for (const splitTokens of split) {
      //cases like: Khechinashvili et al. (1973) and Privalov (1979)
      const text = LayoutTokensUtil.toText(splitTokens);
      const mc = ReferenceMarkerMatcher.matchCountString(
        text,
        ReferenceMarkerMatcher.YEAR_PATTERN_WITH_LOOK_AROUND,
      );
      if (mc === 2 && text.includes(" and ")) {
        for (const ys of LayoutTokensUtil.split(
          splitTokens,
          ReferenceMarkerMatcher.AND_WORD_PATTERN,
          true,
        )) {
          result.push(
            new Pair<string, LayoutToken[]>(
              LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(ys)),
              ys,
            ),
          );
        }
      } else if (mc > 1) {
        const yearSplit = LayoutTokensUtil.split(
          splitTokens,
          ReferenceMarkerMatcher.YEAR_PATTERN,
          true,
          false,
        );
        const yearSplitWithLeftOver = LayoutTokensUtil.split(
          splitTokens,
          ReferenceMarkerMatcher.YEAR_PATTERN,
          true,
          true,
        );
        // do we have a leftover to be added?
        let leftover: LayoutToken[] | null = null;
        if (yearSplit.length < yearSplitWithLeftOver.length) {
          leftover = yearSplitWithLeftOver[yearSplitWithLeftOver.length - 1]!;
        }
        if (yearSplit.length === 0) {
          result.push(
            new Pair<string, LayoutToken[]>(
              LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(splitTokens)),
              splitTokens,
            ),
          );
        } else {
          if (
            ReferenceMarkerMatcher.matchCountTokens(
              splitTokens,
              ReferenceMarkerMatcher.AUTHOR_NAME_PATTERN,
            ) === 1
          ) {
            // cases like Grafton et al. 1995, 1998;
            // the idea is that we produce as many labels as we have year.
            //E.g. "Grafton et al. 1995, 1998;" will become two pairs:
            // 1) ("Grafton et al. 1995", tokens_of("Grafton et al. 1995"))
            // 2) ("Grafton et al. 1998", tokens_of("1998"))
            // this method will allow to mark two citations in a non-overlapping manner

            const firstYearSplitItem = yearSplit[0]!;
            result.push(
              new Pair<string, LayoutToken[]>(
                LayoutTokensUtil.toText(
                  LayoutTokensUtil.dehyphenize(firstYearSplitItem),
                ),
                firstYearSplitItem,
              ),
            );

            const excludedYearToks = firstYearSplitItem.slice(
              0,
              firstYearSplitItem.length - 1,
            );
            const authorName = LayoutTokensUtil.toText(
              LayoutTokensUtil.dehyphenize(excludedYearToks),
            );

            for (let i = 1; i < yearSplit.length; i++) {
              const toksI = yearSplit[i]!;
              if (i === yearSplit.length - 1 && leftover !== null) {
                const lastSegmentTokens = toksI.slice(toksI.length - 1, toksI.length);
                // addAll - mutate
                for (const lt of leftover) lastSegmentTokens.push(lt);
                result.push(
                  new Pair<string, LayoutToken[]>(
                    authorName +
                      " " +
                      LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(toksI)) +
                      LayoutTokensUtil.toText(leftover),
                    lastSegmentTokens,
                  ),
                );
              } else {
                result.push(
                  new Pair<string, LayoutToken[]>(
                    authorName +
                      " " +
                      LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(toksI)),
                    toksI.slice(toksI.length - 1, toksI.length),
                  ),
                );
              }
            }
          } else {
            // case when two authors still appear
            for (let k = 0; k < yearSplit.length; k++) {
              const item = yearSplit[k]!;
              if (k === yearSplit.length - 1 && leftover !== null) {
                const lastSegmentTokens = item;
                for (const lt of leftover) lastSegmentTokens.push(lt);
                result.push(
                  new Pair<string, LayoutToken[]>(
                    LayoutTokensUtil.toText(
                      LayoutTokensUtil.dehyphenize(lastSegmentTokens),
                    ),
                    lastSegmentTokens,
                  ),
                );
              } else
                result.push(
                  new Pair<string, LayoutToken[]>(
                    LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(item)),
                    item,
                  ),
                );
            }
          }
        }
      } else {
        result.push(
          new Pair<string, LayoutToken[]>(
            LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(splitTokens)),
            splitTokens,
          ),
        );
      }
    }
    return result;
  }

  private static matchCountString(s: string, p: RegExp): number {
    const g = new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g");
    let cnt = 0;
    let m: RegExpExecArray | null;
    while ((m = g.exec(s)) !== null) {
      cnt++;
      if (m[0].length === 0) {
        g.lastIndex++;
      }
    }
    return cnt;
  }

  private static matchCountTokens(toks: LayoutToken[], p: RegExp): number {
    return ReferenceMarkerMatcher.matchCountString(LayoutTokensUtil.toText(toks), p);
  }

  //if we match more than 1 citation based on name, then we leave only those citations that have author name first
  private postFilterMatches(c: string, matches: BibDataSet[]): BibDataSet[] {
    if (c.toLowerCase().includes("et al") || c.toLowerCase().includes(" and ")) {
      const sp = c.trim().split(" ");
      //callouts often include parentheses as seen in https://grobid.readthedocs.io/en/latest/training/fulltext/
      const author = sp[0]!.replace(/[\(\[]/g, "").toLowerCase();
      let bibDataSets: BibDataSet[] = matches.filter((bibDataSet) => {
        // first author last name formatted raw bib
        const raw = bibDataSet.getRawBib();
        return raw !== null && raw.trim().toLowerCase().startsWith(author);
      });

      if (bibDataSets.length === 1) {
        return bibDataSets;
      }

      bibDataSets = matches.filter((bibDataSet) => {
        const resBib = bibDataSet.getResBib();
        if (resBib === null) return false;
        let firstAuthorLastName = resBib.getFirstAuthorSurname();
        if (firstAuthorLastName === null) return false;
        firstAuthorLastName = firstAuthorLastName.toLowerCase();
        // first author forename last name formatted raw bib
        return firstAuthorLastName === author;
      });

      if (bibDataSets.length <= 1) {
        return bibDataSets;
      }

      //cases like c = "Smith et al, 2015" and Bds = <"Smith, Hoffmann, 2015", "Smith, 2015"> -- should prefer first one
      return bibDataSets.filter((bibDataSet) => {
        const resBib = bibDataSet.getResBib();
        return (
          resBib !== null &&
          resBib.getFullAuthors() !== null &&
          resBib.getFullAuthors()!.length > 1
        );
      });
    } else {
      //cases like c = "Smith, 2015" and Bds = <"Smith, Hoffmann, 2015", "Smith, 2015"> -- should prefer second one
      return matches.filter((bibDataSet) => {
        const resBib = bibDataSet.getResBib();
        return (
          resBib !== null &&
          resBib.getFullAuthors() !== null &&
          resBib.getFullAuthors()!.length === 1
        );
      });
    }
  }

  /**
   * Return true if the text is a known label from the bibliographical reference list
   */
  public isKnownLabel(text: string): boolean {
    if (this.allLabels !== null && this.allLabels.has(text.trim())) return true;
    return false;
  }

  /**
   * Return true if the text is a known first author from the bibliographical reference list
   */
  public isKnownFirstAuthor(text: string): boolean {
    if (this.allFirstAuthors !== null && this.allFirstAuthors.has(text.trim()))
      return true;
    return false;
  }
}

export class MatchResult {
  private text: string;
  private tokens: LayoutToken[];
  private bibDataSet: BibDataSet | null;

  public constructor(text: string, tokens: LayoutToken[], bibDataSet: BibDataSet | null) {
    this.text = text;
    this.tokens = tokens;
    this.bibDataSet = bibDataSet;
  }

  public getText(): string {
    return this.text;
  }

  public getTokens(): LayoutToken[] {
    return this.tokens;
  }

  public getBibDataSet(): BibDataSet | null {
    return this.bibDataSet;
  }
}
