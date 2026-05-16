// Port of org.grobid.core.data.Date.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Date.java
//
// Class for representing a date.
// We use our own representation of dates for having a comparable which prioritize the most fully specified
// dates first, then the earliest date, i.e.:
//   10.2010 < 2010
//   20.10.2010 < 10.2010
//   19.10.2010 < 20.10.2010
//   1999 < 10.2000
//   10.1999 < 2000
// which is not the same as a comparison based only on time flow.
// For comparing dates by strict time flow, please use java.util.Date + java.util.Calendar.

import { TextUtilities } from "../utilities/text-utilities.js";

/**
 * Class for representing a date.
 */
export class Date {
  private day: number = -1;
  private month: number = -1;
  private year: number = -1;
  private rawDate: string | null = null;
  private dayString: string | null = null;
  private monthString: string | null = null;
  private yearString: string | null = null;

  // Upstream has two constructors:
  //   Date()
  //   Date(Date fromDate)  — copy constructor
  // Collapsed into a single signature.
  constructor(fromDate?: Date) {
    if (fromDate === undefined) {
      return;
    }
    this.day = fromDate.day;
    this.month = fromDate.month;
    this.year = fromDate.year;
    this.rawDate = fromDate.rawDate;
    this.dayString = fromDate.dayString;
    this.monthString = fromDate.monthString;
    this.yearString = fromDate.yearString;
  }

  getDay(): number {
    return this.day;
  }

  setDay(d: number): void {
    this.day = d;
  }

  getMonth(): number {
    return this.month;
  }

  setMonth(d: number): void {
    this.month = d;
  }

  getYear(): number {
    return this.year;
  }

  setYear(d: number): void {
    this.year = d;
  }

  getRawDate(): string | null {
    return this.rawDate;
  }

  setRawDate(s: string | null): void {
    this.rawDate = s;
  }

  getDayString(): string | null {
    return this.dayString;
  }

  setDayString(d: string | null): void {
    this.dayString = d;
  }

  getMonthString(): string | null {
    return this.monthString;
  }

  setMonthString(d: string | null): void {
    this.monthString = d;
  }

  getYearString(): string | null {
    return this.yearString;
  }

  setYearString(d: string | null): void {
    this.yearString = d;
  }

  /**
   * The lowest date always win.
   */
  compareTo(another: Date): number {
    const BEFORE = -1;
    const EQUAL = 0;
    const AFTER = 1;

    if (another.getYear() === -1) {
      return BEFORE;
    } else if (this.year === -1) {
      return AFTER;
    } else if (this.year < another.getYear()) {
      return BEFORE;
    } else if (this.year > another.getYear()) {
      return AFTER;
    } else {
      // years are identical
      if (another.getMonth() === -1) {
        return BEFORE;
      } else if (this.month === -1) {
        return AFTER;
      } else if (this.month < another.getMonth()) {
        return BEFORE;
      } else if (this.month > another.getMonth()) {
        return AFTER;
      } else {
        // months are identical
        if (another.getDay() === -1) {
          return BEFORE;
        } else if (this.day === -1) {
          return AFTER;
        } else if (this.day < another.getDay()) {
          return BEFORE;
        } else if (this.day > another.getDay()) {
          return AFTER;
        }
      }
    }

    return EQUAL;
  }

  isNotNull(): boolean {
    return (this.rawDate !== null) ||
      (this.dayString !== null) ||
      (this.monthString !== null) ||
      (this.yearString !== null) ||
      (this.day !== -1) ||
      (this.month !== -1) ||
      (this.year !== -1);
  }

  isAmbiguous(): boolean {
    return false;
  }

  static toISOString(date: Date): string {
    const year = date.getYear();
    const month = date.getMonth();
    const day = date.getDay();

    let when = "";
    if (year !== -1) {
      if (year <= 9)
        when += "000" + year;
      else if (year <= 99)
        when += "00" + year;
      else if (year <= 999)
        when += "0" + year;
      else
        when += year;
      if (month !== -1) {
        if (month <= 9)
          when += "-0" + month;
        else
          when += "-" + month;
        if (day !== -1) {
          if (day <= 9)
            when += "-0" + day;
          else
            when += "-" + day;
        }
      }
    }
    return when;
  }

  /**
   * Return a new date instance by merging the date information from a first date with
   * the date information from a second date.
   * The merging follows the year, month, day sequence. If the years
   * for instance clash, the merging is stopped.
   *
   * Examples of merging:
   *   "2010" "2010-10" -> "2010-10"
   *   "2010" "2010-10-27" -> "2010-10-27"
   *   "2010-10" "2010-10-27" -> "2010-10-27"
   *   "2010-10-27" "2010-10" -> "2010-10-27"
   *   "2011-10" "2010-10-27" -> "2011-10"
   *   "2010" "2016-10-27" -> "2010"
   *   "2011" "2010" -> 2011
   */
  static merge(date1: Date, date2: Date): Date {
    if (date1.getYear() === -1) {
      return new Date(date2);
    }

    if (date1.getYear() === date2.getYear()) {
      if (date1.getMonth() === -1 && date2.getMonth() !== -1) {
        return new Date(date2);
      }
      if (date1.getMonth() === date2.getMonth()) {
        if (date1.getDay() === -1 && date2.getDay() !== -1) {
          return new Date(date2);
        }
      }
    }

    return new Date(date1);
  }

  toString(): string {
    let theDate = "";
    if (this.day !== -1) {
      theDate += this.day + "-";
    }
    if (this.month !== -1) {
      theDate += this.month + "-";
    }
    if (this.year !== -1) {
      theDate += this.year;
    }

    theDate += " / ";

    if (this.dayString !== null) {
      theDate += this.dayString + "-";
    }
    if (this.monthString !== null) {
      theDate += this.monthString + "-";
    }
    if (this.yearString !== null) {
      theDate += this.yearString;
    }

    return theDate;
  }

  toTEI(): string {
    // TEI uses ISO 8601 for date encoding
    let theDate = "<date when=\"";
    if (this.year !== -1) {
      theDate += this.year;
    }
    if (this.month !== -1) {
      theDate += "-" + this.month;
    }
    if (this.day !== -1) {
      theDate += "-" + this.day;
    }

    if (this.rawDate !== null) {
      theDate += "\">" + TextUtilities.HTMLEncode(this.rawDate) + "</date>";
    } else {
      theDate += "\" />";
    }

    return theDate;
  }

  toXML(): string {
    let theDate = "<date>";
    if (this.day !== -1) {
      theDate += "<day>" + this.day + "</day>";
    }
    if (this.month !== -1) {
      theDate += "<month>" + this.month + "</month>";
    }
    if (this.year !== -1) {
      theDate += "<year>" + this.year + "</year>";
    }

    theDate += "</date>";

    return theDate;
  }
}

// Alias to avoid the name clash with the JS built-in `Date` in callers that
// import the type as `GrobidDate` (see e.g. `data/funder.ts`).
export { Date as GrobidDate };
