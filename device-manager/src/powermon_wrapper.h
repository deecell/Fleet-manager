#ifndef POWERMON_WRAPPER_H
#define POWERMON_WRAPPER_H

#include <napi.h>
#include <powermon.h>

#include <memory>
#include <mutex>
#include <atomic>
#include <queue>
#include <functional>

class PowermonWrapper : public Napi::ObjectWrap<PowermonWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    PowermonWrapper(const Napi::CallbackInfo& info);
    ~PowermonWrapper();

    static Napi::Value GetLibraryVersion(const Napi::CallbackInfo& info);
    static Napi::Value ParseAccessURL(const Napi::CallbackInfo& info);

    Napi::Value Connect(const Napi::CallbackInfo& info);
    Napi::Value Disconnect(const Napi::CallbackInfo& info);
    Napi::Value IsConnected(const Napi::CallbackInfo& info);
    Napi::Value IsBleAvailable(const Napi::CallbackInfo& info);
    
    Napi::Value GetInfo(const Napi::CallbackInfo& info);
    Napi::Value GetMonitorData(const Napi::CallbackInfo& info);
    Napi::Value GetStatistics(const Napi::CallbackInfo& info);
    Napi::Value GetFuelgaugeStatistics(const Napi::CallbackInfo& info);
    
    Napi::Value GetLogFileList(const Napi::CallbackInfo& info);
    Napi::Value ReadLogFile(const Napi::CallbackInfo& info);
    
    static Napi::Value DecodeLogData(const Napi::CallbackInfo& info);
    static Napi::Value GetHardwareString(const Napi::CallbackInfo& info);
    static Napi::Value GetPowerStatusString(const Napi::CallbackInfo& info);

private:
    Powermon* powermon_;
    std::atomic<bool> connected_;
    std::atomic<bool> connecting_;
    std::atomic<bool> ble_available_;
    Powermon::WifiAccessKey access_key_;
    
    Napi::ThreadSafeFunction on_connect_tsfn_;
    Napi::ThreadSafeFunction on_disconnect_tsfn_;
    
    void SetupCallbacks();
    void CleanupCallbacks();
    
    template<typename T>
    static Napi::Object CreateResultObject(Napi::Env env, Powermon::ResponseCode code, const T& data);
    
    static Napi::Object DeviceInfoToObject(Napi::Env env, const Powermon::DeviceInfo& info);
    static Napi::Object MonitorDataToObject(Napi::Env env, const Powermon::MonitorData& data);
    static Napi::Object MonitorStatisticsToObject(Napi::Env env, const Powermon::MonitorStatistics& stats);
    static Napi::Object FuelgaugeStatisticsToObject(Napi::Env env, const Powermon::FuelgaugeStatistics& stats);
    static Napi::Object LogFileDescriptorToObject(Napi::Env env, const Powermon::LogFileDescriptor& desc);
    static Napi::Object SampleToObject(Napi::Env env, const PowermonLogFile::Sample& sample);
};

#endif
