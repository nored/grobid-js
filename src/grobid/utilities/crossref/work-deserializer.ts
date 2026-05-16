// Port of org.grobid.core.utilities.crossref.WorkDeserializer.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/crossref/WorkDeserializer.java
//
// Convert a JSON Work model - from a glutton or crossref response - to a
// BiblioItem (understandable by this stupid GROBID).

import { BiblioItem } from "../../data/biblio-item.js";
import { GrobidDate } from "../../data/date.js";
import { Person } from "../../data/person.js";

import { CrossrefDeserializer, type JsonNode } from "./crossref-deserializer.js";

interface JsonObj {
  [key: string]: unknown;
}

function isObj(v: unknown): v is JsonObj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asTextOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export class WorkDeserializer extends CrossrefDeserializer<BiblioItem> {
  protected override deserializeOneItem(item: JsonNode): BiblioItem | null {
    let biblio: BiblioItem | null = null;
    let type: string | null = null; // the crossref type of the item, see http://api.crossref.org/types

    if (isObj(item)) {
      biblio = new BiblioItem();
      //System.out.println(item.toString());

      const doiNode = item["DOI"];
      if (doiNode !== undefined && doiNode !== null) {
        const doi = asTextOrNull(doiNode);
        biblio.setDOI(doi);
      }

      const halNode = item["halId"];
      if (halNode !== undefined && halNode !== null) {
        const halId = asTextOrNull(halNode);
        biblio.setHalId(halId);
      }

      // the following are usually provided by biblio-glutton which index augmented/aggregated
      // metadata
      const pmidNode = item["pmid"];
      if (pmidNode !== undefined && pmidNode !== null) {
        const pmid = asTextOrNull(pmidNode);
        biblio.setPMID(pmid);
      }

      const pmcidNode = item["pmcid"];
      if (pmcidNode !== undefined && pmcidNode !== null) {
        const pmcid = asTextOrNull(pmcidNode);
        biblio.setPMCID(pmcid);
      }

      const piiNode = item["pii"];
      if (piiNode !== undefined && piiNode !== null) {
        const pii = asTextOrNull(piiNode);
        biblio.setPII(pii);
      }

      const arkNode = item["ark"];
      if (arkNode !== undefined && arkNode !== null) {
        const ark = asTextOrNull(arkNode);
        biblio.setArk(ark);
      }

      const istexNode = item["istexId"];
      if (istexNode !== undefined && istexNode !== null) {
        const istexId = asTextOrNull(istexNode);
        biblio.setIstexId(istexId);
      }

      // the open access url - if available, from the glorious UnpayWall dataset provided
      // by biblio-glutton
      const oaLinkNode = item["oaLink"];
      if (oaLinkNode !== undefined && oaLinkNode !== null) {
        const oaLink = asTextOrNull(oaLinkNode);
        biblio.setOAURL(oaLink);
      }

      // all the following is now pure crossref metadata
      const typeNode = item["type"];
      if (typeNode !== undefined && typeNode !== null) {
        type = asTextOrNull(typeNode);
      }

      const titlesNode = item["title"];
      if (titlesNode !== undefined && titlesNode !== null && Array.isArray(titlesNode) && titlesNode.length > 0) {
        biblio.setTitle(asTextOrNull(titlesNode[0]));
      }

      const authorsNode = item["author"];
      if (authorsNode !== undefined && authorsNode !== null && Array.isArray(authorsNode) && authorsNode.length > 0) {
        for (const authorNode of authorsNode) {
          if (!isObj(authorNode)) continue;

          const person = new Person();
          const given = authorNode["given"];
          if (given !== undefined && given !== null) {
            person.setFirstName(asTextOrNull(given));
            person.normalizeCrossRefFirstName();
          }
          const family = authorNode["family"];
          if (family !== undefined && family !== null) {
            person.setLastName(asTextOrNull(family));
          }
          const orcid = authorNode["ORCID"];
          if (orcid !== undefined && orcid !== null) {
            person.setORCID(asTextOrNull(orcid));
          }
          // for cases like JM Smith and for case normalisation
          person.normalizeName();
          biblio.addFullAuthor(person);
        }
      }

      const publisherNode = item["publisher"];
      if (publisherNode !== undefined && publisherNode !== null)
        biblio.setPublisher(asTextOrNull(publisherNode));

      const pageNode = item["page"];
      if (pageNode !== undefined && pageNode !== null) biblio.setPageRange(asTextOrNull(pageNode));

      const volumeNode = item["volume"];
      if (volumeNode !== undefined && volumeNode !== null)
        biblio.setVolumeBlock(asTextOrNull(volumeNode) ?? "", false);

      const issueNode = item["issue"];
      if (issueNode !== undefined && issueNode !== null) biblio.setIssue(asTextOrNull(issueNode));

      const containerTitlesNode = item["container-title"];
      if (
        containerTitlesNode !== undefined &&
        containerTitlesNode !== null &&
        Array.isArray(containerTitlesNode) &&
        containerTitlesNode.length > 0
      ) {
        // container title depends on the type of object
        // if journal
        if (type !== null && type === "journal-article")
          biblio.setJournal(asTextOrNull(containerTitlesNode[0]));

        // if book chapter or proceedings article
        if (
          type !== null &&
          (type === "book-section" ||
            type === "proceedings-article" ||
            type === "book-chapter")
        )
          biblio.setBookTitle(asTextOrNull(containerTitlesNode[0]));
      }

      const shortContainerTitlesNode = item["short-container-title"];
      if (
        shortContainerTitlesNode !== undefined &&
        shortContainerTitlesNode !== null &&
        Array.isArray(shortContainerTitlesNode) &&
        shortContainerTitlesNode.length > 0
      ) {
        // container title depends on the type of object
        // if journal
        if (type !== null && type === "journal-article")
          biblio.setJournalAbbrev(asTextOrNull(shortContainerTitlesNode[0]));
      }

      const issnTypeNode = item["issn-type"];
      if (
        issnTypeNode !== undefined &&
        issnTypeNode !== null &&
        Array.isArray(issnTypeNode) &&
        issnTypeNode.length > 0
      ) {
        for (const issnNode of issnTypeNode) {
          if (!isObj(issnNode)) continue;
          const theTypeNode = issnNode["type"];
          const valueNode = issnNode["value"];

          if (
            theTypeNode !== undefined &&
            theTypeNode !== null &&
            valueNode !== undefined &&
            valueNode !== null
          ) {
            const theType = asTextOrNull(theTypeNode);
            if (theType === "print") {
              biblio.setISSN(asTextOrNull(valueNode));
            } else if (theType === "electronic") {
              biblio.setISSNe(asTextOrNull(valueNode));
            }
          }
        }
      }

      let publishPrintNode: unknown = item["issued"];
      if (publishPrintNode === undefined || publishPrintNode === null) {
        publishPrintNode = item["published-online"];
      }
      if (publishPrintNode === undefined || publishPrintNode === null) {
        publishPrintNode = item["published-print"];
      }
      if (publishPrintNode === undefined || publishPrintNode === null) {
        publishPrintNode = item["published"];
      }
      if (publishPrintNode !== undefined && publishPrintNode !== null && isObj(publishPrintNode)) {
        const datePartNode = (publishPrintNode as JsonObj)["date-parts"];
        if (
          datePartNode !== undefined &&
          datePartNode !== null &&
          Array.isArray(datePartNode) &&
          datePartNode.length > 0
        ) {
          const firstDatePartNode = datePartNode[0];
          if (
            firstDatePartNode !== undefined &&
            firstDatePartNode !== null &&
            Array.isArray(firstDatePartNode) &&
            firstDatePartNode.length > 0
          ) {
            // format is [year, month, day], last two optional
            const year = asTextOrNull(firstDatePartNode[0]);
            let month: string | null = null;
            let day: string | null = null;
            if (firstDatePartNode.length > 1) {
              month = asTextOrNull(firstDatePartNode[1]);
              if (firstDatePartNode.length > 2) {
                day = asTextOrNull(firstDatePartNode[2]);
              }
            }
            const date = new GrobidDate();
            date.setYearString(year);
            let yearInt = -1;
            try {
              yearInt = parseInt(year ?? "", 10);
              if (Number.isNaN(yearInt)) yearInt = -1;
            } catch (e) {
              // log something
              void e;
            }
            if (yearInt !== -1) date.setYear(yearInt);

            if (month !== null) {
              date.setMonthString(month);
              let monthInt = -1;
              try {
                monthInt = parseInt(month, 10);
                if (Number.isNaN(monthInt)) monthInt = -1;
              } catch (e) {
                // log something
                void e;
              }
              if (monthInt !== -1) date.setMonth(monthInt);
            }

            if (day !== null) {
              date.setDayString(day);
              let dayInt = -1;
              try {
                dayInt = parseInt(day, 10);
                if (Number.isNaN(dayInt)) dayInt = -1;
              } catch (e) {
                // log something
                void e;
              }
              if (dayInt !== -1) date.setDay(dayInt);
            }
            biblio.setNormalizedPublicationDate(date);
          }
        }
      }

      //System.out.println(biblio.toTEI(0));
    }

    return biblio;
  }
}
