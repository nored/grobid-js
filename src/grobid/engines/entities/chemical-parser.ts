// Port of org.grobid.core.engines.entities.ChemicalParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/entities/ChemicalParser.java
//
// Adaptations:
// - Java `StringTokenizer(text, delim, true)` returns delimiter tokens as
//   well; emulated by `tokenizeWithDelimiters` below.
// - Apache `IOUtils` and Java exception types are inlined.

import { GrobidModels } from "../../grobid-models.js";
import { ChemicalEntity } from "../../data/chemical-entity.js";
import { AbstractParser } from "../abstract-parser.js";
import { GrobidException } from "../../exceptions/grobid-exception.js";
import { FeaturesVectorChemicalEntity } from "../../features/features-vector-chemical-entity.js";
import { TextUtilities } from "../../utilities/text-utilities.js";

/**
 * Returns the tokens of `text` split at any character contained in `delim`,
 * preserving the delimiter characters themselves as tokens — mirroring
 * `java.util.StringTokenizer(text, delim, true)`.
 */
function tokenizeWithDelimiters(text: string, delim: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (delim.indexOf(c) !== -1) {
      if (buf.length > 0) {
        out.push(buf);
        buf = "";
      }
      out.push(c);
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

/**
 * Chemical entities extraction.
 */
export class ChemicalParser extends AbstractParser {
  //    private FeatureFactory featureFactory = null;

  constructor() {
    super(GrobidModels.ENTITIES_CHEMISTRY);
    //        featureFactory = FeatureFactory.getInstance();
  }

  /**
   * Extract all reference from a simple piece of text.
   */
  async extractChemicalEntities(text: string | null): Promise<ChemicalEntity[] | null> {
    //        int nbRes = 0;
    if (text === null) return null;
    if (text.length === 0) return null;
    let entities: ChemicalEntity[] | null;
    try {
      text = text.replace(/\n/g, " ");
      const tokens = tokenizeWithDelimiters(text, TextUtilities.fullPunctuations);

      if (tokens.length === 0) return null;

      const textBlocks: string[] = [];
      const tokenizations: string[] = [];
      for (const tok of tokens) {
        tokenizations.push(tok);
        if (tok !== " ") {
          textBlocks.push(tok + "\t<chemical>");
        }
      }
      let ress = "";
      let posit = 0;
      for (const block of textBlocks) {
        //System.out.println(block);
        ress += FeaturesVectorChemicalEntity.addFeaturesChemicalEntities(
          block,
          textBlocks.length,
          posit,
          false,
          false,
        ).printVector();
        posit++;
      }
      ress += "\n";
      const res = await this.label(ress);
      entities = this.resultExtraction(res, tokenizations);
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
    return entities;
  }

  /**
   * Extract results from a labelled header.
   */
  resultExtraction(result: string, tokenizations: string[]): ChemicalEntity[] | null {
    const entities: ChemicalEntity[] = [];

    const lines = result.split("\n");

    const nameEntities: string[] = [];
    const offsets_entities: number[] = [];
    let entity: string | null = null;
    let offset = 0;
    let currentOffset = 0;
    let label: string | null; // label
    let actual: string | null; // token
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let lastTag: string | null = null; // previous label
    let p = 0; // iterator for the tokenizations for restauring the original tokenization with
    // respect to spaces
    for (const lineRaw of lines) {
      const line = lineRaw;
      if (line.trim().length === 0) {
        continue;
      }

      const parts = line.split("\t");
      let start = true;
      let addSpace = false;
      label = null;
      actual = null;
      let offset_addition = 0;
      for (const tok of parts) {
        if (start) {
          actual = tok;
          start = false;
          actual = actual.trim();
          let strop = false;
          while (!strop && p < tokenizations.length) {
            const tokOriginal = tokenizations[p] as string;
            offset_addition += tokOriginal.length;
            if (tokOriginal === " ") {
              addSpace = true;
            } else if (tokOriginal === actual) {
              strop = true;
            }
            p++;
          }
        } else {
          label = tok.trim();
        }
      }

      if (label === null) {
        continue;
      }

      if (actual !== null) {
        if ((label as string).endsWith("<chemName>")) {
          if (entity === null) {
            entity = actual;
            currentOffset = offset;
          } else {
            if (label === "I-<chemName>") {
              if (entity !== null) {
                nameEntities.push(entity);
                offsets_entities.push(currentOffset);
              }
              entity = actual;
              currentOffset = offset;
            } else {
              if (addSpace) {
                entity += " " + actual;
              } else {
                entity += actual;
              }
            }
          }
        } else if (label === "<other>") {
          if (entity !== null) {
            nameEntities.push(entity);
            offsets_entities.push(currentOffset);
          }
          entity = null;
        }
      }
      offset += offset_addition;
      lastTag = label;
    }

    // call the name-to-structure processing
    let j = 0;
    if (nameEntities.length === 0) {
      return null;
    }
    for (const name of nameEntities) {
      //ChemicalEntity structure = NameToStructureResolver.process(name);
      const structure = new ChemicalEntity();
      structure.setRawName(name);
      structure.setOffsetStart(offsets_entities[j] as number);
      structure.setOffsetEnd((offsets_entities[j] as number) + name.length);
      entities.push(structure);
      j++;
    }

    return entities;
  }
}
