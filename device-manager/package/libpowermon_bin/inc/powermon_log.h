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

#ifndef _POWERMON_LOG_H
#define _POWERMON_LOG_H


#include <powermon_config.h>

#include <vector>
#include <functional>
#include <math.h>


/**
 * \brief PowermonLogFile is a class representing a PowerMon log file. It also contains support to decode the data points from a log file.
 */
class PowermonLogFile
{
public:
    enum Version
    {
        VER_FAMILY_MASK = 0xF0,
        VER_POWERMON_WIFI_5W = 0x00,
    };

    struct Sample
    {
        uint32_t time;
        float voltage1;
        float voltage2;
        float current;
        float power;
        float temperature;
        uint8_t soc;
        uint8_t ps;
    };

    static uint32_t decode(const std::vector<char> &data, std::vector<Sample> &samples);

private:
    enum Flags
    {
        POWER_VOLTAGE_SOURCE = (1 << 0)
    };

	enum Mask
	{
		V1 = (1 << 0),
		V2 = (1 << 1),
		V3 = (1 << 2),
		V4 = (1 << 3),
		V5 = (1 << 4),
		V6 = (1 << 5),
		
		I1 = (1 << 6),
		I2 = (1 << 7),
	
		P1 = (1 << 8),
		P2 = (1 << 9),
		
		T1 = (1 << 10),
		T2 = (1 << 11),
	
		SOC1 = (1 << 12),
		SOC2 = (1 << 13),
		
		PS1 = (1 << 14),
		PS2 = (1 << 15),
	
		VOLTAGE_SOURCE = (1 << 31)
	};

    struct Header
    {
        uint8_t magic[4];
        
        uint8_t version;
        uint8_t mode;
        uint16_t reserved0;

        uint32_t time;

        uint32_t mask;
        uint32_t flags;
    };

    static uint32_t getSamplePeriodInSeconds(uint8_t mode)
    {
        switch(mode)
        {
            case PowermonConfig::LOG_MODE_1_SEC: return 1;
            case PowermonConfig::LOG_MODE_2_SEC: return 2;
            case PowermonConfig::LOG_MODE_5_SEC: return 5;
            case PowermonConfig::LOG_MODE_10_SEC: return 10;
            case PowermonConfig::LOG_MODE_20_SEC: return 20;
            case PowermonConfig::LOG_MODE_30_SEC: return 30;
            case PowermonConfig::LOG_MODE_60_SEC: return 60;
        }
 
        return 0;
    }
};

#endif
