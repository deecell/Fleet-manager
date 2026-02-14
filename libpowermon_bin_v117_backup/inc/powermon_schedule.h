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

#ifndef _POWERMON_SCHEDULE_H
#define _POWERMON_SCHEDULE_H


#include <stdint.h>
#include <stddef.h>


/**
 * \brief PowermonSchedule is a structure containing one PowerMon schedule (timer)
 */
struct PowermonSchedule
{
public:
	PowermonSchedule();

	bool operator==(const PowermonSchedule &rhs) const;

	const char* getName(void) const;
	void setName(const char* name);

	uint64_t getDescriptor(void) const;
	void setDescriptor(uint64_t descriptor);

	uint32_t getStartHour(void) const;
	void setStartHour(uint32_t value);

	uint32_t getStartMinute(void) const;
	void setStartMinute(uint32_t value);

	uint32_t getEndHour(void) const;
	void setEndHour(uint32_t value);

	uint32_t getEndMinute(void) const;
	void setEndMinute(uint32_t value);

	bool isRepeatDOW(void) const;
	void setRepeatDOW(void);

	bool isRepeatDOM(void) const;
	void setRepeatDOM(void);

	uint8_t getRepeat(void) const;
	void setRepeat(uint8_t value);

private:
	uint8_t mRawSchedule[24];
};


#endif
