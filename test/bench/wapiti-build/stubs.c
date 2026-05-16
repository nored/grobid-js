// Stubs for the subset of vmath/gradient/thread/info that aren't needed in
// the label path. Linking these in lets us reuse the upstream `decoder.c` and
// `model.c` verbatim without bringing in SSE2 / pthread dependencies.

#include <math.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "vmath.h"
#include "gradient.h"
#include "thread.h"
#include "tools.h"

// ---- xvm ---------------------------------------------------------------
double *xvm_new(size_t n) {
	double *p = (double *)calloc(n, sizeof(double));
	if (!p) { fprintf(stderr, "out of memory\n"); exit(1); }
	return p;
}
void xvm_free(double *x) { free(x); }
void xvm_expma(double *y, const double *x, double a, size_t n) {
	// Subtract `a` from each element (a max for numerical stability) then
	// take exp. The label path always passes `a == 0.0` so this collapses
	// to elementwise exp(x[i]).
	for (size_t i = 0; i < n; i++) y[i] = exp(x[i] - a);
}

// ---- gradient (never called on label path; abort if reached) ----------
grd_st_t *grd_stnew(mdl_t *mdl, double *g) { (void)mdl; (void)g; fprintf(stderr,"grd_stnew: not supported in driver\n"); exit(2); }
void grd_stfree(grd_st_t *s) { (void)s; }
void grd_stcheck(grd_st_t *s, uint32_t len) { (void)s; (void)len; }
void grd_fldopsi(grd_st_t *s, const seq_t *q) { (void)s; (void)q; }
void grd_flfwdbwd(grd_st_t *s, const seq_t *q) { (void)s; (void)q; }
void grd_spdopsi(grd_st_t *s, const seq_t *q) { (void)s; (void)q; }
void grd_spfwdbwd(grd_st_t *s, const seq_t *q) { (void)s; (void)q; }

// ---- thread (single-threaded driver — both are no-ops) ----------------
void mth_spawn(func_t *f, uint32_t W, void *ud[], uint32_t nseq, uint32_t jobsize) {
	(void)f; (void)W; (void)ud; (void)nseq; (void)jobsize;
}
int mth_getjob(job_t *j, uint32_t *count, uint32_t *pos) {
	(void)j; (void)count; (void)pos;
	return 0;
}

// `info`/`fatal`/`warning`/`pfatal` and `xmalloc`/`xrealloc`/`xstrdup` come
// from upstream `tools.c` which we link in directly.
