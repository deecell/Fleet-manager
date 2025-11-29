/* Copyright (C) 2020 - 2024, Thornwave Labs Inc
 * Written by Razvan Turiac <razvan.turiac@thornwave.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated 
 * documentation files (the “Software”), to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, 
 * and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 * Attribution shall be given to Thornwave Labs Inc. and shall be made visible to the final user. 
 * 
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED 
 * TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL 
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, 
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

#ifndef _POWERMON_CONFIG_H
#define _POWERMON_CONFIG_H


#include <stdint.h>
#include <stddef.h>


/**
 * \brief PowermonConfig is a structure containing the PowerMon configuration
 */
struct PowermonConfig
{
public:

	enum MultiFunctionPinMode: uint32_t
	{
		MF_DATA = 0,			//data stream
		MF_TEMP = 1,			//DS18B20 temperature sensor
		MF_BUTTON = 2,			//button input
		MF_COMM = 3				//half duplex communication
	};
	

	enum FuelgaugeChemistry: uint32_t
	{
		FG_CHEM_LEAD_FLOODED = 0,
		FG_CHEM_LEAD_AGM = 1,
		FG_CHEM_LIFEPO = 2,
		FG_CHEM_LIION = 3,
		FG_CHEM_LIPOLY = 4,
	};


	enum LogMode: uint32_t
	{
		LOG_MODE_DISABLED = 0,
		LOG_MODE_1_SEC = 1,
		LOG_MODE_2_SEC = 2,
		LOG_MODE_5_SEC = 3,
		LOG_MODE_10_SEC = 4,
		LOG_MODE_20_SEC = 5,
		LOG_MODE_30_SEC = 6,
		LOG_MODE_60_SEC = 7,
	};


	enum TimeZone: uint32_t
	{
		TZ_AMERICA_ATLANTIC = 0,
		TZ_AMERICA_EASTERN = 1,
		TZ_AMERICA_CENTRAL = 2,
		TZ_AMERICA_MOUNTAIN = 3,
		TZ_AMERICA_PACIFIC_NO_DST = 4,
		TZ_AMERICA_PACIFIC = 5,
		TZ_AMERICA_ALASKA = 6,
		TZ_AMERICA_HAWAII = 7,
		TZ_AMERICA_SAMOA = 8,
		TZ_AMERICA_CHAMORO = 9,
		TZ_EUROPE_WESTERN = 10,
		TZ_EUROPE_CENTRAL = 11,
		TZ_EUROPE_EASTERN = 12,
		TZ_EUROPE_MOSCOW = 13
	};

	static const char* timeZones[14];

	void setMfMode(MultiFunctionPinMode mode);
	MultiFunctionPinMode getMfMode(void) const;

	void setWiFiKeepAPOn(bool state);
	bool getWiFiKeepAPOn(void) const;

	void setWiFiDisablePowerSaving(bool state);
	bool getWiFiDisablePowerSaving(void) const;

	void setWiFiWatchdogEnable(bool state);
	bool getWiFiWatchdogEnable(void) const;

	void setNoInternetEnable(bool state);
	bool getNoInternetEnable(void) const;

	void setNtpEnable(bool state);
	bool getNtpEnable(void) const;

	void setTimeZone(TimeZone tz);
	TimeZone getTimeZone(void) const;

	void setEthKeepLinkLedOn(bool state);
	bool getEthKeepLinkLedOn(void) const;

	void setEngineShuntVdropNom(uint8_t mv);
	uint8_t getEngineShuntVdropNom(void) const;

	void setEngineShuntCurrentNom(uint16_t amperes);
	uint16_t getEngineShuntCurrentNom(void) const;

	void setEngineShuntCurrentMax(uint16_t amperes);
	uint16_t getEngineShuntCurrentMax(void) const;

	void setEngineDisableV2(bool state);
	bool getEngineDisableV2(void) const;

	void setEngineCurrentSignFlip(bool state);
	bool getEngineCurrentSignFlip(void) const;

	void setEngineMeterVoltageSource(uint8_t source);
	uint8_t getEngineMeterVoltageSource(void) const;

	void setOcInitialState(bool state);
	bool getOcInitialState(void) const;

	void setOcInvertOutput(bool state);
	bool getOcInvertOutput(void) const;

	void setOcLatchRelayOn(bool state);
	bool getOcLatchRelayOn(void) const;

	void setOcConnectFilter(uint32_t filter_ms);
	uint32_t getOcConnectFilter(void) const;

	void setOcLvdEnable(bool state);
	bool getOcLvdEnable(void) const;

	void setOcLvdSource(uint8_t source);
	uint8_t getOcLvdSource(void) const;

	void setOcLvdDisconnectThreshold(float threshold);
	float getOcLvdDisconnectThreshold(void) const;

	void setOcLvdConnectThreshold(float threshold);
	float getOcLvdConnectThreshold(void) const;

	void setOcLvdDisconnectFilter(uint32_t filter_ms);
	uint32_t getOcLvdDisconnectFilter(void) const;

	void setOcHvdEnable(bool state);
	bool getOcHvdEnable(void) const;

	void setOcHvdSource(uint8_t source);
	uint8_t getOcHvdSource(void) const;

	void setOcHvdDisconnectThreshold(float threshold);
	float getOcHvdDisconnectThreshold(void) const;

	void setOcHvdConnectThreshold(float threshold);
	float getOcHvdConnectThreshold(void) const;

	void setOcHvdDisconnectFilter(uint32_t filter_ms);
	uint32_t getOcHvdDisconnectFilter(void) const;

	void setOcOcdEnable(bool state);
	bool getOcOcdEnable(void) const;

	void setOcOcdSource(uint8_t source);
	uint8_t getOcOcdSource(void) const;

	void setOcOcdTripThreshold(float threshold);
	float getOcOcdTripThreshold(void) const;

	void setOcOcdTripFilter(uint32_t filter_ms);
	uint32_t getOcOcdTripFilter(void) const;

	void setOcLtdEnable(bool state);
	bool getOcLtdEnable(void) const;

	void setOcLtdDisconnectThreshold(int8_t threshold);
	int8_t getOcLtdDisconnectThreshold(void) const;

	void setOcLtdConnectThreshold(int8_t threshold);
	int8_t getOcLtdConnectThreshold(void) const;

	void setOcLtdDisconnectFilter(uint32_t filter_ms);
	uint32_t getOcLtdDisconnectFilter(void) const;

	void setOcHtdEnable(bool state);
	bool getOcHtdEnable(void) const;

	void setOcHtdDisconnectThreshold(int8_t threshold);
	int8_t getOcHtdDisconnectThreshold(void) const;

	void setOcHtdConnectThreshold(int8_t threshold);
	int8_t getOcHtdConnectThreshold(void) const;

	void setOcHtdDisconnectFilter(uint32_t filter_ms);
	uint32_t getOcHtdDisconnectFilter(void) const;

	void setOcFgdConnectEnable(bool state);
	bool getOcFgdConnectEnable(void) const;

	void setOcFgdDisconnectEnable(bool state);
	bool getOcFgdDisconnectEnable(void) const;

	void setOcFgdConnectThreshold(uint8_t threshold);
	uint8_t getOcFgdConnectThreshold(void) const;

	void setOcFgdDisconnectThreshold(uint8_t threshold);
	uint8_t getOcFgdDisconnectThreshold(void) const;

	void setOcAutoOnTimer(uint32_t timer_sec);
	uint32_t getOcAutoOnTimer(void) const;

	void setOcAutoOffTimer(uint32_t timer_sec);
	uint32_t getOcAutoOffTimer(void) const;

	void setOcGenControlEnable(bool state);
	bool getOcGenControlEnable(void) const;

	void setOcGenVonEnable(bool state);
	bool getOcGenVonEnable(void) const;

	void setOcGenVoffEnable(bool state);
	bool getOcGenVoffEnable(void) const;

	void setOcGenSoconEnable(bool state);
	bool getOcGenSoconEnable(void) const;

	void setOcGenSocoffEnable(bool state);
	bool getOcGenSocoffEnable(void) const;

	void setOcGenVoltageSource(uint8_t source);
	uint8_t getOcGenVoltageSource(void) const;

	void setOcGenVonThreshold(float threshold);
	float getOcGenVonThreshold(void) const;

	void setOcGenVoffThreshold(float threshold);
	float getOcGenVoffThreshold(void) const;

	void setOcGenSoconThreshold(uint8_t threshold);
	uint8_t getOcGenSoconThreshold(void) const;

	void setOcGenSocoffThreshold(uint8_t threshold);
	uint8_t getOcGenSocoffThreshold(void) const;

	void setOcGenVonFilter(uint32_t filter_ms);
	uint32_t getOcGenVonFilter(void) const;

	void setOcGenTurnOffDelay(uint16_t delay_min);
	uint16_t getOcGenTurnOffDelay(void) const;
	
	void setOcLiFePOEnable(bool state);
	bool getOcLiFePOEnable(void) const;

	void setOcLiFePODesignCapacity(float capacity);
	float getOcLiFePODesignCapacity(void) const;

	void setOcLiFePOCellCount(uint8_t count);
	uint8_t getOcLiFePOCellCount(void) const;

	void setFgEnable(bool state);
	bool getFgEnable(void) const;

	void setFgChemistry(FuelgaugeChemistry chemistry);
	FuelgaugeChemistry getFgChemistry(void) const;

	void setFgCellCount(uint8_t count);
	uint8_t getFgCellCount(void) const;

	void setFgVoltageSource(uint8_t source);
	uint8_t getFgVoltageSource(void) const;

	void setFgDesignCapacity(float capacity);
	float getFgDesignCapacity(void) const;

	void setFgManualChargeDetectionEnable(bool state);
	bool getFgManualChargeDetectionEnable(void) const;

	void setFgSyncVoltageThreshold(float threshold);
	float getFgSyncVoltageThreshold(void) const;

	void setFgSyncCurrentThreshold(float threshold);
	float getFgSyncCurrentThreshold(void) const;

	void setFgSyncFilter(uint32_t filter_ms);
	uint32_t getFgSyncFilter(void) const;

	void setLogMode(LogMode mode);
	LogMode getLogMode(void) const;

private:
	uint8_t mRawConfig[104] alignas(4);
};


#endif
