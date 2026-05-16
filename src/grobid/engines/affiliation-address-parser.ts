// Port of org.grobid.core.engines.AffiliationAddressParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/AffiliationAddressParser.java

import { Affiliation } from "../data/affiliation.js";
import { FeaturesVectorAffiliationAddress } from "../features/features-vector-affiliation-address.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import type { GrobidModel } from "../grobid-model.js";
import { GrobidModels } from "../grobid-models.js";
import { LayoutToken } from "../layout/layout-token.js";
import { Lexicon } from "../lexicon/lexicon.js";
import type { OffsetPosition } from "../utilities/offset-position.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { UnicodeUtil } from "../utilities/unicode-util.js";
import { AbstractParser } from "./abstract-parser.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { Engine } from "./engine.js";

/** Apache Commons isEmpty / isNotEmpty / isBlank shims. */
function isEmpty(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.length === 0;
}

export class AffiliationAddressParser extends AbstractParser {
  public lexicon: Lexicon = Lexicon.getInstance();

  // Upstream has two ctors: `protected AffiliationAddressParser(GrobidModel)`
  // and `public AffiliationAddressParser()`. TS forbids mixing access modifiers
  // across overloads, so we use a single optional-arg constructor; callers
  // outside the package still go through `new AffiliationAddressParser()`.
  constructor(model?: GrobidModel) {
    super(model ?? GrobidModels.AFFILIATION_ADDRESS);
  }

  async processing(input: string | null): Promise<Affiliation[] | null> {
    let results: Affiliation[] | null = null;
    try {
      if (input === null || input.length === 0) {
        return null;
      }

      input = UnicodeUtil.normaliseText(input);
      input = (input as string).trim();

      input = TextUtilities.dehyphenize(input);

      // TBD: pass the language object to the tokenizer
      const tokenizations: LayoutToken[] = this.analyzer.tokenizeWithLayoutToken(input);

      const affiliationBlocks: string[] = AffiliationAddressParser.getAffiliationBlocks(tokenizations);
      const placesPositions: OffsetPosition[][] = [];
      const countriesPositions: OffsetPosition[][] = [];
      placesPositions.push(this.lexicon.tokenPositionsLocationNames(tokenizations));
      countriesPositions.push(this.lexicon.tokenPositionsCountryNames(tokenizations));
      const allTokens: LayoutToken[][] = [];
      allTokens.push(tokenizations);
      const affiliationSequenceWithFeatures: string =
        FeaturesVectorAffiliationAddress.addFeaturesAffiliationAddress(
          affiliationBlocks,
          allTokens,
          placesPositions,
          countriesPositions,
        );

      const res: string = await this.label(affiliationSequenceWithFeatures);

      results = this.resultExtractionLayoutTokens(res, tokenizations);
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }
    return results;
  }

  protected static getAffiliationBlocks(tokenizations: LayoutToken[]): string[] {
    const affiliationBlocks: string[] = [];
    for (const tok of tokenizations) {
      if ((tok.getText() ?? "").length === 0) continue;

      if (tok.getText() !== " ") {
        if (tok.getText() === "\n") {
          affiliationBlocks.push("@newline");
        } else {
          // Upstream: `tok + " <affiliation>"` — LayoutToken.toString() returns getText().
          affiliationBlocks.push(tok.toString() + " <affiliation>");
        }
      }
    }
    return affiliationBlocks;
  }

  /**
   * Separate affiliation blocks, when they appears to be in separate set of offsets.
   */
  protected static getAffiliationBlocksFromSegments(tokenizations: LayoutToken[][]): string[] {
    const affiliationBlocks: string[] = [];
    let end = 0;
    for (const tokenizationSegment of tokenizations) {
      if (tokenizationSegment === null || tokenizationSegment.length === 0) continue;

      // if we have an offset shit, we introduce a segmentation of the affiliation block
      const startToken: LayoutToken = tokenizationSegment[0] as LayoutToken;
      const start: number = startToken.getOffset();
      if (start - end > 2 && end > 0) affiliationBlocks.push("\n");

      for (const tok of tokenizationSegment) {
        if (isEmpty(tok.getText())) {
          continue;
        }

        if (tok.getText() !== " ") {
          if (tok.getText() === "\n") {
            affiliationBlocks.push("@newline");
          } else {
            affiliationBlocks.push(tok.toString() + " <affiliation>");
          }
        }
        end = tok.getOffset();
      }
    }
    return affiliationBlocks;
  }

  async processingLayoutTokens(
    tokenizations: LayoutToken[][] | null,
  ): Promise<Affiliation[] | null> {
    let results: Affiliation[] | null = null;
    try {
      if (tokenizations === null || tokenizations.length === 0) {
        return null;
      }

      const tokenizationsAffiliation: LayoutToken[] = [];
      for (const tokenization of tokenizations) {
        for (const t of tokenization) tokenizationsAffiliation.push(t);
      }

      const affiliationBlocks: string[] = AffiliationAddressParser.getAffiliationBlocksFromSegments(
        tokenizations,
      );

      //System.out.println(affiliationBlocks.toString());

      const placesPositions: OffsetPosition[][] = [];
      const countriesPositions: OffsetPosition[][] = [];
      placesPositions.push(this.lexicon.tokenPositionsLocationNames(tokenizationsAffiliation));
      countriesPositions.push(this.lexicon.tokenPositionsCountryNames(tokenizationsAffiliation));
      const allTokens: LayoutToken[][] = [];
      allTokens.push(tokenizationsAffiliation);
      const affiliationSequenceWithFeatures: string =
        FeaturesVectorAffiliationAddress.addFeaturesAffiliationAddress(
          affiliationBlocks,
          allTokens,
          placesPositions,
          countriesPositions,
        );

      const res: string = await this.label(affiliationSequenceWithFeatures);
      results = this.resultExtractionLayoutTokens(res, tokenizationsAffiliation);
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }
    return results;
  }

  /**
   * Extract results from a labeled sequence.
   *
   * @param result            labeled sequence
   * @param tokenizations     list of tokens
   * @return lis of Affiliation objects
   */
  protected resultExtractionLayoutTokens(
    result: string | null,
    tokenizations: LayoutToken[],
  ): Affiliation[] {
    const affiliations: Affiliation[] = [];
    if (result === null) return affiliations;

    let affiliation: Affiliation = new Affiliation();

    //System.out.println(result);

    // NOTE: upstream bug — `lastClusterLabel` is declared but never read.
    // Preserved verbatim.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let lastClusterLabel: unknown = null;
    const clusteror = new TaggingTokenClusteror(GrobidModels.AFFILIATION_ADDRESS, result, tokenizations);

    // NOTE: upstream bug — `tokenLabel` is also declared but never read.
    // Preserved verbatim.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let tokenLabel: string | null = null;
    let newline = true;
    const clusters = clusteror.cluster();
    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }

      const clusterLabel = cluster.getTaggingLabel();
      Engine.getCntManager().i(clusterLabel);

      const clusterContent: string = LayoutTokensUtil.normalizeText(
        LayoutTokensUtil.toText(cluster.concatTokens()),
      );
      //String clusterContent = LayoutTokensUtil.toText(cluster.concatTokens());
      //String clusterContent = LayoutTokensUtil.normalizeDehyphenizeText(cluster.concatTokens());
      //String clusterNonDehypenizedContent = LayoutTokensUtil.toText(cluster.concatTokens());

      const tokens: LayoutToken[] = cluster.concatTokens();

      if (clusterLabel === TaggingLabels.AFFILIATION_MARKER) {
        // if an affiliation has already a merker, or if a marker start a line,
        // we introduce a new affiliation
        if (affiliation.getMarker() !== null || newline) {
          if (affiliation.isNotNull()) {
            affiliations.push(affiliation);
          }
          affiliation = new Affiliation();
        }

        affiliation.setMarker(clusterContent);
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_MARKER, tokens);
      } else if (clusterLabel === TaggingLabels.AFFILIATION_INSTITUTION) {
        if (affiliation.getInstitutions() !== null && (affiliation.getInstitutions() as string[]).length > 0) {
          if (affiliation.hasAddress()) {
            // new affiliation
            if (affiliation.isNotNull()) {
              affiliations.push(affiliation);
            }
            affiliation = new Affiliation();
          }
        }
        affiliation.addInstitution(clusterContent);
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_INSTITUTION, tokens);
      } else if (clusterLabel === TaggingLabels.AFFILIATION_DEPARTMENT) {
        if (affiliation.getDepartments() !== null && (affiliation.getDepartments() as string[]).length > 0) {
          if (affiliation.hasAddress()) {
            // new affiliation
            if (affiliation.isNotNull()) {
              affiliations.push(affiliation);
            }
            affiliation = new Affiliation();
          }
        }
        affiliation.addDepartment(clusterContent);
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_DEPARTMENT, tokens);
      } else if (clusterLabel === TaggingLabels.AFFILIATION_LABORATORY) {
        if (affiliation.getLaboratories() !== null && (affiliation.getLaboratories() as string[]).length > 0) {
          if (affiliation.hasAddress()) {
            // new affiliation
            if (affiliation.isNotNull()) {
              affiliations.push(affiliation);
            }
            affiliation = new Affiliation();
          }
        }
        affiliation.addLaboratory(clusterContent);
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_LABORATORY, tokens);
      } else if (clusterLabel === TaggingLabels.AFFILIATION_COUNTRY) {
        if (affiliation.getCountry() !== null) {
          if (affiliation.getCountry() !== clusterContent)
            affiliation.setCountry(affiliation.getCountry() + " " + clusterContent);
        } else affiliation.setCountry(clusterContent);
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_COUNTRY, tokens);
      } else if (clusterLabel === TaggingLabels.AFFILIATION_POSTCODE) {
        if (affiliation.getPostCode() !== null)
          affiliation.setPostCode(affiliation.getPostCode() + " " + clusterContent);
        else affiliation.setPostCode(clusterContent);
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_POSTCODE, tokens);
      } else if (clusterLabel === TaggingLabels.AFFILIATION_POSTBOX) {
        if (affiliation.getPostBox() !== null)
          affiliation.setPostBox(affiliation.getPostBox() + " " + clusterContent);
        else affiliation.setPostBox(clusterContent);
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_POSTBOX, tokens);
      } else if (clusterLabel === TaggingLabels.AFFILIATION_REGION) {
        if (affiliation.getRegion() !== null)
          affiliation.setRegion(affiliation.getRegion() + " " + clusterContent);
        else affiliation.setRegion(clusterContent);
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_REGION, tokens);
      } else if (clusterLabel === TaggingLabels.AFFILIATION_SETTLEMENT) {
        if (affiliation.getSettlement() !== null)
          affiliation.setSettlement(affiliation.getSettlement() + " " + clusterContent);
        else affiliation.setSettlement(clusterContent);
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_SETTLEMENT, tokens);
      } else if (clusterLabel === TaggingLabels.AFFILIATION_ADDRESSLINE) {
        if (affiliation.getAddrLine() !== null) {
          affiliation.setAddrLine(affiliation.getAddrLine() + " " + clusterContent);
        } else {
          affiliation.setAddrLine(clusterContent);
        }
        affiliation.addLabeledResult(TaggingLabels.AFFILIATION_ADDRESSLINE, tokens);
      }

      if (clusterLabel !== TaggingLabels.OTHER && affiliation.isNotNull()) {
        affiliation.appendLayoutTokens(tokens);
      }

      if (clusterLabel !== TaggingLabels.AFFILIATION_MARKER) {
        if (affiliation.getRawAffiliationString() === null) {
          affiliation.setRawAffiliationString(clusterContent);
        } else {
          affiliation.setRawAffiliationString(
            affiliation.getRawAffiliationString() + " " + clusterContent,
          );
        }
      }

      newline = false;
      if (tokens.length > 0) {
        const lastToken: LayoutToken = tokens[tokens.length - 1] as LayoutToken;
        if (lastToken.getText() !== null && lastToken.getText() === "\n") newline = true;
      }
      // Track lastClusterLabel for parity with upstream (the local is also
      // dead-written upstream; preserved verbatim).
      lastClusterLabel = clusterLabel;
      // Track tokenLabel — also unread upstream; preserved verbatim.
      tokenLabel = clusterLabel?.getLabel?.() ?? null;
    }

    // last affiliation
    if (affiliation.isNotNull()) {
      affiliations.push(affiliation);
    }

    return affiliations;
  }

  /**
   * DEPRECATED
   */
  protected resultBuilder(
    result: string | null,
    tokenizations: LayoutToken[],
    usePreLabel: boolean,
  ): Affiliation[] | null {
    let fullAffiliations: Affiliation[] | null = null;

    if (result === null) {
      return fullAffiliations;
    }
    result = result.replace(/\n\n/g, "\n \n"); // force empty line between affiliation blocks
    try {
      //System.out.println(tokenizations.toString());
      // extract results from the processed file
      if (result === null || result.length === 0) {
        return null;
      }

      const lines: string[] = result.split("\n").filter((l) => l.length > 0);
      let lastTag: string | null = null;
      let aff: Affiliation = new Affiliation();
      let lineCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let hasInstitution: boolean;
      let hasDepartment = false;
      let hasAddress = false;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let hasLaboratory: boolean;
      let newMarker = false;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let useMarker = false;
      let currentMarker: string | null = null;

      let p = 0;

      for (const line of lines) {
        let addSpace = false;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const lineCountInt: number = lineCount;
        if (line.trim().length === 0) {
          if (aff.isNotNull()) {
            if (fullAffiliations === null) {
              fullAffiliations = [];
            }
            fullAffiliations.push(aff);
            aff = new Affiliation();
            currentMarker = null;
          }
          hasInstitution = false;
          hasDepartment = false;
          hasLaboratory = false;
          hasAddress = false;
          continue;
        }
        let delimiter = "\t";
        if (line.indexOf(delimiter) === -1) delimiter = " ";
        const parts: string[] = line.split(delimiter);
        const ll = parts.length;
        let i = 0;
        let s1: string | null = null; // predicted label
        let s2: string | null = null; // lexical token
        let s3: string | null = null; // pre-label
        const localFeatures: string[] = [];
        for (const partRaw of parts) {
          const s = partRaw.trim();
          if (i === 0) {
            s2 = s; // lexical token

            let strop = false;
            while (!strop && p < tokenizations.length) {
              const tokOriginal: string | null = tokenizations[p]!.getText();
              if (tokOriginal === " ") {
                addSpace = true;
              } else if (tokOriginal === s) {
                strop = true;
              }
              p++;
            }
          } else if (i === ll - 2) {
            s3 = s; // pre-label
          } else if (i === ll - 1) {
            s1 = s; // label
          } else {
            localFeatures.push(s);
          }
          i++;
        }

        if (s1 === "<marker>") {
          if (currentMarker === null) currentMarker = s2;
          else {
            if (addSpace) {
              currentMarker += " " + s2;
            } else currentMarker += s2;
          }
          aff.setMarker(currentMarker);
          newMarker = false;
          useMarker = true;
        } else if (s1 === "I-<marker>") {
          currentMarker = s2;
          newMarker = true;
          useMarker = true;
        }

        if (newMarker) {
          if (aff.isNotNull()) {
            if (fullAffiliations === null) fullAffiliations = [];
            fullAffiliations.push(aff);
          }

          aff = new Affiliation();
          hasInstitution = false;
          hasLaboratory = false;
          hasDepartment = false;
          hasAddress = false;

          if (currentMarker !== null) {
            aff.setMarker(currentMarker);
          }
          newMarker = false;
        } else if (s1 === "<institution>" || s1 === "I-<institution>") {
          if (
            !usePreLabel ||
            (usePreLabel && (s3 === "<affiliation>" || s3 === "I-<affiliation>"))
          ) {
            hasInstitution = true;
            if (aff.getInstitutions() !== null) {
              if (s1 === "I-<institution>" && localFeatures.indexOf("LINESTART") !== -1) {
                // new affiliation
                if (aff.isNotNull()) {
                  if (fullAffiliations === null) fullAffiliations = [];
                  fullAffiliations.push(aff);
                }
                hasInstitution = true;
                hasDepartment = false;
                hasLaboratory = false;
                hasAddress = false;
                aff = new Affiliation();
                aff.addInstitution(s2!);
                if (currentMarker !== null) aff.setMarker(currentMarker.trim());
              } else if (
                s1 === "I-<institution>" &&
                hasInstitution &&
                hasAddress &&
                lastTag !== "<institution>"
              ) {
                // new affiliation
                if (aff.isNotNull()) {
                  if (fullAffiliations === null) {
                    fullAffiliations = [];
                  }
                  fullAffiliations.push(aff);
                }
                hasInstitution = true;
                hasDepartment = false;
                hasLaboratory = false;
                hasAddress = false;
                aff = new Affiliation();
                aff.addInstitution(s2!);
                if (currentMarker !== null) {
                  aff.setMarker(currentMarker.trim());
                }
              } else if (s1 === "I-<institution>") {
                // we have multiple institutions for this affiliation
                //aff.addInstitution(aff.institution);
                aff.addInstitution(s2!);
              } else if (addSpace) {
                aff.extendLastInstitution(" " + s2);
              } else {
                aff.extendLastInstitution(s2!);
              }
            } else {
              aff.addInstitution(s2!);
            }
          } else if (usePreLabel && (s3 === "<address>" || s3 === "I-<address>")) {
            // that's a piece of the address badly labelled according to the model
            if (aff.getAddressString() !== null) {
              if (addSpace) {
                aff.setAddressString(aff.getAddressString()! + " " + s2);
              } else {
                aff.setAddressString(aff.getAddressString()! + s2);
              }
            } else {
              aff.setAddressString(s2!);
            }
          }
        } else if (s1 === "<addrLine>" || s1 === "I-<addrLine>") {
          if (
            !usePreLabel ||
            (usePreLabel && (s3 === "<address>" || s3 === "I-<address>"))
          ) {
            if (aff.getAddrLine() !== null) {
              if (s1 === lastTag || lastTag === "I-<addrLine>") {
                if (s1 === "I-<addrLine>") {
                  aff.setAddrLine(aff.getAddrLine()! + " ; " + s2);
                } else if (addSpace) {
                  aff.setAddrLine(aff.getAddrLine()! + " " + s2);
                } else {
                  aff.setAddrLine(aff.getAddrLine()! + s2);
                }
              } else {
                aff.setAddrLine(aff.getAddrLine()! + ", " + s2);
              }
            } else {
              aff.setAddrLine(s2!);
            }
            hasAddress = true;
          } else if (usePreLabel && (s3 === "<affiliation>" || s3 === "I-<affiliation>")) {
            if (aff.getAffiliationString() !== null) {
              if (s1 === lastTag) {
                if (addSpace) {
                  aff.setAffiliationString(aff.getAffiliationString()! + " " + s2);
                } else {
                  aff.setAffiliationString(aff.getAffiliationString()! + s2);
                }
              } else {
                aff.setAffiliationString(aff.getAffiliationString()! + " ; " + s2);
              }
            } else {
              aff.setAffiliationString(s2!);
            }
          }
        } else if (s1 === "<department>" || s1 === "I-<department>") {
          if (
            !usePreLabel ||
            (usePreLabel && (s3 === "<affiliation>" || s3 === "I-<affiliation>"))
          ) {
            if (aff.getDepartments() !== null) {
              /*if (localFeatures.contains("LINESTART"))
                                   aff.department += " " + s2;*/

              if (s1 === "I-<department>" && localFeatures.indexOf("LINESTART") !== -1) {
                if (aff.isNotNull()) {
                  if (fullAffiliations === null) fullAffiliations = [];
                  fullAffiliations.push(aff);
                }
                hasInstitution = false;
                hasDepartment = true;
                hasLaboratory = false;
                hasAddress = false;
                aff = new Affiliation();
                aff.addDepartment(s2!);
                if (currentMarker !== null) {
                  aff.setMarker(currentMarker.trim());
                }
              } else if (
                s1 === "I-<department>" &&
                hasDepartment &&
                hasAddress &&
                lastTag !== "<department>"
              ) {
                if (aff.isNotNull()) {
                  if (fullAffiliations === null) {
                    fullAffiliations = [];
                  }
                  fullAffiliations.push(aff);
                }
                hasInstitution = false;
                hasDepartment = true;
                hasAddress = false;
                hasLaboratory = false;
                aff = new Affiliation();
                aff.addDepartment(s2!);
                if (currentMarker !== null) {
                  aff.setMarker(currentMarker.trim());
                }
              } else if (s1 === "I-<department>") {
                // we have multiple departments for this affiliation
                aff.addDepartment(s2!);
                //aff.department = s2;
              } else if (addSpace) {
                //aff.extendFirstDepartment(" " + s2);
                aff.extendLastDepartment(" " + s2);
              } else {
                //aff.extendFirstDepartment(s2);
                aff.extendLastDepartment(s2!);
              }
            } else if (aff.getInstitutions() !== null) {
              /*if (localFeatures.contains("LINESTART"))
                                   aff.department += " " + s2;*/

              if (
                s1 === "I-<department>" &&
                hasAddress &&
                localFeatures.indexOf("LINESTART") !== -1
              ) {
                if (aff.isNotNull()) {
                  if (fullAffiliations === null) fullAffiliations = [];
                  fullAffiliations.push(aff);
                }
                hasInstitution = false;
                hasDepartment = true;
                hasLaboratory = false;
                hasAddress = false;
                aff = new Affiliation();
                aff.addDepartment(s2!);
                if (currentMarker !== null) {
                  aff.setMarker(currentMarker.trim());
                }
              } else {
                aff.addDepartment(s2!);
              }
            } else {
              aff.addDepartment(s2!);
            }
          } else if (usePreLabel && (s3 === "<address>" || s3 === "I-<address>")) {
            if (aff.getAddressString() !== null) {
              if (addSpace) {
                aff.setAddressString(aff.getAddressString()! + " " + s2);
              } else {
                aff.setAddressString(aff.getAddressString()! + s2);
              }
            } else {
              aff.setAddressString(s2!);
            }
          }
        } else if (s1 === "<laboratory>" || s1 === "I-<laboratory>") {
          if (
            !usePreLabel ||
            (usePreLabel && (s3 === "<affiliation>" || s3 === "I-<affiliation>"))
          ) {
            hasLaboratory = true;
            if (aff.getLaboratories() !== null) {
              if (s1 === "I-<laboratory>" && localFeatures.indexOf("LINESTART") !== -1) {
                // new affiliation
                if (aff.isNotNull()) {
                  if (fullAffiliations === null) fullAffiliations = [];
                  fullAffiliations.push(aff);
                }
                hasInstitution = false;
                hasLaboratory = true;
                hasDepartment = false;
                hasAddress = false;
                aff = new Affiliation();
                aff.addLaboratory(s2!);
                if (currentMarker !== null) {
                  aff.setMarker(currentMarker.trim());
                }
              } else if (
                s1 === "I-<laboratory>" &&
                hasLaboratory &&
                hasAddress &&
                lastTag !== "<laboratory>"
              ) {
                // new affiliation
                if (aff.isNotNull()) {
                  if (fullAffiliations === null) fullAffiliations = [];
                  fullAffiliations.push(aff);
                }
                hasInstitution = false;
                hasLaboratory = true;
                hasDepartment = false;
                hasAddress = false;
                aff = new Affiliation();
                aff.addLaboratory(s2!);
                if (currentMarker !== null) {
                  aff.setMarker(currentMarker.trim());
                }
              } else if (s1 === "I-<laboratory>") {
                // we have multiple laboratories for this affiliation
                aff.addLaboratory(s2!);
              } else if (addSpace) {
                aff.extendLastLaboratory(" " + s2);
              } else {
                aff.extendLastLaboratory(s2!);
              }
            } else {
              aff.addLaboratory(s2!);
            }
          } else if (usePreLabel && (s3 === "<address>" || s3 === "I-<address>")) {
            // that's a piece of the address badly labelled
            if (aff.getAddressString() !== null) {
              if (addSpace) {
                aff.setAddressString(aff.getAddressString()! + " " + s2);
              } else {
                aff.setAddressString(aff.getAddressString()! + s2);
              }
            } else {
              aff.setAddressString(s2!);
            }
          }
        } else if (s1 === "<country>" || s1 === "I-<country>") {
          if (
            !usePreLabel ||
            (usePreLabel && (s3 === "<address>" || s3 === "I-<address>"))
          ) {
            if (aff.getCountry() !== null) {
              if (s1 === "I-<country>") {
                aff.setCountry(aff.getCountry()! + ", " + s2);
              } else if (addSpace) {
                aff.setCountry(aff.getCountry()! + " " + s2);
              } else {
                aff.setCountry(aff.getCountry()! + s2);
              }
            } else {
              aff.setCountry(s2!);
            }
            hasAddress = true;
          } else if (usePreLabel && (s3 === "<affiliation>" || s3 === "I-<affiliation>")) {
            if (aff.getAffiliationString() !== null) {
              if (addSpace) {
                aff.setAffiliationString(aff.getAffiliationString()! + " " + s2);
              } else {
                aff.setAffiliationString(aff.getAffiliationString()! + s2);
              }
            } else {
              aff.setAffiliationString(s2!);
            }
          }
        } else if (s1 === "<postCode>" || s1 === "I-<postCode>") {
          if (
            !usePreLabel ||
            (usePreLabel && (s3 === "<address>" || s3 === "I-<address>"))
          ) {
            if (aff.getPostCode() !== null) {
              if (s1 === "I-<postCode>") {
                aff.setPostCode(aff.getPostCode()! + ", " + s2);
              } else if (addSpace) {
                aff.setPostCode(aff.getPostCode()! + " " + s2);
              } else {
                aff.setPostCode(aff.getPostCode()! + s2);
              }
            } else {
              aff.setPostCode(s2!);
            }
          } else if (usePreLabel && (s3 === "<affiliation>" || s3 === "I-<affiliation>")) {
            if (aff.getAffiliationString() !== null) {
              if (addSpace) {
                aff.setAffiliationString(aff.getAffiliationString()! + " " + s2);
              } else {
                aff.setAffiliationString(aff.getAffiliationString()! + s2);
              }
            } else {
              aff.setAffiliationString(s2!);
            }
          }
        } else if (s1 === "<postBox>" || s1 === "I-<postBox>") {
          if (
            !usePreLabel ||
            (usePreLabel && (s3 === "<address>" || s3 === "I-<address>"))
          ) {
            if (aff.getPostBox() !== null) {
              if (s1 === "I-<postBox>") {
                aff.setPostBox(aff.getPostBox()! + ", " + s2);
              } else if (addSpace) {
                aff.setPostBox(aff.getPostBox()! + " " + s2);
              } else {
                aff.setPostBox(aff.getPostBox()! + s2);
              }
            } else {
              aff.setPostBox(s2!);
            }
          } else if (usePreLabel && (s3 === "<affiliation>" || s3 === "I-<affiliation>")) {
            if (aff.getAffiliationString() !== null) {
              if (addSpace) {
                aff.setAffiliationString(aff.getAffiliationString()! + " " + s2);
              } else {
                aff.setAffiliationString(aff.getAffiliationString()! + s2);
              }
            } else {
              aff.setAffiliationString(s2!);
            }
          }
        } else if (s1 === "<region>" || s1 === "I-<region>") {
          if (
            !usePreLabel ||
            (usePreLabel && (s3 === "<address>" || s3 === "I-<address>"))
          ) {
            if (aff.getRegion() !== null) {
              if (s1 === "I-<region>") {
                aff.setRegion(aff.getRegion()! + ", " + s2);
              } else if (addSpace) {
                aff.setRegion(aff.getRegion()! + " " + s2);
              } else {
                aff.setRegion(aff.getRegion()! + s2);
              }
            } else {
              aff.setRegion(s2!);
            }
          } else if (usePreLabel && (s3 === "<affiliation>" || s3 === "I-<affiliation>")) {
            if (aff.getAffiliationString() !== null) {
              if (addSpace) {
                aff.setAffiliationString(aff.getAffiliationString()! + " " + s2);
              } else {
                aff.setAffiliationString(aff.getAffiliationString()! + s2);
              }
            } else {
              aff.setAffiliationString(s2!);
            }
          }
        } else if (s1 === "<settlement>" || s1 === "I-<settlement>") {
          if (
            !usePreLabel ||
            (usePreLabel && (s3 === "<address>" || s3 === "I-<address>"))
          ) {
            if (aff.getSettlement() !== null) {
              if (s1 === "I-<settlement>") {
                aff.setSettlement(aff.getSettlement()! + ", " + s2);
              } else if (addSpace) {
                aff.setSettlement(aff.getSettlement()! + " " + s2);
              } else {
                aff.setSettlement(aff.getSettlement()! + s2);
              }
            } else {
              aff.setSettlement(s2!);
            }
            hasAddress = true;
          } else if (usePreLabel && (s3 === "<affiliation>" || s3 === "I-<affiliation>")) {
            if (aff.getAffiliationString() !== null) {
              if (addSpace) {
                aff.setAffiliationString(aff.getAffiliationString()! + " " + s2);
              } else {
                aff.setAffiliationString(aff.getAffiliationString()! + s2);
              }
            } else {
              aff.setAffiliationString(s2!);
            }
          }
        }

        if (s1 !== null && !s1.endsWith("<marker>")) {
          if (aff.getRawAffiliationString() === null) {
            aff.setRawAffiliationString(s2);
          } else if (addSpace) {
            aff.setRawAffiliationString(aff.getRawAffiliationString()! + " " + s2);
          } else {
            aff.setRawAffiliationString(aff.getRawAffiliationString()! + s2);
          }
        }

        lastTag = s1;
        lineCount++;
        newMarker = false;
      }
      if (aff.isNotNull()) {
        if (fullAffiliations === null) fullAffiliations = [];

        fullAffiliations.push(aff);
        hasInstitution = false;
        hasDepartment = false;
        hasAddress = false;
      }

      // we clean a little bit
      if (fullAffiliations !== null) {
        for (const affi of fullAffiliations) {
          affi.clean();
        }
      }
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }
    return fullAffiliations;
  }

  /**
   * Extract results from a labelled header in the training format without any string modification.
   */
  async trainingExtraction(
    tokenizationsAffiliation: LayoutToken[] | null,
  ): Promise<string[] | null> {
    /*if ((result == null) || (result.length() == 0)) {
            return null;
        }*/

    if (tokenizationsAffiliation === null || tokenizationsAffiliation.length === 0) return null;

    const affiliationBlocks: string[] = AffiliationAddressParser.getAffiliationBlocks(
      tokenizationsAffiliation,
    );
    const placesPositions: OffsetPosition[][] = [];
    const countriesPositions: OffsetPosition[][] = [];
    placesPositions.push(this.lexicon.tokenPositionsLocationNames(tokenizationsAffiliation));
    countriesPositions.push(this.lexicon.tokenPositionsCountryNames(tokenizationsAffiliation));
    const allTokens: LayoutToken[][] = [];
    allTokens.push(tokenizationsAffiliation);

    let affiliationSequenceWithFeatures: string | null = null;
    try {
      affiliationSequenceWithFeatures =
        FeaturesVectorAffiliationAddress.addFeaturesAffiliationAddress(
          affiliationBlocks,
          allTokens,
          placesPositions,
          countriesPositions,
        );
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }

    if (affiliationSequenceWithFeatures === null) {
      return null;
    }

    const resultAffiliation: string = await this.label(affiliationSequenceWithFeatures);
    const bufferAffiliation: string[] = [];
    if (resultAffiliation === null) {
      return bufferAffiliation;
    }

    const lines: string[] = resultAffiliation.split("\n").filter((l) => l.length > 0);
    let s1: string | null = null;
    let s2: string | null = null;
    let lastTag: string | null = null;

    let p = 0;

    let currentTag0: string | null = null;
    let lastTag0: string | null = null;
    let hasAddressTag = false;
    let hasAffiliationTag = false;
    let hasAddress = false;
    let hasAffiliation = false;
    let start = true;
    let tagClosed = false;
    for (const tokRaw of lines) {
      let addSpace = false;
      const tok = tokRaw.trim();

      if (tok.length === 0) {
        continue;
      }
      const parts: string[] = tok.split("\t");
      const localFeatures: string[] = [];
      let i = 0;

      let newLine = false;
      const ll = parts.length;
      for (const partRaw of parts) {
        const s = partRaw.trim();
        if (i === 0) {
          s2 = TextUtilities.HTMLEncode(s);

          let strop = false;
          while (!strop && p < tokenizationsAffiliation.length) {
            const tokOriginal: string | null = tokenizationsAffiliation[p]!.getText();
            if (tokOriginal === " ") {
              addSpace = true;
            } else if (tokOriginal === s) {
              strop = true;
            }
            p++;
          }
        } else if (i === ll - 1) {
          s1 = s;
        } else {
          localFeatures.push(s);
          if (s === "LINESTART" && !start) {
            newLine = true;
            start = false;
          } else if (s === "LINESTART") {
            start = false;
          }
        }
        i++;
      }

      lastTag0 = null;
      if (lastTag !== null) {
        if (lastTag.startsWith("I-")) {
          lastTag0 = lastTag.substring(2);
        } else {
          lastTag0 = lastTag;
        }
      }
      currentTag0 = null;
      if (s1 !== null) {
        if (s1.startsWith("I-")) {
          currentTag0 = s1.substring(2);
        } else {
          currentTag0 = s1;
        }
      }

      if (lastTag !== null) {
        tagClosed = AffiliationAddressParser.testClosingTag(bufferAffiliation, currentTag0!, lastTag0!);
      } else tagClosed = false;

      if (newLine) {
        if (tagClosed) {
          bufferAffiliation.push("\t\t\t\t\t\t\t<lb/>\n");
        } else {
          bufferAffiliation.push("<lb/>");
        }
      }

      let output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<marker>", "<marker>", addSpace, 7);
      if (output !== null) {
        if (hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t</address>\n");
          hasAddressTag = false;
        }
        if (hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
        }
        bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n" + output);
        hasAffiliationTag = true;
        hasAddressTag = false;
        hasAddress = false;
        hasAffiliation = false;
        lastTag = s1;
        continue;
      } else {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<institution>", '<orgName type="institution">', addSpace, 7);
      }
      if (output === null) {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<department>", '<orgName type="department">', addSpace, 7);
      } else {
        if (hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t</address>\n");
          hasAddressTag = false;
        }
        if (hasAddress && hasAffiliation) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
          hasAddress = false;
          hasAffiliation = false;
          hasAddressTag = false;
        }

        if (!hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n");
          hasAffiliationTag = true;
        }
        bufferAffiliation.push(output);
        hasAffiliation = true;
        lastTag = s1;
        continue;
      }
      if (output === null) {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<laboratory>", '<orgName type="laboratory">', addSpace, 7);
      } else {
        if (hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t</address>\n");
          hasAddressTag = false;
        }
        if (hasAddress && hasAffiliation) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
          hasAddress = false;
          hasAffiliation = false;
          hasAddressTag = false;
        }

        if (!hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n");
          hasAffiliationTag = true;
        }
        bufferAffiliation.push(output);
        lastTag = s1;
        hasAffiliation = true;
        continue;
      }
      if (output === null) {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<addrLine>", "<addrLine>", addSpace, 8);
      } else {
        if (hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t</address>\n");
          hasAddressTag = false;
        }
        if (hasAddress && hasAffiliation) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
          hasAddress = false;
          hasAffiliation = false;
          hasAddressTag = false;
        }

        if (!hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n");
          hasAffiliationTag = true;
        }
        bufferAffiliation.push(output);
        hasAffiliation = true;
        lastTag = s1;
        continue;
      }
      if (output === null) {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<postCode>", "<postCode>", addSpace, 8);
      } else {
        if (hasAddress && hasAffiliation) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
          hasAddress = false;
          hasAffiliation = false;
          hasAddressTag = false;
        }
        if (!hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n");
          hasAffiliationTag = true;
          hasAddressTag = false;
        }

        if (!hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t<address>\n");
          hasAddressTag = true;
        }
        bufferAffiliation.push(output);
        lastTag = s1;
        continue;
      }
      if (output === null) {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<postBox>", "<postBox>", addSpace, 8);
      } else {
        if (hasAddress && hasAffiliation) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
          hasAddress = false;
          hasAffiliation = false;
          hasAddressTag = false;
        }
        if (!hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n");
          hasAffiliationTag = true;
          hasAddressTag = false;
        }

        if (!hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t<address>\n");
          hasAddressTag = true;
        }
        bufferAffiliation.push(output);
        lastTag = s1;
        continue;
      }
      if (output === null) {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<region>", "<region>", addSpace, 8);
      } else {
        if (hasAddress && hasAffiliation) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
          hasAddress = false;
          hasAffiliation = false;
          hasAddressTag = false;
        }
        if (!hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n");
          hasAffiliationTag = true;
          hasAddressTag = false;
        }

        if (!hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t<address>\n");
          hasAddressTag = true;
        }
        bufferAffiliation.push(output);
        lastTag = s1;
        continue;
      }
      if (output === null) {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<settlement>", "<settlement>", addSpace, 8);
      } else {
        if (hasAddress && hasAffiliation) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
          hasAddress = false;
          hasAffiliation = false;
          hasAddressTag = false;
        }
        if (!hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n");
          hasAffiliationTag = true;
          hasAddressTag = false;
        }

        if (!hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t<address>\n");
          hasAddressTag = true;
        }
        bufferAffiliation.push(output);
        lastTag = s1;
        continue;
      }
      if (output === null) {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<country>", "<country>", addSpace, 8);
      } else {
        if (hasAddress && hasAffiliation) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
          hasAddress = false;
          hasAffiliation = false;
          hasAddressTag = false;
        }
        if (!hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n");
          hasAffiliationTag = true;
          hasAddressTag = false;
        }

        if (!hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t<address>\n");
          hasAddressTag = true;
        }
        bufferAffiliation.push(output);
        lastTag = s1;
        continue;
      }
      if (output === null) {
        output = AffiliationAddressParser.writeField(s1!, lastTag0, s2!, "<other>", "<other>", addSpace, 8);
      } else {
        if (hasAddress && hasAffiliation) {
          bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
          hasAffiliationTag = false;
          hasAddress = false;
          hasAffiliation = false;
          hasAddressTag = false;
        }
        if (!hasAffiliationTag) {
          bufferAffiliation.push("\t\t\t\t\t\t<affiliation>\n");
          hasAffiliationTag = true;
          hasAddressTag = false;
        }

        if (!hasAddressTag) {
          bufferAffiliation.push("\t\t\t\t\t\t\t<address>\n");
          hasAddressTag = true;
        }

        bufferAffiliation.push(output);
        lastTag = s1;
        continue;
      }
      if (output !== null) {
        // Mirror Java StringBuilder.deleteCharAt when the last char is '\n'.
        if (bufferAffiliation.length > 0) {
          const lastIdx = bufferAffiliation.length - 1;
          const last = bufferAffiliation[lastIdx] as string;
          if (last.length > 0 && last.charAt(last.length - 1) === "\n") {
            bufferAffiliation[lastIdx] = last.substring(0, last.length - 1);
          }
        }
        bufferAffiliation.push(output);
      }
      lastTag = s1;
    }

    if (lastTag !== null) {
      if (lastTag.startsWith("I-")) {
        lastTag0 = lastTag.substring(2);
      } else {
        lastTag0 = lastTag;
      }
      currentTag0 = "";
      AffiliationAddressParser.testClosingTag(bufferAffiliation, currentTag0, lastTag0!);
      if (hasAddressTag) {
        bufferAffiliation.push("\t\t\t\t\t\t\t</address>\n");
      }
      bufferAffiliation.push("\t\t\t\t\t\t</affiliation>\n");
    }

    return bufferAffiliation;
  }

  private static writeField(
    s1: string,
    lastTag0: string | null,
    s2: string,
    field: string,
    outField: string,
    addSpace: boolean,
    nbIndent: number,
  ): string | null {
    let result: string | null = null;
    if (s1 === field || s1 === "I-" + field) {
      if (s1 === "<other>" || s1 === "I-<other>") {
        //result = "";
        /*for(int i=0; i<nbIndent; i++) {
                        result += "\t";
                    }*/
        if (addSpace) result = " " + s2;
        else result = s2;
      } else if (s1 === lastTag0 || s1 === "I-" + lastTag0) {
        if (addSpace) result = " " + s2;
        else result = s2;
      } else {
        result = "";
        for (let i = 0; i < nbIndent; i++) {
          result += "\t";
        }
        result += outField + s2;
      }
    }
    return result;
  }

  private static testClosingTag(
    buffer: string[],
    currentTag0: string,
    lastTag0: string,
  ): boolean {
    let res = false;
    if (currentTag0 !== lastTag0) {
      res = true;
      // we close the current tag
      if (lastTag0 === "<institution>") {
        buffer.push("</orgName>\n");
      } else if (lastTag0 === "<department>") {
        buffer.push("</orgName>\n");
      } else if (lastTag0 === "<laboratory>") {
        buffer.push("</orgName>\n");
      } else if (lastTag0 === "<addrLine>") {
        buffer.push("</addrLine>\n");
      } else if (lastTag0 === "<postCode>") {
        buffer.push("</postCode>\n");
      } else if (lastTag0 === "<postBox>") {
        buffer.push("</postBox>\n");
      } else if (lastTag0 === "<region>") {
        buffer.push("</region>\n");
      } else if (lastTag0 === "<settlement>") {
        buffer.push("</settlement>\n");
      } else if (lastTag0 === "<country>") {
        buffer.push("</country>\n");
      } else if (lastTag0 === "<marker>") {
        buffer.push("</marker>\n");
      } else if (lastTag0 === "<other>") {
        buffer.push("\n");
      } else {
        res = false;
      }
    }
    return res;
  }
}
