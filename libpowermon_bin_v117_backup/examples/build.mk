OUTDIR = bin
OBJDIR = $(OUTDIR)/obj

TOOLCHAIN_PREFIX =
TOOLCHAIN_SUFFIX = 

CC = $(TOOLCHAIN_PREFIX)gcc$(TOOLCHAIN_SUFFIX)
CPP = $(TOOLCHAIN_PREFIX)cpp$(TOOLCHAIN_SUFFIX)
GDB = $(TOOLCHAIN_PREFIX)gdb$(TOOLCHAIN_SUFFIX)
SIZE = $(TOOLCHAIN_PREFIX)size$(TOOLCHAIN_SUFFIX)
OBJCOPY = $(TOOLCHAIN_PREFIX)objcopy$(TOOLCHAIN_SUFFIX)
OBJDUMP = $(TOOLCHAIN_PREFIX)objdump$(TOOLCHAIN_SUFFIX)
STRIP = $(TOOLCHAIN_PREFIX)strip$(TOOLCHAIN_SUFFIX)
READELF = $(TOOLCHAIN_PREFIX)readelf$(TOOLCHAIN_SUFFIX)
NM = $(TOOLCHAIN_PREFIX)nm$(TOOLCHAIN_SUFFIX)

ECHO = echo
CP = cp
MKDIR = mkdir
SED = sed
MV = mv


ifeq ($(RELEASE), yes)

$(info *******************************  Release build  *******************************)

else

$(info *******************************  Debug build  *******************************)

endif


#update CFLAGS and LDFLAGS
CXXFLAGS += -fsigned-char -O$(OPTLEVEL) -g$(DBGLEVEL) $(addprefix -I, $(INCDIRS)) $(addprefix -D, $(CPPDEFS))
LDFLAGS += -fsigned-char -O$(OPTLEVEL) -g$(DBGLEVEL) -Wl,-Map=$(OUTDIR)/$(TARGET).map,--gc-sections,--cref
#create list of all objects
ALLOBJS = $(addprefix $(OBJDIR)/, $(patsubst %.cpp, %.o, $(notdir $(CXXSRCS))))
#create list of all object directories
NEWDIRS += $(sort $(dir $(ALLOBJS)))


#(1) = target
#(2) = source(s)
#(3) = extra flags
define COMPILE_CXX_SOURCE
$(1): $(MAKEFILE_LIST) $(2) | $(dir $(1))
	@$(ECHO) Compiling $(2) ...;
	$(PREFIX)$(CC) -c $(3) -MD -pipe -o $(1) $(2);
	$(EMPTY_LINE)
	@$(CP) -R $(patsubst %.o, %.d, $(1)) $(patsubst %.o, %.dtemp, $(1));
	@$(SED) -e 's/#.*//' -e 's/^[^:]*: *//' -e 's/ *\\$$$$//' -e '/^$$$$/ d' -e 's/$$$$/ :/' <$(patsubst %.o,%.d,$(1)) >>$(patsubst %.o,%.dtemp,$(1));
	@$(MV) $(patsubst %.o, %.dtemp, $(1)) $(patsubst %.o, %.d, $(1));
endef


define CREATE_DIRECTORY
$(1)/:
	@$(ECHO) Creating directory $(1) ...
	@$(MKDIR) -p $(1)
endef


.PHONY: all clean

all: $(OUTDIR)/$(TARGET)

$(OUTDIR)/$(TARGET): $(OUTDIR)/$(TARGET).elf | $(OUTDIR)/
	@$(CP) -av $(OUTDIR)/$(TARGET).elf $(OUTDIR)/$(TARGET)

clean: 
	@$(ECHO) Cleaning application files ...
	-$(RM) -rf $(OUTDIR)


$(OUTDIR)/$(TARGET).elf: $(MAKEFILE_LIST) $(ALLOBJS) $(LIBS) | $(OUTDIR)/
	@$(ECHO) "Linking ..."
	$(CC) -o $(OUTDIR)/$(TARGET).elf $(ALLOBJS) $(LIBS) $(LDFLAGS)
ifeq ($(RELEASE), yes)
	$(STRIP) --strip-all $(OUTDIR)/$(TARGET).elf
endif
	$(EMPTY_LINE)


$(foreach dir, $(OBJDIR), $(eval $(call CREATE_DIRECTORY, $(dir))))
$(eval $(call CREATE_DIRECTORY, $(OUTDIR)))
$(foreach source, $(CXXSRCS), $(eval $(call COMPILE_CXX_SOURCE, $(OBJDIR)/$(notdir $(source:%.cpp=%.o)), $(source), $(CXXFLAGS))))

-include $(ALLOBJS:%.o=%.d)
