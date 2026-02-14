#include <stdio.h>
#include <stdlib.h>

#include <unistd.h>
#include <termios.h>
#include <poll.h>


//this is the only file needed to be included
//also link the powermon_lib.a together with your application
//the following extra linker command line options are needed:
//-lstdc++ -lbluetooth -ldbus-1
#include <powermon.h>


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
	printf("\nPowerMon Scanner Example. Thornwave Labs Inc.\n");
	printf("\nPress ENTER to exit\n\n");

	PowermonScanner* scanner = PowermonScanner::createInstance();
	if (scanner == nullptr)
	{
		printf("\nCannot create the PowermonScanner instance");
		return EXIT_FAILURE;
	}

	//the PowerMon access libraries make extensive use of lambdas (closures).
	//here we set the lambda that will be called by the library when it received an advertisment from a PowerMon device
	//PowermonScanner::Advertisement contains the advertisment
	scanner->setCallback([](const PowermonScanner::Advertisement &adv)
	{
		printf("Name: %-16s, Model: %-12s, Serial: %016lX, Firmware: %X.%02X\n", 
					adv.name.c_str(), 
					Powermon::getHardwareString(adv.hardware_revision_bcd).c_str(), 
					adv.serial,
					adv.firmware_version_bcd >> 8, adv.firmware_version_bcd & 0xFF);

		printf("\tVoltage1: %.3fV, Current: %.3fA, Power: %.2fW\n", adv.voltage1, adv.current, adv.power);

		fflush(stdout);

		//here we just print some of the information. There is more available in "PowermonScanner::Advertisement"
		//you may chose to compile a list that you can present to the user. "PowermonScanner::Advertisement.serial" is unique among all PowerMon
		//devices so you can use it as a primary key
	});

	scanner->startBleScan();
	scanner->startWifiScan();

	for(;;)
	{
		if (should_exit())
			break;
		usleep(10000);
	}

	scanner->stopBleScan();
	scanner->stopWifiScan();

	delete scanner;

	return EXIT_SUCCESS;
}
