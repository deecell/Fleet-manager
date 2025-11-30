#include "powermon_wrapper.h"
#include <powermon_log.h>
#include <sstream>
#include <iomanip>

Napi::Object PowermonWrapper::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "PowermonDevice", {
        StaticMethod("getLibraryVersion", &PowermonWrapper::GetLibraryVersion),
        StaticMethod("parseAccessURL", &PowermonWrapper::ParseAccessURL),
        StaticMethod("decodeLogData", &PowermonWrapper::DecodeLogData),
        StaticMethod("getHardwareString", &PowermonWrapper::GetHardwareString),
        StaticMethod("getPowerStatusString", &PowermonWrapper::GetPowerStatusString),
        
        InstanceMethod("connect", &PowermonWrapper::Connect),
        InstanceMethod("disconnect", &PowermonWrapper::Disconnect),
        InstanceMethod("isConnected", &PowermonWrapper::IsConnected),
        InstanceMethod("isBleAvailable", &PowermonWrapper::IsBleAvailable),
        InstanceMethod("getInfo", &PowermonWrapper::GetInfo),
        InstanceMethod("getMonitorData", &PowermonWrapper::GetMonitorData),
        InstanceMethod("getStatistics", &PowermonWrapper::GetStatistics),
        InstanceMethod("getFuelgaugeStatistics", &PowermonWrapper::GetFuelgaugeStatistics),
        InstanceMethod("getLogFileList", &PowermonWrapper::GetLogFileList),
        InstanceMethod("readLogFile", &PowermonWrapper::ReadLogFile),
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("PowermonDevice", func);
    return exports;
}

PowermonWrapper::PowermonWrapper(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<PowermonWrapper>(info)
    , powermon_(nullptr)
    , connected_(false)
    , connecting_(false)
    , ble_available_(false) {
    
    // With libpowermon v1.11+, createInstance() no longer requires BLE
    // BLE is now initialized separately via initBle()
    powermon_ = Powermon::createInstance();
    
    if (powermon_ != nullptr) {
        SetupCallbacks();
        
        // Try to initialize BLE (optional - WiFi works without it)
        try {
            ble_available_ = powermon_->initBle();
        } catch (...) {
            // BLE init failed (expected on servers without Bluetooth)
            // WiFi connections will still work
            ble_available_ = false;
        }
    }
}

PowermonWrapper::~PowermonWrapper() {
    CleanupCallbacks();
    if (powermon_) {
        if (connected_) {
            powermon_->disconnect();
        }
        delete powermon_;
        powermon_ = nullptr;
    }
}

void PowermonWrapper::SetupCallbacks() {
    powermon_->setOnConnectCallback([this]() {
        connected_ = true;
        connecting_ = false;
        if (on_connect_tsfn_) {
            on_connect_tsfn_.NonBlockingCall([](Napi::Env env, Napi::Function callback) {
                callback.Call({});
            });
        }
    });
    
    powermon_->setOnDisconnectCallback([this](Powermon::DisconnectReason reason) {
        connected_ = false;
        connecting_ = false;
        if (on_disconnect_tsfn_) {
            on_disconnect_tsfn_.NonBlockingCall([reason](Napi::Env env, Napi::Function callback) {
                callback.Call({Napi::Number::New(env, static_cast<int>(reason))});
            });
        }
    });
}

void PowermonWrapper::CleanupCallbacks() {
    if (on_connect_tsfn_) {
        on_connect_tsfn_.Release();
    }
    if (on_disconnect_tsfn_) {
        on_disconnect_tsfn_.Release();
    }
}

Napi::Value PowermonWrapper::GetLibraryVersion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    uint16_t version = Powermon::getVersion();
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("major", Napi::Number::New(env, version >> 8));
    result.Set("minor", Napi::Number::New(env, version & 0xFF));
    result.Set("string", Napi::String::New(env, 
        std::to_string(version >> 8) + "." + std::to_string(version & 0xFF)));
    
    return result;
}

Napi::Value PowermonWrapper::ParseAccessURL(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "URL string expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string url = info[0].As<Napi::String>().Utf8Value();
    Powermon::DeviceIdentifier id;
    
    if (!id.fromURL(url.c_str())) {
        return env.Null();
    }
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("name", Napi::String::New(env, id.name));
    result.Set("serial", Napi::String::New(env, 
        (std::stringstream() << std::hex << std::uppercase << std::setfill('0') 
         << std::setw(16) << id.serial).str()));
    result.Set("hardwareRevision", Napi::Number::New(env, id.hardware_revision_bcd));
    result.Set("hardwareString", Napi::String::New(env, 
        Powermon::getHardwareString(id.hardware_revision_bcd)));
    
    std::stringstream channel_ss;
    for (uint32_t i = 0; i < CHANNEL_ID_SIZE; i++) {
        channel_ss << std::hex << std::uppercase << std::setfill('0') 
                   << std::setw(2) << static_cast<int>(id.access_key.channel_id[i]);
    }
    result.Set("channelId", Napi::String::New(env, channel_ss.str()));
    
    std::stringstream key_ss;
    for (uint32_t i = 0; i < ENCRYPTION_KEY_SIZE; i++) {
        key_ss << std::hex << std::uppercase << std::setfill('0') 
               << std::setw(2) << static_cast<int>(id.access_key.encryption_key[i]);
    }
    result.Set("encryptionKey", Napi::String::New(env, key_ss.str()));
    
    Napi::Object access_key = Napi::Object::New(env);
    Napi::ArrayBuffer channel_buf = Napi::ArrayBuffer::New(env, CHANNEL_ID_SIZE);
    memcpy(channel_buf.Data(), id.access_key.channel_id, CHANNEL_ID_SIZE);
    access_key.Set("channelId", Napi::Uint8Array::New(env, CHANNEL_ID_SIZE, channel_buf, 0));
    
    Napi::ArrayBuffer enc_buf = Napi::ArrayBuffer::New(env, ENCRYPTION_KEY_SIZE);
    memcpy(enc_buf.Data(), id.access_key.encryption_key, ENCRYPTION_KEY_SIZE);
    access_key.Set("encryptionKey", Napi::Uint8Array::New(env, ENCRYPTION_KEY_SIZE, enc_buf, 0));
    
    result.Set("accessKey", access_key);
    
    return result;
}

Napi::Value PowermonWrapper::Connect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!ble_available_ || powermon_ == nullptr) {
        Napi::TypeError::New(env, "Bluetooth not available - cannot connect to devices")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (connected_ || connecting_) {
        Napi::TypeError::New(env, "Already connected or connecting")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Options object expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    Napi::Object options = info[0].As<Napi::Object>();
    
    if (options.Has("onConnect") && options.Get("onConnect").IsFunction()) {
        on_connect_tsfn_ = Napi::ThreadSafeFunction::New(
            env,
            options.Get("onConnect").As<Napi::Function>(),
            "OnConnectCallback",
            0, 1
        );
    }
    
    if (options.Has("onDisconnect") && options.Get("onDisconnect").IsFunction()) {
        on_disconnect_tsfn_ = Napi::ThreadSafeFunction::New(
            env,
            options.Get("onDisconnect").As<Napi::Function>(),
            "OnDisconnectCallback",
            0, 1
        );
    }
    
    if (options.Has("accessKey") && options.Get("accessKey").IsObject()) {
        Napi::Object ak = options.Get("accessKey").As<Napi::Object>();
        
        if (ak.Has("channelId") && ak.Get("channelId").IsTypedArray()) {
            Napi::Uint8Array channel = ak.Get("channelId").As<Napi::Uint8Array>();
            if (channel.ByteLength() >= CHANNEL_ID_SIZE) {
                memcpy(access_key_.channel_id, channel.Data(), CHANNEL_ID_SIZE);
            }
        }
        
        if (ak.Has("encryptionKey") && ak.Get("encryptionKey").IsTypedArray()) {
            Napi::Uint8Array enc = ak.Get("encryptionKey").As<Napi::Uint8Array>();
            if (enc.ByteLength() >= ENCRYPTION_KEY_SIZE) {
                memcpy(access_key_.encryption_key, enc.Data(), ENCRYPTION_KEY_SIZE);
            }
        }
        
        connecting_ = true;
        powermon_->connectWifi(access_key_);
        
    } else if (options.Has("url") && options.Get("url").IsString()) {
        std::string url = options.Get("url").As<Napi::String>().Utf8Value();
        Powermon::DeviceIdentifier id;
        
        if (!id.fromURL(url.c_str())) {
            Napi::TypeError::New(env, "Invalid access URL").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        
        access_key_ = id.access_key;
        connecting_ = true;
        powermon_->connectWifi(access_key_);
        
    } else {
        Napi::TypeError::New(env, "Either 'accessKey' or 'url' option required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    return env.Undefined();
}

Napi::Value PowermonWrapper::Disconnect(const Napi::CallbackInfo& info) {
    if (connected_ || connecting_) {
        powermon_->disconnect();
    }
    return info.Env().Undefined();
}

Napi::Value PowermonWrapper::IsConnected(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), connected_.load());
}

Napi::Value PowermonWrapper::IsBleAvailable(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), ble_available_.load());
}

Napi::Object PowermonWrapper::DeviceInfoToObject(Napi::Env env, const Powermon::DeviceInfo& info) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("name", Napi::String::New(env, info.name));
    obj.Set("firmwareVersion", Napi::String::New(env,
        std::to_string(info.firmware_version_bcd >> 8) + "." + 
        std::to_string(info.firmware_version_bcd & 0xFF)));
    obj.Set("firmwareVersionBcd", Napi::Number::New(env, info.firmware_version_bcd));
    obj.Set("hardwareRevision", Napi::Number::New(env, info.hardware_revision_bcd));
    obj.Set("hardwareString", Napi::String::New(env, 
        Powermon::getHardwareString(info.hardware_revision_bcd)));
    
    std::stringstream serial_ss;
    serial_ss << std::hex << std::uppercase << std::setfill('0') 
              << std::setw(16) << info.serial;
    obj.Set("serial", Napi::String::New(env, serial_ss.str()));
    
    obj.Set("timezone", Napi::Number::New(env, info.timezone));
    obj.Set("isUserLocked", Napi::Boolean::New(env, info.isUserLocked()));
    obj.Set("isMasterLocked", Napi::Boolean::New(env, info.isMasterLocked()));
    obj.Set("isWifiConnected", Napi::Boolean::New(env, info.isWifiConnected()));
    
    return obj;
}

Napi::Object PowermonWrapper::MonitorDataToObject(Napi::Env env, const Powermon::MonitorData& data) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("time", Napi::Number::New(env, data.time));
    obj.Set("voltage1", Napi::Number::New(env, data.voltage1));
    obj.Set("voltage2", Napi::Number::New(env, data.voltage2));
    obj.Set("current", Napi::Number::New(env, data.current));
    obj.Set("power", Napi::Number::New(env, data.power));
    obj.Set("temperature", Napi::Number::New(env, data.temperature));
    obj.Set("coulombMeter", Napi::Number::New(env, data.coulomb_meter / 1000.0));
    obj.Set("energyMeter", Napi::Number::New(env, data.energy_meter / 1000.0));
    obj.Set("powerStatus", Napi::Number::New(env, static_cast<int>(data.power_status)));
    obj.Set("powerStatusString", Napi::String::New(env, 
        Powermon::getPowerStatusString(data.power_status)));
    obj.Set("soc", Napi::Number::New(env, data.fg_soc));
    obj.Set("runtime", Napi::Number::New(env, data.fg_runtime));
    obj.Set("rssi", Napi::Number::New(env, data.rssi));
    obj.Set("isTemperatureExternal", Napi::Boolean::New(env, data.isTemperatureExternal()));
    
    return obj;
}

Napi::Object PowermonWrapper::MonitorStatisticsToObject(Napi::Env env, const Powermon::MonitorStatistics& stats) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("secondsSinceOn", Napi::Number::New(env, stats.seconds_since_on));
    obj.Set("voltage1Min", Napi::Number::New(env, stats.voltage1_min));
    obj.Set("voltage1Max", Napi::Number::New(env, stats.voltage1_max));
    obj.Set("voltage2Min", Napi::Number::New(env, stats.voltage2_min));
    obj.Set("voltage2Max", Napi::Number::New(env, stats.voltage2_max));
    obj.Set("peakChargeCurrent", Napi::Number::New(env, stats.peak_charge_current));
    obj.Set("peakDischargeCurrent", Napi::Number::New(env, stats.peak_discharge_current));
    obj.Set("temperatureMin", Napi::Number::New(env, stats.temperature_min));
    obj.Set("temperatureMax", Napi::Number::New(env, stats.temperature_max));
    return obj;
}

Napi::Object PowermonWrapper::FuelgaugeStatisticsToObject(Napi::Env env, const Powermon::FuelgaugeStatistics& stats) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("timeSinceLastFullCharge", Napi::Number::New(env, stats.time_since_last_full_charge));
    obj.Set("fullChargeCapacity", Napi::Number::New(env, stats.full_charge_capacity));
    obj.Set("totalDischarge", Napi::Number::New(env, stats.total_discharge / 1000.0));
    obj.Set("totalDischargeEnergy", Napi::Number::New(env, stats.total_discharge_energy / 1000.0));
    obj.Set("totalCharge", Napi::Number::New(env, stats.total_charge / 1000.0));
    obj.Set("totalChargeEnergy", Napi::Number::New(env, stats.total_charge_energy / 1000.0));
    obj.Set("minVoltage", Napi::Number::New(env, stats.min_voltage));
    obj.Set("maxVoltage", Napi::Number::New(env, stats.max_voltage));
    obj.Set("maxDischargeCurrent", Napi::Number::New(env, stats.max_discharge_current));
    obj.Set("maxChargeCurrent", Napi::Number::New(env, stats.max_charge_current));
    obj.Set("deepestDischarge", Napi::Number::New(env, stats.deepest_discharge));
    obj.Set("lastDischarge", Napi::Number::New(env, stats.last_discharge));
    obj.Set("soc", Napi::Number::New(env, stats.soc));
    return obj;
}

Napi::Object PowermonWrapper::LogFileDescriptorToObject(Napi::Env env, const Powermon::LogFileDescriptor& desc) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("id", Napi::Number::New(env, desc.id));
    obj.Set("size", Napi::Number::New(env, desc.size));
    return obj;
}

Napi::Object PowermonWrapper::SampleToObject(Napi::Env env, const PowermonLogFile::Sample& sample) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("time", Napi::Number::New(env, sample.time));
    obj.Set("voltage1", Napi::Number::New(env, sample.voltage1));
    obj.Set("voltage2", Napi::Number::New(env, sample.voltage2));
    obj.Set("current", Napi::Number::New(env, sample.current));
    obj.Set("power", Napi::Number::New(env, sample.power));
    obj.Set("temperature", Napi::Number::New(env, sample.temperature));
    obj.Set("soc", Napi::Number::New(env, sample.soc));
    obj.Set("powerStatus", Napi::Number::New(env, sample.ps));
    return obj;
}

Napi::Value PowermonWrapper::GetInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!connected_) {
        Napi::TypeError::New(env, "Not connected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(), "GetInfoCallback", 0, 1
    );
    
    powermon_->requestGetInfo([tsfn](Powermon::ResponseCode code, const Powermon::DeviceInfo& device_info) mutable {
        tsfn.NonBlockingCall([code, device_info](Napi::Env env, Napi::Function callback) {
            Napi::Object result = Napi::Object::New(env);
            result.Set("success", Napi::Boolean::New(env, code == Powermon::RSP_SUCCESS));
            result.Set("code", Napi::Number::New(env, static_cast<int>(code)));
            
            if (code == Powermon::RSP_SUCCESS) {
                result.Set("data", DeviceInfoToObject(env, device_info));
            }
            
            callback.Call({result});
        });
        tsfn.Release();
    });
    
    return env.Undefined();
}

Napi::Value PowermonWrapper::GetMonitorData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!connected_) {
        Napi::TypeError::New(env, "Not connected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(), "GetMonitorDataCallback", 0, 1
    );
    
    powermon_->requestGetMonitorData([tsfn](Powermon::ResponseCode code, const Powermon::MonitorData& data) mutable {
        tsfn.NonBlockingCall([code, data](Napi::Env env, Napi::Function callback) {
            Napi::Object result = Napi::Object::New(env);
            result.Set("success", Napi::Boolean::New(env, code == Powermon::RSP_SUCCESS));
            result.Set("code", Napi::Number::New(env, static_cast<int>(code)));
            
            if (code == Powermon::RSP_SUCCESS) {
                result.Set("data", MonitorDataToObject(env, data));
            }
            
            callback.Call({result});
        });
        tsfn.Release();
    });
    
    return env.Undefined();
}

Napi::Value PowermonWrapper::GetStatistics(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!connected_) {
        Napi::TypeError::New(env, "Not connected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(), "GetStatisticsCallback", 0, 1
    );
    
    powermon_->requestGetStatistics([tsfn](Powermon::ResponseCode code, const Powermon::MonitorStatistics& stats) mutable {
        tsfn.NonBlockingCall([code, stats](Napi::Env env, Napi::Function callback) {
            Napi::Object result = Napi::Object::New(env);
            result.Set("success", Napi::Boolean::New(env, code == Powermon::RSP_SUCCESS));
            result.Set("code", Napi::Number::New(env, static_cast<int>(code)));
            
            if (code == Powermon::RSP_SUCCESS) {
                result.Set("data", MonitorStatisticsToObject(env, stats));
            }
            
            callback.Call({result});
        });
        tsfn.Release();
    });
    
    return env.Undefined();
}

Napi::Value PowermonWrapper::GetFuelgaugeStatistics(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!connected_) {
        Napi::TypeError::New(env, "Not connected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(), "GetFgStatisticsCallback", 0, 1
    );
    
    powermon_->requestGetFgStatistics([tsfn](Powermon::ResponseCode code, const Powermon::FuelgaugeStatistics& stats) mutable {
        tsfn.NonBlockingCall([code, stats](Napi::Env env, Napi::Function callback) {
            Napi::Object result = Napi::Object::New(env);
            result.Set("success", Napi::Boolean::New(env, code == Powermon::RSP_SUCCESS));
            result.Set("code", Napi::Number::New(env, static_cast<int>(code)));
            
            if (code == Powermon::RSP_SUCCESS) {
                result.Set("data", FuelgaugeStatisticsToObject(env, stats));
            }
            
            callback.Call({result});
        });
        tsfn.Release();
    });
    
    return env.Undefined();
}

Napi::Value PowermonWrapper::GetLogFileList(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!connected_) {
        Napi::TypeError::New(env, "Not connected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(), "GetLogFileListCallback", 0, 1
    );
    
    powermon_->requestGetLogFileList([tsfn](Powermon::ResponseCode code, 
        const std::vector<Powermon::LogFileDescriptor>& files) mutable {
        
        tsfn.NonBlockingCall([code, files](Napi::Env env, Napi::Function callback) {
            Napi::Object result = Napi::Object::New(env);
            result.Set("success", Napi::Boolean::New(env, code == Powermon::RSP_SUCCESS));
            result.Set("code", Napi::Number::New(env, static_cast<int>(code)));
            
            if (code == Powermon::RSP_SUCCESS) {
                Napi::Array arr = Napi::Array::New(env, files.size());
                for (size_t i = 0; i < files.size(); i++) {
                    arr.Set(i, LogFileDescriptorToObject(env, files[i]));
                }
                result.Set("data", arr);
            }
            
            callback.Call({result});
        });
        tsfn.Release();
    });
    
    return env.Undefined();
}

Napi::Value PowermonWrapper::ReadLogFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!connected_) {
        Napi::TypeError::New(env, "Not connected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    if (info.Length() < 4) {
        Napi::TypeError::New(env, "fileId, offset, size, and callback expected")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    uint32_t file_id = info[0].As<Napi::Number>().Uint32Value();
    uint32_t offset = info[1].As<Napi::Number>().Uint32Value();
    uint32_t read_size = info[2].As<Napi::Number>().Uint32Value();
    
    if (!info[3].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
        env, info[3].As<Napi::Function>(), "ReadLogFileCallback", 0, 1
    );
    
    powermon_->requestReadLogFile(file_id, offset, read_size, 
        [tsfn](Powermon::ResponseCode code, const uint8_t* data, size_t size) mutable {
        
        std::vector<uint8_t> data_copy;
        if (code == Powermon::RSP_SUCCESS && data && size > 0) {
            data_copy.assign(data, data + size);
        }
        
        tsfn.NonBlockingCall([code, data_copy](Napi::Env env, Napi::Function callback) {
            Napi::Object result = Napi::Object::New(env);
            result.Set("success", Napi::Boolean::New(env, code == Powermon::RSP_SUCCESS));
            result.Set("code", Napi::Number::New(env, static_cast<int>(code)));
            
            if (code == Powermon::RSP_SUCCESS && !data_copy.empty()) {
                Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, data_copy.size());
                memcpy(buf.Data(), data_copy.data(), data_copy.size());
                result.Set("data", Napi::Uint8Array::New(env, data_copy.size(), buf, 0));
            }
            
            callback.Call({result});
        });
        tsfn.Release();
    });
    
    return env.Undefined();
}

Napi::Value PowermonWrapper::DecodeLogData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Buffer expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::vector<char> data;
    
    if (info[0].IsTypedArray()) {
        Napi::Uint8Array arr = info[0].As<Napi::Uint8Array>();
        data.assign(reinterpret_cast<char*>(arr.Data()), 
                    reinterpret_cast<char*>(arr.Data()) + arr.ByteLength());
    } else if (info[0].IsArrayBuffer()) {
        Napi::ArrayBuffer buf = info[0].As<Napi::ArrayBuffer>();
        data.assign(reinterpret_cast<char*>(buf.Data()),
                    reinterpret_cast<char*>(buf.Data()) + buf.ByteLength());
    } else {
        Napi::TypeError::New(env, "Uint8Array or ArrayBuffer expected")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::vector<PowermonLogFile::Sample> samples;
    uint32_t result_code = PowermonLogFile::decode(data, samples);
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, result_code == 0));
    result.Set("code", Napi::Number::New(env, result_code));
    
    Napi::Array arr = Napi::Array::New(env, samples.size());
    for (size_t i = 0; i < samples.size(); i++) {
        arr.Set(i, SampleToObject(env, samples[i]));
    }
    result.Set("samples", arr);
    
    return result;
}

Napi::Value PowermonWrapper::GetHardwareString(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Hardware revision number expected")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    uint8_t hw_rev = info[0].As<Napi::Number>().Uint32Value() & 0xFF;
    return Napi::String::New(env, Powermon::getHardwareString(hw_rev));
}

Napi::Value PowermonWrapper::GetPowerStatusString(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Power status number expected")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    Powermon::PowerStatus status = static_cast<Powermon::PowerStatus>(
        info[0].As<Napi::Number>().Uint32Value() & 0xFF);
    return Napi::String::New(env, Powermon::getPowerStatusString(status));
}
