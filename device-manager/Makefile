CXX = g++
CXXFLAGS = -std=c++17 -O2 -Wall -Wno-unused-parameter
LDFLAGS = -lstdc++ -lpthread

# Use pkg-config for bluetooth and dbus
PKG_CFLAGS = $(shell pkg-config --cflags bluez dbus-1 2>/dev/null)
PKG_LIBS = $(shell pkg-config --libs bluez dbus-1 2>/dev/null)

LIBPOWERMON_DIR = ../libpowermon_bin
INCLUDES = -I$(LIBPOWERMON_DIR)/inc $(PKG_CFLAGS)
LIBS = $(LIBPOWERMON_DIR)/powermon_lib.a

TARGET = powermon-bridge
SRC = src/powermon_bridge.cpp

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(SRC) $(LIBS)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $(SRC) $(LIBS) $(PKG_LIBS) $(LDFLAGS)

clean:
	rm -f $(TARGET)
