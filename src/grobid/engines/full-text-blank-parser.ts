// Port of org.grobid.core.engines.FullTextBlankParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/FullTextBlankParser.java
//
// Adaptations:
// - Java `File inputPdf` → `string` (file path), matching DocumentSource.fromPdf.
// - `StringBuilder` / `StringBuffer` → `string[]` joined at the end.
// - `tmpPath` is upstream a `java.io.File`; ported as `string | null`.
//   `tmpPath.exists()` becomes a `fs.existsSync` check in the
//   process-from-file paths; here we keep the same not-null/exists check
//   (preserving the semantics) using `fs.existsSync`.

import { existsSync } from "node:fs";
import { AbstractParser } from "./abstract-parser.js";
import { EngineParsers } from "./engine-parsers.js";
import type { GrobidAnalysisConfig } from "./config/grobid-analysis-config.js";
import { Document } from "../document/document.js";
import { DocumentSource } from "../document/document-source.js";
import { TEIFormatter } from "../document/tei-formatter.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidResourceException } from "../exceptions/grobid-resource-exception.js";
import { GrobidModels } from "../grobid-models.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("FullTextBlankParser");
// upstream binds LOGGER but never uses it after the constructor; preserved.
void LOGGER;

export class FullTextBlankParser extends AbstractParser {
  protected tmpPath: string | null = null;

  // default bins for relative position
  private static readonly NBBINS_POSITION: number = 12;

  // default bins for inter-block spacing
  private static readonly NBBINS_SPACE: number = 5;

  // default bins for block character density
  private static readonly NBBINS_DENSITY: number = 5;

  // projection scale for line length
  private static readonly LINESCALE: number = 10;

  // NOTE: upstream bug — the `parsers` field is declared but the
  // constructor never assigns the `parsers` argument to it. As a result
  // `this.parsers` is always `null` at runtime. Preserved verbatim.
  protected parsers: EngineParsers | null = null;

  constructor(_parsers: EngineParsers) {
    super(GrobidModels.FULLTEXT);
    this.tmpPath = GrobidProperties.getTempPath();
  }

  // Upstream `process(File inputPdf, GrobidAnalysisConfig config)`.
  processFile(inputPdf: string, config: GrobidAnalysisConfig): Document;
  // Upstream `process(File inputPdf, String md5Str, GrobidAnalysisConfig config)`.
  processFile(inputPdf: string, md5Str: string, config: GrobidAnalysisConfig): Document;
  processFile(
    inputPdf: string,
    arg2: string | GrobidAnalysisConfig,
    arg3?: GrobidAnalysisConfig,
  ): Document {
    if (arg3 === undefined) {
      // 2-arg overload: (inputPdf, config)
      const config = arg2 as GrobidAnalysisConfig;
      const documentSource = DocumentSource.fromPdf(
        inputPdf,
        config.getStartPage(),
        config.getEndPage(),
        config.getPdfAssetPath() !== null,
        true,
        false,
      );
      return this.process(documentSource, config);
    }
    // 3-arg overload: (inputPdf, md5Str, config)
    const md5Str = arg2 as string;
    const config = arg3;
    const documentSource = DocumentSource.fromPdf(
      inputPdf,
      config.getStartPage(),
      config.getEndPage(),
      config.getPdfAssetPath() !== null,
      true,
      false,
    );
    documentSource.setMD5(md5Str);
    return this.process(documentSource, config);
  }

  /**
   * Machine-learning recognition of the complete full text structures.
   *
   * @param documentSource input
   * @param config config
   * @return the document object with built TEI
   */
  process(documentSource: DocumentSource, config: GrobidAnalysisConfig): Document {
    if (this.tmpPath === null) {
      throw new GrobidResourceException("Cannot process pdf file, because temp path is null.");
    }
    if (!existsSync(this.tmpPath)) {
      throw new GrobidResourceException(
        "Cannot process pdf file, because temp path '" + this.tmpPath + "' does not exists.",
      );
    }
    try {
      const doc = new Document(documentSource);
      doc.addTokenizedDocument(config);

      if (doc.getBlocks() === null) {
        throw new Error("PDF parsing resulted in empty content");
      }
      doc.produceStatistics();

      const tokenizations: LayoutToken[] = doc.getTokenizations() ?? [];

      // also write the raw text as seen before segmentation
      const rawtxt: string[] = [];
      for (const txtline of tokenizations) {
        rawtxt.push(TextUtilities.HTMLEncode(txtline.getText()) ?? "");
      }

      const fulltext = rawtxt.join("");
      const formatter = new TEIFormatter(doc, null);
      // Upstream returns `java.lang.StringBuilder`; we represent it as
      // a JS string and accumulate appended chunks via a `string[]` buffer.
      // Convert the StringBuilder-equivalent to its string form first.
      const teiHeader: string = String(
        formatter.toTEIHeader(null, null, null, null, null, config),
      );
      const tei: string[] = [teiHeader];

      tei.push("\t\t<body>\n");
      tei.push("\t\t\t<div>\n");
      tei.push("\t\t\t\t<p>\n");
      tei.push(fulltext);
      tei.push("\t\t\t\t</p>\n");
      tei.push("\t\t\t</div>\n");
      tei.push("\t\t</body>\n");
      tei.push("\t</text>\n");
      tei.push("</TEI>\n");

      doc.setTei(tei.join(""));
      return doc;
    } catch (e) {
      if (e instanceof GrobidException) {
        throw e;
      }
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }
  }

  override close(): void {
    super.close();
  }
}
