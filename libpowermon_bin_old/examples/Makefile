.PHONY: all clean


all:
	$(MAKE) -f Makefile.scan RELEASE=$(RELEASE)
	$(MAKE) -f Makefile.connect RELEASE=$(RELEASE)

clean:
	$(MAKE) -f Makefile.scan clean
	$(MAKE) -f Makefile.connect clean
