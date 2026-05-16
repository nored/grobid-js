// Minimal options.h stub for the label-only driver. Mirrors the upstream
// `opt_t` struct *fields used* by the label path (decoder.c, model.c). Other
// fields are present so size matches but they are zero-initialised.
#ifndef options_h
#define options_h

#include <stdbool.h>
#include <stdint.h>

typedef struct opt_s opt_t;
struct opt_s {
	// Mode
	bool     mode;
	char    *input, *output;
	// Algorithm
	char    *algo, *type;
	char    *pattern, *model, *devel;
	char    *rstate, *sstate;
	bool     compact;
	bool     sparse;
	uint32_t nthread;
	uint32_t jobsize;
	uint32_t maxiter;
	double   rho1, rho2;
	double   objwin;
	uint32_t stopwin;
	double   stopeps;
	struct {
		uint32_t hist;
		uint32_t maxls;
	} lbfgs;
	struct {
		double   eta0;
		double   alpha;
	} sgdl1;
	struct {
		double   min;
		double   range;
		double   stpmin;
		double   stpmax;
		double   stpinc;
		double   stpdec;
		uint32_t kappa;
		double   stable;
	} bcd;
	struct {
		uint32_t kmax;
		uint32_t sigma;
		double   stpmin;
		double   stpmax;
		double   stpinc;
		double   stpdec;
		uint32_t cutoff;
	} rprop;
	bool     autouni;
	bool     maxent;
	// Labelling-only fields (the ones we actually need).
	bool     label;
	bool     check;
	bool     outsc;
	bool     lblpost;
	uint32_t nbest;
	bool     force;
};

#endif
