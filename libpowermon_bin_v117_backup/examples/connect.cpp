#include <stdio.h>
#include <stdlib.h>

#include <unistd.h>
#include <arpa/inet.h>
#include <termios.h>
#include <poll.h>

//this is the only file needed to be included
//also link the powermon_lib.a together with your application
//the following extra linker command line options are needed:
//-lstdc++ -lbluetooth -ldbus-1
#include <powermon.h>


volatile bool connected = false;
volatile bool disconnected = false;
volatile bool ready = false;



static bool should_exit(void)
{
	pollfd pfd{};
	pfd.fd = STDIN_FILENO;
	pfd.events = POLLIN;

	const int32_t ret = poll(&pfd, 1, 0); // timeout = 0 → non-blocking
	if (ret > 0 && (pfd.revents & POLLIN)) 
		return true;

	return false;
}


int32_t main(int32_t argc, char** argv) 
{
	printf("\nPowerMon Connect Example. Thornwave Labs Inc.\n");
	printf("\nPress ENTER to exit\n\n");

	Powermon* const powermon = Powermon::createInstance();
	if (powermon == nullptr)
	{
		printf("\nCannot create the Powermon instance");
		return EXIT_FAILURE;
	}


	//Let's set our connect callback. This gets called when a connection is successfully established
	powermon->setOnConnectCallback([]() 
	{
		printf("\nDevice is connected\n"); fflush(stdout);
		connected = true;
	});

    //... and our disconnect callback. This gets called when a device gets disconnected or a connection attempt fails.
	powermon->setOnDisconnectCallback([](Powermon::DisconnectReason reason) 
	{
		printf("\nDevice is disconnected, reason: %u\n", reason); fflush(stdout);
		disconnected = true;
	});

	

	//Now we are ready to connect to a device
	//Here are the options:
	// - we can connect to a Bluetooth LE device (PowerMon or PowerMon-5S)
	// - we can connect to a WiFi or Ethernet device located in the same network - we need an IP address
	// - we can connect to a WiFi or Ethernet device located remotely - we need the Access Keys



	//WIFI / ETHERNET REMOTE CONNECTION

	//this is the URL needed to connect to a demo device
	//we can use functions provided by the Powermon class to decode this URL into the access keys required to connect
	const char* url = "https://applinks.thornwave.com/?n=DemoUnit&s=36129e86da98dda9&h=40&c=HzotUykUSvP/Ox0xdUpYVw%3D%3D&k=//////////////////////////////////////////8%3D";
	Powermon::DeviceIdentifier id;
	if (id.fromURL(url))
	{
		printf("\nURL decoded successfully");
		printf("\n  Device name: %s", id.name.c_str());
		printf("\n  Device model: %s", Powermon::getHardwareString(id.hardware_revision_bcd).c_str());
		printf("\n  Device serial number: %016lX", id.serial);

		printf("\n  Device channel ID: ");
		for(uint32_t i = 0; i < CHANNEL_ID_SIZE; i++)
			printf("%02X", id.access_key.channel_id[i]);

		printf("\n  Device encryption key: ");
		for(uint32_t i = 0; i < ENCRYPTION_KEY_SIZE; i++)
			printf("%02X", id.access_key.encryption_key[i]);

		//let's connect
		powermon->connectWifi(id.access_key);
	}
	else
	{
		printf("\nThe URL provided is invalid\n");
		return EXIT_FAILURE;
	}
	

  /*  
	//WIFI / ETHERNET LOCAL CONNECTION
	struct in_addr ip_addr;
	inet_pton(AF_INET, "192.168.1.230", &ip_addr);	//use the IP address of your device. You can get that from the PowerMon advertisments.
	powermon->connectWifi(ip_addr.s_addr);
*/


	/*
	//BLE CONNECTION
	const uint64_t ble_mac_address = (uint64_t)0x123456789ABC;		//pay attention to big endian vs little endian
	//use the MAC address of your device. You can get that from the PowerMon advertisments.
	powermon->connectBle(ble_mac_address);
*/



	//wait to either connect or fail
	while (!connected && !disconnected)
        usleep(10 * 1000);

	//as you noticed, the PowerMon API is asynchronous. This means, you make a request by calling a member function in 
	//the Powermon class and specifying a lambda as a parameter. That function returns immediately. The lambda will be 
	//called later when the response of the request arrives or the request times out.
	//For this reason, in this example we need to keep the thread alive, hence the volatile bool connected, disconnected and ready.
	//In your application, chances are that it's event driven and the Powermon library will fit nicely in that environment


	if (connected)
	{
		//this is our first request sent to the device
		//again, make abstraction of the ready flag. It's here because we need to keep this thread blocked until we get a response
		//It is highly recommended to start any connection with this request. Also keep the DeviceInfo structure because
		//you may need information about this device to make decisions about how to interpret the data
		ready = false;
		powermon->requestGetInfo([](uint16_t status, const Powermon::DeviceInfo& info) 
		{
			if (status == Powermon::RSP_SUCCESS) 
			{
				printf("\nDevice Information\n-----------------\n");

				printf("\nDevice name: %s", info.name.c_str());
				printf("\nFirmware version: %x.%02x", info.firmware_version_bcd >> 8, info.firmware_version_bcd & 0xFF);
				printf("\nHardware ID: %x.%x", info.hardware_revision_bcd >> 4, info.hardware_revision_bcd & 0xF);

				fflush(stdout);
			}
			else 
			{
				printf("\r\nError retrieving device information");
			}

			ready = true;
		});
		while(ready == false) usleep(50 * 1000);			//wait until we get a response


		printf("\n\nMonitor Data");
		
		while(!should_exit())
		{
			powermon->requestGetMonitorData([](Powermon::ResponseCode response, const Powermon::MonitorData& data)
            {
                if (response == Powermon::ResponseCode::RSP_SUCCESS)
                {
					printf("\nV1: %.3fV, V2: %.3fV, I: %.3fA, P: %.2fW, Coulombs: %.3fAh, Energy: %.3fWh, PS: %s", 
						data.voltage1, data.voltage2, data.current, data.power,
						data.coulomb_meter / 1000.0, data.energy_meter / 1000.0,
						Powermon::getPowerStatusString(data.power_status).c_str()
					);
                }
                else
                {
                    printf("\nFailed to get monitor data. Response code: %u", response);
                }

				fflush(stdout);
            });

			//delay 2 seconds and check if we should exit every 10ms. 
			//This is done so we can respond quickly to the user request of terminating the program.
			for(uint32_t i = 0; i < 200; i++)
				if (!should_exit())
					usleep(10 * 1000);
				else
					break;
		}


		powermon->disconnect();
	}

    
	//wait for the device to disconnect. If the connection failed when trying to establish it, disconnected will already be true
	while (!disconnected)
        usleep(50 * 1000);

    delete powermon;

	printf("\n");

    return EXIT_SUCCESS;
}
