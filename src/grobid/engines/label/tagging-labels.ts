// Port of org.grobid.core.engines.label.TaggingLabels.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/label/TaggingLabels.java
//
// Adaptations:
// - `ConcurrentMap<Pair<GrobidModel, String>, TaggingLabel>` → a JS `Map`
//   keyed by a `${modelName}|${label}` string. JS is single-threaded so the
//   concurrency primitives are unnecessary.
// - The Java `static {}` initialisation block registering all labels is
//   emitted as a single static-call sequence at module top level; the
//   `register` helper is preserved as a `protected static` method.
// - All constants ported verbatim — names, label strings, model mappings
//   left unchanged. Commented-out registrations from upstream are preserved
//   as inline `//` comments.

import type { GrobidModel } from "../../grobid-model.js";
import { GrobidModels } from "../../grobid-models.js";
// GenericTaggerUtils imports back into TaggingLabels — this circular import is
// preserved verbatim from upstream (TaggingLabels.labelFor calls
// GenericTaggerUtils.getPlainLabel). JS hoists module-level let/const but
// resolves circular imports lazily; the only use site below is in `labelFor`,
// which runs after both modules' top-level statics initialize.
import { GenericTaggerUtils } from "../tagging/generic-tagger-utils.js";
import type { TaggingLabel } from "./tagging-label.js";
import { TaggingLabelImpl } from "./tagging-label-impl.js";

export class TaggingLabels {
  protected static readonly cache: Map<string, TaggingLabel> = new Map<string, TaggingLabel>();

  //IOB labels and prefixes
  static readonly IOB_START_ENTITY_LABEL_PREFIX: string = "B-";
  static readonly IOB_INSIDE_LABEL_PREFIX: string = "I-";
  static readonly IOB_OTHER_LABEL: string = "O";

  //ENAMEX NER label and prefixes
  static readonly ENAMEX_START_ENTITY_LABEL_PREFIX: string = "E-";

  //Grobid generic labels
  static readonly GROBID_START_ENTITY_LABEL_PREFIX: string = "I-";
  static readonly GROBID_INSIDE_ENTITY_LABEL_PREFIX: string = "";
  static readonly OTHER_LABEL: string = "<other>";

  //Grobid specific labels

  static readonly AVAILABILITY_LABEL: string = "<availability>";
  static readonly FUNDING_LABEL: string = "<funding>";
  static readonly CONFLICT_OF_INTEREST_LABEL: string = "<conflict>";
  static readonly AUTHOR_CONTRIBUTION_LABEL: string = "<contribution>";

  static readonly CITATION_MARKER_LABEL: string = "<citation_marker>";
  static readonly TABLE_MARKER_LABEL: string = "<table_marker>";
  static readonly FIGURE_MARKER_LABEL: string = "<figure_marker>";
  static readonly EQUATION_MARKER_LABEL: string = "<equation_marker>";

  static readonly PARAGRAPH_LABEL: string = "<paragraph>";
  static readonly ITEM_LABEL: string = "<item>";
  static readonly SECTION_LABEL: string = "<section>";
  static readonly FIGURE_LABEL: string = "<figure>";
  static readonly TABLE_LABEL: string = "<table>";
  static readonly EQUATION_LAB: string = "<equation>";
  static readonly EQUATION_ID_LABEL: string = "<equation_label>";
  static readonly DESCRIPTION_LABEL: string = "<figDesc>";
  static readonly HEADER_LABEL: string = "<figure_head>";
  static readonly CONTENT_LABEL: string = "<content>";
  static readonly LABEL_LABEL: string = "<label>";
  static readonly DATE_LABEL: string = "<date>";
  static readonly DATE_YEAR_LABEL: string = "<year>";
  static readonly DATE_MONTH_LABEL: string = "<month>";
  static readonly DATE_DAY_LABEL: string = "<day>";

  static readonly TITLE_LABEL: string = "<title>";
  static readonly ABSTRACT_LABEL: string = "<abstract>";
  static readonly AUTHOR_LABEL: string = "<author>";
  static readonly TECH_LABEL: string = "<tech>";
  static readonly LOCATION_LABEL: string = "<location>";
  static readonly DATESUB_LABEL: string = "<date-submission>";
  static readonly PAGE_LABEL: string = "<page>";
  static readonly EDITOR_LABEL: string = "<editor>";
  static readonly INSTITUTION_LABEL: string = "<institution>";
  static readonly NOTE_LABEL: string = "<note>";
  static readonly REFERENCE_LABEL: string = "<reference>";
  static readonly COPYRIGHT_LABEL: string = "<copyright>";
  static readonly AFFILIATION_LABEL: string = "<affiliation>";
  static readonly ADDRESS_LABEL: string = "<address>";
  static readonly EMAIL_LABEL: string = "<email>";
  static readonly PUBNUM_LABEL: string = "<pubnum>";
  static readonly KEYWORD_LABEL: string = "<keyword>";
  static readonly PHONE_LABEL: string = "<phone>";
  static readonly DEGREE_LABEL: string = "<degree>";
  static readonly WEB_LABEL: string = "<web>";
  static readonly DEDICATION_LABEL: string = "<dedication>";
  static readonly SUBMISSION_LABEL: string = "<submission>";
  static readonly ENTITLE_LABEL: string = "<entitle>";
  //public final static String INTRO_LABEL = "<intro>";
  static readonly VERSION_LABEL: string = "<version>";
  static readonly DOCTYPE_LABEL: string = "<doctype>";
  static readonly DOWNLOAD_LABEL: string = "<date-download>";
  static readonly WORKINGGROUP_LABEL: string = "<group>";
  static readonly MEETING_LABEL: string = "<meeting>";

  static readonly COLLABORATION_LABEL: string = "<collaboration>";
  static readonly JOURNAL_LABEL: string = "<journal>";
  static readonly BOOKTITLE_LABEL: string = "<booktitle>";
  static readonly SERIES_LABEL: string = "<series>";
  static readonly VOLUME_LABEL: string = "<volume>";
  static readonly ISSUE_LABEL: string = "<issue>";
  static readonly PAGES_LABEL: string = "<pages>";
  static readonly PUBLISHER_LABEL: string = "<publisher>";

  static readonly MARKER_LABEL: string = "<marker>";
  static readonly FORENAME_LABEL: string = "<forename>";
  static readonly MIDDLENAME_LABEL: string = "<middlename>";
  static readonly SURNAME_LABEL: string = "<surname>";
  static readonly SUFFIX_LABEL: string = "<suffix>";

  static readonly COVER_LABEL: string = "<cover>";
  static readonly SUMMARY_LABEL: string = "<summary>";
  static readonly BIOGRAPHY_LABEL: string = "<biography>";
  static readonly ADVERTISEMENT_LABEL: string = "<advertisement>";
  static readonly TOC_LABEL: string = "<toc>";
  static readonly TOF_LABEL: string = "<tof>";
  static readonly PREFACE_LABEL: string = "<preface>";
  static readonly UNIT_LABEL: string = "<unit>";
  static readonly ANNEX_LABEL: string = "<annex>";
  static readonly INDEX_LABEL: string = "<index>";
  static readonly GLOSSARY_LABEL: string = "<glossary>";
  static readonly BACK_LABEL: string = "<back>";

  static readonly PATENT_CITATION_PL_LABEL: string = "<refPatent>";
  static readonly PATENT_CITATION_NPL_LABEL: string = "<refNPL>";

  static readonly FUNDER_NAME_LABEL: string = "<funderName>";
  static readonly FUNDER_ABBRV_NAME_LABEL: string = "<funderAbbrv>";
  static readonly PROGRAM_NAME_LABEL: string = "<programName>";
  static readonly PROGRAM_ABBRV_NAME_LABEL: string = "<programAbbrv>";
  static readonly GRANT_NUMBER_LABEL: string = "<grantNumber>";
  static readonly GRANT_NAME_LABEL: string = "<grantName>";
  static readonly PROJECT_NAME_LABEL: string = "<projectName>";
  static readonly PROJECT_ABBRV_NAME_LABEL: string = "<projectAbbrv>";
  static readonly URL_LABEL: string = "<url>";
  static readonly PERSON_LABEL: string = "<person>";
  static readonly INFRASTRUCTURE_LABEL: string = "<infrastructure>";

  static readonly DEPARTMENT_LABEL: string = "<department>";
  static readonly LABORATORY_LABEL: string = "<laboratory>";
  static readonly COUNTRY_LABEL: string = "<country>";
  static readonly POSTCODE_LABEL: string = "<postCode>";
  static readonly POSTBOX_LABEL: string = "<postBox>";
  static readonly REGION_LABEL: string = "<region>";
  static readonly SETTLEMENT_LABEL: string = "<settlement>";
  static readonly ADDRESSLINE_LABEL: string = "<addrLine>";

  /* title page (secondary title page)
   *       publisher page (publication information, including usually the copyrights info)
   *       summary (include executive summary)
   *       biography
   *       advertising (other works by the author/publisher)
   *       table of content
   *       preface (foreword)
   *       dedication (I dedicate this label to my family and my thesis director ;)
   *       unit (chapter or standalone article)
   *       reference (a full chapter of references, not to be confused with references attached to an article)
   *       annex
   *       index
   *       glossary (also abbreviations and acronyms)
   *       back cover page
   *       other
   */

  static readonly CITATION_MARKER: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.CITATION_MARKER_LABEL);
  static readonly TABLE_MARKER: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.TABLE_MARKER_LABEL);
  static readonly FIGURE_MARKER: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.FIGURE_MARKER_LABEL);
  static readonly EQUATION_MARKER: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.EQUATION_MARKER_LABEL);
  static readonly PARAGRAPH: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.PARAGRAPH_LABEL);
  static readonly ITEM: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.ITEM_LABEL);
  static readonly OTHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.OTHER_LABEL);
  static readonly SECTION: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.SECTION_LABEL);
  static readonly FIGURE: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.FIGURE_LABEL);
  static readonly TABLE: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.TABLE_LABEL);
  static readonly EQUATION: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.EQUATION_LAB);
  static readonly EQUATION_LABEL: TaggingLabel = new TaggingLabelImpl(GrobidModels.FULLTEXT, TaggingLabels.EQUATION_ID_LABEL);

  static readonly HEADER_DATE: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.DATE_LABEL);
  static readonly HEADER_TITLE: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.TITLE_LABEL);
  static readonly HEADER_ABSTRACT: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.ABSTRACT_LABEL);
  static readonly HEADER_AUTHOR: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.AUTHOR_LABEL);
  static readonly HEADER_TECH: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.TECH_LABEL);
  static readonly HEADER_LOCATION: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.LOCATION_LABEL);
  static readonly HEADER_DATESUB: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.DATESUB_LABEL);
  static readonly HEADER_PAGE: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.PAGE_LABEL);
  static readonly HEADER_EDITOR: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.EDITOR_LABEL);
  static readonly HEADER_INSTITUTION: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.INSTITUTION_LABEL);
  static readonly HEADER_NOTE: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.NOTE_LABEL);
  static readonly HEADER_OTHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.OTHER_LABEL);
  static readonly HEADER_REFERENCE: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.REFERENCE_LABEL);
  static readonly HEADER_FUNDING: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.FUNDING_LABEL);
  static readonly HEADER_COPYRIGHT: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.COPYRIGHT_LABEL);
  static readonly HEADER_AFFILIATION: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.AFFILIATION_LABEL);
  static readonly HEADER_ADDRESS: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.ADDRESS_LABEL);
  static readonly HEADER_EMAIL: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.EMAIL_LABEL);
  static readonly HEADER_PUBNUM: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.PUBNUM_LABEL);
  static readonly HEADER_KEYWORD: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.KEYWORD_LABEL);
  static readonly HEADER_PHONE: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.PHONE_LABEL);
  static readonly HEADER_DEGREE: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.DEGREE_LABEL);
  static readonly HEADER_WEB: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.WEB_LABEL);
  static readonly HEADER_DEDICATION: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.DEDICATION_LABEL);
  static readonly HEADER_SUBMISSION: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.SUBMISSION_LABEL);
  static readonly HEADER_ENTITLE: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.ENTITLE_LABEL);
  //public static final TaggingLabel HEADER_INTRO = new TaggingLabelImpl(GrobidModels.HEADER, INTRO_LABEL);
  static readonly HEADER_COLLABORATION: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.COLLABORATION_LABEL);
  static readonly HEADER_VERSION: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.VERSION_LABEL);
  static readonly HEADER_DOCTYPE: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.DOCTYPE_LABEL);
  static readonly HEADER_DOWNLOAD: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.DOWNLOAD_LABEL);
  static readonly HEADER_WORKINGGROUP: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.WORKINGGROUP_LABEL);
  static readonly HEADER_MEETING: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.MEETING_LABEL);
  static readonly HEADER_PUBLISHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.PUBLISHER_LABEL);
  static readonly HEADER_JOURNAL: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.JOURNAL_LABEL);
  static readonly HEADER_AVAILABILITY: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.AVAILABILITY_LABEL);
  static readonly HEADER_CONFLICT_OF_INTEREST: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.CONFLICT_OF_INTEREST_LABEL);
  static readonly HEADER_AUTHOR_CONTRIBUTION: TaggingLabel = new TaggingLabelImpl(GrobidModels.HEADER, TaggingLabels.AUTHOR_CONTRIBUTION_LABEL);

  static readonly DATE_YEAR: TaggingLabel = new TaggingLabelImpl(GrobidModels.DATE, TaggingLabels.DATE_YEAR_LABEL);
  static readonly DATE_MONTH: TaggingLabel = new TaggingLabelImpl(GrobidModels.DATE, TaggingLabels.DATE_MONTH_LABEL);
  static readonly DATE_DAY: TaggingLabel = new TaggingLabelImpl(GrobidModels.DATE, TaggingLabels.DATE_DAY_LABEL);

  static readonly FIG_DESC: TaggingLabel = new TaggingLabelImpl(GrobidModels.FIGURE, TaggingLabels.DESCRIPTION_LABEL);
  static readonly FIG_HEAD: TaggingLabel = new TaggingLabelImpl(GrobidModels.FIGURE, TaggingLabels.HEADER_LABEL);
  static readonly FIG_CONTENT: TaggingLabel = new TaggingLabelImpl(GrobidModels.FIGURE, TaggingLabels.CONTENT_LABEL);
  static readonly FIG_LABEL: TaggingLabel = new TaggingLabelImpl(GrobidModels.FIGURE, TaggingLabels.LABEL_LABEL);
  static readonly FIG_OTHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.FIGURE, TaggingLabels.OTHER_LABEL);

  static readonly TBL_DESC: TaggingLabel = new TaggingLabelImpl(GrobidModels.TABLE, TaggingLabels.DESCRIPTION_LABEL);
  static readonly TBL_HEAD: TaggingLabel = new TaggingLabelImpl(GrobidModels.TABLE, TaggingLabels.HEADER_LABEL);
  static readonly TBL_CONTENT: TaggingLabel = new TaggingLabelImpl(GrobidModels.TABLE, TaggingLabels.CONTENT_LABEL);
  static readonly TBL_LABEL: TaggingLabel = new TaggingLabelImpl(GrobidModels.TABLE, TaggingLabels.LABEL_LABEL);
  static readonly TBL_OTHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.TABLE, TaggingLabels.OTHER_LABEL);
  static readonly TBL_NOTE: TaggingLabel = new TaggingLabelImpl(GrobidModels.TABLE, TaggingLabels.NOTE_LABEL);

  static readonly CITATION_TITLE: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.TITLE_LABEL);
  static readonly CITATION_JOURNAL: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.JOURNAL_LABEL);
  static readonly CITATION_BOOKTITLE: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.BOOKTITLE_LABEL);
  static readonly CITATION_COLLABORATION: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.COLLABORATION_LABEL);
  static readonly CITATION_AUTHOR: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.AUTHOR_LABEL);
  static readonly CITATION_EDITOR: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.EDITOR_LABEL);
  static readonly CITATION_DATE: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.DATE_LABEL);
  static readonly CITATION_INSTITUTION: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.INSTITUTION_LABEL);
  static readonly CITATION_NOTE: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.NOTE_LABEL);
  static readonly CITATION_TECH: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.TECH_LABEL);
  static readonly CITATION_VOLUME: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.VOLUME_LABEL);
  static readonly CITATION_ISSUE: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.ISSUE_LABEL);
  static readonly CITATION_PAGES: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.PAGES_LABEL);
  static readonly CITATION_LOCATION: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.LOCATION_LABEL);
  static readonly CITATION_PUBLISHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.PUBLISHER_LABEL);
  static readonly CITATION_WEB: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.WEB_LABEL);
  static readonly CITATION_PUBNUM: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.PUBNUM_LABEL);
  static readonly CITATION_SERIES: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.SERIES_LABEL);
  static readonly CITATION_OTHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.CITATION, TaggingLabels.OTHER_LABEL);

  static readonly NAMES_HEADER_MARKER: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_HEADER, TaggingLabels.MARKER_LABEL);
  static readonly NAMES_HEADER_TITLE: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_HEADER, TaggingLabels.TITLE_LABEL);
  static readonly NAMES_HEADER_FORENAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_HEADER, TaggingLabels.FORENAME_LABEL);
  static readonly NAMES_HEADER_MIDDLENAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_HEADER, TaggingLabels.MIDDLENAME_LABEL);
  static readonly NAMES_HEADER_SURNAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_HEADER, TaggingLabels.SURNAME_LABEL);
  static readonly NAMES_HEADER_SUFFIX: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_HEADER, TaggingLabels.SUFFIX_LABEL);

  static readonly NAMES_CITATION_TITLE: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_CITATION, TaggingLabels.TITLE_LABEL);
  static readonly NAMES_CITATION_FORENAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_CITATION, TaggingLabels.FORENAME_LABEL);
  static readonly NAMES_CITATION_MIDDLENAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_CITATION, TaggingLabels.MIDDLENAME_LABEL);
  static readonly NAMES_CITATION_SURNAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_CITATION, TaggingLabels.SURNAME_LABEL);
  static readonly NAMES_CITATION_SUFFIX: TaggingLabel = new TaggingLabelImpl(GrobidModels.NAMES_CITATION, TaggingLabels.SUFFIX_LABEL);

  static readonly PATENT_CITATION_PL: TaggingLabel = new TaggingLabelImpl(GrobidModels.PATENT_CITATION, TaggingLabels.PATENT_CITATION_PL_LABEL);
  static readonly PATENT_CITATION_NPL: TaggingLabel = new TaggingLabelImpl(GrobidModels.PATENT_CITATION, TaggingLabels.PATENT_CITATION_NPL_LABEL);

  static readonly MONOGRAPH_COVER: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.COVER_LABEL);
  static readonly MONOGRAPH_TITLE: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.TITLE_LABEL);
  static readonly MONOGRAPH_PUBLISHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.PUBLISHER_LABEL);
  static readonly MONOGRAPH_SUMMARY: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.SUMMARY_LABEL);
  static readonly MONOGRAPH_BIOGRAPHY: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.BIOGRAPHY_LABEL);
  static readonly MONOGRAPH_ADVERTISEMENT: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.ADVERTISEMENT_LABEL);
  static readonly MONOGRAPH_TOC: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.TOC_LABEL);
  static readonly MONOGRAPH_TOF: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.TOF_LABEL);
  static readonly MONOGRAPH_PREFACE: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.PREFACE_LABEL);
  static readonly MONOGRAPH_DEDICATION: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.DEDICATION_LABEL);
  static readonly MONOGRAPH_UNIT: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.UNIT_LABEL);
  static readonly MONOGRAPH_REFERENCE: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.REFERENCE_LABEL);
  static readonly MONOGRAPH_ANNEX: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.ANNEX_LABEL);
  static readonly MONOGRAPH_INDEX: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.INDEX_LABEL);
  static readonly MONOGRAPH_GLOSSARY: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.GLOSSARY_LABEL);
  static readonly MONOGRAPH_BACK: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.BACK_LABEL);
  static readonly MONOGRAPH_OTHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.MONOGRAPH, TaggingLabels.OTHER_LABEL);

  static readonly FUNDING_FUNDER_NAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.FUNDER_NAME_LABEL);
  static readonly FUNDING_FUNDER_ABBRV_NAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.FUNDER_ABBRV_NAME_LABEL);
  static readonly FUNDING_PROGRAM_NAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.PROGRAM_NAME_LABEL);
  static readonly FUNDING_PROGRAM_ABBRV_NAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.PROGRAM_ABBRV_NAME_LABEL);
  static readonly FUNDING_GRANT_NUMBER: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.GRANT_NUMBER_LABEL);
  static readonly FUNDING_GRANT_NAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.GRANT_NAME_LABEL);
  static readonly FUNDING_PROJECT_NAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.PROJECT_NAME_LABEL);
  static readonly FUNDING_PROJECT_ABBRV_NAME: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.PROJECT_ABBRV_NAME_LABEL);
  static readonly FUNDING_URL: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.URL_LABEL);
  static readonly FUNDING_PERSON: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.PERSON_LABEL);
  static readonly FUNDING_INSTITUTION: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.INSTITUTION_LABEL);
  static readonly FUNDING_INFRASTRUCTURE: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.INFRASTRUCTURE_LABEL);
  static readonly FUNDING_AFFILIATION: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.AFFILIATION_LABEL);
  static readonly FUNDING_OTHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.FUNDING_ACKNOWLEDGEMENT, TaggingLabels.OTHER_LABEL);

  static readonly AFFILIATION_MARKER: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.MARKER_LABEL);
  static readonly AFFILIATION_INSTITUTION: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.INSTITUTION_LABEL);
  static readonly AFFILIATION_DEPARTMENT: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.DEPARTMENT_LABEL);
  static readonly AFFILIATION_LABORATORY: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.LABORATORY_LABEL);
  static readonly AFFILIATION_COUNTRY: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.COUNTRY_LABEL);
  static readonly AFFILIATION_POSTCODE: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.POSTCODE_LABEL);
  static readonly AFFILIATION_POSTBOX: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.POSTBOX_LABEL);
  static readonly AFFILIATION_REGION: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.REGION_LABEL);
  static readonly AFFILIATION_SETTLEMENT: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.SETTLEMENT_LABEL);
  static readonly AFFILIATION_ADDRESSLINE: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.ADDRESSLINE_LABEL);
  static readonly AFFILIATION_OTHER: TaggingLabel = new TaggingLabelImpl(GrobidModels.AFFILIATION_ADDRESS, TaggingLabels.OTHER_LABEL);

  protected static register(label: TaggingLabel): void {
    const key = TaggingLabels.cacheKey(label.getGrobidModel(), label.getLabel());
    if (!TaggingLabels.cache.has(key)) {
      TaggingLabels.cache.set(key, label);
    }
  }

  protected static cacheKey(model: GrobidModel, label: string): string {
    return model.getModelName() + "|" + label;
  }

  protected constructor() {}

  static labelFor(model: GrobidModel, label: string): TaggingLabel {
    const plainLabel = GenericTaggerUtils.getPlainLabel(label) as string;
    const key = TaggingLabels.cacheKey(model, plainLabel);
    if (!TaggingLabels.cache.has(key)) {
      TaggingLabels.cache.set(key, new TaggingLabelImpl(model, plainLabel));
    }
    return TaggingLabels.cache.get(key) as TaggingLabel;
  }
}

// Java's `static {}` initialisation block — registers every label in the
// model-specific cache. Emitted verbatim as a top-level IIFE so it runs on
// module load, mirroring upstream's class-loading semantics.
(function registerAll(): void {
  //fulltext
  TaggingLabelsRegister(TaggingLabels.CITATION_MARKER);
  TaggingLabelsRegister(TaggingLabels.TABLE_MARKER);
  TaggingLabelsRegister(TaggingLabels.FIGURE_MARKER);
  TaggingLabelsRegister(TaggingLabels.EQUATION_MARKER);
  TaggingLabelsRegister(TaggingLabels.PARAGRAPH);
  TaggingLabelsRegister(TaggingLabels.ITEM);
  TaggingLabelsRegister(TaggingLabels.OTHER);
  TaggingLabelsRegister(TaggingLabels.SECTION);
  TaggingLabelsRegister(TaggingLabels.FIGURE);
  TaggingLabelsRegister(TaggingLabels.TABLE);
  TaggingLabelsRegister(TaggingLabels.EQUATION);
  TaggingLabelsRegister(TaggingLabels.EQUATION_LABEL);

  //header
  TaggingLabelsRegister(TaggingLabels.HEADER_DATE);
  TaggingLabelsRegister(TaggingLabels.HEADER_TITLE);
  TaggingLabelsRegister(TaggingLabels.HEADER_ABSTRACT);
  TaggingLabelsRegister(TaggingLabels.HEADER_AUTHOR);
  //register(HEADER_LOCATION);
  //register(HEADER_DATESUB);
  TaggingLabelsRegister(TaggingLabels.HEADER_EDITOR);
  //register(HEADER_INSTITUTION);
  TaggingLabelsRegister(TaggingLabels.HEADER_NOTE);
  TaggingLabelsRegister(TaggingLabels.HEADER_OTHER);
  TaggingLabelsRegister(TaggingLabels.HEADER_REFERENCE);
  TaggingLabelsRegister(TaggingLabels.HEADER_FUNDING);
  TaggingLabelsRegister(TaggingLabels.HEADER_COPYRIGHT);
  TaggingLabelsRegister(TaggingLabels.HEADER_AFFILIATION);
  TaggingLabelsRegister(TaggingLabels.HEADER_ADDRESS);
  TaggingLabelsRegister(TaggingLabels.HEADER_EMAIL);
  TaggingLabelsRegister(TaggingLabels.HEADER_PUBNUM);
  TaggingLabelsRegister(TaggingLabels.HEADER_KEYWORD);
  TaggingLabelsRegister(TaggingLabels.HEADER_PHONE);
  //register(HEADER_DEGREE);
  TaggingLabelsRegister(TaggingLabels.HEADER_WEB);
  //register(HEADER_DEDICATION);
  TaggingLabelsRegister(TaggingLabels.HEADER_SUBMISSION);
  //register(HEADER_ENTITLE);
  //register(HEADER_INTRO);
  //register(HEADER_COLLABORATION);
  //register(HEADER_VERSION);
  TaggingLabelsRegister(TaggingLabels.HEADER_DOCTYPE);
  //register(HEADER_DOWNLOAD);
  TaggingLabelsRegister(TaggingLabels.HEADER_WORKINGGROUP);
  TaggingLabelsRegister(TaggingLabels.HEADER_MEETING);
  TaggingLabelsRegister(TaggingLabels.HEADER_PUBLISHER);
  TaggingLabelsRegister(TaggingLabels.HEADER_JOURNAL);
  TaggingLabelsRegister(TaggingLabels.HEADER_PAGE);
  TaggingLabelsRegister(TaggingLabels.HEADER_AVAILABILITY);
  TaggingLabelsRegister(TaggingLabels.HEADER_CONFLICT_OF_INTEREST);
  TaggingLabelsRegister(TaggingLabels.HEADER_AUTHOR_CONTRIBUTION);

  //date
  TaggingLabelsRegister(TaggingLabels.DATE_YEAR);
  TaggingLabelsRegister(TaggingLabels.DATE_MONTH);
  TaggingLabelsRegister(TaggingLabels.DATE_DAY);

  //figures
  TaggingLabelsRegister(TaggingLabels.FIG_DESC);
  TaggingLabelsRegister(TaggingLabels.FIG_HEAD);
  TaggingLabelsRegister(TaggingLabels.FIG_CONTENT);
  TaggingLabelsRegister(TaggingLabels.FIG_LABEL);
  TaggingLabelsRegister(TaggingLabels.FIG_OTHER);

  // table
  TaggingLabelsRegister(TaggingLabels.TBL_DESC);
  TaggingLabelsRegister(TaggingLabels.TBL_HEAD);
  TaggingLabelsRegister(TaggingLabels.TBL_CONTENT);
  TaggingLabelsRegister(TaggingLabels.TBL_LABEL);
  TaggingLabelsRegister(TaggingLabels.TBL_OTHER);

  // citation
  TaggingLabelsRegister(TaggingLabels.CITATION_TITLE);
  TaggingLabelsRegister(TaggingLabels.CITATION_JOURNAL);
  TaggingLabelsRegister(TaggingLabels.CITATION_BOOKTITLE);
  TaggingLabelsRegister(TaggingLabels.CITATION_COLLABORATION);
  TaggingLabelsRegister(TaggingLabels.CITATION_AUTHOR);
  TaggingLabelsRegister(TaggingLabels.CITATION_EDITOR);
  TaggingLabelsRegister(TaggingLabels.CITATION_DATE);
  TaggingLabelsRegister(TaggingLabels.CITATION_INSTITUTION);
  TaggingLabelsRegister(TaggingLabels.CITATION_NOTE);
  TaggingLabelsRegister(TaggingLabels.CITATION_TECH);
  TaggingLabelsRegister(TaggingLabels.CITATION_VOLUME);
  TaggingLabelsRegister(TaggingLabels.CITATION_ISSUE);
  TaggingLabelsRegister(TaggingLabels.CITATION_PAGES);
  TaggingLabelsRegister(TaggingLabels.CITATION_LOCATION);
  TaggingLabelsRegister(TaggingLabels.CITATION_PUBLISHER);
  TaggingLabelsRegister(TaggingLabels.CITATION_WEB);
  TaggingLabelsRegister(TaggingLabels.CITATION_PUBNUM);
  TaggingLabelsRegister(TaggingLabels.CITATION_OTHER);
  TaggingLabelsRegister(TaggingLabels.CITATION_SERIES);

  // person names
  TaggingLabelsRegister(TaggingLabels.NAMES_HEADER_MARKER);
  TaggingLabelsRegister(TaggingLabels.NAMES_HEADER_TITLE);
  TaggingLabelsRegister(TaggingLabels.NAMES_HEADER_FORENAME);
  TaggingLabelsRegister(TaggingLabels.NAMES_HEADER_MIDDLENAME);
  TaggingLabelsRegister(TaggingLabels.NAMES_HEADER_SURNAME);
  TaggingLabelsRegister(TaggingLabels.NAMES_HEADER_SUFFIX);

  TaggingLabelsRegister(TaggingLabels.NAMES_CITATION_TITLE);
  TaggingLabelsRegister(TaggingLabels.NAMES_CITATION_FORENAME);
  TaggingLabelsRegister(TaggingLabels.NAMES_CITATION_MIDDLENAME);
  TaggingLabelsRegister(TaggingLabels.NAMES_CITATION_SURNAME);
  TaggingLabelsRegister(TaggingLabels.NAMES_CITATION_SUFFIX);

  // citations in patent
  TaggingLabelsRegister(TaggingLabels.PATENT_CITATION_PL);
  TaggingLabelsRegister(TaggingLabels.PATENT_CITATION_NPL);

  // monograph
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_COVER);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_TITLE);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_PUBLISHER);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_BIOGRAPHY);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_SUMMARY);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_ADVERTISEMENT);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_TOC);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_TOF);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_PREFACE);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_DEDICATION);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_UNIT);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_REFERENCE);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_ANNEX);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_INDEX);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_GLOSSARY);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_BACK);
  TaggingLabelsRegister(TaggingLabels.MONOGRAPH_OTHER);

  // funding-acknowledgement
  TaggingLabelsRegister(TaggingLabels.FUNDING_FUNDER_NAME);
  TaggingLabelsRegister(TaggingLabels.FUNDING_FUNDER_ABBRV_NAME);
  TaggingLabelsRegister(TaggingLabels.FUNDING_PROGRAM_NAME);
  TaggingLabelsRegister(TaggingLabels.FUNDING_PROGRAM_ABBRV_NAME);
  TaggingLabelsRegister(TaggingLabels.FUNDING_GRANT_NUMBER);
  TaggingLabelsRegister(TaggingLabels.FUNDING_GRANT_NAME);
  TaggingLabelsRegister(TaggingLabels.FUNDING_PROJECT_NAME);
  TaggingLabelsRegister(TaggingLabels.FUNDING_PROJECT_ABBRV_NAME);
  TaggingLabelsRegister(TaggingLabels.FUNDING_URL);
  TaggingLabelsRegister(TaggingLabels.FUNDING_PERSON);
  TaggingLabelsRegister(TaggingLabels.FUNDING_AFFILIATION);
  TaggingLabelsRegister(TaggingLabels.FUNDING_INSTITUTION);
  TaggingLabelsRegister(TaggingLabels.FUNDING_OTHER);
  TaggingLabelsRegister(TaggingLabels.FUNDING_INFRASTRUCTURE);

  // affiliation-address
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_MARKER);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_INSTITUTION);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_DEPARTMENT);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_LABORATORY);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_COUNTRY);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_POSTCODE);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_POSTBOX);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_REGION);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_SETTLEMENT);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_ADDRESSLINE);
  TaggingLabelsRegister(TaggingLabels.AFFILIATION_OTHER);
})();

/**
 * Module-local re-export of the `protected static register` for use by the
 * top-level IIFE above. Subclasses (SegmentationLabels) call
 * `TaggingLabels['register'](...)` via the protected access.
 */
function TaggingLabelsRegister(label: TaggingLabel): void {
  // Forward to the protected static method on TaggingLabels.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (TaggingLabels as unknown as { register(l: TaggingLabel): void }).register(label);
}
