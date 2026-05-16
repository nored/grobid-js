// Minimal default LanguageDetector + SentenceDetector implementations that
// the JS port wires in at Engine boot. Upstream defaults to Cybozu (language)
// and OpenNLP / Pragmatic (sentence) — both are Java libraries with no
// drop-in JS equivalent on disk. Without these factories registered, the
// upstream-ported Segmentation constructor throws because LanguageUtilities
// requires a configured factory at instance init.
//
// These defaults are intentionally simple, no-op-ish stand-ins so the
// pipeline boots and we can measure parity. They are NOT a faithful port
// of Cybozu / OpenNLP. Replacing them with real ports is tracked in
// UPSTREAM-BUGS.md (or a dedicated todo list); for now they unblock Phase 8.
//
//   - "Always English" language detector returns Language(en, 1.0).
//   - Naive period-based sentence splitter: splits on `.!?` followed by
//     whitespace, preserving offsets. Good enough to feed downstream code
//     that just needs SOME segmentation; not byte-equivalent to upstream.

import { Language } from "../grobid/lang/language.js";
import type { LanguageDetector } from "../grobid/lang/language-detector.js";
import type { LanguageDetectorFactory } from "../grobid/lang/language-detector-factory.js";
import { registerLanguageDetectorFactory } from "../grobid/lang/language-detector-factory.js";
import type { SentenceDetector } from "../grobid/lang/sentence-detector.js";
import type { SentenceDetectorFactory } from "../grobid/lang/sentence-detector-factory.js";
import { registerSentenceDetectorFactory } from "../grobid/lang/sentence-detector-factory.js";
import { OffsetPosition } from "../grobid/utilities/offset-position.js";

const ALWAYS_EN_FQCN = "io.grobidjs.lang.AlwaysEnglishLanguageDetectorFactory";
const NAIVE_SENT_FQCN = "io.grobidjs.lang.NaiveSentenceDetectorFactory";

class AlwaysEnglishLanguageDetector implements LanguageDetector {
  detect(_text: string): Language {
    return new Language(Language.EN, 1.0);
  }
}

class AlwaysEnglishLanguageDetectorFactory implements LanguageDetectorFactory {
  private readonly singleton = new AlwaysEnglishLanguageDetector();
  getInstance(): LanguageDetector {
    return this.singleton;
  }
}

class NaiveSentenceDetector implements SentenceDetector {
  detect(text: string): OffsetPosition[];
  detect(text: string, lang: Language | null): OffsetPosition[];
  detect(text: string, _lang?: Language | null): OffsetPosition[] {
    const out: OffsetPosition[] = [];
    let start = 0;
    const len = text.length;
    for (let i = 0; i < len; i++) {
      const ch = text.charCodeAt(i);
      // Period / question mark / exclamation followed by whitespace ends a sentence.
      if (ch === 46 /* . */ || ch === 63 /* ? */ || ch === 33 /* ! */) {
        let j = i + 1;
        while (j < len && /\s/.test(text.charAt(j))) j++;
        if (j > i + 1 || j === len) {
          // Skip empty trailing fragments.
          if (start < i + 1) out.push(new OffsetPosition(start, i + 1));
          start = j;
          i = j - 1;
        }
      }
    }
    if (start < len) out.push(new OffsetPosition(start, len));
    return out;
  }
}

class NaiveSentenceDetectorFactory implements SentenceDetectorFactory {
  private readonly singleton = new NaiveSentenceDetector();
  getInstance(): SentenceDetector {
    return this.singleton;
  }
}

let registered = false;

/**
 * Register the JS-side default detectors. Idempotent — safe to call from
 * every `Grobid` constructor.
 * Returns the FQCN strings to write into `grobid.yaml`.
 */
export function registerDefaultDetectors(): { languageFqcn: string; sentenceFqcn: string } {
  if (!registered) {
    registerLanguageDetectorFactory(ALWAYS_EN_FQCN, AlwaysEnglishLanguageDetectorFactory);
    registerSentenceDetectorFactory(NAIVE_SENT_FQCN, NaiveSentenceDetectorFactory);
    registered = true;
  }
  return { languageFqcn: ALWAYS_EN_FQCN, sentenceFqcn: NAIVE_SENT_FQCN };
}
