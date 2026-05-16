// Stub gradient.h: declares only the bits the decoder.c includes. We never
// invoke `tag_postsc` in the label path, so the bodies are unimplemented.
#ifndef gradient_h
#define gradient_h

#include <stdint.h>
#include "model.h"
#include "sequence.h"

typedef struct grd_st_s grd_st_t;
struct grd_st_s {
	mdl_t   *mdl;
	uint32_t first, last;
	double  *alpha, *beta, *unorm;
};

grd_st_t *grd_stnew(mdl_t *mdl, double *g);
void      grd_stfree(grd_st_t *grd_st);
void      grd_stcheck(grd_st_t *grd_st, uint32_t len);
void      grd_fldopsi(grd_st_t *grd_st, const seq_t *seq);
void      grd_flfwdbwd(grd_st_t *grd_st, const seq_t *seq);
void      grd_spdopsi(grd_st_t *grd_st, const seq_t *seq);
void      grd_spfwdbwd(grd_st_t *grd_st, const seq_t *seq);

#endif
