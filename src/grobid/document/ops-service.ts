// Port of org.grobid.core.document.OPSService.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/OPSService.java
//
// Usage of the EPO OPS service for online interactive version of patent
// document retrieval. We use a POST request since the EPO wsdl file
// results in a terrible mess with WSDL2Java.
//
// There is now however a new REST interface that should be used instead of
// the SOAP one.
//
// Service "fair use" implies no more than 6 request per minutes and up to
// 20 query per batch SOAP envelope.

import { Buffer } from "node:buffer";
import { connect } from "node:net";
import { TextSaxParser } from "../sax/text-sax-parser.js";

/**
 * Upstream OPSService.java line 27-150.
 */
export class OPSService {
  // Upstream line 29.
  constructor() {
    // empty
  }

  // Upstream line 31-32.
  static OPS_HOST: string = "ops.epo.org";
  static OPS_PORT: number = 80;

  // Upstream line 34-52.
  stripNonValidXMLCharacters(input: string | null): string {
    const out: string[] = [];
    let current: number;
    if (input === null || input === "") return "";
    for (let i = 0; i < input.length; i++) {
      current = input.charCodeAt(i);
      if (
        current === 0x9 ||
        current === 0xa ||
        current === 0xd ||
        (current >= 0x20 && current <= 0xd7ff) ||
        (current >= 0xe000 && current <= 0xfffd) ||
        (current >= 0x10000 && current <= 0x10ffff)
      ) {
        out.push(input.charAt(i));
      }
    }
    return out.join("");
  }

  /**
   * Access to full text for a given patent publication number.
   *
   * Upstream line 58-148. Async in TS because Node sockets are async.
   */
  async descriptionRetrieval(patentNumber: string): Promise<string | null> {
    try {
      // header
      let envelope = '<?xml version="1.0" encoding="UTF-8"?>\n';
      envelope +=
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ops="http://ops.epo.org" xmlns:exc="http://www.epo.org/exchange">\n';
      envelope += "<soapenv:Header/>\n";
      envelope += "<soapenv:Body>\n";
      envelope += '<ops:description-retrieval format="text-only" format-version="1.0">\n';

      // body
      envelope += '<exc:publication-reference data-format="epodoc">\n';
      envelope += "<exc:document-id>\n";
      envelope += "<exc:doc-number>" + patentNumber + "</exc:doc-number>\n";
      envelope += "</exc:document-id>\n";
      envelope += "</exc:publication-reference>\n";

      envelope += "</ops:description-retrieval>\n";
      envelope += "</soapenv:Body>\n";
      envelope += "</soapenv:Envelope>\n";

      // Create socket.
      const path = "/soap-services/description-retrieval";
      const reqHeader =
        "POST " + path + " HTTP/1.0\r\n" +
        "Host: " + OPSService.OPS_HOST + "\r\n" +
        "SOAPAction: description-retrieval\r\n" +
        "Content-Length: " + envelope.length + "\r\n" +
        'Content-Type: text/xml; charset="utf-8"\r\n' +
        "\r\n";

      const responseBody = await new Promise<string>((resolve, reject) => {
        const sock = connect({ host: OPSService.OPS_HOST, port: OPSService.OPS_PORT }, () => {
          sock.write(reqHeader, "utf8");
          sock.write(envelope, "utf8");
        });
        const chunks: Buffer[] = [];
        sock.on("data", (c: Buffer) => chunks.push(c));
        sock.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        sock.on("error", (err: Error) => reject(err));
      });

      // Response — strip the HTTP headers and start at `<?xml`.
      const sb: string[] = [];
      let toRead = false;
      for (const line of responseBody.split(/\r?\n/)) {
        let curr = line;
        if (curr.startsWith("<?xml")) toRead = true;
        if (toRead) {
          curr = this.stripNonValidXMLCharacters(curr);
          sb.push(curr);
        }
      }

      // Parse with TextSaxParser. Upstream configures the SAXParser with
      // disabled features (external entities, DTD, namespaces) — our SAX
      // walker is namespace-free and DTD-free by construction.
      const sax = new TextSaxParser();
      sax.parse(sb.join(""));

      const res = sax.getText();
      if (res !== null) return res;
      return null;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
    return null;
  }
}
