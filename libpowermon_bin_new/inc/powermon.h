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

#ifndef _POWERMON_H
#define _POWERMON_H


#include <stdint.h>
#include <string.h>

#include <string>
#include <vector>
#include <functional>


#include <powermon_config.h>
#include <powermon_schedule.h>
#include <powermon_log.h>


#define MAX_WIFI_SSID_SIZE			32
#define MAX_WIFI_PASSWORD_SIZE		64

#define CHANNEL_ID_SIZE				16
#define ENCRYPTION_KEY_SIZE			32

#define MAX_BLE_NAME_LENGTH			8
#define MAX_NAME_LENGTH		32

#define MAX_TIMER_NAME_LENGTH		16
#define MAX_TIMER_COUNT				16

#define FG_SOC_DISABLED				0xFF
#define FG_SOC_UNKNOWN				0xFE

#define FG_RUNTIME_DISABLED			0xFFFF
#define FG_RUNTIME_UNKNOWN			0xFFFE
#define FG_RUNTIME_MAX				0xFFF0


/**
 * \brief Powermon is a class representing one PowerMon device (BLE or WiFi) and offers a set of functions for accessing all features of PowerMon battery monitors.
 */
class Powermon
{
public:
	/**
	 * \brief HardwareRevision definitions (2 digit BCD format)
	 */
	enum HardwareRevision: uint8_t
	{
		FAMILY_MASK = 0xF0,			///<Mask for the family part of the revision number
	
		POWERMON_E = 0x10,			///<PowerMon-E (Ethernet)
		POWERMON = 0x20,			///<Original PowerMon (BLE)
		POWERMON_5S = 0x30,			///<PowerMon-5S (BLE)
		POWERMON_W = 0x40			///<PowerMon-W (WiFi)
	};


	/**
 	* \brief State represents the PowerMon connection state
 	*/
	enum State: uint8_t
	{
		Disconnected = 0,			///<Device is not connected
		Connecting,					///<Device is in the process of connecting
		Connected					///<Device is connected
	};

	
	/**
 	* \brief DisconnectReason is an enumeration of all reasons a connection can be terminated
 	*/
	enum DisconnectReason: uint8_t
	{
		CLOSED = 0,
		NO_ROUTE,
		FAILED,
		UNEXPECTED_ERROR,
		UNEXPECTED_RESPONSE,
		WRITE_ERROR,
		READ_ERROR,
	};


	/**
 	* \brief ResponseCodes is an enumeration of all possible response codes for requests to a PowerMon device
 	*/
	enum ResponseCode: uint16_t
	{
		RSP_SUCCESS 		= 0x0000,
		RSP_SUCCESS_MORE	= 0x0100,
		
		RSP_INVALID_REQ 	= 0x0001,
		RSP_INVALID_PARAM 	= 0x0002,
		RSP_ERROR 			= 0x0003,
		RSP_LOCKED_USER		= 0x0004,
		RSP_LOCKED_MASTER	= 0x0005,
		RSP_CANNOT_UNLOCK	= 0x0006,
		RSP_NOT_FOUND		= 0x0007,
		
		RSP_TIMEOUT			= 0x0008,
		RSP_INVALID			= 0x0009,
		RSP_CANCELLED		= 0x000A,
	};
	
	
	/**
 	* \brief PowerStatus is an enumeration of all possible power states
 	*/
	enum PowerStatus: uint8_t
	{
		PS_OFF = 0,				///<Power status is Off
		PS_ON = 1,				///<Power status is On
		PS_LVD = 2,				///<Power status is Low Voltage Disconnect
		PS_OCD = 3,				///<Power status is Over-Current Disconnect
		PS_HVD = 4,				///<Power status is High Voltage Disconnect
		PS_FGD = 5,				///<Power status is Fuel Gauge Disconnect
		PS_NCH = 6,				///<Power status is Not CHarging (for LiFePO4 charge manager only)
		PS_LTD = 7,				///<Power status is Low Temperature Disconnect
		PS_HTD = 8,				///<Power status is High Temperature Disconnect
	};


	/**
 	* \brief AuthKey is a structure representing an authentication key used to unlock a locked PowerMon device
 	*/
	struct AuthKey
	{
		uint8_t data[32];
	};


	/**
 	* \brief WifiAccessKey is a structure representing the access keys used to connect to a WiFi/Ethernet PowerMon remotely (via the Internet)
 	*/
	struct WifiAccessKey
	{
		uint8_t channel_id[CHANNEL_ID_SIZE];
		uint8_t encryption_key[ENCRYPTION_KEY_SIZE];
	};


	/**
 	* \brief WifiNetwork represents all information required by PowerMon-W to connect to an access point
 	*/
	struct WifiNetwork
	{
		enum SecurityMode: uint16_t
		{
			OPEN                         = 0x0,    ///< No security
			WEP                          = 0x1,    ///< Use WEP
			WPA2_WPA1_PSK                = 0x2,    ///< Use WPA1 or WPA2
			WPA2_PSK                     = 0x4,    ///< Use only WPA2
			WPA3_SAE                     = 0x6     ///< Use WPA3 (STA mode only)
		};

		uint8_t ssid_length;
		uint8_t ssid[MAX_WIFI_SSID_SIZE];

		uint8_t pass_length;
		uint8_t pass[MAX_WIFI_PASSWORD_SIZE];

		uint16_t flags;

		bool isPasswordProtected(void) const;
		bool isMetered(void) const;
		bool isFailed(void) const;

		void setMetered(bool enabled);
	};

	
	/**
 	* \brief WifiScanResult represents a WiFi network detected by PowerMon-W during WiFi scanning
 	*/
	struct WifiScanResult
	{
		uint8_t ssid_length;
		uint8_t ssid[MAX_WIFI_SSID_SIZE];
		uint8_t channel;

		struct
		{
			uint8_t wep : 1;                                        ///< Network supports WEP
			uint8_t wpa : 1;                                        ///< Network supports WPA. If both WPA bits are set the network supports mixed mode.
			uint8_t wpa2 : 1;                                       ///< Network supports WPA2. If both WPA bits are set the network supports mixed mode.
			uint8_t wpa3 : 1;                                       ///< Network supports WPA3. If multiple WPA bits are set the network supports mixed mode.
			uint8_t pmf : 1;                                        ///< Networks requires use of Protected Management Frames
			uint8_t unused : 1;                                     ///< Reserved, set to zero
			uint8_t psk : 1;                                        ///< Network supports Personal authentication
			uint8_t eap : 1;                                        ///< Network supports Enterprise authentication
		}security;

		int8_t rssi;

		bool operator==(const WifiScanResult &rhs) const;
	};


	/**
 	* \brief DeviceInfo is the information structure returned by PowerMon as response to the GetInfo request
 	*/
	struct DeviceInfo
	{
		std::string name;

		uint16_t firmware_version_bcd;
		uint8_t hardware_revision_bcd;

		uint64_t address;
		uint64_t serial;

		uint8_t ssid_length;
		uint8_t ssid[MAX_WIFI_SSID_SIZE];
		uint8_t flags;
		int8_t timezone;
		
		bool isUserPasswordSet(void) const;
		bool isMasterPasswordSet(void) const;
		bool isUserLocked(void) const;
		bool isMasterLocked(void) const;
		
		bool isWifiConnecting(void) const;
		bool isWifiConnected(void) const;
		bool isWifiFailed(void) const;
	};


	/**
 	* \brief DeviceIdentifier is a structure containing all information used to identify a PowerMon device
 	*/
	struct DeviceIdentifier
	{
		std::string name;					///<Device name
		uint64_t serial;					///<Device serial number
		uint8_t hardware_revision_bcd;		///<Identifies if it's a WiFi or BLE device
		uint64_t address;					///<contains the BLE MAC address for a BLE device of the IP address of a local WiFi device. 

		WifiAccessKey access_key;			///<Contains the access keys for a remote WiFi device. In this case address is zero.

		DeviceIdentifier();

		bool operator==(const DeviceIdentifier &rhs);

		/**
		 * \brief Initializes the current object from a device link.
		 * \param url C string containing a valid PowerMon-W access link
		 * \return True if the link was correctly decoded, false otherwise.
		 */
		bool fromURL(const char* url);
		
		/**
		 * \brief Saves the current PowerMon-W access structure to a link. Only remote access WiFi device identifiers can be saved.
		 * \return String containing the link or a zero length string if the structure is not a valid remote PowerMon-W identifier
		 */
		std::string toURL(void);
	};


	/**
 	* \brief MonitorData is a structure containing the real-time PowerMon data
 	*/
	struct MonitorData
	{
		uint16_t firmware_version_bcd;			///<current firmware version in BCD format xx.yy
		uint8_t hardware_revision_bcd;			///<current hardware revision in BCD format x.y

		uint32_t time;							///<UNIX time in localtime (not UTC)
		uint32_t flags;							///<various flags - do not use directly

		float voltage1;							///<Voltage 1 in Volts
		float voltage2;							///<Voltage 2 in Volts
		float current;							///<Current in Amperes
		float power;							///<Power in Watts. Depending on the configuration, either V1 or V2 are used to compute this value.
		float temperature;						///<Temperature in Celsius

		int64_t coulomb_meter;					///<Coulomb meter in mAh
		int64_t energy_meter;					///<Energy meter in mWh

		PowerStatus power_status;				///<Device power status

		uint8_t fg_soc;							///<Fuelgauge SoC (State of Charge) in percentage. 0xFF means the FG is not enabled. 0xFE means the SoC is unknown
		uint16_t fg_runtime;					///<Fuelgauge runtime in minutes. 0xFFFF means the FG is not enabled. The maximum valid value is 0xFFF0.

		int16_t rssi = INT16_MIN;							///<RSSI as seen by the device in dBm

		/**
		 * \brief Returns true if the temperature is read from an external sensor.
		 */
		bool isTemperatureExternal(void) const;
	};


	/**
 	* \brief MonitorStatistics is a structure containing power meter statistics
 	*/
	struct MonitorStatistics
	{
		uint32_t seconds_since_on;				///<number of seconds since PowerMon was powered up

		float voltage1_min;
		float voltage1_max;

		float voltage2_min;
		float voltage2_max;

		float peak_charge_current;
		float peak_discharge_current;

		float temperature_min;					///<in Celsius
		float temperature_max;					///<in Celsius
	};


	/**	
 	* \brief FuelgaugeStatistics is a structure containing battery statistics
 	*/
	struct FuelgaugeStatistics
	{
		uint32_t time_since_last_full_charge;	//in seconds
		float full_charge_capacity;				//current total capacity in Ah

		uint64_t total_discharge;				//in mAh
		uint64_t total_discharge_energy;		//in mWh

		uint64_t total_charge;					//in mAh
		uint64_t total_charge_energy;			//in mWh

		float min_voltage;
		float max_voltage;
		float max_discharge_current;
		float max_charge_current;

		float deepest_discharge;				//in Ah
		float last_discharge;					//in Ah

		float soc;								//in percentage
		uint32_t RESERVED;
	};


	/**
	 * \brief LogFileDescriptor represents a PowerMon log file 
	 */
	struct LogFileDescriptor
	{
		uint32_t id;				///<ID of the file (timestamp in UNIX time of the first sample in the file)
		uint32_t size;				///<Size in bytes
	};


	/**
	 * \brief Creates an instance of the Powermon class
	 * \return Pointer to the newly created Powermon object. Must be freed using delete().
	 */
	static Powermon* createInstance(void);
	virtual ~Powermon();

	/**
	 * \brief Returns the PowerMon access library version
	 * \return Version in BCD format
	 */
	static uint16_t getVersion(void);

	
	/**
	 * \brief Connects to a remote WiFi PowerMon
	 * \param key The access key used to connect
	 */
	virtual void connectWifi(const WifiAccessKey &key) = 0;

	
	/**
	 * \brief Connects to a local WiFi PowerMon
	 * \param ipaddr The IPv4 address of the local WiFi PowerMon device
	 */
	virtual void connectWifi(uint32_t ipaddr) = 0;
	
	
	/**
	 * \brief Connects to a local BLE PowerMon
	 * \param ble_address The Bluetooth address of the PowerMon device
	 */
	virtual void connectBle(uint64_t ble_address) = 0;
	
	
	/**
	 * \brief Disconnects from a connected device
	 */
	virtual void disconnect(void) = 0;

	
	/**
	 * \brief Returns true if the current connection is local
	 */
	virtual bool isLocalConnection(void) const = 0;
	
	
	/**
	 * \brief Sets the callback to be called by the driver when a connection to the PowerMon device is fully established
	 * \param cb Lambda of type `void(void)`
	*/
	virtual void setOnConnectCallback(const std::function<void(void)> &cb) = 0;


	/**
	 * \brief Sets the callback to be called by the driver when a connection to the PowerMon device is disconnected
	 * \param cb Lambda of type `void(Powermmon::DisconnectReason)`
	*/
	virtual void setOnDisconnectCallback(const std::function<void(DisconnectReason)> &cb) = 0;

	
	/**
	 * \brief Sets the callback to be called by the driver when new monitor data is received. This applies to the BLE devices only.
	 * For the WiFi devices, use the request to retrieve the monitor data.
	 * \param cb Lambda of type `void(Powermon::MonitorData&)`
	*/
	virtual void setOnMonitorDataCallback(const std::function<void(const MonitorData&)> &cb) = 0;


	/**
	 * \brief Sets the callback to be called by the driver when a new WiFi scan result is received from the PowerMon. This applies to the WiFi devices only.
	 * WiFi scanning can be initiated using requestStartWifiScan().
	 * \param cb Lambda of type `void(Powermon::WifiScanResult*)`
	 * \param result Pointer to a WiFiScanResult structure describing a WiFi network. The pointer is only valid inside the scope of the callback closure.
	 * Do not store this pointer. Result can be nullptr to signal the WiFi scan ending.
	*/
	virtual void setOnWifiScanReportCallback(const std::function<void(const WifiScanResult*)> &cb) = 0;


	/**
	 * \brief Returns the last DeviceInfo retrieved from the PowerMon
	 * \return Reference to internal DeviceInfo structure. This is not valid before the first requestGetInfo() that returns success.
	 */
	virtual const DeviceInfo& getLastDeviceInfo(void) const = 0;


	/**
	 * \brief Requests the device information
	 * \param cb Lambda of type void(ResponseCode, const DeviceInfo&) that will be called to signal the result of the request
	 */
	virtual void requestGetInfo(const std::function<void(ResponseCode, const DeviceInfo&)> &cb) = 0;


	/**
	 * \brief Requests the device monitor data. It only applies to the WiFi devices.
	 * \param cb Lambda of type void(ResponseCode, const MonitorData&) that will be called to signal the result of the request
	 */
	virtual void requestGetMonitorData(const std::function<void(ResponseCode, const MonitorData&)> &cb) = 0;


	/**
	 * \brief Requests the device power monitor statistics data
	 * \param cb Lambda of type void(ResponseCode, const MonitorStatistics&) that will be called to signal the result of the request
	 */
	virtual void requestGetStatistics(const std::function<void(ResponseCode, const MonitorStatistics&)> &cb) = 0;


	/**
	 * \brief Requests the device battery statistics data
	 * \param cb Lambda of type void(ResponseCode, const FuelgaugeStatistics&) that will be called to signal the result of the request
	 */
	virtual void requestGetFgStatistics(const std::function<void(ResponseCode, const FuelgaugeStatistics&)> &cb) = 0;
	

	/**
	 * \brief Requests unlocking a password protected device
	 * \param key 32 bytes AuthKey type used to unlock the device. This is typically the SHA256 hash of a password.
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestUnlock(const AuthKey &key, std::function<void(ResponseCode)> cb) = 0;


	/**
	 * \brief Requests setting a user password lock
	 * \param key 32 bytes AuthKey type used to unlock the device. This is typically the SHA256 hash of a password.
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestSetUserPasswordLock(const AuthKey &key, std::function<void(ResponseCode)> cb) = 0;


	/**
	 * \brief Requests setting a master password lock on
	 * \param key 32 bytes AuthKey type used to unlock the device. This is typically the SHA256 hash of a password.
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestSetMasterPasswordLock(const AuthKey &key, std::function<void(ResponseCode)> cb) = 0;


	/**
	 * \brief Requests clearing of the user password lock
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestClearUserPasswordLock(std::function<void(ResponseCode)> cb) = 0;


	/**
	 * \brief Requests clearing of the master password lock
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestClearMasterPasswordLock(std::function<void(ResponseCode)> cb) = 0;


	/**
	 * \brief Requests the authentication key from the device. This key can be used to unlock a locked device. It acts the same way as the user password lock.
	 * \param cb Lambda of type void(ResponseCode, const AuthKey&) that will be called to signal the result of the request
	 */
	virtual void requestGetAuthKey(std::function<void(ResponseCode, const AuthKey&)> cb) = 0;
	

	/**
	 * \brief Requests the reset of the device authentication key
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestResetAuthKey(std::function<void(ResponseCode)> cb) = 0;


	/**
	 * \brief Requests the reset of the energy meter
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestResetEnergyMeter(const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Requests the reset of the coulomb meter
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestResetCoulombMeter(const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Requests the reset of the power meter statistics
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestResetStatistics(const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Requests changing the power state
	 * \param state New power state (ON / OFF)
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestSetPowerState(bool state, const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Retrieves the device configuration structure
	 * \param cb Lambda of type void(ResponseCode, const PowermonConfig&) that will be called to signal the result of the request
	 */
	virtual void requestGetConfig(const std::function<void(ResponseCode, const PowermonConfig&)> &cb) = 0;


	/**
	 * \brief Sends new configuration to the device
	 * \param config New configuration structure
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestSetConfig(const PowermonConfig &config, const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Resets the PowerMon configuration to factory settings
	 * This will also clear the data log, reset the name, authentication keys and access keys (for WiFi devices).
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request.
	 */
	virtual void requestResetConfig(const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Requests renaming the PowerMon device
	 * \param name New name. For Bluetooth PowerMons the name is limited to 8 characters. For WiFi PowerMons the name can be up to 32 characters in length.
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestRename(const char* name, const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Requests setting the internal clock of the PowerMon device
	 * \param time New clock in UNIX format (number of seconds since Jan 1st, 1970) in localtime (not UTC)
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestSetTime(uint32_t time, const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Requests forcing the SoC to 100% (SoC synchronize)
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestFgSynchronize(const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Requests starting the WiFi scan (only applies to the WiFi PowerMons). WiFi scanning will stop automatically after a max of 5 seconds.
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestStartWifiScan(const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Sends new WiFi network credentials to the PowerMon device. 
	 * The new credentials will be saved by the device whether PowerMon can or cannot connect to that specified network.
	 * \param network WiFi network credentials
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestWifiConfigure(const WifiNetwork &network, const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Returns a list of all WiFi networks known by the device.
	 * \param cb Lambda of type void(ResponseCode, const std::vector<WifiNetwork>&) that will be called to signal the result of the request
	 */
	virtual void requestGetWifiNetworks(const std::function<void(ResponseCode, const std::vector<WifiNetwork>&)> &cb) = 0;

	/**
	 * \brief Add a new WiFi network 
	 * The new credentials will be saved by the device whether PowerMon can or cannot connect to that specified network.
	 * \param network WiFi network credentials
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestAddWifiNetwork(const WifiNetwork& network, const std::function<void(ResponseCode)> &cb) = 0;

	/**
	 * \brief Removes a stored WiFi network 
	 * \param index WiFi network index in the list returned by requestGetWifiNetworks()
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestRemoveWifiNetwork(uint8_t index, const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Requests the WiFi access keys (only applies to the WiFi PowerMons). The access keys are used to remotely access the device.
	 * \param cb Lambda of type void(ResponseCode, const WifiAccessKey&) that will be called to signal the result of the request
	 */
	virtual void requestGetAccessKeys(const std::function<void(ResponseCode, const WifiAccessKey&)> &cb) = 0;


	/**
	 * \brief Requests resetting of the WiFi access keys (only applies to the WiFi PowerMons). This effectively severs the connection to all the paired clients.
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestResetAccessKeys(const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Requests zeroing of the current reading offset
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestZeroCurrentOffset(const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Requests calibration of the current reading
	 * \param value The actual current flowing through the shunt. An accurate multimeter is required to measure the current.
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestCalibrateCurrent(float value, const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Requests the list of all schedules stored in the device
	 * \param cb Lambda of type void(ResponseCode, const std::vector<PowermonSchedule>&) that will be called to signal the result of the request
	 */
	virtual void requestGetSchedules(const std::function<void(ResponseCode, const std::vector<PowermonSchedule>&)> &cb) = 0;


	/**
	 * \brief Requests adding new schedules
	 * \param schedules A list of schedules to add
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestAddSchedules(const std::vector<PowermonSchedule> &schedules, const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Requests updating an existing schedule
	 * \param old_schedule_descriptor The descriptor of the schedule to update
	 * \param new_schedule The new schedule
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestUpdateSchedule(uint64_t old_schedule_descriptor, const PowermonSchedule &new_schedule, const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Requests deleting an existing schedule
	 * \param schedule_descriptor The descriptor of the schedule to delete
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestDeleteSchedule(uint64_t schedule_descriptor, const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Requests clearing of all schedule
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestClearSchedules(const std::function<void(ResponseCode)> &cb) = 0;
	

	/**
	 * \brief Requests committing the schedules to non-volatile memory
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestCommitSchedules(const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Requests the list of log files
	 * \param cb Lambda of type void(ResponseCode, const std::vector<LogFileDescriptor>&) that will be called to signal the result of the request
	 */
	virtual void requestGetLogFileList(const std::function<void(ResponseCode, const std::vector<LogFileDescriptor>&)> &cb) = 0;


	/**
	 * \brief Requests reading of a log file
	 * \param file_id ID of the file to read (obtained from the LogFileDescriptor)
	 * \param offset Offset to read from
	 * \param read_size Read size in bytes
	 * \param cb Lambda of type void(ResponseCode, const uint8_t*, size_t) that will be called to signal the result of the request
	 */
	virtual void requestReadLogFile(uint32_t file_id, uint32_t offset, uint32_t read_size, const std::function<void(ResponseCode, const uint8_t*, size_t)> &cb) = 0;


	/**
	 * \brief Requests committing the schedules to non-volatile memory
	 * \param cb Lambda of type void(ResponseCode) that will be called to signal the result of the request
	 */
	virtual void requestClearLog(const std::function<void(ResponseCode)> &cb) = 0;


	/**
	 * \brief Requests firmware update
	 * \param firmware_image The firmware update image
	 * \param size Size of the firmware update image
	 * \param progress_cb Lambda of type bool(uint32_t progress, uint32_t total) that will be called regularly with updates about the progress. 
	 * 						Returning false fronm the lambda will abort the update operation.
	 * \param done_cb Lambda of type void(ResponseCode) that will be called to signal the result of the request upon completion of the firmware update
	 */
	virtual void requestUpdateFirmware(const uint8_t* firmware_image, uint32_t size, const std::function<bool(uint32_t, uint32_t)> &progress_cb, 
																			const std::function<void(ResponseCode)> &done_cb) = 0;



	virtual void requestReadDebug(uint32_t offset, uint32_t read_size, const std::function<void(ResponseCode, const uint8_t*, size_t)> &cb) = 0;
	virtual void requestEraseDebug(const std::function<void(ResponseCode)> &cb) = 0;


	virtual void requestReboot(const std::function<void(ResponseCode)> &cb) = 0;



	/**
	 * \brief Returns the IP address as string
	 */
	static std::string getIpAddressString(uint32_t ip);

	
	/**
	 * \brief Returns the Bluetooth MAC address as string
	 */
	static std::string getMacAddressString(uint64_t mac);

	
	/**
	 * \brief Parses a MAC address string
	 */
	static uint64_t parseMacAddress(const char* address);


	/**
	 * \brief Returns the hardware name based on the hardware revision in BCD format
	 */
	static std::string getHardwareString(uint8_t bcd);

	
	/**
	 * \brief Returns the power status string representation
	 */
	static std::string getPowerStatusString(PowerStatus ps);


	/**
	 * \brief Returns true if the PowerMon described by the BCD hardware revision has data logging capabilities
	 */
	static bool hasDataLog(uint8_t bcd);

	
	/**
	 * \brief Returns true if the PowerMon described by the BCD hardware revision has V2
	 */
	static bool hasVoltage2(uint8_t bcd);

	
	/**
	 * \brief Returns true if the PowerMon described by the BCD hardware revision supports configurable shunts
	 */
	static bool hasConfigurableShunt(uint8_t bcd);


	/**
	 * \brief Returns true if the PowerMon described by the BCD hardware revision has an initegrated shunt
	 */
	static bool hasIntegratedShunt(uint8_t bcd);

	
	/**
	 * \brief Returns true if the PowerMon described by the BCD hardware revision has WiFi
	 */
	static bool hasWifi(uint8_t bcd);


	/**
	 * \brief Returns true if the PowerMon described by the BCD hardware revision has Ethernet
	 */
	static bool hasEthernet(uint8_t bcd);


	/**
	 * \brief Returns true if the PowerMon described by the BCD hardware revision has Ethernet
	 */
	static bool hasNetwork(uint8_t bcd);


	/**
	 * \brief Returns true if the PowerMon described by the BCD hardware revision has Bluetooth
	 */
	static bool hasBluetooth(uint8_t bcd);


	/**
	 * \brief Returns true if the parameter is a valid BCD number
	 */
	static inline bool checkBCD(uint16_t bcd)
	{
		for(uint32_t i = 0; i < 4; i++)
		{
			if ((bcd & 0xF) > 0x9)
				return false;
			bcd >>= 4;
		}

		return true;
	}

	/**
	 * \brief Generates the SHA256 hash of a password
	 * \param password C string containing the password
	 * \return Authentication key that can be used for the lock / unlock functions
	 */
	static AuthKey getAuthKeyFromPassword(const char* password);

	/**
	 * \brief Returns the update firmware image URL based on the hardware revision and firmware version.
	 */
	static std::string getUpdateFirmwareImageUrl(uint8_t hardware_revision_bcd, uint16_t firmware_revision_bcd);
	
	/**
	 * \brief Checks the validity of the firmware update image.
	 */
	static uint16_t checkFirmwareImage(const uint8_t* image, size_t size, uint8_t hardware_revision_bcd);
};


#include <powermon_scanner.h>


#endif
