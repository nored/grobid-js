CFLAGS = -O2 -I. -I../../../upstream/wapiti
UPSTREAM = ../../../upstream/wapiti

SRCS = wapiti-label.c stubs.c \
       $(UPSTREAM)/decoder.c $(UPSTREAM)/model.c $(UPSTREAM)/reader.c \
       $(UPSTREAM)/pattern.c $(UPSTREAM)/quark.c $(UPSTREAM)/tools.c

wapiti-label: $(SRCS)
	cc $(CFLAGS) -o $@ $(SRCS)

clean:
	rm -f wapiti-label
