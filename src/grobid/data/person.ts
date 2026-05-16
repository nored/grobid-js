// Port of org.grobid.core.data.Person.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Person.java
//
// Class for representing and exchanging person information, e.g. author or editor.

import { LayoutToken } from "../layout/layout-token.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { Affiliation } from "./affiliation.js";
import { normalizePersonName, normalizePersonNames } from "./person-name-normalizer.js";

/** Mirrors `org.apache.commons.lang3.StringUtils.isEmpty`. */
function isEmptyStr(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.length === 0;
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isNotBlank`. */
function isNotBlank(s: string | null | undefined): boolean {
  if (s === null || s === undefined) return false;
  for (let i = 0; i < s.length; i++) {
    if (!/\s/.test(s.charAt(i))) return true;
  }
  return false;
}

/** Mirrors `StringUtils.normalizeSpace`. */
function normalizeSpace(s: string | null): string | null {
  if (s === null) return null;
  return s.replace(/\s+/g, " ").trim();
}

/** Mirrors `org.apache.commons.collections4.CollectionUtils.isEmpty` for arrays. */
function isCollectionEmpty<T>(c: T[] | null | undefined): boolean {
  return c === null || c === undefined || c.length === 0;
}

/** Mirrors `java.lang.Character.isUpperCase(char)`. */
function isUpperCase(c: string): boolean {
  if (c.length === 0) return false;
  return /\p{Lu}/u.test(c);
}

/** Mirrors `java.lang.Character.isLowerCase(char)`. */
function isLowerCase(c: string): boolean {
  if (c.length === 0) return false;
  return /\p{Ll}/u.test(c);
}

/**
 * Class for representing and exchanging person information, e.g. author or editor.
 */
export class Person {
  private firstName: string | null = null;
  private middleName: string | null = null;
  private lastName: string | null = null;
  private title: string | null = null;
  private suffix: string | null = null;
  private rawName: string | null = null; // raw full name if relevant/available, e.g. name exactly as displayed
  private orcid: string | null = null;
  private corresp: boolean = false;

  private layoutTokens: LayoutToken[] = [];
  private affiliationBlocks: string[] | null = null;
  private affiliations: Affiliation[] | null = null;
  private affiliationMarkers: string[] | null = null;
  private markers: string[] | null = null;

  private email: string | null = null;

  getFirstName(): string | null {
    return this.firstName;
  }

  setFirstName(f: string | null): void {
    this.firstName = f;
  }

  getMiddleName(): string | null {
    return this.middleName;
  }

  setMiddleName(f: string | null): void {
    this.middleName = f;
  }

  getLastName(): string | null {
    return this.lastName;
  }

  setLastName(f: string | null): void {
    this.lastName = f;
  }

  getRawName(): string | null {
    return this.rawName;
  }

  setRawName(name: string | null): void {
    this.rawName = name;
  }

  getTitle(): string | null {
    return this.title;
  }

  setTitle(f: string | null): void {
    if (f !== null) {
      while (f.startsWith("(")) {
        f = f.substring(1, f.length);
      }

      while (f.endsWith(")")) {
        f = f.substring(0, f.length - 1);
      }
    }

    this.title = f;
  }

  getSuffix(): string | null {
    return this.suffix;
  }

  setSuffix(s: string | null): void {
    this.suffix = s;
  }

  getCorresp(): boolean {
    return this.corresp;
  }

  setCorresp(b: boolean): void {
    this.corresp = b;
  }

  getORCID(): string | null {
    return this.orcid;
  }

  setORCID(id: string | null): void {
    if (id === null)
      return;
    if (id.startsWith("http://orcid.org/"))
      id = id.replace("http://orcid.org/", "");
    else if (id.startsWith("https://orcid.org/"))
      id = id.replace("https://orcid.org/", "");
    this.orcid = id;
  }

  getAffiliationBlocks(): string[] | null {
    return this.affiliationBlocks;
  }

  setAffiliationBlocks(blocks: string[] | null): void {
    this.affiliationBlocks = blocks;
  }

  addAffiliationBlocks(f: string): void {
    if (this.affiliationBlocks === null)
      this.affiliationBlocks = [];
    this.affiliationBlocks.push(f);
  }

  getAffiliations(): Affiliation[] | null {
    return this.affiliations;
  }

  addAffiliation(f: Affiliation): void {
    if (this.affiliations === null)
      this.affiliations = [];
    this.affiliations.push(f);
  }

  getAffiliationMarkers(): string[] | null {
    return this.affiliationMarkers;
  }

  setAffiliationMarkers(affiliationMarkers: string[] | null): void {
    this.affiliationMarkers = affiliationMarkers;
  }

  addAffiliationMarker(s: string): void {
    if (this.affiliationMarkers === null)
      this.affiliationMarkers = [];
    this.affiliationMarkers.push(s);
  }

  setAffiliations(f: Affiliation[] | null): void {
    this.affiliations = f;
  }

  getMarkers(): string[] | null {
    return this.markers;
  }

  setMarkers(markers: string[] | null): void {
    this.markers = markers;
  }

  addMarker(f: string): void {
    if (this.markers === null)
      this.markers = [];
    f = f.replace(/ /g, "");
    this.markers.push(f);
  }

  getEmail(): string | null {
    return this.email;
  }

  setEmail(f: string | null): void {
    this.email = f;
  }

  notNull(): boolean {
    if ((this.firstName === null) &&
      (this.middleName === null) &&
      (this.lastName === null) &&
      (this.title === null)
    )
      return false;
    else
      return true;
  }

  /**
   * Create a new instance of Person object from current instance (shallow copy)
   */
  clonePerson(): Person {
    const person = new Person();
    person.firstName = this.firstName;
    person.middleName = this.middleName;
    person.lastName = this.lastName;
    person.title = this.title;
    person.suffix = this.suffix;
    person.rawName = this.rawName;
    person.orcid = this.orcid;
    person.corresp = this.corresp;
    person.email = this.email;

    if (this.layoutTokens !== null)
      person.layoutTokens = [...this.layoutTokens];
    if (this.affiliationBlocks !== null)
      person.affiliationBlocks = [...this.affiliationBlocks];
    if (this.affiliations !== null)
      person.affiliations = [...this.affiliations];
    if (this.affiliationMarkers !== null)
      person.affiliationMarkers = [...this.affiliationMarkers];
    if (this.markers !== null)
      person.markers = [...this.markers];

    return person;
  }

  toString(): string {
    let res = "";
    if (this.title !== null)
      res += this.title + " ";
    if (this.firstName !== null)
      res += this.firstName + " ";
    if (this.middleName !== null)
      res += this.middleName + " ";
    if (this.lastName !== null)
      res += this.lastName + " ";
    if (this.suffix !== null)
      res += this.suffix;
    if (this.email !== null) {
      res += " (email:" + this.email + ")";
    }
    if (this.orcid !== null) {
      res += " (orcid:" + this.orcid + ")";
    }
    if (this.affiliations !== null) {
      for (const aff of this.affiliations) {
        res += " (affiliation: " + aff.toString() + ") ";
      }
    }
    return res.trim();
  }

  getLayoutTokens(): LayoutToken[] {
    return this.layoutTokens;
  }

  setLayoutTokens(tokens: LayoutToken[]): void {
    this.layoutTokens = tokens;
  }

  /**
   * TEI serialization via xom.
   */
  appendLayoutTokens(theTokens: LayoutToken[]): void {
    if (this.layoutTokens === null) {
      this.layoutTokens = [];
    }
    for (const t of theTokens) this.layoutTokens.push(t);
  }

  /**
   * TEI serialization based on string builder (XOM-equivalent).
   *
   * Upstream uses XmlBuilderUtils to build via xom and serializes the result.
   * We produce the same XML string directly: a TEI-namespaced `persName`
   * element with optional `coords` attribute and the standard child elements.
   * The namespace declaration matches the XOM output so that the downstream
   * `localString.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "")` strip
   * call (see `BiblioItem.toTEIAuthorBlock`) operates identically.
   */
  toTEI(withCoordinates: boolean): string | null;
  /**
   * TEI serialization based on string builder, it allows to avoid namespaces and to better control
   * the formatting.
   */
  toTEI(withCoordinates: boolean, indent: number): string | null;
  toTEI(withCoordinates: boolean, indent?: number): string | null {
    if (indent === undefined) {
      // XOM-equivalent string serialization
      if ((this.firstName === null) && (this.middleName === null) &&
        (this.lastName === null)) {
        return null;
      }

      const buf: string[] = [];
      buf.push("<persName xmlns=\"http://www.tei-c.org/ns/1.0\"");
      if (withCoordinates && (this.getLayoutTokens() !== null) && (this.getLayoutTokens().length > 0)) {
        // XOM addCoords appends `coords="..."` attribute.
        buf.push(" coords=\"" + LayoutTokensUtil.getCoordsString(this.getLayoutTokens()) + "\"");
      }
      buf.push(">");
      if (this.title !== null) {
        buf.push("<roleName>" + (TextUtilities.HTMLEncode(this.title) ?? "") + "</roleName>");
      }
      if (this.firstName !== null) {
        buf.push("<forename type=\"first\">" + (TextUtilities.HTMLEncode(this.firstName) ?? "") + "</forename>");
      }
      if (this.middleName !== null) {
        buf.push("<forename type=\"middle\">" + (TextUtilities.HTMLEncode(this.middleName) ?? "") + "</forename>");
      }
      if (this.lastName !== null) {
        buf.push("<surname>" + (TextUtilities.HTMLEncode(this.lastName) ?? "") + "</surname>");
      }
      if (this.suffix !== null) {
        buf.push("<genName>" + (TextUtilities.HTMLEncode(this.suffix) ?? "") + "</genName>");
      }
      buf.push("</persName>");
      return buf.join("");
    }

    // indent variant
    if ((this.firstName === null) && (this.middleName === null) && (this.lastName === null)) {
      return null;
    }

    const tei: string[] = [];

    for (let i = 0; i < indent; i++) {
      tei.push("\t");
    }
    tei.push("<persName");
    if (withCoordinates && (this.getLayoutTokens() !== null) && (this.getLayoutTokens().length > 0)) {
      tei.push(" ");
      tei.push(LayoutTokensUtil.getCoordsString(this.getLayoutTokens()));
    }
    tei.push(">\n");

    if (!isEmptyStr(this.title)) {
      for (let i = 0; i < indent + 1; i++) {
        tei.push("\t");
      }
      tei.push("<roleName>" + TextUtilities.HTMLEncode(this.title) + "</roleName>\n");
    }

    if (!isEmptyStr(this.firstName)) {
      for (let i = 0; i < indent + 1; i++) {
        tei.push("\t");
      }
      tei.push("<forename type=\"first\">" + TextUtilities.HTMLEncode(this.firstName) + "</forename>\n");
    }

    if (!isEmptyStr(this.middleName)) {
      for (let i = 0; i < indent + 1; i++) {
        tei.push("\t");
      }
      tei.push("<forename type=\"middle\">" + TextUtilities.HTMLEncode(this.middleName) + "</forename>\n");
    }

    if (!isEmptyStr(this.lastName)) {
      for (let i = 0; i < indent + 1; i++) {
        tei.push("\t");
      }
      tei.push("<surname>" + TextUtilities.HTMLEncode(this.lastName) + "</surname>\n");
    }

    if (!isEmptyStr(this.suffix)) {
      for (let i = 0; i < indent + 1; i++) {
        tei.push("\t");
      }
      tei.push("<genName>" + TextUtilities.HTMLEncode(this.suffix) + "</genName>\n");
    }

    for (let i = 0; i < indent; i++) {
      tei.push("\t");
    }
    tei.push("</persName>");

    return tei.join("");
  }

  // list of character delimiters for capitalising names
  private static readonly NAME_DELIMITERS: string = "-.,;:/_ ";

  /*static public String normalizeName(String inputName) {
      return TextUtilities.capitalizeFully(inputName, NAME_DELIMITERS);
  }*/

  /**
   * This normalisation takes care of uniform case for name components and for
   * transforming agglutinated initials (like "JM" in JM Smith)
   * which are put into the firstname into separate initials in first and middle names.
   */
  normalizeName(): void {
    if (isEmptyStr(this.middleName) && !isEmptyStr(this.firstName) &&
      (this.firstName!.length === 2) && (TextUtilities.isAllUpperCase(this.firstName!))) {
      this.middleName = this.firstName!.substring(1, 2);
      this.firstName = this.firstName!.substring(0, 1);
    }

    this.firstName = TextUtilities.capitalizeFully(this.firstName, Person.NAME_DELIMITERS);
    this.middleName = TextUtilities.capitalizeFully(this.middleName, Person.NAME_DELIMITERS);
    this.lastName = TextUtilities.capitalizeFully(this.lastName, Person.NAME_DELIMITERS);
  }

  // assume never more than 3 initials
  //private Pattern initials = Pattern.compile("([A-Z])(?:\\.)\\s?(?:([A-Z])(?:\\.))?\\s?(?:([A-Z])(?:\\.))?");

  /**
   * First names coming from CrossRef are clearly heavily impacted by the original publisher
   * formats and a large variety of forms can be seen, with some information lost apparently.
   */
  normalizeCrossRefFirstName(): void {
    // first name can be initial with a dot, e.g. "M." or without a dot
    // <forename type="first">H</forename>

    // firstname can be initials with appended middlename also as initials,
    // with or without space, e.g. "M. L." or
    // <forename type="first">L.S.</forename>

    // normal full first name can be appended with middlename initials with dots but
    // no space e.g. "Nicholas J.", "John W.S."

    // we have also destructive case normalization done at CrossRef or by publishers
    // like "Zs. Biró"

    let first: string | null = null;
    let middle: string | null = null;

    /*Matcher m = initials.matcher(firstName);
    while(m.find()) {
        count++;
        System.out.println("Match number "+count);
        System.out.println("start(): "+m.start());
        System.out.println("end(): "+m.end());
        if (count != 0) {

        }
    }*/

    this.firstName = this.firstName!.replace(/\./g, ". ");
    this.firstName = normalizeSpace(this.firstName);

    // check first the specific case "Zs. Biró" - given the we've never observed three
    // letters first name like "Zsv. Biró"
    if (this.firstName!.endsWith(".") && (this.firstName!.length === 3) &&
      isUpperCase(this.firstName!.charAt(0)) && isLowerCase(this.firstName!.charAt(1))) {
      this.middleName = this.firstName!.substring(1, 2);
      this.firstName = this.firstName!.substring(0, 1);
    }

    // check the specific case of composed forenames which are often but not always lost
    // ex: "J.-L. Arsuag"
    if (this.firstName!.indexOf("-") !== -1) {
      const tokens = this.firstName!.replace(/ /g, "").split("-");
      if (tokens.length === 2) {
        if (tokens[0]!.endsWith(".") && (tokens[0]!.length === 2))
          first = "" + tokens[0]!.charAt(0);
        else if (tokens[0]!.length === 1)
          first = tokens[0]!;
        if (tokens[1]!.endsWith(".") && (tokens[1]!.length === 2))
          first += "-" + tokens[1]!.charAt(0);
        else if (tokens[1]!.length === 1)
          first += "-" + tokens[1]!;
      }
    } else {
      const tokens = this.firstName!.split(" ");
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (i !== 0) {
          if (first !== null) {
            if (tokens[i]!.endsWith(".") && (tokens[i]!.length === 2)) {
              // (case "G. Arjen")
              first = tokens[i]!.charAt(0) + " " + first;
            } else {
              // multiple token first name
              first = tokens[i]! + " " + first;
            }
          } else if ((tokens[i]!.endsWith(".") && (tokens[i]!.length === 2)) ||
            (tokens[i]!.length === 1)) {
            // we have an initials in secondary position, this is a middle name
            if (middle === null)
              middle = "" + tokens[i]!.charAt(0);
            else
              middle = tokens[i]!.charAt(0) + " " + middle;
          } else {
            if (middle === null)
              middle = tokens[i]!;
            else
              middle = tokens[i]! + " " + middle;
          }
        } else {
          // we check if we have an initial at the beginning (case "G. Arjen")
          if (tokens[i]!.endsWith(".") && (tokens[i]!.length === 2)) {
            if (first === null)
              first = "" + tokens[i]!.charAt(0);
            else
              first = tokens[i]! + " " + first;
          } else {
            if (first === null)
              first = tokens[i]!;
            else
              first = tokens[i]! + " " + first;
          }
        }
      }
    }

    if (first !== null)
      this.firstName = first;
    if (middle !== null)
      this.middleName = middle;

    // dirty case <forename type="first">HermanHG</forename><surname>Teerink</surname>
    if ((this.firstName !== null) && (this.middleName === null) && (this.firstName.length > 2) &&
      isUpperCase(this.firstName.charAt(this.firstName.length - 1)) &&
      isLowerCase(this.firstName.charAt(1))) {
      let i = this.firstName.length - 1;
      while (i > 1) {
        if (isUpperCase(this.firstName.charAt(i))) {
          if (this.middleName === null)
            this.middleName = "" + this.firstName.charAt(i);
          else
            this.middleName = this.firstName.charAt(i) + " " + this.middleName;
        } else
          break;
        i--;
      }
      this.firstName = this.firstName.substring(0, i + 1);
    }


    // for cases like JM Smith and for case normalisation
    this.normalizeName();

    // cleaning for CrossRef middlenames
    if (this.middleName !== null) {
      this.middleName = this.middleName.replace(/\./g, ". ");
      this.middleName = this.middleName.replace(/ {2}/g, " ");
    }

    // other weird stuff: <forename type="first">G. Arjen</forename><surname>de Groot</surname>

    // also note that language specific case practice are usually not expected
    // e.g. H Von Allmen, J De
  }

  /**
   * Return true if the person structure is a valid person name, in our case
   * with at least a lastname or a raw name.
   */
  isValid(): boolean {
    if ((this.lastName === null) && (this.rawName === null))
      return false;
    else
      return true;
  }


  /**
   * Deduplicate person names, optionally attached to affiliations, based
   * on common forename/surname, taking into account abbreviated forms
   */
  static deduplicate(persons: Person[] | null): Person[] | null {
    if (persons === null)
      return null;
    if (persons.length === 0)
      return persons;

    // we create a signature per person based on lastname and first name first letter
    const signatures: Map<string, Person[]> = new Map<string, Person[]>();

    for (const person of persons) {
      if (person.getLastName() === null || person.getLastName()!.trim().length === 0) {
        // the minimal information to deduplicate is not available
        continue;
      }
      let signature = person.getLastName()!.toLowerCase();
      if (person.getFirstName() !== null && person.getFirstName()!.trim().length !== 0) {
        signature += "_" + person.getFirstName()!.substring(0, 1);
      }
      let localPersons = signatures.get(signature);
      if (localPersons === undefined) {
        localPersons = [];
      }
      localPersons.push(person);
      signatures.set(signature, localPersons);
    }

    // upstream iterates a TreeMap (sorted by key); we mirror by sorting keys.
    const sortedKeys = Array.from(signatures.keys()).sort();

    // match signature and check possible affiliation information
    for (const key of sortedKeys) {
      let localPersons = signatures.get(key)!;
      if (localPersons.length > 1) {
        // candidate for deduplication, check full forenames and middlenames to check if there is a clash
        const newLocalPersons: Person[] = [];
        for (let j = 0; j < localPersons.length; j++) {
          const localPerson = localPersons[j]!;
          let localFirstName = localPerson.getFirstName();
          if (localFirstName !== null) {
            localFirstName = localFirstName.toLowerCase();
            localFirstName = localFirstName.replace(/[\-\.]/g, "");
          }
          let localMiddleName = localPerson.getMiddleName();
          if (localMiddleName !== null) {
            localMiddleName = localMiddleName.toLowerCase();
            localMiddleName = localMiddleName.replace(/[\-\.]/g, "");
          }
          let nbClash = 0;
          for (let k = 0; k < localPersons.length; k++) {
            let clash = false;
            if (k === j)
              continue;
            const otherPerson = localPersons[k]!;
            let otherFirstName = otherPerson.getFirstName();
            if (otherFirstName !== null) {
              otherFirstName = otherFirstName.toLowerCase();
              otherFirstName = otherFirstName.replace(/[\-\.]/g, "");
            }
            let otherMiddleName = otherPerson.getMiddleName();
            if (otherMiddleName !== null) {
              otherMiddleName = otherMiddleName.toLowerCase();
              otherMiddleName = otherMiddleName.replace(/[\-\.]/g, "");
            }

            // test first name clash
            if (localFirstName !== null && otherFirstName !== null) {
              if (localFirstName.length === 1 && otherFirstName.length === 1) {
                if (localFirstName !== otherFirstName) {
                  clash = true;
                }
              } else {
                if (localFirstName !== otherFirstName &&
                  !localFirstName.startsWith(otherFirstName) &&
                  !otherFirstName.startsWith(localFirstName)
                ) {
                  clash = true;
                }
              }
            }

            // test middle name clash
            if (!clash) {
              if (localMiddleName !== null && otherMiddleName !== null) {
                if (localMiddleName.length === 1 && otherMiddleName.length === 1) {
                  if (localMiddleName !== otherMiddleName) {
                    clash = true;
                  }
                } else {
                  if (localMiddleName !== otherMiddleName &&
                    !localMiddleName.startsWith(otherMiddleName) &&
                    !otherMiddleName.startsWith(localMiddleName)
                  ) {
                    clash = true;
                  }
                }
              }
            }

            if (clash) {
              // increase the clash number for index j
              nbClash++;
            }
          }

          if (nbClash === 0) {
            newLocalPersons.push(localPerson);
          }
        }

        localPersons = newLocalPersons;

        if (localPersons.length > 1) {
          // if identified duplication, keep the most complete person form and the most complete
          // affiliation information
          const localPerson = localPersons[0]!;
          let localFirstName = localPerson.getFirstName();
          if (localFirstName !== null)
            localFirstName = localFirstName.toLowerCase();
          let localMiddleName = localPerson.getMiddleName();
          if (localMiddleName !== null)
            localMiddleName = localMiddleName.toLowerCase();
          let localTitle = localPerson.getTitle();
          if (localTitle !== null)
            localTitle = localTitle.toLowerCase();
          let localSuffix = localPerson.getSuffix();
          if (localSuffix !== null)
            localSuffix = localSuffix.toLowerCase();
          // upstream declares `aff` but never reads it — preserved as dead local.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const aff = localPerson.getAffiliations();
          for (let i = 1; i < localPersons.length; i++) {
            const otherPerson = localPersons[i]!;
            // try to enrich first Person object
            let otherFirstName = otherPerson.getFirstName();
            if (otherFirstName !== null)
              otherFirstName = otherFirstName.toLowerCase();
            let otherMiddleName = otherPerson.getMiddleName();
            if (otherMiddleName !== null)
              otherMiddleName = otherMiddleName.toLowerCase();
            let otherTitle = otherPerson.getTitle();
            if (otherTitle !== null)
              otherTitle = otherTitle.toLowerCase();
            let otherSuffix = otherPerson.getSuffix();
            if (otherSuffix !== null)
              otherSuffix = otherSuffix.toLowerCase();

            if ((localFirstName === null && otherFirstName !== null) ||
              (localFirstName !== null && otherFirstName !== null &&
                otherFirstName.length > localFirstName.length)) {
              localPerson.setFirstName(otherPerson.getFirstName());
              localFirstName = localPerson.getFirstName()!.toLowerCase();
            }

            if ((localMiddleName === null && otherMiddleName !== null) ||
              (localMiddleName !== null && otherMiddleName !== null &&
                otherMiddleName.length > localMiddleName.length)) {
              localPerson.setMiddleName(otherPerson.getMiddleName());
              localMiddleName = localPerson.getMiddleName()!.toLowerCase();
            }

            if ((localTitle === null && otherTitle !== null) ||
              (localTitle !== null && otherTitle !== null &&
                otherTitle.length > localTitle.length)) {
              localPerson.setTitle(otherPerson.getTitle());
              localTitle = localPerson.getTitle()!.toLowerCase();
            }

            if ((localSuffix === null && otherSuffix !== null) ||
              (localSuffix !== null && otherSuffix !== null &&
                otherSuffix.length > localSuffix.length)) {
              localPerson.setSuffix(otherPerson.getSuffix());
              localSuffix = localPerson.getSuffix()!.toLowerCase();
            }

            const otherOrcid = otherPerson.getORCID();
            if (otherOrcid !== null)
              localPerson.setORCID(otherOrcid);

            if (otherPerson.getAffiliations() !== null) {
              for (const affOther of otherPerson.getAffiliations()!) {
                localPerson.addAffiliation(affOther);
              }
            }

            if (otherPerson.getAffiliationBlocks() !== null) {
              for (const block of otherPerson.getAffiliationBlocks()!) {
                localPerson.addAffiliationBlocks(block);
              }
            }

            if (otherPerson.getMarkers() !== null) {
              for (const marker of otherPerson.getMarkers()!) {
                if (localPerson.getMarkers() === null || !localPerson.getMarkers()!.includes(marker))
                  localPerson.addMarker(marker);
              }
            }

            if (localPerson.getEmail() === null)
              localPerson.setEmail(otherPerson.getEmail());

            const otherIdx = persons.indexOf(otherPerson);
            if (otherIdx !== -1)
              persons.splice(otherIdx, 1);
          }
        }
      }
    }

    return persons;
  }


  /**
   * Remove invalid/impossible person names (no last names, noise, etc.)
   */
  static sanityCheck(persons: Person[] | null): Person[] | null {
    if (persons === null) {
      return null;
    }

    if (isCollectionEmpty(persons)) {
      return persons;
    }

    const result: Person[] = [];

    for (const person of persons) {
      if (isNotBlank(person.getLastName())) {
        result.push(person);
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Author-name post-processing (grobid-js port-only — not present upstream).
  //
  // The string-cleaning rules live in person-name-normalizer.ts so a unit
  // test can exercise them without pulling Person's transitive import graph
  // (Affiliation → Lexicon → ... → engine plumbing) along.
  // -------------------------------------------------------------------------

  /**
   * Post-process this person's name fields. See {@link normalizePersonName}
   * for the exact rules — strips honorifics ("Mr.", "Dr.", "Prof.") from
   * forenames, footnote markers (digits, `*`, `†`, `‡`, `§`, `¶`, `+`, `#`)
   * from surnames, and trims stray edge punctuation / whitespace. Idempotent.
   */
  postProcessName(): void {
    normalizePersonName(this);
  }

  /**
   * Apply {@link postProcessName} across a list of persons. Accepts and
   * returns `null` unchanged so this can be inline-piped after
   * {@link Person.sanityCheck} / {@link Person.deduplicate}.
   */
  static postProcessNames(persons: Person[] | null): Person[] | null {
    return normalizePersonNames(persons);
  }
}
