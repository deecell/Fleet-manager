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

#ifndef _POWERMON_SCANNER_H
#define _POWERMON_SCANNER_H


#include <stdint.h>
#include <string>
#include <functional>

#include <powermon.h>


/**
 * \brief PowermonScanner offers support for scanning for PowerMon advertisements. Both BLE and WiFi PowerMon devices are supported.
 */
class PowermonScanner
{
public:
	/**
	 * \brief Advertisement is a structure representing an advertisement packet received from the PowerMon device.
	 */
	struct Advertisement
	{
		uint64_t serial;
		uint64_t address;
		
		uint32_t time;
		uint32_t flags;

		float voltage1;
		float voltage2;
		float current;
		float power;

		float coulomb_meter;
		float power_meter;

		float temperature;
		
		std::string name;

		uint16_t firmware_version_bcd;
		uint8_t hardware_revision_bcd;

		Powermon::PowerStatus power_status;

		uint8_t soc;
		uint16_t runtime;

		int16_t rssi;

		bool isExternalTemperature(void) const;
	};


	/**
	 * \brief Creates an instance of the PowermonScanner class
	 * \return Pointer to the newly created PowermonScanner object. Must be freed using delete().
	 */
	static PowermonScanner* createInstance(void);
	virtual ~PowermonScanner();

	/**
	 * \brief Sets the callback to be called by the Powermon scanner when a new advertisement has been received
	 * \param cb Lambda of type `void(const Advertisement&)`
	*/
	virtual void setCallback(const std::function<void(const Advertisement&)> &cb) = 0;

	/**
	 * \brief Starts scanning for WiFi device advertisements
	 */
	virtual void startWifiScan(void) = 0;

	/**
	 * \brief Stops scanning for WiFi device advertisements
	 */
	virtual void stopWifiScan(void) = 0;

	/**
	 * Starts scanning for BLE device advertisements
	 */
	virtual void startBleScan(void) = 0;

	/**
	 * Stops scanning for BLE device advertisements
	 */
	virtual void stopBleScan(void) = 0;
};


#endif
