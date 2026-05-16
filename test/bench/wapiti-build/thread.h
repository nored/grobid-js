// Stub thread.h: only needed because decoder.c includes it. We don't use any
// thread functions in the label path.
#ifndef thread_h
#define thread_h

#include <stdint.h>

typedef struct job_s job_t;
typedef void (func_t)(job_t *, uint32_t, uint32_t, void *);

void mth_spawn(func_t *f, uint32_t W, void *ud[], uint32_t nseq, uint32_t jobsize);
int  mth_getjob(job_t *j, uint32_t *count, uint32_t *pos);

#endif
