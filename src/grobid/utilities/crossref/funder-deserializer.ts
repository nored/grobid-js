// Port of org.grobid.core.utilities.crossref.FunderDeserializer.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/crossref/FunderDeserializer.java
//
// Convert a JSON Funder model - from a glutton or crossref response - to a
// Funder object (understandable by this stupid GROBID).
//
// Input JSON format is from the REST API query. For example:
// https://api.crossref.org/funders?query=agence+nationale+de+la+recherche
//
// For better data (Crossref funder registry one), we can then use the data API:
// http://data.crossref.org/fundingdata/funder/10.13039/501100001665

import { Funder } from "../../data/funder.js";
import { TextUtilities } from "../text-utilities.js";

import { CrossrefDeserializer, type JsonNode } from "./crossref-deserializer.js";

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asTextOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export class FunderDeserializer extends CrossrefDeserializer<Funder> {
  protected override deserializeOneItem(item: JsonNode): Funder | null {
    let funder: Funder | null = null;
    const type: string | null = null; // the crossref type of the item, see http://api.crossref.org/types
    void type;

    if (isObj(item)) {
      funder = new Funder();
      //System.out.println(item.toString());

      const locationNode = item["location"];
      if (locationNode !== undefined && locationNode !== null) {
        const location = asTextOrNull(locationNode);
        funder.setCountry(location);
      }

      // we always have a uri field, and we can get the DOI from this...
      // surprisingly no DOI field !
      const uriNode = item["uri"];
      if (uriNode !== undefined && uriNode !== null) {
        let uri = asTextOrNull(uriNode);
        if (uri !== null) uri = uri.replace("http://dx.doi.org/", "");
        funder.setDoi(uri);
      }

      const nameNode = item["name"];
      if (nameNode !== undefined && nameNode !== null) {
        const name = asTextOrNull(nameNode);
        funder.setFullName(name);
      }

      const altNamesNode = item["alt-names"];
      if (
        altNamesNode !== undefined &&
        altNamesNode !== null &&
        Array.isArray(altNamesNode) &&
        altNamesNode.length > 0
      ) {
        // here we just keep an acronym form - better names with lang info via the data API
        for (let i = 0; i < altNamesNode.length; i++) {
          const altName = asTextOrNull(altNamesNode[i]);
          if (altName === null) continue;
          if (altName === "INCa") {
            funder.setAbbreviatedName("INCa");
            funder.setFullName("Institut National du Cancer");
            break;
          } else if (altName === "Anses") {
            funder.setAbbreviatedName("Anses");
            funder.setFullName(
              "Agence nationale de recherches sur le sida et les hépatites virales",
            );
            break;
          } else if (TextUtilities.isAllUpperCase(altName) && altName.length < 10) {
            funder.setAbbreviatedName(altName);
            break;
          }
        }
      }

      //System.out.println(funder.toTEI());
    }

    return funder;
  }
}
