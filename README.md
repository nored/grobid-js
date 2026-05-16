# grobid-js

A pure JS / TypeScript port of [GROBID](https://github.com/kermitt2/grobid) — scientific PDF → TEI-XML extraction in Node and the browser, no Docker, no Java.

## Status

- **Wapiti CRF path**: ties upstream Java GROBID byte-for-byte on the test corpus.
- **BiLSTM_CRF_FEATURES path** (opt-in): ONNX runtime, modest quality wins on author + affiliation extraction.
- **Auto-download**: Wapiti model weights and pdfalto binary are fetched on first run.

## Install

```sh
npm install grobid-js
```

## Quick start

```ts
import { Grobid } from "grobid-js/node";

const g = new Grobid();
const tei = await g.processPdf("path/to/paper.pdf");
console.log(tei);
```

Models and the pdfalto binary auto-download to `~/.cache/grobid-js/` on first call. To pin specific paths:

```ts
const g = new Grobid({
  modelsDir: "/path/to/grobid-home/models",
  lexiconDir: "/path/to/grobid-home/lexicon",
  pdfaltoOptions: { binaryPath: "/path/to/pdfalto" },
});
```

## Opting into the BiLSTM (ONNX) header model

```ts
import { Grobid } from "grobid-js/node";
import {
  GloveFileProvider,
} from "grobid-js/grobid/engines/tagging/glove-file-provider";

const g = new Grobid({
  bidlstmModels: {
    header: {
      modelDir: "/path/to/header-BidLSTM_CRF_FEATURES",
      glove: new GloveFileProvider(vocabPath, vectorsPath),
    },
  },
});
```

Requires `onnxruntime-node` (optional peer dep) and a vocab-restricted Glove dump produced by `scripts/extract-glove-vocab.py`.

## Architecture

Faithful port of the upstream Java layers:

- **pdfalto**: native binary for PDF token + bounding-box extraction (same binary upstream uses)
- **Wapiti**: pure-JS implementation of the Wapiti CRF decoder (`src/grobid/jni/wapiti-*.ts`), byte-equivalent to upstream's C decoder
- **Engines**: header, citation, segmentation, fulltext, affiliation, date, author name, reference segmenter, figure, table, funding-acknowledgement — all ported (`src/grobid/engines/`)
- **Features**: every per-token feature vector upstream produces (`src/grobid/features/`)
- **Lexicon**: same gazetteers and lookup tables
- **TEI emission**: same `<teiHeader>` / `<text>` / `<biblStruct>` structure

## Building from source

```sh
npm install
npm run build
npm test
```

For the BiLSTM ONNX conversion path, see `scripts/convert-bidlstm-crf-features.py`.

## License

Apache 2.0
