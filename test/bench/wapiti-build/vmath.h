// Minimal vmath.h stub: just the symbols referenced by the label path.
// Real upstream uses SSE2-aligned mallocs; we use plain malloc since the
// decoder only does additions/exp() on the values and doesn't require alignment
// for the JS comparison.
#ifndef vmath_h
#define vmath_h

#include <stddef.h>

double *xvm_new(size_t n);
void    xvm_free(double *x);
void    xvm_expma(double *y, const double *x, double a, size_t n);

#endif
