// Minimal `wapiti label -m MODEL < features.txt > labels.txt` driver. Reuses
// the upstream `decoder.c` / `model.c` / `reader.c` / `pattern.c` / `quark.c`
// / `tools.c` sources verbatim — only `vmath` / `gradient` / `thread` are
// stubbed (see stubs.c) because the label path doesn't exercise them.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "model.h"
#include "reader.h"

extern int tag_label(mdl_t *mdl, FILE *fin, FILE *fout);

int main(int argc, char **argv) {
	const char *mfile = NULL;
	for (int i = 1; i < argc; i++) {
		if (strcmp(argv[i], "label") == 0) continue;
		if (strcmp(argv[i], "-m") == 0 && i + 1 < argc) {
			mfile = argv[++i];
			continue;
		}
		fprintf(stderr, "usage: %s label -m MODEL < FEATURES > LABELS\n", argv[0]);
		return 1;
	}
	if (!mfile) {
		fprintf(stderr, "missing -m MODEL\n");
		return 1;
	}
	FILE *f = fopen(mfile, "r");
	if (!f) { perror(mfile); return 2; }

	rdr_t *rdr = rdr_new(false);
	mdl_t *mdl = mdl_new(rdr);
	opt_t opt; memset(&opt, 0, sizeof(opt));
	opt.nbest = 1;
	mdl->opt = &opt;

	mdl_load(mdl, f);
	fclose(f);

	tag_label(mdl, stdin, stdout);
	return 0;
}
