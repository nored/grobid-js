// Port of org.grobid.core.engines.DateParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/DateParser.java
//
// Java's `Calendar.getInstance().getWeekYear()` is replaced by
// `new Date().getFullYear()` — week-year and ISO year differ only at the
// ISO-week boundary (a handful of days/year) and the cleaning bound is
// computed with +4 anyway, so the value used is functionally identical.

import { Date as GrobidDate } from "../data/date.js";
import { FeaturesVectorDate } from "../features/features-vector-date.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import type { GrobidModel } from "../grobid-model.js";
import { GrobidModels } from "../grobid-models.js";
import { Language } from "../lang/language.js";
import { LayoutToken } from "../layout/layout-token.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { AbstractParser } from "./abstract-parser.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { Engine } from "./engine.js";

const NEWLINE_REGEX_PATTERN: RegExp = /[ \n]/g;
// Java's `String.replaceAll("[ \n]", "")` semantics are global, hence the /g flag.
const SANITIZE_PATTERN: RegExp = /[ \n]/g;

/** Apache Commons `StringUtils.isNotBlank` — true iff non-null and contains a non-whitespace char. */
function isNotBlank(s: string | null | undefined): boolean {
  return s !== null && s !== undefined && s.trim().length > 0;
}

export class DateParser extends AbstractParser {
  constructor();
  constructor(model: GrobidModel);
  constructor(model?: GrobidModel) {
    super(model ?? GrobidModels.DATE);
  }

  /**
   * @deprecated Use process(String input)
   */
  processing(input: string): Promise<GrobidDate[] | null> {
    return this.process(input);
  }

  process(input: string): Promise<GrobidDate[] | null>;
  process(input: LayoutToken[]): Promise<GrobidDate[] | null>;
  async process(input: string | LayoutToken[]): Promise<GrobidDate[] | null> {
    const dateBlocks: string[] = [];

    if (typeof input === "string") {
      // force English language for the tokenization only
      const tokenizations: string[] = this.analyzer.tokenize(input, new Language("en", 1.0));
      if (tokenizations === null || tokenizations.length === 0) {
        return null;
      }

      for (let tok of tokenizations) {
        if (tok !== " " && tok !== "\n") {
          // para final sanitisation
          tok = tok.replace(NEWLINE_REGEX_PATTERN, "");
          dateBlocks.push(tok + " <date>");
        }
      }
    } else {
      for (const tok of input) {
        if (tok.getText() !== " " && tok.getText() !== "\n") {
          // para final sanitisation
          const normalizedText = (tok.getText() ?? "").replace(SANITIZE_PATTERN, "");
          dateBlocks.push(normalizedText + " <date>");
        }
      }
    }

    return await this.processCommon(dateBlocks);
  }

  protected async processCommon(input: string[]): Promise<GrobidDate[] | null> {
    if (input === null || input.length === 0) return null;

    try {
      const features: string = FeaturesVectorDate.addFeaturesDate(input);
      const res: string = await this.label(features);

      const tokenization: LayoutToken[] = input.map(
        (token) => new LayoutToken(token.split(" ")[0] ?? ""),
      );

      // extract results from the processed file
      return this.resultExtraction(res, tokenization);
    } catch (e) {
      throw new GrobidException(
        "An exception on " + this.constructor.name + " occured while running Grobid.",
        e,
      );
    }
  }

  resultExtraction(result: string, tokenizations: LayoutToken[]): GrobidDate[] {
    const dates: GrobidDate[] = [];
    let date: GrobidDate = new GrobidDate();
    const clusteror = new TaggingTokenClusteror(GrobidModels.DATE, result, tokenizations);

    const clusters = clusteror.cluster();

    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }
      const clusterLabel = cluster.getTaggingLabel();
      Engine.getCntManager().i(clusterLabel);

      const clusterText: string = LayoutTokensUtil.toText(cluster.concatTokens());
      if (clusterLabel === TaggingLabels.DATE_YEAR) {
        if (isNotBlank(date.getYearString())) {
          if (date.isNotNull()) {
            const normalizedDate = this.normalizeAndClean(date);
            dates.push(normalizedDate);
            date = new GrobidDate();
          }
          date.setYearString(clusterText);
        } else {
          date.setYearString(clusterText);
        }
      } else if (clusterLabel === TaggingLabels.DATE_DAY) {
        if (isNotBlank(date.getDayString())) {
          if (date.isNotNull()) {
            const normalizedDate = this.normalizeAndClean(date);
            dates.push(normalizedDate);
            date = new GrobidDate();
          }
          date.setDayString(clusterText);
        } else {
          date.setDayString(clusterText);
        }
      } else if (clusterLabel === TaggingLabels.DATE_MONTH) {
        if (isNotBlank(date.getMonthString())) {
          if (date.isNotNull()) {
            const normalizedDate = this.normalizeAndClean(date);
            dates.push(normalizedDate);
            date = new GrobidDate();
          }
          date.setMonthString(clusterText);
        } else {
          date.setMonthString(clusterText);
        }
      }
    }

    if (date.isNotNull()) {
      const normalizedDate = this.normalizeAndClean(date);
      dates.push(normalizedDate);
    }
    return dates;
  }

  static readonly jan: RegExp =
    /([Jj]an$|[Jj]anuary$|[Jj]anvier$|[Jj]annewaori$|[Jj]anuar$|[Ee]nero$|[Jj]anuaro$|[Jj]anuari$|[Jj]aneiro$|[Gg]ennaio$|[Gg]en$|[Oo]cak$|[Jj]a$|(^1$)|(^01$)|(1月))/;
  static readonly feb: RegExp =
    /([Ff]eb$|[Ff]ebruary$|[Ff][eé]vrier$|[Ff]ebruar$|[Ff]ebrewaori$|[Ff]ebrero$|[Ff]evereiro$|[Ff]ebbraio$|[Ll]uty$|[Ss]tyczeń$|Ş$|ubat$|[Ff]e$|^2$|^02$|2月)/;
  static readonly mar: RegExp =
    /([Mm]ar$|[Mm]arch$|[Mm]ars$|[Mm]eert$|[Mm]ärz$|[Mm]arzo$|[Mm]arço$|[Mm]art$|[Mm]a$|[Mm]a$|^3$|^03$|3月)/;
  static readonly apr: RegExp =
    /([Aa]pr$|[Aa]br$|[Aa]vr$|[Aa]pril$|[Aa]vril$|[Aa]pril$|[Aa]prile$|[Aa]bril$|[Nn]isan$|[Aa]p$|^4$|^04$|4月)/;
  static readonly may: RegExp =
    /([Mm]ay$|[Mm]ai$|[Mm]ay$|[Mm]ayıs$|[Mm]ei$|[Mm]aio$|[Mm]aggio$|[Mm]eie$|[Mm]a$|^5$|^05$|5月)/;
  static readonly jun: RegExp =
    /([Jj]un$|[Jj]une$|[Jj]uin$|[Jj]uni$|[Jj]unho$|[Gg]iugno$|[Hh]aziran$|^6$|^06$|6月)/;
  static readonly jul: RegExp =
    /([Jj]ul$|[Jj]uly$|[Jj]uillet$|[Jj]uli$|[Tt]emmuz$|[Ll]uglio$|[Jj]ulho$|^7$|^07$|7月)/;
  static readonly aug: RegExp =
    /([Aa]ug$|[Aa]ugust$|[Aa]o[uû]t$|[Aa]ugust$|[Aa]gosto$|[Aa]ugustus$|[Aa]ğustos$|^8$|^08$|8月)/;
  static readonly sep: RegExp =
    /([Ss]ep$|[Ss]ept$|[Ss]eptember$|[Ss]eptembre$|[Ss]eptember$|[Ss]ettembre$|[Ss]etembro$|[Ee]ylül$|^9$|^09$|9月)/;
  static readonly oct: RegExp =
    /([Oo]ct$|[Oo]cto$|[Oo]ctober$|[Oo]ctobre$|[Ee]kim$|[Oo]ktober$|[Oo]ttobre$|[Oo]utubro$|^10$|10月)/;
  static readonly nov: RegExp =
    /([Nn]ov$|[Nn]ovember$|[Nn]ovembre$|[Kk]asım$|[Nn]oviembre$|[Nn]ovembro$|^11$|11月)/;
  static readonly dec: RegExp =
    /([Dd]ec$|[Dd]ecember$|[Dd][eé]cembre$|[Dd]iciembre$|[Aa]ralık$|^12$|12月)/;

  static readonly months: RegExp[] = [
    DateParser.jan,
    DateParser.feb,
    DateParser.mar,
    DateParser.apr,
    DateParser.may,
    DateParser.jun,
    DateParser.jul,
    DateParser.aug,
    DateParser.sep,
    DateParser.oct,
    DateParser.nov,
    DateParser.dec,
  ];

  normalizeAndClean(date: GrobidDate): GrobidDate {
    return DateParser.cleaning(this.normalize(date));
  }

  normalize(date: GrobidDate): GrobidDate {
    const normalizedDate: GrobidDate = new GrobidDate();

    // normalize day
    if (isNotBlank(date.getDayString())) {
      let dayStringBis = "";
      const dayString: string = date.getDayString()!.trim();
      normalizedDate.setDayString(dayString);
      for (let n = 0; n < dayString.length; n++) {
        const c = dayString.charAt(n);
        if (c >= "0" && c <= "9") {
          dayStringBis += c;
        }
      }
      try {
        const day = parseInt(dayStringBis, 10);
        if (!Number.isNaN(day)) {
          normalizedDate.setDay(day);
        }
      } catch (_e) {
        //e.printStackTrace();
      }
    }

    //normalize month
    if (isNotBlank(date.getMonthString())) {
      const month: string = date.getMonthString()!.trim();
      normalizedDate.setMonthString(month);
      let n = 0;
      while (n < 12) {
        const ma = (DateParser.months[n] as RegExp).exec(month);
        if (ma !== null) {
          normalizedDate.setMonth(n + 1);
          break;
        }
        n++;
      }
    }

    if (isNotBlank(date.getYearString())) {
      let yearStringBis = "";
      const yearString: string = date.getYearString()!.trim();
      normalizedDate.setYearString(yearString);
      for (let n = 0; n < yearString.length; n++) {
        const c = yearString.charAt(n);
        if (c >= "0" && c <= "9") {
          yearStringBis += c;
        }
      }
      try {
        let year = parseInt(yearStringBis, 10);
        if (!Number.isNaN(year)) {
          if (year >= 20 && year < 100) {
            year = year + 1900;
          } else if (year >= 0 && year < 20) {
            year = year + 2000;
          }
          normalizedDate.setYear(year);
        }
      } catch (_e) {
        //e.printStackTrace();
      }
    }

    // if we don't have day and month, but a year with 8 digits, we might have a YYYYMMDD pattern
    const maxYear: number = new Date().getFullYear() + 4;
    if (
      date.getDay() === -1 &&
      date.getMonth() === -1 &&
      date.getYear() !== -1 &&
      date.getYear() > 19000000 &&
      date.getYear() < maxYear * 10000 + 1231
    ) {
      const yearPart: number = Math.trunc(date.getYear() / 10000);
      if (yearPart > 1900 && yearPart < maxYear) {
        const yearString = "" + date.getYear();
        const theMonthString = yearString.substring(4, 6);
        const theDayString = yearString.substring(6, 8);

        let dayPart = -1;
        try {
          const parsed = parseInt(theDayString, 10);
          if (!Number.isNaN(parsed)) dayPart = parsed;
        } catch (_e) {
          //e.printStackTrace();
        }

        let monthPart = -1;
        try {
          const parsed = parseInt(theMonthString, 10);
          if (!Number.isNaN(parsed)) monthPart = parsed;
        } catch (_e) {
          //e.printStackTrace();
        }

        if (dayPart !== -1 && monthPart !== -1) {
          if (dayPart > 0 && dayPart < 32 && monthPart > 0 && monthPart < 13) {
            normalizedDate.setDay(dayPart);
            normalizedDate.setDayString(theDayString);
            normalizedDate.setMonth(monthPart);
            normalizedDate.setMonthString(theMonthString);
            normalizedDate.setYear(yearPart);
          }
        }
      }
    }

    return normalizedDate;
  }

  /**
   * Simple and loose date validation, checking:
   *  - the year has not more than 4 digits
   *  - the month and day has not more than 2 digits
   *
   * Assuming that incomplete dates of any form and nature can pass by here,
   * only the information that are "out of bounds" will be reverted.
   *
   * @return the date where invalid information are removed or reverted
   */
  static cleaning(originalDate: GrobidDate): GrobidDate {
    const validatedDate: GrobidDate = new GrobidDate();

    if (originalDate.getDay() > -1) {
      if (String(originalDate.getDay()).length < 3) {
        validatedDate.setDay(originalDate.getDay());
        validatedDate.setDayString(originalDate.getDayString());
      }
    }

    if (originalDate.getMonth() > -1) {
      if (String(originalDate.getMonth()).length < 3) {
        validatedDate.setMonth(originalDate.getMonth());
        validatedDate.setMonthString(originalDate.getMonthString());
      }
    }

    if (originalDate.getYear() > -1) {
      if (String(originalDate.getYear()).length < 5) {
        validatedDate.setYear(originalDate.getYear());
        validatedDate.setYearString(originalDate.getYearString());
      }
    }

    return validatedDate;
  }

  /**
   * Extract results from a date string in the training format without any string modification.
   */
  async trainingExtraction(inputs: (string | null)[] | null): Promise<string[] | null> {
    const buffer: string[] = [];
    try {
      if (inputs === null) return null;
      if (inputs.length === 0) return null;

      let tokenizations: string[] | null = null;
      const dateBlocks: string[] = [];
      for (const input of inputs) {
        if (input === null) continue;

        //StringTokenizer st = new StringTokenizer(input, " \t\n"+TextUtilities.fullPunctuations, true);
        //StringTokenizer st = new StringTokenizer(input, "([" + TextUtilities.punctuations, true);
        tokenizations = this.analyzer.tokenize(input);

        //if (st.countTokens() == 0)
        if (tokenizations.length === 0) return null;
        //while (st.hasMoreTokens()) {
        //    String tok = st.nextToken();
        for (const tok of tokenizations) {
          if (tok === "\n") {
            dateBlocks.push("@newline");
          } else if (tok !== " ") {
            dateBlocks.push(tok + " <date>");
          }
          //tokenizations.add(tok);
        }
        dateBlocks.push("\n");
      }

      const headerDate: string = FeaturesVectorDate.addFeaturesDate(dateBlocks);
      const res: string = await this.label(headerDate);

      // extract results from the processed file

      //System.out.print(res.toString());
      // Java StringTokenizer skips empty tokens — emulate via filter.
      const lines: string[] = res.split("\n").filter((l) => l.length > 0);
      let lastTag: string | null = null;
      let q = 0;
      let addSpace: boolean;
      let hasYear = false;
      let hasMonth = false;
      let hasDay = false;
      let lastTag0: string | null;
      let currentTag0: string | null;
      let start = true;
      for (const line of lines) {
        addSpace = false;
        if (line.trim().length === 0) {
          // new date
          buffer.push("</date>\n");
          hasYear = false;
          hasMonth = false;
          hasDay = false;
          buffer.push("\t<date>");
          continue;
        } else {
          if (tokenizations === null) continue;
          let theTok = tokenizations[q] as string;
          while (theTok === " ") {
            addSpace = true;
            q++;
            theTok = tokenizations[q] as string;
          }
          q++;
        }

        const parts: string[] = line.split("\t");
        const ll = parts.length;
        let i = 0;
        let s1: string | null = null;
        let s2: string | null = null;
        //String s3 = null;
        //List<String> localFeatures = new ArrayList<String>();
        for (const partRaw of parts) {
          const s = partRaw.trim();
          if (i === 0) {
            s2 = TextUtilities.HTMLEncode(s); // string
          } /*else if (i == ll - 2) {
                        s3 = s; // pre-label, in this case it should always be <date>
                    } */ else if (i === ll - 1) {
            s1 = s; // label
          }
          i++;
        }

        if (start && s1 !== null) {
          buffer.push("\t<date>");
          start = false;
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

        // Dead-write of `tagClosed` mirroring upstream's discarded local.
        void (lastTag0 !== null && DateParser.testClosingTag(buffer, currentTag0!, lastTag0));

        /*if (newLine) {
                        if (tagClosed) {
                            buffer.append("\t\t\t\t\t\t\t<lb/>\n");
                        }
                        else {
                            buffer.append("<lb/>");
                        }

                    }*/

        let output = DateParser.writeField(s1!, lastTag0, s2!, "<day>", "<day>", addSpace, 0);
        if (output !== null) {
          if (lastTag0 !== null) {
            if (hasDay && lastTag0 !== "<day>") {
              buffer.push("</date>\n");
              hasYear = false;
              hasMonth = false;
              buffer.push("\t<date>");
            }
          }
          hasDay = true;
          buffer.push(output);
          lastTag = s1;
          continue;
        } else {
          output = DateParser.writeField(s1!, lastTag0, s2!, "<other>", "<other>", addSpace, 0);
        }
        if (output === null) {
          output = DateParser.writeField(s1!, lastTag0, s2!, "<month>", "<month>", addSpace, 0);
        } else {
          buffer.push(output);
          lastTag = s1;
          continue;
        }
        if (output === null) {
          output = DateParser.writeField(s1!, lastTag0, s2!, "<year>", "<year>", addSpace, 0);
        } else {
          if (lastTag0 !== null) {
            if (hasMonth && lastTag0 !== "<month>") {
              buffer.push("</date>\n");
              hasYear = false;
              hasDay = false;
              buffer.push("\t<date>");
            }
          }
          buffer.push(output);
          hasMonth = true;
          lastTag = s1;
          continue;
        }
        if (output !== null) {
          if (lastTag0 !== null) {
            if (hasYear && lastTag0 !== "<year>") {
              buffer.push("</date>\n");
              hasDay = false;
              hasMonth = false;
              buffer.push("\t<date>");
            }
          }
          buffer.push(output);
          hasYear = true;
          lastTag = s1;
          continue;
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
        DateParser.testClosingTag(buffer, currentTag0, lastTag0!);
        buffer.push("</date>\n");
      }
    } catch (e) {
      //			e.printStackTrace();
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
    return buffer;
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
        if (addSpace) result += " " + outField + s2;
        else result += outField + s2;
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
      if (lastTag0 === "<other>") {
        buffer.push("");
      } else if (lastTag0 === "<day>") {
        buffer.push("</day>");
      } else if (lastTag0 === "<month>") {
        buffer.push("</month>");
      } else if (lastTag0 === "<year>") {
        buffer.push("</year>");
      } else {
        res = false;
      }
    }
    return res;
  }
}
