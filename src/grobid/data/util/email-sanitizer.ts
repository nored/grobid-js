// Port of org.grobid.core.data.util.EmailSanitizer.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/util/EmailSanitizer.java

/**
 * Splits and cleans email address strings, handling common encoding
 * artifacts and removing blacklisted institutional addresses.
 */
export class EmailSanitizer {
  private static readonly DASHES_PATTERN_SRC = "(%E2%80%90|%e2%80%90)";

  private static readonly BLACKLISTED_EMAIL_WORDS: ReadonlySet<string> = new Set([
    "firstname",
    "lastname",
    "publication",
    "theses",
    "thesis",
    "editor",
    "press",
    "contact",
    "info",
    "feedback",
    "journal",
    "please",
    "pubs",
    "iza@iza",
    "admin",
    "help",
    "subs",
    "news",
    "archives",
    "order",
    "postmaster@",
    "informa",
    "reprint",
    "comunicacion@",
    "revista",
    "digitalcommons",
    "group@",
    "root@",
    "deposit@",
    "studies",
    "permiss",
    "print",
    "paper",
    "report",
    "support",
    "pedocs",
    "investigaciones@",
    "medicin",
    "copyright",
    "rights",
    "sales@",
    "pacific@",
    "redaktion",
    "publicidad",
    "surface@",
    "comstat@",
    "service@",
    "omnia@",
    "letter",
    "scholar",
    "staff",
    "delivery",
    "epubs",
    "office",
    "technolog",
    "compute",
    "elsevier",
  ]);

  // EMAIL_STRIP_PATTERNS use Matcher.replaceAll => global flag in JS.
  private static readonly EMAIL_STRIP_PATTERN_SOURCES: readonly string[] = [
    "^(e\\-mail|email|e\\smail|mail):",
    "[\\r\\n\\t ]", // newlines, tabs and spaces
    "\\(.*\\)$",
  ];

  private static readonly AT_SYMBOL_REPLACEMENT_SOURCES: readonly string[] = [
    "&#64;",
    "@\\.",
    "\\.@",
  ];

  // Java: Pattern.compile("(\\sor\\s|,|;|/)")
  private static readonly EMAIL_SPLITTER_PATTERN = /(\sor\s|,|;|\/)/g;

  // Java: Pattern.compile("@")
  private static readonly AT_SPLITTER = /@/g;

  /**
   * @param addresses email addresses
   * @return cleaned addresses (null if none survive cleaning)
   */
  splitAndClean(addresses: string[] | null): string[] | null {
    if (addresses == null) {
      return null;
    }

    const result: string[] = [];
    const emails = new Set<string>();
    for (let emailAddress of addresses) {
      emailAddress = this.initialReplace(emailAddress);

      // Guava Splitter.on(EMAIL_SPLITTER_PATTERN).omitEmptyStrings()
      // Java's Pattern-based Splitter doesn't include the delimiter; JS's
      // String.split with a capturing group does, so we filter out the
      // capture matches as well.
      const splitEmails = EmailSanitizer.splitOmitEmpty(emailAddress.toLowerCase(), /(\sor\s|,|;|\/)/g);

      if (splitEmails.length > 1) {
        // Some emails are of the form jiglesia,cmt@ll.iac.es or jiglesia;cmt@ll.iac.es or bono/caputo/vittorio@mporzio.astro.it
        const atSeparatedStrings = EmailSanitizer.splitOmitEmpty(emailAddress.toLowerCase(), /@/g);
        if (atSeparatedStrings.length === 2) {
          // Only the last email address has a domain, so append it to the rest of the splitted emails
          const last = splitEmails[splitEmails.length - 1]!;
          const atIndex = last.indexOf("@");
          const domain = last.substring(atIndex + 1);
          for (let i = 0; i < splitEmails.length - 1; i++) {
            splitEmails[i] = splitEmails[i] + "@" + domain;
          }
        }
      }

      for (const splitEmail of splitEmails) {
        let email: string | null;
        try {
          email = EmailSanitizer.cleanEmail(splitEmail);
        } catch (e) {
          // Cleaning failed so its probably an invalid email so don't keep it
          continue;
        }

        if (email != null && email.length > 0) {
          // Check for duplicate emails
          if (emails.has(email)) {
            continue;
          }

          email = EmailSanitizer.postValidateAddress(email);

          if (email == null) {
            continue;
          }

          emails.add(email);
          result.push(email);
        }
      }
    }

    if (result.length === 0) {
      return null;
    }

    return result;
  }

  /**
   * Mirror of Guava's `Splitter.on(<Pattern>).omitEmptyStrings().split(s)`.
   * The pattern is matched globally; the parts between matches are kept,
   * and empty strings (between consecutive matches or at the boundaries)
   * are dropped.
   */
  private static splitOmitEmpty(s: string, pattern: RegExp): string[] {
    // Make a fresh non-capturing regex with the global flag.
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    const re = new RegExp(pattern.source.replace(/^\((?!\?)/, "(?:"), flags);
    const out: string[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      const seg = s.substring(last, m.index);
      if (seg.length > 0) out.push(seg);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++; // avoid zero-width loop
    }
    const tail = s.substring(last);
    if (tail.length > 0) out.push(tail);
    return out;
  }

  private initialReplace(email: string): string {
    email = email.replace(/\{/g, "");
    email = email.replace(/\}/g, "");
    email = email.replace(/\(/g, "");
    email = email.replace(/\)/g, "").trim();
    email = email.replace(/(E|e)lectronic(\s)(A|a)ddress(\:)?/g, "");
    email = email.replace(/^(e|E)?(\-)?mail(\:)?(\s)(A|a)ddress(\:)?/g, "");
    email = email.replace(/^(e|E)?(\-)?mail(\:)?(\s)?/g, "");
    // case: Peter Pan -peter.pan@email.org with asterisks and spaces
    email = email.replace(/^[A-Z][a-z]+\s+[A-Z][a-z]+(\*)?(\s)*-(\s)*/g, "");
    return email;
  }

  private static postValidateAddress(emStr: string): string | null {
    let orig = emStr;
    for (const b of EmailSanitizer.BLACKLISTED_EMAIL_WORDS) {
      if (orig.includes(b)) {
        return null;
      }
    }

    for (const src of EmailSanitizer.EMAIL_STRIP_PATTERN_SOURCES) {
      orig = orig.replace(new RegExp(src, "g"), "");
    }

    if (!orig.includes("@")) {
      return null;
    }

    return orig;
  }

  private static cleanEmail(email: string | null): string | null {
    if (email == null) {
      return null;
    }

    // Fix any incorrect dashes
    email = email.replace(new RegExp(EmailSanitizer.DASHES_PATTERN_SRC, "g"), "-");

    // Some emails may contain HTML encoded characters, so decode just in case.
    // Java upstream uses URLDecoder.decode(email, "UTF-8") which:
    // - decodes %XX sequences
    // - turns '+' into ' '
    // - throws on malformed sequences (caller catches)
    email = EmailSanitizer.urlDecode(email);

    email = email.toLowerCase().trim();

    for (const src of EmailSanitizer.EMAIL_STRIP_PATTERN_SOURCES) {
      email = email.replace(new RegExp(src, "g"), "");
    }

    for (const src of EmailSanitizer.AT_SYMBOL_REPLACEMENT_SOURCES) {
      email = email.replace(new RegExp(src, "g"), "@");
    }
    return email;
  }

  /**
   * Mirrors Java's `URLDecoder.decode(s, "UTF-8")`: convert '+' to ' ',
   * then decode percent-encoded UTF-8 bytes. Throws on malformed input,
   * matching the upstream contract that the caller catches the exception.
   */
  private static urlDecode(s: string): string {
    return decodeURIComponent(s.replace(/\+/g, " "));
  }
}
