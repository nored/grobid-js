// Port of org.grobid.core.document.TEIFormatter.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/TEIFormatter.java
//
// Class for generating a TEI representation of a document.
//
// Adaptations:
// - Java `StringBuilder` → JS `string` (mutate by reassigning local). Static
//   `TextUtilities.replaceAll(sb, re, rep)` returns a new string. Where the
//   upstream code does `tei.setCharAt(i, c)` we splice the string by index.
// - `nu.xom.Element/Text/Node` → our shim from `xml/xml-builder-utils.ts`.
// - Guava `Sets.newHashSet(...)` → JS `Set`.
// - Guava `Iterables.getFirst(list, null)` → `list[0] ?? null`.
// - Guava `Iterables.getLast(list)` → `list[list.length - 1]`.
// - `org.apache.commons.lang3.tuple.Pair.of(a, b)` → local `new Pair(a, b)`
//   from `utilities/pair.ts`; left/right map to a/b.
// - `org.apache.commons.lang3.tuple.Triple.of(l, m, r)` → local `Triple` from
//   `document.ts` (with getLeft/getMiddle/getRight).
// - The `org.grobid.core.utilities.Pair` (a/b API) maps to our local Pair.
// - `Collectors.toList()` on Java streams → JS `.filter(...).sort(...)`.
// - Java reflection-free: upstream uses `TEIFormatter.class` solely for the
//   logger which we resolve via `getLogger("TEIFormatter")`.

import { BibDataSet } from "../data/bib-data-set.js";
import { BiblioItem } from "../data/biblio-item.js";
import {
  CopyrightsLicense,
  CopyrightsOwner,
  License,
} from "../data/copyrights-license.js";
import { GrobidDate } from "../data/date.js";
import { Equation } from "../data/equation.js";
import { Figure } from "../data/figure.js";
import { FigureTableType } from "../data/figure-table-type.js";
import { Funder } from "../data/funder.js";
import { Funding } from "../data/funding.js";
import { Keyword } from "../data/keyword.js";
import { Note, NoteType } from "../data/note.js";
import { Table } from "../data/table.js";
import { BasicStructureBuilder } from "./basic-structure-builder.js";
import { Engine } from "../engines/engine.js";
import type { FullTextParser } from "../engines/full-text-parser.js";
import { CalloutAnalyzer, type MarkerType } from "../engines/citations/callout-analyzer.js";
import { GrobidAnalysisConfig } from "../engines/config/grobid-analysis-config.js";
import { SegmentationLabels } from "../engines/label/segmentation-labels.js";
import type { TaggingLabel } from "../engines/label/tagging-label.js";
import { TaggingLabels } from "../engines/label/tagging-labels.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidModels } from "../grobid-models.js";
import { Language } from "../lang/language.js";
import { BoundingBox } from "../layout/bounding-box.js";
import { GraphicObject } from "../layout/graphic-object.js";
import { LayoutToken } from "../layout/layout-token.js";
import { LayoutTokenization } from "../layout/layout-tokenization.js";
import { PDFAnnotation } from "../layout/pdf-annotation.js";
import { Page } from "../layout/page.js";
import { Lexicon } from "../lexicon/lexicon.js";
import { TaggingTokenCluster } from "../tokenization/tagging-token-cluster.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import { Consolidation } from "../utilities/consolidation.js";
import { ReferenceMarkerMatcher } from "../utilities/matching/reference-marker-matcher.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { KeyGen } from "../utilities/key-gen.js";
import { LanguageUtilities } from "../utilities/language-utilities.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { getLogger } from "../utilities/logger.js";
import { OffsetPosition } from "../utilities/offset-position.js";
import { Pair } from "../utilities/pair.js";
import { SentenceUtilities } from "../utilities/sentence-utilities.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { Document, Triple } from "./document.js";
import type { DocumentPiece } from "./document-piece.js";
import {
  Attribute,
  Element,
  Node,
  Text,
  XmlBuilderUtils,
  textNode,
} from "./xml/xml-builder-utils.js";

// Static-method shortcuts re-bound as locals (upstream uses
// `import static XmlBuilderUtils.teiElement` / `addXmlId`).
const teiElement = XmlBuilderUtils.teiElement.bind(XmlBuilderUtils);
const addXmlId = XmlBuilderUtils.addXmlId.bind(XmlBuilderUtils);

const LOGGER = getLogger("TEIFormatter");

// --- Local helpers mirroring commons-lang3 / Guava utilities used inline ---

/** Mirrors `org.apache.commons.lang3.StringUtils.isEmpty`. */
function isEmpty(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.length === 0;
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isNotEmpty`. */
function isNotEmpty(s: string | null | undefined): boolean {
  return !isEmpty(s);
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isBlank`. */
function isBlank(s: string | null | undefined): boolean {
  if (s === null || s === undefined) return true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r" && c !== "\f") return false;
  }
  return true;
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isNotBlank`. */
function isNotBlank(s: string | null | undefined): boolean {
  return !isBlank(s);
}

/** Mirrors `CollectionUtils.isEmpty`. */
function isCollectionEmpty<T>(c: T[] | Set<T> | null | undefined): boolean {
  if (c === null || c === undefined) return true;
  if (Array.isArray(c)) return c.length === 0;
  return (c as Set<T>).size === 0;
}

/** Mirrors `CollectionUtils.isNotEmpty`. */
function isCollectionNotEmpty<T>(c: T[] | Set<T> | null | undefined): boolean {
  return !isCollectionEmpty(c);
}

/** Mirrors `StringUtils.equalsAnyIgnoreCase(s, ...cases)`. */
function equalsAnyIgnoreCase(s: string | null, ...cases: string[]): boolean {
  if (s === null) {
    for (const c of cases) if (c === null) return true;
    return false;
  }
  const lower = s.toLowerCase();
  for (const c of cases) {
    if (c !== null && c !== undefined && c.toLowerCase() === lower) return true;
  }
  return false;
}

/** Java `Character.isUpperCase`. */
function isJavaUpperCase(c: string): boolean {
  return c >= "A" && c <= "Z";
}

/** Java `Character.isLowerCase`. */
function isJavaLowerCase(c: string): boolean {
  return c >= "a" && c <= "z";
}

// --- Inner enum hoisted to a top-level export ---

/**
 * Possible association to Grobid customised TEI schemas: DTD, XML schema,
 * RelaxNG or compact RelaxNG. `DEFAULT` means no schema association in the
 * generated XML documents.
 */
export enum SchemaDeclaration {
  DEFAULT = "DEFAULT",
  DTD = "DTD",
  XSD = "XSD",
  RNG = "RNG",
  RNC = "RNC",
}

// --- TEIFormatter ---

/**
 * Class for generating a TEI representation of a document.
 *
 * Upstream: org.grobid.core.document.TEIFormatter (~2682 LOC at tag 0.9.0).
 */
export class TEIFormatter {
  // Re-expose the nested enum so callers can write `TEIFormatter.SchemaDeclaration.XSD`.
  static readonly SchemaDeclaration = SchemaDeclaration;

  private doc: Document | null = null;
  private fullTextParser: FullTextParser | null = null;

  // Upstream uses `Sets.newHashSet(...)` of 4 TaggingLabels.
  static readonly MARKER_LABELS: Set<TaggingLabel> = new Set<TaggingLabel>([
    TaggingLabels.CITATION_MARKER,
    TaggingLabels.FIGURE_MARKER,
    TaggingLabels.TABLE_MARKER,
    TaggingLabels.EQUATION_MARKER,
  ]);

  // NOTE: upstream has a `Boolean inParagraph = false;` field that's read in
  // some places — preserved verbatim (currently unused after refactors).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private inParagraph: boolean = false;

  // NOTE: upstream `ArrayList<String> elements = null;` — never written, only
  // declared. Preserved as a field on the class.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private elements: string[] | null = null;

  // static variable for the position of italic and bold features in the CRF model
  private static readonly ITALIC_POS: number = 16;
  private static readonly BOLD_POS: number = 15;

  // private static Pattern numberRef = Pattern.compile("(\\[|\\()\\d+\\w?(\\)|\\])");
  // private static Pattern numberRefCompact =
  //         Pattern.compile("(\\[|\\()((\\d)+(\\w)?(\\-\\d+\\w?)?,\\s?)+(\\d+\\w?)(\\-\\d+\\w?)?(\\)|\\])");
  // private static Pattern numberRefCompact2 = Pattern.compile("(\\[|\\()(\\d+)(-|‒|–|—|―|–)(\\d+)(\\)|\\])");

  private static readonly startNum: RegExp = /^(\d+\.?\s)(.*)/;

  private static readonly SCHEMA_XSD_LOCATION: string =
    "https://raw.githubusercontent.com/kermitt2/grobid/master/grobid-home/schemas/xsd/Grobid.xsd";
  private static readonly SCHEMA_DTD_LOCATION: string =
    "https://raw.githubusercontent.com/kermitt2/grobid/master/grobid-home/schemas/dtd/Grobid.dtd";
  private static readonly SCHEMA_RNG_LOCATION: string =
    "https://raw.githubusercontent.com/kermitt2/grobid/master/grobid-home/schemas/rng/Grobid.rng";

  constructor(document: Document, fullTextParser: FullTextParser | null) {
    this.doc = document;
    this.fullTextParser = fullTextParser;
  }

  /**
   * Upstream overload 1: 6 args (default SchemaDeclaration.XSD).
   * Upstream overload 2: 7 args including SchemaDeclaration.
   */
  toTEIHeader(
    biblio: BiblioItem | null,
    defaultPublicationStatement: string | null,
    bds: BibDataSet[] | null,
    markerTypes: MarkerType[] | null,
    fundings: Funding[] | null,
    config: GrobidAnalysisConfig,
  ): string;
  toTEIHeader(
    biblio: BiblioItem | null,
    schemaDeclaration: SchemaDeclaration,
    defaultPublicationStatement: string | null,
    bds: BibDataSet[] | null,
    markerTypes: MarkerType[] | null,
    fundings: Funding[] | null,
    config: GrobidAnalysisConfig,
  ): string;
  toTEIHeader(
    biblio: BiblioItem | null,
    secondArg: SchemaDeclaration | string | null,
    thirdArg: string | BibDataSet[] | null,
    fourthArg: BibDataSet[] | MarkerType[] | null,
    fifthArg: MarkerType[] | Funding[] | null,
    sixthArg: Funding[] | GrobidAnalysisConfig | null,
    seventhArg?: GrobidAnalysisConfig,
  ): string {
    // Detect the 6-arg vs 7-arg shape: in the 6-arg form, `secondArg` is the
    // defaultPublicationStatement (string|null) — i.e. not a SchemaDeclaration.
    let schemaDeclaration: SchemaDeclaration;
    let defaultPublicationStatement: string | null;
    let bds: BibDataSet[] | null;
    let markerTypes: MarkerType[] | null;
    let fundings: Funding[] | null;
    let config: GrobidAnalysisConfig;

    if (seventhArg === undefined) {
      // 6-arg overload — default schema is XSD.
      schemaDeclaration = SchemaDeclaration.XSD;
      defaultPublicationStatement = secondArg as string | null;
      bds = thirdArg as BibDataSet[] | null;
      markerTypes = fourthArg as MarkerType[] | null;
      fundings = fifthArg as Funding[] | null;
      config = sixthArg as GrobidAnalysisConfig;
    } else {
      schemaDeclaration = secondArg as SchemaDeclaration;
      defaultPublicationStatement = thirdArg as string | null;
      bds = fourthArg as BibDataSet[] | null;
      markerTypes = fifthArg as MarkerType[] | null;
      fundings = sixthArg as Funding[] | null;
      config = seventhArg;
    }

    return this._toTEIHeaderImpl(
      biblio,
      schemaDeclaration,
      defaultPublicationStatement,
      bds,
      markerTypes,
      fundings,
      config,
    );
  }

  private _toTEIHeaderImpl(
    biblio: BiblioItem | null,
    schemaDeclaration: SchemaDeclaration,
    defaultPublicationStatement: string | null,
    bds: BibDataSet[] | null,
    markerTypes: MarkerType[] | null,
    fundings: Funding[] | null,
    config: GrobidAnalysisConfig,
  ): string {
    // markerTypes & bds are currently unused inside this method body upstream
    // (no direct references). They are forwarded by callers that share the
    // signature with downstream helpers. Preserved verbatim.
    void markerTypes;
    void bds;

    let tei = "";
    tei += "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    if (config.isWithXslStylesheet()) {
      tei += "<?xml-stylesheet type=\"text/xsl\" href=\"../jsp/xmlverbatimwrapper.xsl\"?> \n";
    }
    if (schemaDeclaration === SchemaDeclaration.DTD) {
      tei += "<!DOCTYPE TEI SYSTEM \"" + TEIFormatter.SCHEMA_DTD_LOCATION + "\">\n";
    } else if (schemaDeclaration === SchemaDeclaration.XSD) {
      // XML schema
      tei +=
        "<TEI xml:space=\"preserve\" xmlns=\"http://www.tei-c.org/ns/1.0\" \n" +
        "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" \n" +
        "xsi:schemaLocation=\"http://www.tei-c.org/ns/1.0 " +
        TEIFormatter.SCHEMA_XSD_LOCATION +
        "\"\n xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n";
      //				"\n xmlns:mml=\"http://www.w3.org/1998/Math/MathML\">\n");
    } else if (schemaDeclaration === SchemaDeclaration.RNG) {
      // standard RelaxNG
      tei +=
        "<?xml-model href=\"" +
        TEIFormatter.SCHEMA_RNG_LOCATION +
        "\" schematypens=\"http://relaxng.org/ns/structure/1.0\"?>\n";
    }

    // by default there is no schema association
    if (schemaDeclaration !== SchemaDeclaration.XSD) {
      tei += "<TEI xml:space=\"preserve\" xmlns=\"http://www.tei-c.org/ns/1.0\">\n";
    }

    const doc = this.doc!;

    if (doc.getLanguage() !== null) {
      tei += "\t<teiHeader xml:lang=\"" + doc.getLanguage() + "\">";
    } else {
      tei += "\t<teiHeader>";
    }

    tei += "\n\t\t<fileDesc>\n\t\t\t<titleStmt>\n\t\t\t\t<title level=\"a\" type=\"main\"";
    if (config.isGenerateTeiIds()) {
      const divID = KeyGen.getKey().substring(0, 7);
      tei += " xml:id=\"_" + divID + "\"";
    }

    if (config.isGenerateTeiCoordinates("title")) {
      const titleTokens = biblio !== null ? biblio.getLayoutTokensForLabel(TaggingLabels.HEADER_TITLE) : null;
      if (isCollectionNotEmpty(titleTokens)) {
        const coords = LayoutTokensUtil.getCoordsString(titleTokens!);
        tei += " coords=\"" + coords + "\"";
      }
    }

    tei += ">";

    if (biblio === null) {
      // if the biblio object is null, we simply create an empty one
      biblio = new BiblioItem();
    }

    if (biblio.getTitle() !== null) {
      tei += TextUtilities.HTMLEncode(biblio.getTitle());
    }

    tei += "</title>\n";

    if (isCollectionNotEmpty(fundings)) {
      // Map<String, Funder> funderSignatures = new TreeMap<>();
      const funderSignatures = new Map<string, Funder>();
      for (const funding of fundings!) {
        if (funding.getFunder() !== null && funding.getFunder()!.getFullName() !== null) {
          if (funderSignatures.get(funding.getFunder()!.getFullName()!) === undefined) {
            funderSignatures.set(funding.getFunder()!.getFullName()!, funding.getFunder()!);
          } else {
            funding.setFunder(funderSignatures.get(funding.getFunder()!.getFullName()!) ?? null);
          }
        }
      }

      const fundingRelation = new Map<Funder, Funding[]>();
      for (const funding of fundings!) {
        if (funding.getFunder() === null) {
          let localfundings = fundingRelation.get(Funder.EMPTY);
          if (localfundings === undefined) localfundings = [];
          localfundings.push(funding);
          fundingRelation.set(Funder.EMPTY, localfundings);
        } else {
          let localfundings = fundingRelation.get(funding.getFunder()!);
          if (localfundings === undefined) localfundings = [];
          localfundings.push(funding);
          fundingRelation.set(funding.getFunder()!, localfundings);
        }
      }

      const localFunders: Funder[] = [];
      for (const entry of fundingRelation) {
        localFunders.push(entry[0]);
      }

      let consolidatedFunders: Map<number, Funder> | null = null;
      if (config.getConsolidateFunders() !== 0) {
        consolidatedFunders = Consolidation.getInstance().consolidateFunders(localFunders);
      }

      let n = 0;
      for (const entry of fundingRelation) {
        let funderPiece: string | null = null;
        let consolidatedFunder: Funder | null = null;
        if (consolidatedFunders !== null) {
          consolidatedFunder = consolidatedFunders.get(n) ?? null;
        }

        if (consolidatedFunder !== null && config.getConsolidateFunders() === 1) {
          funderPiece = consolidatedFunder.toTEI(4);
        } else if (consolidatedFunder !== null && config.getConsolidateFunders() === 2) {
          const localFunder = entry[0];
          localFunder.setDoi(consolidatedFunder.getDoi());
          funderPiece = localFunder.toTEI(4);
        } else {
          funderPiece = entry[0].toTEI(4);
        }

        // inject funding ref in the funder entries
        let referenceString = "";
        for (const funderFunding of entry[1]) {
          if (funderFunding.isNonEmptyFunding())
            referenceString += " #" + funderFunding.getIdentifier();
        }

        if (funderPiece !== null) {
          if (referenceString.length > 0)
            funderPiece = funderPiece.replace(
              "<funder>",
              "<funder ref=\"" + referenceString.trim() + "\">",
            );
          tei += funderPiece;
        }
        n++;
      }
    }

    tei += "\t\t\t</titleStmt>\n";

    if (
      biblio.getPublisher() !== null ||
      biblio.getPublicationDate() !== null ||
      biblio.getNormalizedPublicationDate() !== null ||
      biblio.getCopyrightsLicense() !== null
    ) {
      tei += "\t\t\t<publicationStmt>\n";

      const copyrightsLicense = biblio.getCopyrightsLicense() as CopyrightsLicense | null;

      if (biblio.getPublisher() !== null) {
        // publisher and date under <publicationStmt> for better TEI conformance
        tei +=
          "\t\t\t\t<publisher>" + TextUtilities.HTMLEncode(biblio.getPublisher()) + "</publisher>\n";
      } else {
        // a dummy publicationStmt is still necessary according to TEI
        tei += "\t\t\t\t<publisher/>\n";
      }

      // copyrights/license block — preserved verbatim per upstream comments.
      if (copyrightsLicense !== null) {
        tei += "\t\t\t\t<availability ";

        let addCopyrightsComment = false;
        if (
          copyrightsLicense.getCopyrightsOwner() !== null &&
          copyrightsLicense.getCopyrightsOwner() !== CopyrightsOwner.UNDECIDED
        ) {
          tei +=
            "resp=\"" +
            CopyrightsOwner.getName(copyrightsLicense.getCopyrightsOwner()) +
            "\" ";
          addCopyrightsComment = true;
        }

        if (
          copyrightsLicense.getLicense() !== null &&
          copyrightsLicense.getLicense() !== License.UNDECIDED
        ) {
          tei += "status=\"restricted\">\n";
          if (addCopyrightsComment) {
            tei +=
              "\t\t\t\t\t<!-- the @rest attribute above gives the document copyrights owner (publisher, authors), if known -->\n";
          }
          tei +=
            "\t\t\t\t\t<licence>" +
            License.getName(copyrightsLicense.getLicense()) +
            "</licence>\n";
        } else {
          tei += " status=\"unknown\">\n";
          if (addCopyrightsComment) {
            tei +=
              "\t\t\t\t\t<!-- the @rest attribute above gives the document copyrights owner (publisher, authors), if known -->\n";
          }
          tei += "\t\t\t\t\t<licence/>\n";
        }

        if (
          (config as unknown as { getIncludeRawCopyrights(): boolean }).getIncludeRawCopyrights() &&
          biblio.getCopyright() !== null &&
          biblio.getCopyright()!.length > 0
        ) {
          tei += "\t\t\t\t\t<p type=\"raw\">";
          tei += TextUtilities.HTMLEncode(biblio.getCopyright());
          tei += "</p>\n";
        }

        tei += "\t\t\t\t</availability>\n";
      } else {
        tei += "\t\t\t\t<availability ";

        tei += " status=\"unknown\">\n";
        tei += "\t\t\t\t\t<licence/>\n";

        if (defaultPublicationStatement !== null) {
          tei +=
            "\t\t\t\t\t<p>" + TextUtilities.HTMLEncode(defaultPublicationStatement) + "</p>\n";
        }

        if (
          (config as unknown as { getIncludeRawCopyrights(): boolean }).getIncludeRawCopyrights() &&
          biblio.getCopyright() !== null &&
          biblio.getCopyright()!.length > 0
        ) {
          tei += "\t\t\t\t\t<p type=\"raw\">";
          tei += TextUtilities.HTMLEncode(biblio.getCopyright());
          tei += "</p>\n";
        }

        tei += "\t\t\t\t</availability>\n";
      }

      if (biblio.getNormalizedPublicationDate() !== null) {
        const date = biblio.getNormalizedPublicationDate()!;

        const when = GrobidDate.toISOString(date);
        if (isNotBlank(when)) {
          tei += "\t\t\t\t<date type=\"published\" when=\"";
          tei += when + "\">";
        } else {
          tei += "\t\t\t\t<date>";
        }

        if (biblio.getPublicationDate() !== null) {
          tei += TextUtilities.HTMLEncode(biblio.getPublicationDate());
        } else {
          tei += when;
        }
        tei += "</date>\n";
      } else if (biblio.getYear() !== null && biblio.getYear()!.length > 0) {
        let when = "";
        if (biblio.getYear()!.length === 1) when += "000" + biblio.getYear();
        else if (biblio.getYear()!.length === 2) when += "00" + biblio.getYear();
        else if (biblio.getYear()!.length === 3) when += "0" + biblio.getYear();
        else if (biblio.getYear()!.length === 4) when += biblio.getYear();

        if (biblio.getMonth() !== null && biblio.getMonth()!.length > 0) {
          if (biblio.getMonth()!.length === 1) when += "-0" + biblio.getMonth();
          else when += "-" + biblio.getMonth();
          if (biblio.getDay() !== null && biblio.getDay()!.length > 0) {
            if (biblio.getDay()!.length === 1) when += "-0" + biblio.getDay();
            else when += "-" + biblio.getDay();
          }
        }
        tei += "\t\t\t\t<date type=\"published\" when=\"";
        tei += when + "\">";
        if (biblio.getPublicationDate() !== null) {
          tei += TextUtilities.HTMLEncode(biblio.getPublicationDate());
        } else {
          tei += when;
        }
        tei += "</date>\n";
      } else if (biblio.getE_Year() !== null) {
        let when = "";
        if (biblio.getE_Year()!.length === 1) when += "000" + biblio.getE_Year();
        else if (biblio.getE_Year()!.length === 2) when += "00" + biblio.getE_Year();
        else if (biblio.getE_Year()!.length === 3) when += "0" + biblio.getE_Year();
        else if (biblio.getE_Year()!.length === 4) when += biblio.getE_Year();

        if (biblio.getE_Month() !== null) {
          if (biblio.getE_Month()!.length === 1) when += "-0" + biblio.getE_Month();
          else when += "-" + biblio.getE_Month();

          if (biblio.getE_Day() !== null) {
            if (biblio.getE_Day()!.length === 1) when += "-0" + biblio.getE_Day();
            else when += "-" + biblio.getE_Day();
          }
        }
        tei += "\t\t\t\t<date type=\"ePublished\" when=\"";
        tei += when + "\">";
        if (biblio.getPublicationDate() !== null) {
          tei += TextUtilities.HTMLEncode(biblio.getPublicationDate());
        } else {
          tei += when;
        }
        tei += "</date>\n";
      } else if (biblio.getPublicationDate() !== null) {
        tei += "\t\t\t\t<date type=\"published\">";
        tei += TextUtilities.HTMLEncode(biblio.getPublicationDate()) + "</date>";
      }
      tei += "\t\t\t</publicationStmt>\n";
    } else {
      tei += "\t\t\t<publicationStmt>\n";
      tei += "\t\t\t\t<publisher/>\n";
      tei += "\t\t\t\t<availability status=\"unknown\"><licence/></availability>\n";
      tei += "\t\t\t</publicationStmt>\n";
    }
    tei += "\t\t\t<sourceDesc>\n\t\t\t\t<biblStruct";
    if (biblio.getStatus() !== null) tei += " status=\"" + biblio.getStatus() + "\"";
    if (biblio.getConsolidationService() !== null)
      tei += " source=\"" + biblio.getConsolidationService() + "\"";
    tei += ">\n\t\t\t\t\t<analytic>\n";

    // authors + affiliation
    //biblio.createAuthorSet();
    //biblio.attachEmails();
    //biblio.attachAffiliations();

    tei += biblio.toTEIAuthorBlock(6, config);

    // title
    const title = biblio.getTitle();
    const language = biblio.getLanguage();
    const english_title = biblio.getEnglishTitle();
    if (title !== null) {
      tei += "\t\t\t\t\t\t<title";
      /*if ( (bookTitle == null) & (journal == null) )
              tei.append(" level=\"m\"");
          else */
      tei += " level=\"a\" type=\"main\"";

      if (config.isGenerateTeiIds()) {
        const divID = KeyGen.getKey().substring(0, 7);
        tei += " xml:id=\"_" + divID + "\"";
      }

      if (config.isGenerateTeiCoordinates("title")) {
        const titleTokens = biblio.getLayoutTokensForLabel(TaggingLabels.HEADER_TITLE);
        if (isCollectionNotEmpty(titleTokens)) {
          const coords = LayoutTokensUtil.getCoordsString(titleTokens!);
          tei += " coords=\"" + coords + "\"";
        }
      }

      // here check the language ?
      if (english_title === null)
        tei += ">" + TextUtilities.HTMLEncode(title) + "</title>\n";
      else
        tei +=
          " xml:lang=\"" + language + "\">" + TextUtilities.HTMLEncode(title) + "</title>\n";
    }

    let hasEnglishTitle = false;
    const generateIDs = config.isGenerateTeiIds();
    if (english_title !== null) {
      // here do check the language!
      const languageUtilities = LanguageUtilities.getInstance();
      const resLang = languageUtilities.runLanguageId(english_title);

      if (resLang !== null) {
        const resL = resLang.getLang();
        if (resL === Language.EN) {
          hasEnglishTitle = true;
          tei += "\t\t\t\t\t\t<title";
          //if ( (bookTitle == null) & (journal == null) )
          //	tei.append(" level=\"m\"");
          //else
          tei += " level=\"a\"";
          if (generateIDs) {
            const divID = KeyGen.getKey().substring(0, 7);
            tei += " xml:id=\"_" + divID + "\"";
          }
          tei +=
            " xml:lang=\"en\">" +
            TextUtilities.HTMLEncode(english_title) +
            "</title>\n";
        }
      }
      // if it's not something in English, we will write it anyway as note without type at the end
    }

    tei += "\t\t\t\t\t</analytic>\n";

    if (
      biblio.getJournal() !== null ||
      biblio.getJournalAbbrev() !== null ||
      biblio.getISSN() !== null ||
      biblio.getISSNe() !== null ||
      biblio.getPublisher() !== null ||
      biblio.getPublicationDate() !== null ||
      biblio.getVolumeBlock() !== null ||
      biblio.getItem() === BiblioItem.Periodical ||
      biblio.getItem() === BiblioItem.InProceedings ||
      biblio.getItem() === BiblioItem.Proceedings ||
      biblio.getItem() === BiblioItem.InBook ||
      biblio.getItem() === BiblioItem.Book ||
      biblio.getItem() === BiblioItem.Serie ||
      biblio.getItem() === BiblioItem.InCollection
    ) {
      tei += "\t\t\t\t\t<monogr";
      tei += ">\n";

      if (biblio.getJournal() !== null) {
        tei += "\t\t\t\t\t\t<title level=\"j\" type=\"main\"";
        if (generateIDs) {
          const divID = KeyGen.getKey().substring(0, 7);
          tei += " xml:id=\"_" + divID + "\"";
        }
        tei += ">" + TextUtilities.HTMLEncode(biblio.getJournal()) + "</title>\n";
      } else if (biblio.getBookTitle() !== null) {
        tei += "\t\t\t\t\t\t<title level=\"m\"";
        if (generateIDs) {
          const divID = KeyGen.getKey().substring(0, 7);
          tei += " xml:id=\"_" + divID + "\"";
        }
        tei += ">" + TextUtilities.HTMLEncode(biblio.getBookTitle()) + "</title>\n";
      }

      if (biblio.getJournalAbbrev() !== null) {
        tei +=
          "\t\t\t\t\t\t<title level=\"j\" type=\"abbrev\">" +
          TextUtilities.HTMLEncode(biblio.getJournalAbbrev()) +
          "</title>\n";
      }

      if (biblio.getISSN() !== null) {
        tei +=
          "\t\t\t\t\t\t<idno type=\"ISSN\">" +
          TextUtilities.HTMLEncode(biblio.getISSN()) +
          "</idno>\n";
      }

      if (biblio.getISSNe() !== null) {
        if (biblio.getISSNe() !== biblio.getISSN())
          tei +=
            "\t\t\t\t\t\t<idno type=\"eISSN\">" +
            TextUtilities.HTMLEncode(biblio.getISSNe()) +
            "</idno>\n";
      }

      //            if (biblio.getEvent() != null) {
      //                // TODO:
      //            }

      // in case the book title corresponds to a proceedings, we can try to indicate the meeting title
      let meeting: string | null = biblio.getBookTitle();
      let meetLoc = false;
      if (biblio.getEvent() !== null) meeting = biblio.getEvent();
      else if (meeting !== null) {
        meeting = meeting.trim();
        for (const prefix of BiblioItem.confPrefixes) {
          if (meeting.startsWith(prefix)) {
            meeting = meeting.replace(prefix, "");
            meeting = meeting.trim();
            tei += "\t\t\t\t\t\t<meeting>" + TextUtilities.HTMLEncode(meeting);
            if (
              biblio.getLocation() !== null ||
              biblio.getTown() !== null ||
              biblio.getCountry() !== null
            ) {
              tei += " <address>";
              if (biblio.getTown() !== null) {
                tei +=
                  "<settlement>" +
                  TextUtilities.HTMLEncode(biblio.getTown()) +
                  "</settlement>";
              }
              if (biblio.getCountry() !== null) {
                tei +=
                  "<country>" +
                  TextUtilities.HTMLEncode(biblio.getCountry()) +
                  "</country>";
              }
              if (
                biblio.getLocation() !== null &&
                biblio.getTown() === null &&
                biblio.getCountry() === null
              ) {
                tei +=
                  "<addrLine>" +
                  TextUtilities.HTMLEncode(biblio.getLocation()) +
                  "</addrLine>";
              }
              tei += "</address>\n";
              meetLoc = true;
            }
            tei += "\t\t\t\t\t\t</meeting>\n";
            break;
          }
        }
      }

      if (
        (biblio.getLocation() !== null ||
          biblio.getTown() !== null ||
          biblio.getCountry() !== null) &&
        !meetLoc
      ) {
        tei += "\t\t\t\t\t\t<meeting>";
        tei += " <address>";
        if (biblio.getTown() !== null) {
          tei +=
            " <settlement>" + TextUtilities.HTMLEncode(biblio.getTown()) + "</settlement>";
        }
        if (biblio.getCountry() !== null) {
          tei += " <country>" + TextUtilities.HTMLEncode(biblio.getCountry()) + "</country>";
        }
        if (
          biblio.getLocation() !== null &&
          biblio.getTown() === null &&
          biblio.getCountry() === null
        ) {
          tei +=
            "<addrLine>" + TextUtilities.HTMLEncode(biblio.getLocation()) + "</addrLine>";
        }
        tei += "</address>\n";
        tei += "\t\t\t\t\t\t</meeting>\n";
      }

      const pageRange = biblio.getPageRange();

      if (
        biblio.getVolumeBlock() !== null ||
        biblio.getPublicationDate() !== null ||
        biblio.getNormalizedPublicationDate() !== null ||
        pageRange !== null ||
        biblio.getIssue() !== null ||
        biblio.getBeginPage() !== -1 ||
        biblio.getPublisher() !== null
      ) {
        tei += "\t\t\t\t\t\t<imprint>\n";

        if (biblio.getPublisher() !== null) {
          tei +=
            "\t\t\t\t\t\t\t<publisher>" +
            TextUtilities.HTMLEncode(biblio.getPublisher()) +
            "</publisher>\n";
        }

        if (biblio.getVolumeBlock() !== null) {
          let vol = biblio.getVolumeBlock()!;
          vol = vol.replace(/ /g, "").trim();
          tei +=
            "\t\t\t\t\t\t\t<biblScope unit=\"volume\">" +
            TextUtilities.HTMLEncode(vol) +
            "</biblScope>\n";
        }

        if (biblio.getIssue() !== null) {
          tei +=
            "\t\t\t\t\t\t\t<biblScope unit=\"issue\">" +
            TextUtilities.HTMLEncode(biblio.getIssue()) +
            "</biblScope>\n";
        }

        if (pageRange !== null) {
          // NOTE: upstream uses `new StringTokenizer(pageRange, "--")` which
          // treats the delimiter as a SET of characters — "--" is functionally
          // identical to "-". Already catalogued in UPSTREAM-BUGS.md.
          const tokens = pageRange.split(/-+/).filter((t) => t.length > 0);
          if (tokens.length === 2) {
            tei += "\t\t\t\t\t\t\t<biblScope unit=\"page\"";
            tei += " from=\"" + TextUtilities.HTMLEncode(tokens[0]!) + "\"";
            tei += " to=\"" + TextUtilities.HTMLEncode(tokens[1]!) + "\"/>\n";
            //tei.append(">" + TextUtilities.HTMLEncode(pageRange) + "</biblScope>\n");
          } else {
            tei +=
              "\t\t\t\t\t\t\t<biblScope unit=\"page\">" +
              TextUtilities.HTMLEncode(pageRange) +
              "</biblScope>\n";
          }
        } else if (biblio.getBeginPage() !== -1) {
          if (biblio.getEndPage() !== -1) {
            tei += "\t\t\t\t\t\t\t<biblScope unit=\"page\"";
            tei += " from=\"" + biblio.getBeginPage() + "\"";
            tei += " to=\"" + biblio.getEndPage() + "\"/>\n";
          } else {
            tei += "\t\t\t\t\t\t\t<biblScope unit=\"page\"";
            tei += " from=\"" + biblio.getBeginPage() + "\"/>\n";
          }
        }

        if (biblio.getNormalizedPublicationDate() !== null) {
          const date = biblio.getNormalizedPublicationDate()!;

          const when = GrobidDate.toISOString(date);
          if (isNotBlank(when)) {
            if (biblio.getPublicationDate() !== null) {
              tei += "\t\t\t\t\t\t\t<date type=\"published\" when=\"";
              tei += when + "\">";
              tei += TextUtilities.HTMLEncode(biblio.getPublicationDate()) + "</date>\n";
            } else {
              tei += "\t\t\t\t\t\t\t<date type=\"published\" when=\"";
              tei += when + "\" />\n";
            }
          } else {
            if (biblio.getPublicationDate() !== null) {
              tei += "\t\t\t\t\t\t\t<date type=\"published\">";
              tei += TextUtilities.HTMLEncode(biblio.getPublicationDate()) + "</date>\n";
            }
          }
        } else if (biblio.getYear() !== null) {
          let when = "";
          if (biblio.getYear()!.length === 1) when += "000" + biblio.getYear();
          else if (biblio.getYear()!.length === 2) when += "00" + biblio.getYear();
          else if (biblio.getYear()!.length === 3) when += "0" + biblio.getYear();
          else if (biblio.getYear()!.length === 4) when += biblio.getYear();

          if (biblio.getMonth() !== null) {
            if (biblio.getMonth()!.length === 1) when += "-0" + biblio.getMonth();
            else when += "-" + biblio.getMonth();
            if (biblio.getDay() !== null) {
              if (biblio.getDay()!.length === 1) when += "-0" + biblio.getDay();
              else when += "-" + biblio.getDay();
            }
          }
          if (biblio.getPublicationDate() !== null) {
            tei += "\t\t\t\t\t\t\t<date type=\"published\" when=\"";
            tei += when + "\">";
            tei += TextUtilities.HTMLEncode(biblio.getPublicationDate()) + "</date>\n";
          } else {
            tei += "\t\t\t\t\t\t\t<date type=\"published\" when=\"";
            tei += when + "\" />\n";
          }
        } else if (biblio.getE_Year() !== null) {
          let when = "";
          if (biblio.getE_Year()!.length === 1) when += "000" + biblio.getE_Year();
          else if (biblio.getE_Year()!.length === 2) when += "00" + biblio.getE_Year();
          else if (biblio.getE_Year()!.length === 3) when += "0" + biblio.getE_Year();
          else if (biblio.getE_Year()!.length === 4) when += biblio.getE_Year();

          if (biblio.getE_Month() !== null) {
            if (biblio.getE_Month()!.length === 1) when += "-0" + biblio.getE_Month();
            else when += "-" + biblio.getE_Month();

            if (biblio.getE_Day() !== null) {
              if (biblio.getE_Day()!.length === 1) when += "-0" + biblio.getE_Day();
              else when += "-" + biblio.getE_Day();
            }
          }
          tei += "\t\t\t\t\t\t\t<date type=\"ePublished\" when=\"";
          tei += when + "\" />\n";
        } else if (biblio.getPublicationDate() !== null) {
          tei += "\t\t\t\t\t\t\t<date type=\"published\">";
          tei += TextUtilities.HTMLEncode(biblio.getPublicationDate()) + "</date>\n";
        }

        // Fix for issue #31
        tei += "\t\t\t\t\t\t</imprint>\n";
      }
      tei += "\t\t\t\t\t</monogr>\n";
    } else {
      tei += "\t\t\t\t\t<monogr>\n";
      tei += "\t\t\t\t\t\t<imprint>\n";
      tei += "\t\t\t\t\t\t\t<date/>\n";
      tei += "\t\t\t\t\t\t</imprint>\n";
      tei += "\t\t\t\t\t</monogr>\n";
    }

    if (!isEmpty(doc.getMD5())) {
      tei += "\t\t\t\t\t<idno type=\"MD5\">" + doc.getMD5() + "</idno>\n";
    }

    if (!isEmpty(biblio.getDOI())) {
      let theDOI = TextUtilities.HTMLEncode(biblio.getDOI())!;
      if (theDOI.endsWith(".xml")) {
        theDOI = theDOI.replace(".xml", "");
      }
      tei += "\t\t\t\t\t<idno type=\"DOI\">" + TextUtilities.HTMLEncode(theDOI) + "</idno>\n";
    }

    if (!isEmpty(biblio.getHalId())) {
      tei +=
        "\t\t\t\t\t<idno type=\"halId\">" +
        TextUtilities.HTMLEncode(biblio.getHalId()) +
        "</idno>\n";
    }

    if (!isEmpty(biblio.getArXivId())) {
      tei +=
        "\t\t\t\t\t<idno type=\"arXiv\">" +
        TextUtilities.HTMLEncode(biblio.getArXivId()) +
        "</idno>\n";
    }

    if (!isEmpty(biblio.getPMID())) {
      tei +=
        "\t\t\t\t\t<idno type=\"PMID\">" +
        TextUtilities.HTMLEncode(biblio.getPMID()) +
        "</idno>\n";
    }

    if (!isEmpty(biblio.getPMCID())) {
      tei +=
        "\t\t\t\t\t<idno type=\"PMCID\">" +
        TextUtilities.HTMLEncode(biblio.getPMCID()) +
        "</idno>\n";
    }

    if (!isEmpty(biblio.getPII())) {
      tei +=
        "\t\t\t\t\t<idno type=\"PII\">" + TextUtilities.HTMLEncode(biblio.getPII()) + "</idno>\n";
    }

    if (!isEmpty(biblio.getArk())) {
      tei +=
        "\t\t\t\t\t<idno type=\"ark\">" + TextUtilities.HTMLEncode(biblio.getArk()) + "</idno>\n";
    }

    if (!isEmpty(biblio.getIstexId())) {
      tei +=
        "\t\t\t\t\t<idno type=\"istexId\">" +
        TextUtilities.HTMLEncode(biblio.getIstexId()) +
        "</idno>\n";
    }

    if (!isEmpty(biblio.getOAURL())) {
      tei +=
        "\t\t\t\t\t<ptr type=\"open-access\" target=\"" +
        TextUtilities.HTMLEncode(biblio.getOAURL()) +
        "\" />\n";
    }

    if (biblio.getSubmission() !== null) {
      tei +=
        "\t\t\t\t\t<note type=\"submission\">" +
        TextUtilities.HTMLEncode(biblio.getSubmission()) +
        "</note>\n";
    }

    if (biblio.getDedication() !== null) {
      tei +=
        "\t\t\t\t\t<note type=\"dedication\">" +
        TextUtilities.HTMLEncode(biblio.getDedication()) +
        "</note>\n";
    }

    // NOTE: upstream bug — `&` (bitwise) instead of `&&` (logical). Operands
    // are booleans here so semantics survive but it's a latent type bug.
    if (english_title !== null && !hasEnglishTitle) {
      tei += "\t\t\t\t\t<note type=\"title\"";
      if (generateIDs) {
        const divID = KeyGen.getKey().substring(0, 7);
        tei += " xml:id=\"_" + divID + "\"";
      }
      tei += ">" + TextUtilities.HTMLEncode(english_title) + "</note>\n";
    }

    if (biblio.getNote() !== null) {
      tei += "\t\t\t\t\t<note";
      if (generateIDs) {
        const divID = KeyGen.getKey().substring(0, 7);
        tei += " xml:id=\"_" + divID + "\"";
      }
      tei += ">" + TextUtilities.HTMLEncode(biblio.getNote()) + "</note>\n";
    }

    tei += "\t\t\t\t</biblStruct>\n";

    if (biblio.getURL() !== null) {
      tei += "\t\t\t\t<ref target=\"" + biblio.getURL() + "\" />\n";
    }

    tei += "\t\t\t</sourceDesc>\n";

    // We collect the discarded text from the header and add it as a <noteStmt>
    if (config.isIncludeDiscardedText()) {
      const locationTextNotProcessed: TaggingLabel[] = [
        SegmentationLabels.OTHER,
        // SegmentationLabels.PAGE_NUMBER,
        // SegmentationLabels.HEADNOTE,
        // SegmentationLabels.COVER
      ];

      const discardedTextElsewhere: LayoutToken[][] = [];
      for (const label of locationTextNotProcessed) {
        const docPieces = doc.getDocumentPart(label);
        if (docPieces === null) continue;
        for (const docPiece of docPieces) {
          const tokens = doc.getDocumentPieceTokenization(docPiece);
          if (isCollectionEmpty(tokens)) continue;
          discardedTextElsewhere.push(tokens);
        }
      }

      if (
        isCollectionNotEmpty(biblio.getDiscardedPiecesTokens()) ||
        isCollectionNotEmpty(discardedTextElsewhere)
      ) {
        tei += "\t\t\t<notesStmt>\n";
        for (const discardedPieceTokens of biblio.getDiscardedPiecesTokens()!) {
          tei += "\t\t\t\t";
          tei += TEIFormatter.generateDiscardedTextNote(
            discardedPieceTokens,
            doc,
            this,
            config,
          ).toXML();
          tei += "\n";
        }

        for (const discardedPieceTokens of discardedTextElsewhere) {
          tei += "\t\t\t\t";
          tei += TEIFormatter.generateDiscardedTextNote(
            discardedPieceTokens,
            doc,
            this,
            config,
          ).toXML();
          tei += "\n";
        }

        tei += "\t\t\t</notesStmt>\n";
      }
    }

    tei += "\t\t</fileDesc>\n";

    // encodingDesc gives info about the producer of the file
    tei += "\t\t<encodingDesc>\n";
    tei += "\t\t\t<appInfo>\n";

    // Java: TimeZone.getTimeZone("UTC"); SimpleDateFormat("yyyy-MM-dd'T'HH:mmZ"); format(new Date())
    // We emit the same shape: yyyy-MM-ddTHH:mm+0000
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const MM = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const HH = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const dateISOString = yyyy + "-" + MM + "-" + dd + "T" + HH + ":" + mm + "+0000";

    tei +=
      "\t\t\t\t<application version=\"" +
      GrobidProperties.getVersion() +
      "\" ident=\"GROBID\" when=\"" +
      dateISOString +
      "\">\n";
    tei +=
      "\t\t\t\t\t<desc>GROBID - A machine learning software for extracting information from scholarly documents</desc>\n";
    tei +=
      "\t\t\t\t\t<label type=\"revision\">" +
      GrobidProperties.getRevision() +
      "</label>\n";
    tei +=
      "\t\t\t\t\t<label type=\"parameters\">" +
      config.toStringTEI() +
      "</label>\n";
    tei += "\t\t\t\t\t<ref target=\"https://github.com/kermitt2/grobid\"/>\n";
    tei += "\t\t\t\t</application>\n";
    tei += "\t\t\t</appInfo>\n";
    tei += "\t\t</encodingDesc>\n";

    let textClassWritten = false;

    tei += "\t\t<profileDesc>\n";

    // keywords here !! Normally the keyword field has been preprocessed
    // if the segmentation into individual keywords worked, the first conditional
    // statement will be used - otherwise the whole keyword field is outputted
    if (isCollectionNotEmpty(biblio.getKeywords())) {
      textClassWritten = true;
      tei += "\t\t\t<textClass>\n";
      tei += "\t\t\t\t<keywords>\n";

      const keywords: Keyword[] = biblio.getKeywords()!;
      let pos = 0;
      for (const keyw of keywords) {
        if (isBlank(keyw.getKeyword())) continue;
        let res = keyw.getKeyword()!.trim();
        if (res.startsWith(":")) {
          res = res.substring(1);
        }
        if (pos === keywords.length - 1) {
          if (res.endsWith(".")) {
            res = res.substring(0, res.length - 1);
          }
        }
        tei += "\t\t\t\t\t<term";
        if (generateIDs) {
          const divID = KeyGen.getKey().substring(0, 7);
          tei += " xml:id=\"_" + divID + "\"";
        }
        tei += ">" + TextUtilities.HTMLEncode(res) + "</term>\n";
        pos++;
      }
      tei += "\t\t\t\t</keywords>\n";
    } else if (biblio.getKeyword() !== null) {
      textClassWritten = true;
      tei += "\t\t\t<textClass>\n";
      tei += "\t\t\t\t<keywords";

      if (generateIDs) {
        const divID = KeyGen.getKey().substring(0, 7);
        tei += " xml:id=\"_" + divID + "\"";
      }
      tei += ">";
      tei += TextUtilities.HTMLEncode(biblio.getKeyword());
      tei += "</keywords>\n";
    }

    if (biblio.getCategories() !== null) {
      if (!textClassWritten) {
        textClassWritten = true;
        tei += "\t\t\t<textClass>\n";
      }
      const categories: string[] = biblio.getCategories()!;
      tei += "\t\t\t\t<keywords>";
      for (const category of categories) {
        tei += "\t\t\t\t\t<term";
        if (generateIDs) {
          const divID = KeyGen.getKey().substring(0, 7);
          tei += " xml:id=\"_" + divID + "\"";
        }
        tei += ">" + TextUtilities.HTMLEncode(category.trim()) + "</term>\n";
      }
      tei += "\t\t\t\t</keywords>\n";
    }

    if (textClassWritten) tei += "\t\t\t</textClass>\n";

    const abstractText = biblio.getAbstract();

    let resLang: Language | null = null;
    if (abstractText !== null) {
      const languageUtilities = LanguageUtilities.getInstance();
      resLang = languageUtilities.runLanguageId(abstractText);
    }
    if (resLang !== null) {
      const resL = resLang.getLang();
      if (resL !== doc.getLanguage()) {
        tei += "\t\t\t<abstract xml:lang=\"" + resL + "\">\n";
      } else {
        tei += "\t\t\t<abstract>\n";
      }
    } else if (abstractText === null || abstractText.length === 0) {
      tei += "\t\t\t<abstract/>\n";
    } else {
      tei += "\t\t\t<abstract>\n";
    }

    if (isNotBlank(abstractText)) {
      if (isNotBlank(biblio.getLabeledAbstract())) {
        // we have available structured abstract, which can be serialized as a full text "piece"
        let buffer = "";
        try {
          buffer = this.toTEITextPiece(
            buffer,
            biblio.getLabeledAbstract()!,
            biblio,
            bds,
            false,
            new LayoutTokenization(biblio.getLayoutTokensForLabel(TaggingLabels.HEADER_ABSTRACT)!),
            null,
            null,
            null,
            null,
            markerTypes,
            doc,
            config,
          ); // no figure, no table, no equation
        } catch (e) {
          throw new GrobidException(
            "An exception occurred while serializing TEI.",
            e instanceof Error ? e : new Error(String(e)),
          );
        }
        tei += buffer;
      } else {
        tei += "\t\t\t\t<p";
        if (generateIDs) {
          const divID = KeyGen.getKey().substring(0, 7);
          tei += " xml:id=\"_" + divID + "\"";
        }
        tei += ">" + TextUtilities.HTMLEncode(abstractText) + "</p>";
      }

      tei += "\n\t\t\t</abstract>\n";
    }

    tei += "\t\t</profileDesc>\n";

    // NOTE: upstream uses `|` (bitwise OR) instead of `||` (logical) — preserved.
    if (
      biblio.getA_Year() !== null ||
      biblio.getS_Year() !== null ||
      biblio.getSubmissionDate() !== null ||
      biblio.getNormalizedSubmissionDate() !== null
    ) {
      tei += "\t\t<revisionDesc>\n";
    }

    // submission and other review dates here !
    if (biblio.getA_Year() !== null) {
      let when = biblio.getA_Year()!;
      if (biblio.getA_Month() !== null) {
        when += "-" + biblio.getA_Month();
        if (biblio.getA_Day() !== null) {
          when += "-" + biblio.getA_Day();
        }
      }
      tei += "\t\t\t\t<date type=\"accepted\" when=\"";
      tei += when + "\" />\n";
    }
    if (biblio.getNormalizedSubmissionDate() !== null) {
      const date = biblio.getNormalizedSubmissionDate()!;
      const year = date.getYear();
      const month = date.getMonth();
      const day = date.getDay();

      let when = "" + year;
      if (month !== -1) {
        when += "-" + month;
        if (day !== -1) {
          when += "-" + day;
        }
      }
      tei += "\t\t\t\t<date type=\"submission\" when=\"";
      tei += when + "\" />\n";
    } else if (biblio.getS_Year() !== null) {
      let when = biblio.getS_Year()!;
      if (biblio.getS_Month() !== null) {
        when += "-" + biblio.getS_Month();
        if (biblio.getS_Day() !== null) {
          when += "-" + biblio.getS_Day();
        }
      }
      tei += "\t\t\t\t<date type=\"submission\" when=\"";
      tei += when + "\" />\n";
    } else if (biblio.getSubmissionDate() !== null) {
      tei +=
        "\t\t\t<date type=\"submission\">" +
        TextUtilities.HTMLEncode(biblio.getSubmissionDate()) +
        "</date>\n";

      /*tei.append("\t\t\t<change when=\"");
      tei.append(TextUtilities.HTMLEncode(biblio.getSubmissionDate()));
      tei.append("\">Submitted</change>\n");
      */
    }
    // Fixed from upstream: the open test (above) includes
    // `getNormalizedSubmissionDate()` but the close test omitted it,
    // so a paper with ONLY a normalized submission date would emit
    // `<revisionDesc>` without ever closing it (malformed XML).
    // Mirror the open test exactly. Also: upstream uses `|` (bitwise OR)
    // — kept as logical `||` here since operands are booleans.
    if (
      biblio.getA_Year() !== null ||
      biblio.getS_Year() !== null ||
      biblio.getSubmissionDate() !== null ||
      biblio.getNormalizedSubmissionDate() !== null
    ) {
      tei += "\t\t</revisionDesc>\n";
    }

    tei += "\t</teiHeader>\n";

    // output pages dimensions in the case coordinates will also be provided for some structures
    try {
      tei = this.toTEIPages(tei, doc, config);
    } catch (e) {
      LOGGER.warn("Problem when serializing page size", e);
    }

    if (doc.getLanguage() !== null) {
      tei += "\t<text xml:lang=\"" + doc.getLanguage() + "\">\n";
    } else {
      tei += "\t<text>\n";
    }

    return tei;
  }

  static generateDiscardedTextNote(
    discardedPieceTokens: LayoutToken[],
    doc: Document,
    formatter: TEIFormatter,
    config: GrobidAnalysisConfig,
  ): Element {
    // Iterables.getFirst(list, null) → list[0] ?? null
    const first: LayoutToken | null = discardedPieceTokens[0] ?? null;
    const place =
      first === null || isCollectionEmpty(first.getLabels())
        ? "unknown"
        : first.getLabels()[0]!.getGrobidModel().getModelName();

    const note = XmlBuilderUtils.teiElement("note");
    note.addAttribute(new Attribute("type", "other"));
    note.addAttribute(new Attribute("place", place));
    const p = teiElement("p");
    note.appendChild(p);

    if (config.isGenerateTeiIds()) {
      let divID = KeyGen.getKey().substring(0, 7);
      addXmlId(note, "_" + divID);
      divID = KeyGen.getKey().substring(0, 7);
      addXmlId(p, "_" + divID);
    }

    p.appendChild(
      LayoutTokensUtil.normalizeText(LayoutTokensUtil.toText(discardedPieceTokens)).trim(),
    );
    if (config.isWithSentenceSegmentation()) {
      // we need a sentence segmentation of the table caption
      formatter.segmentIntoSentences(
        p,
        discardedPieceTokens,
        config,
        doc.getLanguage(),
        doc.getPDFAnnotations(),
      );
    }

    if (config.isGenerateTeiCoordinates("note")) {
      const coords = LayoutTokensUtil.getCoordsString(discardedPieceTokens);
      note.addAttribute(new Attribute("coords", coords));
    }

    return note;
  }

  /**
   * TEI formatting of the body where only basic logical document structures are present.
   * This TEI format avoids most of the risks of ill-formed TEI due to structure recognition
   * errors and frequent PDF noises.
   * It is adapted to fully automatic process and simple exploitation of the document structures
   * like structured indexing and search.
   */
  async toTEIBody(
    buffer: string,
    result: string | null,
    biblio: BiblioItem | null,
    bds: BibDataSet[] | null,
    layoutTokenization: LayoutTokenization | null,
    figures: Figure[] | null,
    tables: Table[] | null,
    equations: Equation[] | null,
    markerTypes: MarkerType[] | null,
    doc: Document,
    config: GrobidAnalysisConfig,
  ): Promise<string> {
    if (
      result === null ||
      layoutTokenization === null ||
      layoutTokenization.getTokenization() === null
    ) {
      buffer += "\t\t<body/>\n";
      return buffer;
    }
    buffer += "\t\t<body>\n";

    const notes = this.getTeiNotes(doc);

    buffer = this.toTEITextPiece(
      buffer,
      result,
      biblio,
      bds,
      true,
      layoutTokenization,
      figures,
      tables,
      equations,
      notes,
      markerTypes,
      doc,
      config,
    );

    // notes are still in the body
    buffer = await this.toTEINote(buffer, notes, doc, markerTypes, config);

    buffer += "\t\t</body>\n";

    return buffer;
  }

  protected getTeiNotes(doc: Document): Note[] {
    // There are two types of structured notes currently supported, foot notes and margin notes.
    // We consider that head notes are always only presentation matter and are never references
    // in a text body.

    let documentNoteParts = doc.getDocumentPart(SegmentationLabels.FOOTNOTE);
    const notes = this.getTeiNotesInner(doc, documentNoteParts, NoteType.FOOT);

    documentNoteParts = doc.getDocumentPart(SegmentationLabels.MARGINNOTE);
    const marginNotes = this.getTeiNotesInner(doc, documentNoteParts, NoteType.MARGIN);
    for (const n of marginNotes) notes.push(n);

    return notes;
  }

  protected getTeiNotesInner(
    doc: Document,
    documentNoteParts: Set<DocumentPiece> | null,
    noteType: NoteType,
  ): Note[] {
    const notes: Note[] = [];
    if (documentNoteParts === null) {
      return notes;
    }

    const allNotes: string[] = [];

    for (const docPiece of documentNoteParts) {
      const noteTokens = doc.getDocumentPieceTokenization(docPiece);
      if (isCollectionEmpty(noteTokens)) {
        continue;
      }

      let footText = doc.getDocumentPieceText(docPiece);
      footText = footText.replace(/\n/g, " ");
      //footText = footText.replace("  ", " ").trim();
      if (footText.length < 6) continue;
      if (allNotes.indexOf(footText) !== -1) {
        // basically we have here the "recurrent" headnote/footnote for each page,
        // no need to add them several times (in the future we could even use them
        // differently combined with the header)
        continue;
      }

      allNotes.push(footText);

      const localNotes = this.makeNotes(noteTokens, footText, noteType, notes.length);
      if (localNotes !== null) {
        for (const ln of localNotes) notes.push(ln);
      }
    }

    notes.forEach((n) => n.setText(TextUtilities.dehyphenize(n.getText() ?? "")));

    return notes;
  }

  protected makeNotes(
    noteTokens: LayoutToken[],
    footText: string | null,
    noteType: NoteType,
    startIndex: number,
  ): Note[] | null {
    if (footText === null) return null;

    const notes: Note[] = [];

    const m = TEIFormatter.startNum.exec(footText);
    let currentNumber = -1;
    // this string represents the possible characters after a note number (usually nothing or a dot)
    let sugarText: string | null = null;
    if (m !== null) {
      const groupStr = m[1]!;
      footText = m[2]!;
      try {
        if (groupStr.indexOf(".") !== -1) sugarText = ".";
        let groupStrNormalized = groupStr.replace(/\./g, "");
        groupStrNormalized = groupStrNormalized.trim();
        const parsed = parseInt(groupStrNormalized, 10);
        if (!Number.isNaN(parsed)) {
          currentNumber = parsed;
        } else {
          // Java throws NumberFormatException; we mirror via catch path.
          throw new Error("NumberFormatException");
        }

        // remove this number from the layout tokens of the note
        if (currentNumber !== -1) {
          let toConsume = groupStr;
          let start = 0;
          for (const token of noteTokens) {
            if (isEmpty(token.getText())) {
              continue;
            }
            if (toConsume.startsWith(token.getText()!)) {
              start++;
              toConsume = toConsume.substring(token.getText()!.length);
            } else break;

            if (isEmpty(toConsume)) break;
          }
          if (start !== 0) {
            noteTokens = noteTokens.slice(start, noteTokens.length);
          }
        }
      } catch (_e) {
        currentNumber = -1;
      }
    }

    let localNote: Note | null = null;
    if (currentNumber === -1) localNote = new Note(null, noteTokens, footText, noteType);
    else localNote = new Note("" + currentNumber, noteTokens, footText, noteType);

    notes.push(localNote);

    // add possible subsequent notes concatenated in the same note sequence
    if (currentNumber !== -1) {
      let nextLabel = " " + (currentNumber + 1);
      // sugar characters after note number must be consistent with the previous ones to avoid false match
      if (sugarText !== null) nextLabel += sugarText;

      const nextFootnoteLabelIndex = footText.indexOf(nextLabel);
      if (nextFootnoteLabelIndex !== -1) {
        // optionally we could restrict here to superscript numbers
        // review local note
        localNote.setText(footText.substring(0, nextFootnoteLabelIndex));
        let pos = 0;
        const previousNoteTokens: LayoutToken[] = [];
        const nextNoteTokens: LayoutToken[] = [];
        for (const localToken of noteTokens) {
          if (isEmpty(localToken.getText())) continue;
          pos += localToken.getText()!.length;
          if (pos <= nextFootnoteLabelIndex + 1) {
            previousNoteTokens.push(localToken);
          } else {
            nextNoteTokens.push(localToken);
          }
        }
        localNote.setTokens(previousNoteTokens);
        const nextFootText = footText.substring(nextFootnoteLabelIndex + 1);

        // process the concatenated note
        if (isCollectionNotEmpty(nextNoteTokens) && isNotEmpty(nextFootText)) {
          const nextNotes = this.makeNotes(nextNoteTokens, nextFootText, noteType, notes.length);
          if (isCollectionNotEmpty(nextNotes)) {
            for (const nn of nextNotes!) notes.push(nn);
          }
        }
      }
    }

    for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
      const oneNote = notes[noteIndex]!;
      oneNote.setIdentifier(oneNote.getNoteTypeName() + "_" + (noteIndex + startIndex));
    }

    return notes;
  }

  private async toTEINote(
    tei: string,
    notes: Note[],
    doc: Document,
    markerTypes: MarkerType[] | null,
    config: GrobidAnalysisConfig,
  ): Promise<string> {
    void markerTypes;
    // pattern is <note n="1" place="foot" xml:id="foot_1">
    // or
    // pattern is <note n="1" place="margin" xml:id="margin_1">

    // if no note label is found, no @n attribute but we generate a random xml:id (not be used currently)

    for (const note of notes) {
      const desc = XmlBuilderUtils.teiElement("note");
      desc.addAttribute(new Attribute("place", note.getNoteTypeName() ?? ""));
      if (note.getLabel() !== null) {
        desc.addAttribute(new Attribute("n", note.getLabel()!));
      }

      addXmlId(desc, note.getIdentifier());

      // this is a paragraph element for storing text content of the note, which is
      // better practice than just putting the text under the <note> element
      const pNote = XmlBuilderUtils.teiElement("p");
      if (config.isGenerateTeiIds()) {
        const pID = KeyGen.getKey().substring(0, 7);
        addXmlId(pNote, "_" + pID);
      }

      if (config.isGenerateTeiCoordinates("p")) {
        const coords = LayoutTokensUtil.getCoordsString(note.getTokens()!);
        desc.addAttribute(new Attribute("coords", coords));
      }

      // for labelling bibliographical references in notes
      const noteTokens = note.getTokens()!;

      let coords: string | null = null;
      if (config.isGenerateTeiCoordinates("note")) {
        coords = LayoutTokensUtil.getCoordsString(noteTokens);
      }

      if (coords !== null) {
        desc.addAttribute(new Attribute("coords", coords));
      }

      const noteProcess: Pair<string, LayoutToken[]> | null =
        await (this.fullTextParser as unknown as {
          processShort(t: LayoutToken[], d: Document): Promise<Pair<string, LayoutToken[]> | null>;
        }).processShort(noteTokens, doc);

      if (noteProcess === null) {
        continue;
      }

      const labeledNote: string | null = noteProcess.a;
      const noteLayoutTokens: LayoutToken[] = noteProcess.b;

      if (labeledNote !== null && labeledNote.length > 0) {
        const clusteror = new TaggingTokenClusteror(
          GrobidModels.FULLTEXT,
          labeledNote,
          noteLayoutTokens,
        );
        const clusters = clusteror.cluster();

        for (const cluster of clusters) {
          if (cluster === null) {
            continue;
          }

          const clusterLabel = cluster.getTaggingLabel();
          const clusterContent = LayoutTokensUtil.normalizeDehyphenizeText(cluster.concatTokens());
          if (clusterLabel === TaggingLabels.CITATION_MARKER) {
            try {
              const refNodes = this.markReferencesTEILuceneBased(
                cluster.concatTokens(),
                doc.getReferenceMarkerMatcher(),
                config.isGenerateTeiCoordinates("ref"),
                false,
              );
              if (refNodes !== null) {
                for (const n of refNodes) {
                  pNote.appendChild(n);
                }
              }
            } catch (e) {
              LOGGER.warn("Problem when serializing TEI fragment for figure caption", e);
            }
          } else {
            pNote.appendChild(textNode(clusterContent));
          }
        }
      } else {
        let noteText: string | null = note.getText();
        if (noteText === null) {
          noteText = LayoutTokensUtil.toText(note.getTokens()!);
        } else {
          // upstream first does `.replace("  ", " ").trim()` then null-checks;
          // the null-check is unreachable for non-null. We mirror the order.
          noteText = noteText.replace("  ", " ").trim();
          noteText = noteText.trim();
        }
        pNote.appendChild(LayoutTokensUtil.normalizeText(noteText));
      }

      if (config.isWithSentenceSegmentation()) {
        this.segmentIntoSentences(
          pNote,
          noteTokens,
          config,
          doc.getLanguage(),
          doc.getPDFAnnotations(),
        );
      }

      desc.appendChild(pNote);

      tei += "\t\t\t";
      tei += desc.toXML();
      tei += "\n";
    }

    return tei;
  }

  processTEIDivSection(
    xmlType: string,
    indentation: string,
    text: string | null,
    tokens: LayoutToken[] | null,
    biblioData: BibDataSet[] | null,
    config: GrobidAnalysisConfig,
  ): string {
    let outputTei = "";

    if (isBlank(text) || tokens === null) {
      return outputTei;
    }

    outputTei += "\n" + indentation + "<div type=\"" + xmlType + "\">\n";
    let contentBuffer = "";

    contentBuffer = this.toTEITextPiece(
      contentBuffer,
      text!,
      null,
      biblioData,
      false,
      new LayoutTokenization(tokens),
      null,
      null,
      null,
      null,
      null,
      this.doc!,
      config,
    );
    const result = contentBuffer;
    const resultAsArray = result.split("\n");

    if (resultAsArray.length !== 0) {
      for (let i = 0; i < resultAsArray.length; i++) {
        if (resultAsArray[i]!.trim().length === 0) continue;
        outputTei += TextUtilities.dehyphenize(resultAsArray[i]!) + "\n";
      }
    }
    outputTei += indentation + "</div>\n\n";

    return outputTei;
  }

  toTEIAnnex(
    buffer: string,
    result: string | null,
    biblio: BiblioItem | null,
    bds: BibDataSet[] | null,
    tokenizations: LayoutToken[] | null,
    figures: Figure[] | null,
    tables: Table[] | null,
    equations: Equation[] | null,
    markerTypes: MarkerType[] | null,
    doc: Document,
    config: GrobidAnalysisConfig,
  ): string {
    if (result === null || tokenizations === null) {
      return buffer;
    }

    buffer += "\t\t\t<div type=\"annex\">\n";
    buffer = this.toTEITextPiece(
      buffer,
      result,
      biblio,
      bds,
      true,
      new LayoutTokenization(tokenizations),
      figures,
      tables,
      equations,
      null,
      markerTypes,
      doc,
      config,
    );
    buffer += "\t\t\t</div>\n";

    return buffer;
  }

  toTEITextPiece(
    buffer: string,
    result: string,
    biblio: BiblioItem | null,
    bds: BibDataSet[] | null,
    keepUnsolvedCallout: boolean,
    layoutTokenization: LayoutTokenization,
    figures: Figure[] | null,
    tables: Table[] | null,
    equations: Equation[] | null,
    notes: Note[] | null,
    markerTypes: MarkerType[] | null,
    doc: Document,
    config: GrobidAnalysisConfig,
  ): string {
    // biblio/bds are referenced as part of the upstream signature but the
    // method body doesn't read them — kept for parity.
    void biblio;
    void bds;

    let lastClusterLabel: TaggingLabel | null = null;
    const startPosition = buffer.length;

    //boolean figureBlock = false; // indicate that a figure or table sequence was met
    // used for reconnecting a paragraph that was cut by a figure/table

    const tokenizations = layoutTokenization.getTokenization()!;

    const clusteror = new TaggingTokenClusteror(GrobidModels.FULLTEXT, result, tokenizations);

    const clusters: TaggingTokenCluster[] = clusteror.cluster();

    const divResults: Element[] = [];

    let curDiv: Element = teiElement("div");
    if (config.isGenerateTeiIds()) {
      const divID = KeyGen.getKey().substring(0, 7);
      addXmlId(curDiv, "_" + divID);
    }
    divResults.push(curDiv);
    let curParagraph: Element | null = null;
    let curParagraphTokens: LayoutToken[] | null = null;
    let curList: Element | null = null;
    let equationIndex = 0; // current equation index position
    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }

      const clusterLabel = cluster.getTaggingLabel();
      Engine.getCntManager().i(clusterLabel);
      if (clusterLabel === TaggingLabels.SECTION) {
        const clusterContent = LayoutTokensUtil.normalizeDehyphenizeText(cluster.concatTokens());
        curDiv = teiElement("div");
        const head = teiElement("head");
        // section numbers
        const numb = this.getSectionNumber(clusterContent);
        if (numb !== null) {
          head.addAttribute(new Attribute("n", numb.b));
          head.appendChild(numb.a);
        } else {
          head.appendChild(clusterContent);
        }

        if (config.isGenerateTeiIds()) {
          const divID = KeyGen.getKey().substring(0, 7);
          addXmlId(head, "_" + divID);
        }

        if (config.isGenerateTeiCoordinates("head")) {
          const coords = LayoutTokensUtil.getCoordsString(cluster.concatTokens());
          if (coords !== null) {
            head.addAttribute(new Attribute("coords", coords));
          }
        }

        curDiv.appendChild(head);
        divResults.push(curDiv);
      } else if (
        clusterLabel === TaggingLabels.EQUATION ||
        clusterLabel === TaggingLabels.EQUATION_LABEL
      ) {
        // get starting position of the cluster
        let start = -1;
        if (isCollectionNotEmpty(cluster.concatTokens())) {
          start = cluster.concatTokens()[0]!.getOffset();
        }
        // get the corresponding equation
        if (start !== -1) {
          let theEquation: Equation | null = null;
          if (equations !== null) {
            for (let i = 0; i < equations.length; i++) {
              if (i < equationIndex) continue;
              const equation = equations[i]!;
              if (equation.getStart() === start) {
                theEquation = equation;
                equationIndex = i;
                break;
              }
            }
            if (theEquation !== null) {
              const element = theEquation.toTEIElement(config) as Element | null;
              if (element !== null) curDiv.appendChild(element);
            }
          }
        }
      } else if (clusterLabel === TaggingLabels.ITEM) {
        const clusterContent = LayoutTokensUtil.normalizeText(cluster.concatTokens());
        //curDiv.appendChild(teiElement("item", clusterContent));
        const itemNode = teiElement("item", clusterContent);
        if (
          !TEIFormatter.MARKER_LABELS.has(lastClusterLabel!) &&
          lastClusterLabel !== TaggingLabels.ITEM
        ) {
          curList = teiElement("list");
          curDiv.appendChild(curList);
        }
        if (curList !== null) {
          curList.appendChild(itemNode);
        }
      } else if (clusterLabel === TaggingLabels.OTHER) {
        const clusterContent = LayoutTokensUtil.normalizeDehyphenizeText(cluster.concatTokens());
        const note = teiElement("note", clusterContent);
        note.addAttribute(new Attribute("type", "other"));
        if (config.isGenerateTeiIds()) {
          const divID = KeyGen.getKey().substring(0, 7);
          addXmlId(note, "_" + divID);
        }
        curDiv.appendChild(note);
      } else if (clusterLabel === TaggingLabels.PARAGRAPH) {
        const clusterTokens = cluster.concatTokens();
        const clusterPage = clusterTokens[clusterTokens.length - 1]!.getPage();

        let notesSamePage: Note[] | null = null;
        const matchedLabelPositions: Triple<string, string, OffsetPosition>[] = [];

        // map the matched note labels to their corresponding note objects
        const labels2Notes = new Map<string, Note>();
        if (isCollectionNotEmpty(notes)) {
          notesSamePage = notes!
            .filter((f) => !f.isIgnored() && f.getPageNumber() === clusterPage);

          // we need to cover several footnote callouts in the same paragraph segment
          // we also can't assume notes are sorted and will appear first in the text as the same order
          // they are defined in the note areas - this might not always be the case in
          // ill-formed documents

          // map a note label (string) to a valid matching position in the sequence of Layout Tokens
          // of the paragraph segment

          let start = 0;
          for (const note of notesSamePage) {
            const clusterReduced = clusterTokens.slice(start, clusterTokens.length);
            const matching = clusterReduced.find(
              (t) => t.getText() === note.getLabel() && t.isSuperscript(),
            );

            if (matching !== undefined) {
              const idx = clusterReduced.indexOf(matching) + start;
              note.setIgnored(true);
              const matchingPosition = new OffsetPosition();
              matchingPosition.start = idx;
              matchingPosition.end = idx + 1; // to be review, might be more than one layout token
              start = matchingPosition.end;
              matchedLabelPositions.push(
                Triple.of(note.getIdentifier(), "note", matchingPosition),
              );
              labels2Notes.set(note.getIdentifier(), note);
            }
          }
        }

        //Identify URLs and attach reference in the text
        const offsetPositionsAndDestinationUrls: Pair<OffsetPosition, string | null>[] =
          Lexicon.tokenPositionUrlPatternWithPdfAnnotations(
            clusterTokens,
            doc.getPDFAnnotations() ?? [],
          );

        offsetPositionsAndDestinationUrls.forEach((opu) => {
          // We correct the latest token here, since later we will do a substring in the shared code,
          // and we cannot add a +1 there.
          const left = opu.a;
          const right = opu.b;
          matchedLabelPositions.push(
            Triple.of(
              right !== null
                ? right
                : LayoutTokensUtil.normalizeDehyphenizeText(
                    clusterTokens.slice(left.start, left.end + 1),
                  ),
              "url",
              new OffsetPosition(left.start, left.end + 1),
            ),
          );
        });

        // We can add more elements to be extracted from the paragraphs, here. Each labelPosition it's a
        // Triple with three main elements: the text of the item, the type, and the offsetPositions.

        if (isCollectionEmpty(matchedLabelPositions)) {
          const clusterContent = LayoutTokensUtil.normalizeDehyphenizeText(clusterTokens);
          if (TEIFormatter.isNewParagraph(lastClusterLabel, curParagraph)) {
            if (curParagraph !== null && config.isWithSentenceSegmentation()) {
              this.segmentIntoSentences(curParagraph, curParagraphTokens!, config, doc.getLanguage());
            }
            curParagraph = teiElement("p");
            if (config.isGenerateTeiIds()) {
              const divID = KeyGen.getKey().substring(0, 7);
              addXmlId(curParagraph, "_" + divID);
            }

            if (config.isGenerateTeiCoordinates("p")) {
              const coords = LayoutTokensUtil.getCoordsString(clusterTokens);
              curParagraph.addAttribute(new Attribute("coords", coords));
            }

            curDiv.appendChild(curParagraph);
            curParagraphTokens = [];
          } else {
            if (config.isGenerateTeiCoordinates("p")) {
              const coords = LayoutTokensUtil.getCoordsString(clusterTokens);
              if (
                curParagraph!.getAttribute("coords") !== null &&
                !curParagraph!.getAttributeValue("coords")!.includes(coords)
              ) {
                curParagraph!.addAttribute(
                  new Attribute("coords", curParagraph!.getAttributeValue("coords") + ";" + coords),
                );
              }
            }
          }
          curParagraph!.appendChild(clusterContent);
          for (const t of clusterTokens) curParagraphTokens!.push(t);
        } else {
          if (TEIFormatter.isNewParagraph(lastClusterLabel, curParagraph)) {
            if (curParagraph !== null && config.isWithSentenceSegmentation()) {
              this.segmentIntoSentences(
                curParagraph,
                curParagraphTokens!,
                config,
                doc.getLanguage(),
                doc.getPDFAnnotations(),
              );
            }
            curParagraph = teiElement("p");
            if (config.isGenerateTeiIds()) {
              const divID = KeyGen.getKey().substring(0, 7);
              addXmlId(curParagraph, "_" + divID);
            }

            if (config.isGenerateTeiCoordinates("p")) {
              const coords = LayoutTokensUtil.getCoordsString(clusterTokens);
              curParagraph.addAttribute(new Attribute("coords", coords));
            }

            curDiv.appendChild(curParagraph);
            curParagraphTokens = [];
          }

          // sort the matches by position
          const sortedFilteredMatchedLabelPositions = matchedLabelPositions
            .filter((a) => isNotBlank(a.getLeft()))
            .sort((m1, m2) => m1.getRight().start - m2.getRight().start);

          // position in the layout token index
          let pos = 0;

          // build the paragraph segment, match by match
          for (const referenceInformation of sortedFilteredMatchedLabelPositions) {
            const type = referenceInformation.getMiddle();
            const matchingPosition = referenceInformation.getRight();

            if (pos > matchingPosition.start) break;

            const before = clusterTokens.slice(pos, matchingPosition.start);
            const clusterContentBefore = LayoutTokensUtil.normalizeDehyphenizeText(before);

            if (isCollectionNotEmpty(before) && before[0]!.getText() === " ") {
              curParagraph!.appendChild(new Text(" "));
            }

            curParagraph!.appendChild(clusterContentBefore);
            if (config.isGenerateTeiCoordinates("p")) {
              const coords = LayoutTokensUtil.getCoordsString(before);
              if (
                curParagraph!.getAttribute("coords") !== null &&
                !curParagraph!.getAttributeValue("coords")!.includes(coords)
              ) {
                curParagraph!.addAttribute(
                  new Attribute("coords", curParagraph!.getAttributeValue("coords") + ";" + coords),
                );
              }
            }

            for (const t of before) curParagraphTokens!.push(t);

            let ref: Element | null = null;
            const calloutTokens = clusterTokens.slice(matchingPosition.start, matchingPosition.end);
            if (type === "note") {
              const note = labels2Notes.get(referenceInformation.getLeft()) ?? null;
              ref = TEIFormatter.generateNoteRef(
                calloutTokens,
                referenceInformation.getLeft(),
                note!,
                config,
              );
            } else if (type === "url") {
              const destinationText = referenceInformation.getLeft();
              ref = this.generateURLRef(
                destinationText,
                calloutTokens,
                config.isGenerateTeiCoordinates("ref"),
              );

              //We might need to add a space if it's in the layout tokens
              if (
                isCollectionNotEmpty(before) &&
                equalsAnyIgnoreCase(before[before.length - 1]!.getText(), " ", "\n")
              ) {
                curParagraph!.appendChild(new Text(" "));
              }
            }

            pos = matchingPosition.end;
            if (ref !== null) {
              curParagraph!.appendChild(ref);
            } else {
              LOGGER.warn("Detected empty reference or note after " + clusterContentBefore);
            }
          }

          // add last chunk of paragraph stuff (or whole paragraph if no note callout matching)
          const remaining = clusterTokens.slice(pos, clusterTokens.length);
          const remainingClusterContent = LayoutTokensUtil.normalizeDehyphenizeText(remaining);

          if (isCollectionNotEmpty(remaining) && remaining[0]!.getText() === " ") {
            curParagraph!.appendChild(new Text(" "));
          }

          if (config.isGenerateTeiCoordinates("p")) {
            const coords = LayoutTokensUtil.getCoordsString(remaining);
            if (
              curParagraph!.getAttribute("coords") !== null &&
              !curParagraph!.getAttributeValue("coords")!.includes(coords)
            ) {
              curParagraph!.addAttribute(
                new Attribute("coords", curParagraph!.getAttributeValue("coords") + ";" + coords),
              );
            }
          }

          curParagraph!.appendChild(remainingClusterContent);
          for (const t of remaining) curParagraphTokens!.push(t);
        }
      } else if (TEIFormatter.MARKER_LABELS.has(clusterLabel)) {
        let refTokens = cluster.concatTokens();
        refTokens = LayoutTokensUtil.dehyphenize(refTokens);
        const chunkRefString = LayoutTokensUtil.toText(refTokens);

        const parent: Element = curParagraph !== null ? curParagraph : curDiv;
        parent.appendChild(new Text(" "));

        let refNodes: Node[] | null;
        let citationMarkerType: MarkerType | null = null;
        if (markerTypes !== null && markerTypes.length > 0) {
          citationMarkerType = markerTypes[0]!;
        }
        if (clusterLabel === TaggingLabels.CITATION_MARKER) {
          refNodes = this.markReferencesTEILuceneBased(
            refTokens,
            doc.getReferenceMarkerMatcher(),
            config.isGenerateTeiCoordinates("ref"),
            keepUnsolvedCallout,
            citationMarkerType,
          );
        } else if (clusterLabel === TaggingLabels.FIGURE_MARKER) {
          refNodes = this.markReferencesFigureTEI(
            chunkRefString,
            refTokens,
            figures,
            config.isGenerateTeiCoordinates("ref"),
          );
        } else if (clusterLabel === TaggingLabels.TABLE_MARKER) {
          refNodes = this.markReferencesTableTEI(
            chunkRefString,
            refTokens,
            tables,
            config.isGenerateTeiCoordinates("ref"),
          );
        } else if (clusterLabel === TaggingLabels.EQUATION_MARKER) {
          refNodes = this.markReferencesEquationTEI(
            chunkRefString,
            refTokens,
            equations,
            config.isGenerateTeiCoordinates("ref"),
          );
        } else {
          throw new Error("Unsupported marker type: " + clusterLabel);
        }

        if (refNodes !== null) {
          let footNoteCallout = false;

          if (refNodes.length === 1 && refNodes[0] instanceof Text) {
            // filtered out superscript reference marker might be foot note callout
            if (
              citationMarkerType === null ||
              citationMarkerType !== CalloutAnalyzer.MarkerType.SUPERSCRIPT_NUMBER
            ) {
              // is refTokens superscript?
              if (refTokens.length > 0 && refTokens[0]!.isSuperscript()) {
                // check note callout matching
                const clusterPage = refTokens[refTokens.length - 1]!.getPage();
                let notesSamePage: Note[] | null = null;
                if (notes !== null && notes.length > 0) {
                  notesSamePage = notes.filter(
                    (f) => !f.isIgnored() && f.getPageNumber() === clusterPage,
                  );
                }

                if (notesSamePage !== null) {
                  for (const note of notesSamePage) {
                    if (chunkRefString.trim() === note.getLabel()) {
                      footNoteCallout = true;
                      note.setIgnored(true);

                      const ref = TEIFormatter.generateNoteRef(
                        refTokens,
                        chunkRefString.trim(),
                        note,
                        config,
                      );

                      parent.appendChild(ref);

                      if (chunkRefString.endsWith(" ")) {
                        parent.appendChild(new Text(" "));
                      }
                    }
                  }
                }
              }
            }
          }

          if (!footNoteCallout) {
            for (const n of refNodes) {
              parent.appendChild(n);
            }
          }
        }

        if (curParagraph !== null) {
          for (const t of cluster.concatTokens()) curParagraphTokens!.push(t);
        }
      } else if (
        clusterLabel === TaggingLabels.FIGURE ||
        clusterLabel === TaggingLabels.TABLE
      ) {
        //figureBlock = true;
        if (curParagraph !== null) curParagraph.appendChild(new Text(" "));
      }

      lastClusterLabel = cluster.getTaggingLabel();
    }

    // in case we segment paragraph into sentences, we still need to do it for the last paragraph
    if (curParagraph !== null && config.isWithSentenceSegmentation()) {
      this.segmentIntoSentences(
        curParagraph,
        curParagraphTokens!,
        config,
        doc.getLanguage(),
        doc.getPDFAnnotations(),
      );
    }

    // remove possibly empty div in the div list
    if (divResults.length !== 0) {
      for (let i = divResults.length - 1; i >= 0; i--) {
        const theDiv = divResults[i]!;
        // upstream `getChildElements()` returns only Element children
        let hasElementChild = false;
        for (let k = 0; k < theDiv.getChildCount(); k++) {
          if (theDiv.getChild(k) instanceof Element) {
            hasElementChild = true;
            break;
          }
        }
        if (!hasElementChild) {
          divResults.splice(i, 1);
        }
      }
    }

    if (divResults.length !== 0) buffer += XmlBuilderUtils.toXml(divResults);
    else buffer += XmlBuilderUtils.toXml(curDiv);

    // we apply some overall cleaning and simplification
    buffer = TextUtilities.replaceAll(
      buffer,
      "</head><head",
      "</head>\n\t\t\t</div>\n\t\t\t<div>\n\t\t\t\t<head",
    );
    buffer = TextUtilities.replaceAll(buffer, "</p>\t\t\t\t<p>", " ");

    //TODO: work on reconnection
    // we evaluate the need to reconnect paragraphs cut by a figure or a table
    let indP1 = buffer.indexOf("</p0>", startPosition - 1);
    while (indP1 !== -1) {
      const indP2 = buffer.indexOf("<p>", indP1 + 1);
      // NOTE: upstream bug — `indP2 != 1` should likely be `indP2 != -1`.
      // Preserved verbatim.
      if (indP2 !== 1 && buffer.length > indP2 + 5) {
        if (isJavaUpperCase(buffer.charAt(indP2 + 4)) && isJavaLowerCase(buffer.charAt(indP2 + 5))) {
          // a marker for reconnecting the two paragraphs
          buffer = buffer.substring(0, indP2 + 1) + "q" + buffer.substring(indP2 + 2);
        }
      }
      indP1 = buffer.indexOf("</p0>", indP1 + 1);
    }
    buffer = TextUtilities.replaceAll(buffer, "</p0>(\\n\\t)*<q>", " ");
    buffer = TextUtilities.replaceAll(buffer, "</p0>", "</p>");
    buffer = TextUtilities.replaceAll(buffer, "<q>", "<p>");

    if (figures !== null) {
      for (const figure of figures) {
        const figSeg = figure.toTEI(config, doc, this, markerTypes);
        if (figSeg !== null) {
          buffer += figSeg + "\n";
        }
      }
    }
    if (tables !== null) {
      for (const table of tables) {
        const tabSeg = (table as unknown as {
          toTEI(c: GrobidAnalysisConfig, d: Document, f: TEIFormatter, m: MarkerType[] | null): string | null;
        }).toTEI(config, doc, this, markerTypes);
        if (tabSeg !== null) {
          buffer += tabSeg + "\n";
        }
      }
    }

    return buffer;
  }

  private static generateNoteRef(
    noteTokens: LayoutToken[],
    noteLabel: string,
    note: Note,
    config: GrobidAnalysisConfig,
  ): Element {
    const ref = teiElement("ref");
    //TODO: is this normal that it's hardcoded "foot"?
    ref.addAttribute(new Attribute("type", "foot"));

    if (config.isGenerateTeiCoordinates("ref")) {
      const coords = LayoutTokensUtil.getCoordsString(noteTokens);
      if (coords !== null) {
        ref.addAttribute(new Attribute("coords", coords));
      }
    }

    ref.appendChild(noteLabel);
    ref.addAttribute(new Attribute("target", "#" + note.getIdentifier()));
    return ref;
  }

  static isNewParagraph(
    lastClusterLabel: TaggingLabel | null,
    curParagraph: Element | null,
  ): boolean {
    return (
      (!TEIFormatter.MARKER_LABELS.has(lastClusterLabel!) &&
        lastClusterLabel !== TaggingLabels.FIGURE &&
        lastClusterLabel !== TaggingLabels.TABLE) ||
      curParagraph === null
    );
  }

  segmentIntoSentences(
    curParagraph: Element | null,
    curParagraphTokens: LayoutToken[],
    config: GrobidAnalysisConfig,
    lang: string | null,
  ): void;
  segmentIntoSentences(
    curParagraph: Element | null,
    curParagraphTokens: LayoutToken[],
    config: GrobidAnalysisConfig,
    lang: string | null,
    annotations: PDFAnnotation[] | null,
  ): void;
  segmentIntoSentences(
    curParagraph: Element | null,
    curParagraphTokens: LayoutToken[],
    config: GrobidAnalysisConfig,
    lang: string | null,
    annotations?: PDFAnnotation[] | null,
  ): void {
    if (annotations === undefined) annotations = [];
    // in order to avoid having a sentence boundary in the middle of a ref element
    // we only consider for sentence segmentation texts under <p> and skip the text under <ref>.
    if (curParagraph === null) return;

    // in xom, the following gives all the text under the element, for the whole subtree
    const text = curParagraph.getValue();
    if (isBlank(text)) return;

    // identify ref nodes, ref spans and ref positions
    const mapRefNodes = new Map<number, Node>();
    const refPositions: number[] = [];
    const forbiddenPositions: OffsetPosition[] = [];
    let pos = 0;
    for (let i = 0; i < curParagraph.getChildCount(); i++) {
      const theNode = curParagraph.getChild(i);
      if (theNode instanceof Text) {
        const chunk = theNode.getValue();
        pos += chunk.length;
      } else if (theNode instanceof Element) {
        // for readability in another conditional
        if (theNode.getLocalName() === "ref") {
          // map character offset of the node
          mapRefNodes.set(pos, theNode);
          refPositions.push(pos);

          const chunk = theNode.getValue();
          forbiddenPositions.push(new OffsetPosition(pos, pos + chunk.length));
          pos += chunk.length;
        }
      }
    }

    // We add URL that are identified using the PDF features for annotations
    const offsetPositionsUrls = Lexicon.characterPositionsUrlPatternWithPdfAnnotations(
      curParagraphTokens,
      annotations ?? [],
      text,
    );
    for (const p of offsetPositionsUrls) forbiddenPositions.push(p);

    let language = new Language("en");
    if (lang !== null) {
      language = new Language(lang);
    } else {
      LOGGER.warn(
        "There wasn't enough usable text to detect the language. Defaulting to English (en) for applying sentence segmentation. ",
      );
    }

    const theSentences = SentenceUtilities.getInstance().runSentenceDetection(
      text,
      forbiddenPositions,
      curParagraphTokens,
      language,
    )!;

    /*if (theSentences.size() == 0) {
        // this should normally not happen, but it happens (depending on sentence splitter, usually the text
        // is just a punctuation)
        // in this case we consider the current text as a unique sentence as fall back
        theSentences.add(new OffsetPosition(0, text.length()));
    }*/

    // segment the list of layout tokens according to the sentence segmentation if the coordinates are needed
    const segmentedParagraphTokens: LayoutToken[][] = [];
    let currentSentenceTokens: LayoutToken[] = [];
    pos = 0;

    if (config.isGenerateTeiCoordinates("s")) {
      let currentSentenceIndex = 0;
      let sentenceChunk = text.substring(
        theSentences[currentSentenceIndex]!.start,
        theSentences[currentSentenceIndex]!.end,
      );

      for (let i = 0; i < curParagraphTokens.length; i++) {
        const token = curParagraphTokens[i]!;
        if (isEmpty(token.getText())) continue;
        const newPos = sentenceChunk.indexOf(token.getText()!, pos);
        if (newPos !== -1 || SentenceUtilities.toSkipToken(token.getText()!)) {
          // just move on
          currentSentenceTokens.push(token);
          if (newPos !== -1 && !SentenceUtilities.toSkipToken(token.getText()!)) pos = newPos;
        } else {
          if (currentSentenceTokens.length > 0) {
            segmentedParagraphTokens.push(currentSentenceTokens);
            currentSentenceIndex++;
            if (currentSentenceIndex >= theSentences.length) {
              currentSentenceTokens = [];
              break;
            }
            const endPosition = Math.min(theSentences[currentSentenceIndex]!.end, text.length);
            sentenceChunk = text.substring(theSentences[currentSentenceIndex]!.start, endPosition);
          }
          currentSentenceTokens = [];
          currentSentenceTokens.push(token);
          pos = 0;
        }

        if (currentSentenceIndex >= theSentences.length) break;
      }
      // last sentence
      if (currentSentenceTokens.length > 0) {
        // check sentence index too ?
        segmentedParagraphTokens.push(currentSentenceTokens);
      }
    }

    // update the xml paragraph element
    let posInSentence = 0;
    let refIndex = 0;
    for (let i = 0; i < theSentences.length; i++) {
      pos = theSentences[i]!.start;
      posInSentence = 0;
      const sentenceElement = teiElement("s");
      if (config.isGenerateTeiIds()) {
        const sID = KeyGen.getKey().substring(0, 7);
        addXmlId(sentenceElement, "_" + sID);
      }
      if (config.isGenerateTeiCoordinates("s")) {
        if (segmentedParagraphTokens.length >= i + 1) {
          currentSentenceTokens = segmentedParagraphTokens[i]!;
          const coords = LayoutTokensUtil.getCoordsString(currentSentenceTokens);
          if (coords !== null) {
            sentenceElement.addAttribute(new Attribute("coords", coords));
          }
        }
      }

      const sentenceLength = theSentences[i]!.end - pos;
      // check if we have a ref between pos and pos+sentenceLength
      for (let j = refIndex; j < refPositions.length; j++) {
        const refPos = refPositions[j]!;
        if (refPos < pos + posInSentence) continue;

        if (refPos >= pos + posInSentence && refPos <= pos + sentenceLength) {
          const valueNode = mapRefNodes.get(refPos)!;
          if (pos + posInSentence < refPos) {
            let local_text_chunk = text.substring(pos + posInSentence, refPos);
            local_text_chunk = XmlBuilderUtils.stripNonValidXMLCharacters(local_text_chunk);
            sentenceElement.appendChild(local_text_chunk);
          }
          valueNode.detach();
          sentenceElement.appendChild(valueNode);
          refIndex = j;
          posInSentence = refPos + valueNode.getValue().length - pos;
        }
        if (refPos > pos + sentenceLength) {
          break;
        }
      }

      const endPosition = Math.min(theSentences[i]!.end, text.length);
      if (pos + posInSentence <= endPosition) {
        let local_text_chunk = text.substring(pos + posInSentence, endPosition);
        local_text_chunk = XmlBuilderUtils.stripNonValidXMLCharacters(local_text_chunk);
        sentenceElement.appendChild(local_text_chunk);
      }
      curParagraph.appendChild(sentenceElement);
    }

    for (let i = curParagraph.getChildCount() - 1; i >= 0; i--) {
      const theNode = curParagraph.getChild(i);
      if (theNode instanceof Text) {
        curParagraph.removeChild(theNode);
      } else if (theNode instanceof Element) {
        if (theNode.getLocalName() !== "s") {
          curParagraph.removeChild(theNode);
        }
      }
    }
  }

  /**
   * Return the graphic objects in a given interval position in the document.
   */
  // NOTE: upstream marks this private but it's referenced by callers via
  // reflection in some build configurations. Preserved as `private`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private getGraphicObject(
    graphicObjects: GraphicObject[],
    startPos: number,
    endPos: number,
  ): GraphicObject[] {
    const result: GraphicObject[] = [];
    for (const nto of graphicObjects) {
      if (nto.getStartPosition() >= startPos && nto.getStartPosition() <= endPos) {
        result.push(nto);
      }
      if (nto.getStartPosition() > endPos) {
        break;
      }
    }
    return result;
  }

  private getSectionNumber(text: string): Pair<string, string> | null {
    const m1 = BasicStructureBuilder.headerNumbering1.exec(text);
    const m2 = BasicStructureBuilder.headerNumbering2.exec(text);
    const m3 = BasicStructureBuilder.headerNumbering3.exec(text);
    let numb: string | null = null;
    if (m1 !== null) {
      numb = m1[0]!;
    } else if (m2 !== null) {
      numb = m2[0]!;
    } else if (m3 !== null) {
      numb = m3[0]!;
    }
    if (numb !== null) {
      text = text.replace(numb, "").trim();
      numb = numb.replace(/ /g, "");
      return new Pair<string, string>(text, numb);
    } else {
      return null;
    }
  }

  toTEIReferences(
    tei: string,
    bds: BibDataSet[] | null,
    config: GrobidAnalysisConfig,
  ): string {
    tei += "\t\t\t<div type=\"references\">\n\n";

    if (bds === null || bds.length === 0) tei += "\t\t\t\t<listBibl/>\n";
    else {
      tei += "\t\t\t\t<listBibl>\n";

      let p = 0;
      if (bds.length > 0) {
        for (const bib of bds) {
          const bit: BiblioItem | null = bib.getResBib();
          if (bit !== null) {
            bit.setReference(bib.getRawBib());
            tei += "\n" + bit.toTEI(p, 0, config);
          } else {
            tei += "\n";
          }
          p++;
        }
      }
      tei += "\n\t\t\t\t</listBibl>\n";
    }
    tei += "\t\t\t</div>\n";

    return tei;
  }

  //bounding boxes should have already been calculated when calling this method
  static getCoordsAttribute(
    boundingBoxes: BoundingBox[] | null,
    generateCoordinates: boolean,
  ): string {
    if (!generateCoordinates || boundingBoxes === null || boundingBoxes.length === 0) {
      return "";
    }
    const coords = boundingBoxes.map((b) => b.toString()).join(";");
    return "coords=\"" + coords + "\"";
  }

  /**
   * Mark using TEI annotations the identified references in the text body
   * build with the machine learning model.
   *
   * Upstream has a 4-arg and a 5-arg overload.
   */
  markReferencesTEILuceneBased(
    refTokens: LayoutToken[],
    markerMatcher: unknown,
    generateCoordinates: boolean,
    keepUnsolvedCallout: boolean,
  ): Node[] | null;
  markReferencesTEILuceneBased(
    refTokens: LayoutToken[],
    markerMatcher: unknown,
    generateCoordinates: boolean,
    keepUnsolvedCallout: boolean,
    citationMarkerType: MarkerType | null,
  ): Node[] | null;
  markReferencesTEILuceneBased(
    refTokens: LayoutToken[],
    markerMatcher: unknown,
    generateCoordinates: boolean,
    keepUnsolvedCallout: boolean,
    citationMarkerType?: MarkerType | null,
  ): Node[] | null {
    if (citationMarkerType === undefined) citationMarkerType = null;

    // safety tests
    if (refTokens === null || refTokens.length === 0) return null;
    let text = LayoutTokensUtil.toText(refTokens);
    if (
      text === null ||
      text.trim().length === 0 ||
      text.endsWith("</ref>") ||
      text.startsWith("<ref") ||
      markerMatcher === null
    )
      return [new Text(text)];

    let spaceEnd = false;
    text = text.replace(/\n/g, " ");
    if (text.endsWith(" ")) spaceEnd = true;

    // check constraints on global marker type
    if (citationMarkerType !== null) {
      // do we have superscript numbers in the ref tokens?
      let hasSuperScriptNumber = false;
      for (const refToken of refTokens) {
        if (refToken.isSuperscript()) {
          hasSuperScriptNumber = true;
          break;
        }
      }

      if (citationMarkerType === CalloutAnalyzer.MarkerType.SUPERSCRIPT_NUMBER) {
        // we need to check that the reference tokens have some superscript numbers
        if (!hasSuperScriptNumber) {
          return [new Text(text)];
        }
      } else {
        // if the reference tokens has some superscript numbers, it is a callout for a different type of object
        // (e.g. a foot note)
        if (hasSuperScriptNumber) {
          return [new Text(text)];
        }
      }

      // TBD: check other constraints and consistency issues
    }

    const nodes: Node[] = [];
    const matchResults = (markerMatcher as {
      match(t: LayoutToken[]): {
        getText(): string;
        getTokens(): LayoutToken[];
        getBibDataSet(): BibDataSet | null;
      }[];
    }).match(refTokens);
    if (matchResults !== null) {
      for (const matchResult of matchResults) {
        // no need to HTMLEncode since XOM will take care about the correct escaping
        const markerText = LayoutTokensUtil.normalizeText(matchResult.getText());
        let coords: string | null = null;
        if (generateCoordinates && matchResult.getTokens() !== null) {
          coords = LayoutTokensUtil.getCoordsString(matchResult.getTokens());
        }

        const ref = teiElement("ref");
        ref.addAttribute(new Attribute("type", "bibr"));

        if (coords !== null) {
          ref.addAttribute(new Attribute("coords", coords));
        }
        ref.appendChild(markerText);

        let solved = false;
        if (matchResult.getBibDataSet() !== null) {
          ref.addAttribute(
            new Attribute("target", "#b" + matchResult.getBibDataSet()!.getResBib()!.getOrdinal()),
          );
          solved = true;
        }
        if (solved || (!solved && keepUnsolvedCallout)) nodes.push(ref);
        else nodes.push(textNode(matchResult.getText()));
      }
    }
    if (spaceEnd) nodes.push(new Text(" "));
    return nodes;
  }

  markReferencesFigureTEI(
    refText: string,
    allRefTokens: LayoutToken[],
    figures: Figure[] | null,
    generateCoordinates: boolean,
  ): Node[] | null {
    return this.markReferencesFigureOrTableTEI(
      refText,
      allRefTokens,
      figures,
      FigureTableType.FIGURE,
      generateCoordinates,
    );
  }

  markReferencesTableTEI(
    refText: string,
    allRefTokens: LayoutToken[],
    tables: Table[] | null,
    generateCoordinates: boolean,
  ): Node[] | null {
    return this.markReferencesFigureOrTableTEI(
      refText,
      allRefTokens,
      tables,
      FigureTableType.TABLE,
      generateCoordinates,
    );
  }

  private markReferencesFigureOrTableTEI(
    refText: string,
    allRefTokens: LayoutToken[],
    figuresOrTables: Figure[] | Table[] | null,
    type: FigureTableType,
    generateCoordinates: boolean,
  ): Node[] | null {
    if (refText === null || refText.trim().length === 0) {
      return null;
    }

    const nodes: Node[] = [];

    if (
      refText.trim().length === 1 &&
      TextUtilities.fullPunctuations.indexOf(refText.trim()) !== -1
    ) {
      // the reference text marker is punctuation
      nodes.push(new Text(refText));
      return nodes;
    }

    let labels: Pair<string, LayoutToken[]>[] | null = null;

    // Java: ReferenceMarkerMatcher.FIGURE_TABLES_REF_SEPARATORS
    const allYs: LayoutToken[][] = LayoutTokensUtil.split(
      allRefTokens,
      ReferenceMarkerMatcher.FIGURE_TABLES_REF_SEPARATORS,
      true,
    );
    if (allYs.length > 1) {
      labels = [];
      for (const ys of allYs) {
        labels.push(
          new Pair<string, LayoutToken[]>(
            LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(ys)),
            ys,
          ),
        );
      }
    } else {
      // possibly expand the range of reference numbers (like for numerical bibliographical markers)
      labels = ReferenceMarkerMatcher.getNumberedLabels(allRefTokens, false);
    }

    if (labels === null || labels.length <= 1) {
      const localLabel = new Pair<string, LayoutToken[]>(refText, allRefTokens);
      labels = [];
      labels.push(localLabel);
    }

    for (const theLabel of labels) {
      let text = theLabel.a;
      let refTokens = theLabel.b;

      const textLow = text.toLowerCase().trim();
      let bestFigureOrTable: string | null = null;

      if (figuresOrTables !== null) {
        for (const figureOrTable of figuresOrTables) {
          if (isNotBlank((figureOrTable as Figure | Table).getLabel())) {
            const label = TextUtilities.cleanField((figureOrTable as Figure | Table).getLabel(), false);
            if (isNotBlank(label) && textLow === label!.toLowerCase()) {
              bestFigureOrTable = (figureOrTable as Figure | Table).getId();
              break;
            }
          }
        }
        if (bestFigureOrTable === null) {
          // second pass with relaxed figure marker matching
          for (let i = figuresOrTables.length - 1; i >= 0; i--) {
            const figureOrTable = figuresOrTables[i]!;
            if (isNotBlank(figureOrTable.getLabel())) {
              const label = TextUtilities.cleanField(figureOrTable.getLabel(), false);
              if (isNotBlank(label) && textLow.indexOf(label!.toLowerCase()) !== -1) {
                bestFigureOrTable = figureOrTable.getId();
                break;
              }
            }
          }
        }
      }

      let spaceEnd = false;
      let spaceStart = false;
      text = text.replace(/\n/g, " ");
      if (text.endsWith(" ")) {
        spaceEnd = true;
      }
      // NOTE: upstream bug — `&` (bitwise) instead of `&&` (logical).
      // Operands coerce harmlessly so semantics survive.
      if (text !== " " && text.startsWith(" ")) {
        spaceStart = true;
      }
      text = text.trim();

      if (isBlank(text)) {
        if (spaceStart) {
          nodes.push(new Text(" "));
        }
        nodes.push(new Text(text));
        if (spaceEnd) {
          nodes.push(new Text(" "));
        }
        continue;
      }

      let andWordString: string | null = null;
      if (text.endsWith("and") || text.endsWith("&") || text.endsWith(",")) {
        if (text === "and" || text === "&" || text === ",") {
          if (spaceStart) {
            nodes.push(new Text(" "));
          }
          nodes.push(new Text(text));
          if (spaceEnd) {
            nodes.push(new Text(" "));
          }
          continue;
        } else if (text.endsWith("and")) {
          // the AND_WORD_PATTERN case, we want to exclude the AND word from the tagged chunk
          text = text.substring(0, text.length - 3);
          andWordString = "and";
          refTokens = refTokens.slice(0, refTokens.length - 1);
        } else if (text.endsWith("&")) {
          text = text.substring(0, text.length - 1);
          andWordString = "&";
          refTokens = refTokens.slice(0, refTokens.length - 1);
        } else if (text.endsWith(",")) {
          text = text.substring(0, text.length - 1);
          andWordString = ",";
          refTokens = refTokens.slice(0, refTokens.length - 1);
        }

        if (text.endsWith(" ")) {
          andWordString = " " + andWordString;
          refTokens = refTokens.slice(0, refTokens.length - 1);
        }
        text = text.trim();
      }

      let coords: string | null = null;
      if (generateCoordinates && refTokens !== null) {
        coords = LayoutTokensUtil.getCoordsString(refTokens);
      }

      const ref = teiElement("ref");

      ref.addAttribute(new Attribute("type", type));

      if (coords !== null) {
        ref.addAttribute(new Attribute("coords", coords));
      }
      ref.appendChild(text);

      if (bestFigureOrTable !== null) {
        if (type === FigureTableType.TABLE) {
          ref.addAttribute(new Attribute("target", "#tab_" + bestFigureOrTable));
        } else if (type === FigureTableType.FIGURE) {
          ref.addAttribute(new Attribute("target", "#fig_" + bestFigureOrTable));
        }
      }
      if (spaceStart) {
        nodes.push(new Text(" "));
      }
      nodes.push(ref);

      if (andWordString !== null) {
        nodes.push(new Text(andWordString));
      }

      if (spaceEnd) {
        nodes.push(new Text(" "));
      }
    }
    return nodes;
  }

  private static readonly patternNumber: RegExp = /\d+/;

  markReferencesEquationTEI(
    text: string | null,
    refTokens: LayoutToken[],
    equations: Equation[] | null,
    generateCoordinates: boolean,
  ): Node[] | null {
    if (text === null || text.trim().length === 0) {
      return null;
    }

    text = TextUtilities.cleanField(text, false)!;
    let textNumber: string | null = null;
    const m = TEIFormatter.patternNumber.exec(text);
    if (m !== null) {
      textNumber = m[0]!;
    }

    const nodes: Node[] = [];

    const textLow = text.toLowerCase();
    let bestFormula: string | null = null;
    if (equations !== null) {
      for (const equation of equations) {
        if (isNotBlank(equation.getLabel())) {
          const label = TextUtilities.cleanField(equation.getLabel(), false)!;
          const m2 = TEIFormatter.patternNumber.exec(label);
          let labelNumber: string | null = null;
          if (m2 !== null) {
            labelNumber = m2[0]!;
          }
          //if ((label.length() > 0) &&
          //        (textLow.contains(label.toLowerCase()))) {
          if (
            (labelNumber !== null &&
              textNumber !== null &&
              labelNumber.length > 0 &&
              labelNumber === textNumber) ||
            (label.length > 0 && textLow === label.toLowerCase())
          ) {
            bestFormula = equation.getId();
            break;
          }
        }
      }
    }

    let spaceEnd = false;
    text = text.replace(/\n/g, " ");
    if (text.endsWith(" ")) spaceEnd = true;
    text = text.trim();

    let coords: string | null = null;
    if (generateCoordinates && refTokens !== null) {
      coords = LayoutTokensUtil.getCoordsString(refTokens);
    }

    const ref = teiElement("ref");
    ref.addAttribute(new Attribute("type", "formula"));

    if (coords !== null) {
      ref.addAttribute(new Attribute("coords", coords));
    }
    ref.appendChild(text);
    if (bestFormula !== null) {
      ref.addAttribute(new Attribute("target", "#formula_" + bestFormula));
    }
    nodes.push(ref);
    if (spaceEnd) nodes.push(new Text(" "));
    return nodes;
  }

  generateURLRef(
    destination: string | null,
    refTokens: LayoutToken[],
    generateCoordinates: boolean,
  ): Element | null {
    if (isEmpty(destination)) {
      return null;
    }

    // For URLs, we remove spaces
    const cleanText = LayoutTokensUtil.toText(refTokens).replace(/\n/g, " ").trim();
    const cleanDestination = destination!.replace(/\n/g, " ").replace(/ /g, "").trim();

    let coords: string | null = null;
    if (generateCoordinates && refTokens !== null) {
      coords = LayoutTokensUtil.getCoordsString(refTokens);
    }

    const ref = teiElement("ref");
    ref.addAttribute(new Attribute("type", "url"));

    if (coords !== null) {
      ref.addAttribute(new Attribute("coords", coords));
    }
    ref.appendChild(cleanText);
    ref.addAttribute(new Attribute("target", cleanDestination));

    return ref;
  }

  // NOTE: upstream marks this private, used internally for whitespace
  // normalisation. Preserved verbatim.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private normalizeText(localText: string): string {
    localText = localText.trim();
    localText = TextUtilities.dehyphenize(localText);
    localText = localText.replace(/\n/g, " ");
    localText = localText.replace(/  /g, " ");

    return localText.trim();
  }

  /**
   * In case the coordinates of structural elements are provided in the TEI
   * representation, we need the page sizes in order to scale the coordinates
   * appropriately. These size information are provided via the TEI facsimile
   * element, with a surface element for each page carrying the page size info.
   */
  toTEIPages(buffer: string, doc: Document, config: GrobidAnalysisConfig): string {
    if (!config.isGenerateTeiCoordinates()) {
      // no cooredinates, nothing to do
      return buffer;
    }

    // page height and width
    const pages: Page[] | null = doc.getPages();
    if (pages === null) return buffer;
    let pageNumber = 1;
    buffer += "\t<facsimile>\n";
    for (const page of pages) {
      buffer += "\t\t<surface ";
      buffer += "n=\"" + pageNumber + "\" ";
      buffer += "ulx=\"0.0\" uly=\"0.0\" ";
      buffer += "lrx=\"" + page.getWidth() + "\" lry=\"" + page.getHeight() + "\"";
      buffer += "/>\n";
      pageNumber++;
    }
    buffer += "\t</facsimile>\n";

    return buffer;
  }
}
