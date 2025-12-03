#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <poll.h>

#include <powermon.h>
#include <powermon_log.h>

#include <string>
#include <sstream>
#include <iomanip>
#include <atomic>
#include <vector>
#include <mutex>
#include <condition_variable>

static Powermon* powermon = nullptr;
static std::atomic<bool> connected(false);
static std::atomic<bool> connecting(false);
static std::atomic<bool> should_exit(false);
static std::mutex response_mutex;
static std::condition_variable response_cv;
static std::string current_cmd_id;

static void output_event(const char* event, const char* data = nullptr) {
    if (data) {
        printf("{\"type\":\"event\",\"event\":\"%s\",%s}\n", event, data);
    } else {
        printf("{\"type\":\"event\",\"event\":\"%s\"}\n", event);
    }
    fflush(stdout);
}

static void output_error(const std::string& cmd_id, const char* message) {
    printf("{\"type\":\"error\",\"id\":\"%s\",\"message\":\"%s\"}\n", cmd_id.c_str(), message);
    fflush(stdout);
}

static void output_fatal(const char* message) {
    printf("{\"type\":\"fatal\",\"message\":\"%s\"}\n", message);
    fflush(stdout);
}

static void output_result(const std::string& cmd_id, bool success, int code, const char* data = nullptr) {
    if (data) {
        printf("{\"type\":\"result\",\"id\":\"%s\",\"success\":%s,\"code\":%d,\"data\":%s}\n", 
               cmd_id.c_str(), success ? "true" : "false", code, data);
    } else {
        printf("{\"type\":\"result\",\"id\":\"%s\",\"success\":%s,\"code\":%d}\n", 
               cmd_id.c_str(), success ? "true" : "false", code);
    }
    fflush(stdout);
}

static std::string escape_json_string(const std::string& s) {
    std::ostringstream o;
    for (auto c : s) {
        switch (c) {
            case '"': o << "\\\""; break;
            case '\\': o << "\\\\"; break;
            case '\b': o << "\\b"; break;
            case '\f': o << "\\f"; break;
            case '\n': o << "\\n"; break;
            case '\r': o << "\\r"; break;
            case '\t': o << "\\t"; break;
            default:
                if ('\x00' <= c && c <= '\x1f') {
                    o << "\\u" << std::hex << std::setw(4) << std::setfill('0') << (int)c;
                } else {
                    o << c;
                }
        }
    }
    return o.str();
}

static std::string device_info_to_json(const Powermon::DeviceInfo& info) {
    std::ostringstream ss;
    ss << "{";
    ss << "\"name\":\"" << escape_json_string(info.name) << "\",";
    ss << "\"firmwareVersion\":\"" << (info.firmware_version_bcd >> 8) << "." << (info.firmware_version_bcd & 0xFF) << "\",";
    ss << "\"firmwareVersionBcd\":" << info.firmware_version_bcd << ",";
    ss << "\"hardwareRevision\":" << (int)info.hardware_revision_bcd << ",";
    ss << "\"hardwareString\":\"" << escape_json_string(Powermon::getHardwareString(info.hardware_revision_bcd)) << "\",";
    ss << "\"serial\":\"" << std::hex << std::uppercase << std::setfill('0') << std::setw(16) << info.serial << std::dec << "\",";
    ss << "\"timezone\":" << (int)info.timezone << ",";
    ss << "\"isUserLocked\":" << (info.isUserLocked() ? "true" : "false") << ",";
    ss << "\"isMasterLocked\":" << (info.isMasterLocked() ? "true" : "false") << ",";
    ss << "\"isWifiConnected\":" << (info.isWifiConnected() ? "true" : "false");
    ss << "}";
    return ss.str();
}

static std::string monitor_data_to_json(const Powermon::MonitorData& data) {
    std::ostringstream ss;
    ss << std::fixed << std::setprecision(3);
    ss << "{";
    ss << "\"time\":" << data.time << ",";
    ss << "\"voltage1\":" << data.voltage1 << ",";
    ss << "\"voltage2\":" << data.voltage2 << ",";
    ss << "\"current\":" << data.current << ",";
    ss << "\"power\":" << std::setprecision(2) << data.power << ",";
    ss << "\"temperature\":" << std::setprecision(1) << data.temperature << ",";
    ss << "\"coulombMeter\":" << std::setprecision(3) << (data.coulomb_meter / 1000.0) << ",";
    ss << "\"energyMeter\":" << std::setprecision(3) << (data.energy_meter / 1000.0) << ",";
    ss << "\"powerStatus\":" << (int)data.power_status << ",";
    ss << "\"powerStatusString\":\"" << escape_json_string(Powermon::getPowerStatusString(data.power_status)) << "\",";
    ss << "\"soc\":" << (int)data.fg_soc << ",";
    ss << "\"runtime\":" << data.fg_runtime << ",";
    ss << "\"rssi\":" << data.rssi << ",";
    ss << "\"isTemperatureExternal\":" << (data.isTemperatureExternal() ? "true" : "false");
    ss << "}";
    return ss.str();
}

static std::string monitor_stats_to_json(const Powermon::MonitorStatistics& stats) {
    std::ostringstream ss;
    ss << std::fixed << std::setprecision(3);
    ss << "{";
    ss << "\"secondsSinceOn\":" << stats.seconds_since_on << ",";
    ss << "\"voltage1Min\":" << stats.voltage1_min << ",";
    ss << "\"voltage1Max\":" << stats.voltage1_max << ",";
    ss << "\"voltage2Min\":" << stats.voltage2_min << ",";
    ss << "\"voltage2Max\":" << stats.voltage2_max << ",";
    ss << "\"peakChargeCurrent\":" << stats.peak_charge_current << ",";
    ss << "\"peakDischargeCurrent\":" << stats.peak_discharge_current << ",";
    ss << "\"temperatureMin\":" << std::setprecision(1) << stats.temperature_min << ",";
    ss << "\"temperatureMax\":" << stats.temperature_max;
    ss << "}";
    return ss.str();
}

static std::string fg_stats_to_json(const Powermon::FuelgaugeStatistics& stats) {
    std::ostringstream ss;
    ss << std::fixed << std::setprecision(3);
    ss << "{";
    ss << "\"timeSinceLastFullCharge\":" << stats.time_since_last_full_charge << ",";
    ss << "\"fullChargeCapacity\":" << stats.full_charge_capacity << ",";
    ss << "\"totalDischarge\":" << (stats.total_discharge / 1000.0) << ",";
    ss << "\"totalDischargeEnergy\":" << (stats.total_discharge_energy / 1000.0) << ",";
    ss << "\"totalCharge\":" << (stats.total_charge / 1000.0) << ",";
    ss << "\"totalChargeEnergy\":" << (stats.total_charge_energy / 1000.0) << ",";
    ss << "\"minVoltage\":" << stats.min_voltage << ",";
    ss << "\"maxVoltage\":" << stats.max_voltage << ",";
    ss << "\"maxDischargeCurrent\":" << stats.max_discharge_current << ",";
    ss << "\"maxChargeCurrent\":" << stats.max_charge_current << ",";
    ss << "\"deepestDischarge\":" << stats.deepest_discharge << ",";
    ss << "\"lastDischarge\":" << stats.last_discharge << ",";
    ss << "\"soc\":" << std::setprecision(1) << stats.soc;
    ss << "}";
    return ss.str();
}

static std::string log_files_to_json(const std::vector<Powermon::LogFileDescriptor>& files) {
    std::ostringstream ss;
    ss << "[";
    for (size_t i = 0; i < files.size(); i++) {
        if (i > 0) ss << ",";
        ss << "{\"id\":" << files[i].id << ",\"size\":" << files[i].size << "}";
    }
    ss << "]";
    return ss.str();
}

static void cmd_version(const std::string& cmd_id) {
    uint16_t version = Powermon::getVersion();
    std::ostringstream ss;
    ss << "{\"major\":" << (version >> 8) << ",\"minor\":" << (version & 0xFF) 
       << ",\"string\":\"" << (version >> 8) << "." << (version & 0xFF) << "\"}";
    output_result(cmd_id, true, 0, ss.str().c_str());
}

static void cmd_parse_url(const std::string& cmd_id, const std::string& url) {
    Powermon::DeviceIdentifier id;
    if (!id.fromURL(url.c_str())) {
        output_result(cmd_id, false, -1, "null");
        return;
    }
    
    std::ostringstream ss;
    ss << "{";
    ss << "\"name\":\"" << escape_json_string(id.name) << "\",";
    ss << "\"serial\":\"" << std::hex << std::uppercase << std::setfill('0') << std::setw(16) << id.serial << std::dec << "\",";
    ss << "\"hardwareRevision\":" << (int)id.hardware_revision_bcd << ",";
    ss << "\"hardwareString\":\"" << escape_json_string(Powermon::getHardwareString(id.hardware_revision_bcd)) << "\",";
    
    ss << "\"channelId\":\"";
    for (uint32_t i = 0; i < CHANNEL_ID_SIZE; i++) {
        ss << std::hex << std::uppercase << std::setfill('0') << std::setw(2) << (int)id.access_key.channel_id[i];
    }
    ss << std::dec << "\",";
    
    ss << "\"encryptionKey\":\"";
    for (uint32_t i = 0; i < ENCRYPTION_KEY_SIZE; i++) {
        ss << std::hex << std::uppercase << std::setfill('0') << std::setw(2) << (int)id.access_key.encryption_key[i];
    }
    ss << std::dec << "\"";
    ss << "}";
    
    output_result(cmd_id, true, 0, ss.str().c_str());
}

static void cmd_connect(const std::string& cmd_id, const std::string& url) {
    if (connected || connecting) {
        output_error(cmd_id, "Already connected or connecting");
        return;
    }
    
    Powermon::DeviceIdentifier id;
    if (!id.fromURL(url.c_str())) {
        output_error(cmd_id, "Invalid access URL");
        return;
    }
    
    connecting = true;
    powermon->connectWifi(id.access_key);
    output_result(cmd_id, true, 0);
}

static void cmd_disconnect(const std::string& cmd_id) {
    if (connected || connecting) {
        powermon->disconnect();
    }
    output_result(cmd_id, true, 0);
}

static void cmd_status(const std::string& cmd_id) {
    std::ostringstream ss;
    ss << "{\"connected\":" << (connected.load() ? "true" : "false") 
       << ",\"connecting\":" << (connecting.load() ? "true" : "false") << "}";
    output_result(cmd_id, true, 0, ss.str().c_str());
}

static void cmd_get_info(const std::string& cmd_id) {
    if (!connected) {
        output_error(cmd_id, "Not connected");
        return;
    }
    
    std::atomic<bool> done(false);
    std::string id_copy = cmd_id;
    powermon->requestGetInfo([&done, id_copy](Powermon::ResponseCode code, const Powermon::DeviceInfo& info) {
        if (code == Powermon::RSP_SUCCESS) {
            output_result(id_copy, true, code, device_info_to_json(info).c_str());
        } else {
            output_result(id_copy, false, code);
        }
        done = true;
    });
    
    while (!done && !should_exit) usleep(10 * 1000);
}

static void cmd_get_monitor_data(const std::string& cmd_id) {
    if (!connected) {
        output_error(cmd_id, "Not connected");
        return;
    }
    
    std::atomic<bool> done(false);
    std::string id_copy = cmd_id;
    powermon->requestGetMonitorData([&done, id_copy](Powermon::ResponseCode code, const Powermon::MonitorData& data) {
        if (code == Powermon::RSP_SUCCESS) {
            output_result(id_copy, true, code, monitor_data_to_json(data).c_str());
        } else {
            output_result(id_copy, false, code);
        }
        done = true;
    });
    
    while (!done && !should_exit) usleep(10 * 1000);
}

static void cmd_get_statistics(const std::string& cmd_id) {
    if (!connected) {
        output_error(cmd_id, "Not connected");
        return;
    }
    
    std::atomic<bool> done(false);
    std::string id_copy = cmd_id;
    powermon->requestGetStatistics([&done, id_copy](Powermon::ResponseCode code, const Powermon::MonitorStatistics& stats) {
        if (code == Powermon::RSP_SUCCESS) {
            output_result(id_copy, true, code, monitor_stats_to_json(stats).c_str());
        } else {
            output_result(id_copy, false, code);
        }
        done = true;
    });
    
    while (!done && !should_exit) usleep(10 * 1000);
}

static void cmd_get_fg_statistics(const std::string& cmd_id) {
    if (!connected) {
        output_error(cmd_id, "Not connected");
        return;
    }
    
    std::atomic<bool> done(false);
    std::string id_copy = cmd_id;
    powermon->requestGetFgStatistics([&done, id_copy](Powermon::ResponseCode code, const Powermon::FuelgaugeStatistics& stats) {
        if (code == Powermon::RSP_SUCCESS) {
            output_result(id_copy, true, code, fg_stats_to_json(stats).c_str());
        } else {
            output_result(id_copy, false, code);
        }
        done = true;
    });
    
    while (!done && !should_exit) usleep(10 * 1000);
}

static void cmd_get_log_files(const std::string& cmd_id) {
    if (!connected) {
        output_error(cmd_id, "Not connected");
        return;
    }
    
    std::atomic<bool> done(false);
    std::string id_copy = cmd_id;
    powermon->requestGetLogFileList([&done, id_copy](Powermon::ResponseCode code, const std::vector<Powermon::LogFileDescriptor>& files) {
        if (code == Powermon::RSP_SUCCESS) {
            output_result(id_copy, true, code, log_files_to_json(files).c_str());
        } else {
            output_result(id_copy, false, code);
        }
        done = true;
    });
    
    while (!done && !should_exit) usleep(10 * 1000);
}

static void cmd_read_log_file(const std::string& cmd_id, uint32_t file_id, uint32_t offset, uint32_t size) {
    if (!connected) {
        output_error(cmd_id, "Not connected");
        return;
    }
    
    std::atomic<bool> done(false);
    std::string id_copy = cmd_id;
    powermon->requestReadLogFile(file_id, offset, size, [&done, id_copy](Powermon::ResponseCode code, const uint8_t* data, size_t len) {
        if (code == Powermon::RSP_SUCCESS && data && len > 0) {
            std::ostringstream ss;
            ss << "\"";
            for (size_t i = 0; i < len; i++) {
                ss << std::hex << std::setfill('0') << std::setw(2) << (int)data[i];
            }
            ss << "\"";
            output_result(id_copy, true, code, ss.str().c_str());
        } else {
            output_result(id_copy, code == Powermon::RSP_SUCCESS, code);
        }
        done = true;
    });
    
    while (!done && !should_exit) usleep(10 * 1000);
}

static void cmd_stream_monitor(const std::string& cmd_id, int interval_ms, int count) {
    if (!connected) {
        output_error(cmd_id, "Not connected");
        return;
    }
    
    int samples = 0;
    while (!should_exit && connected && (count == 0 || samples < count)) {
        std::atomic<bool> done(false);
        powermon->requestGetMonitorData([&done](Powermon::ResponseCode code, const Powermon::MonitorData& data) {
            if (code == Powermon::RSP_SUCCESS) {
                std::string json = monitor_data_to_json(data);
                output_event("monitor", ("\"data\":" + json).c_str());
            }
            done = true;
        });
        
        while (!done && !should_exit) usleep(10 * 1000);
        samples++;
        
        if (count == 0 || samples < count) {
            for (int i = 0; i < interval_ms / 10 && !should_exit; i++) {
                usleep(10 * 1000);
            }
        }
    }
    
    output_result(cmd_id, true, 0);
}

static void handle_signal(int sig) {
    should_exit = true;
}

static bool read_line(std::string& line) {
    line.clear();
    char c;
    while (read(STDIN_FILENO, &c, 1) == 1) {
        if (c == '\n') return true;
        line += c;
    }
    return false;
}

static void parse_command(const std::string& line) {
    std::istringstream iss(line);
    std::string cmd_id, cmd;
    iss >> cmd_id >> cmd;
    
    if (cmd_id.empty() || cmd.empty()) {
        return;
    }
    
    if (cmd == "version") {
        cmd_version(cmd_id);
    } else if (cmd == "parse") {
        std::string url;
        std::getline(iss >> std::ws, url);
        cmd_parse_url(cmd_id, url);
    } else if (cmd == "connect") {
        std::string url;
        std::getline(iss >> std::ws, url);
        cmd_connect(cmd_id, url);
    } else if (cmd == "disconnect") {
        cmd_disconnect(cmd_id);
    } else if (cmd == "status") {
        cmd_status(cmd_id);
    } else if (cmd == "info") {
        cmd_get_info(cmd_id);
    } else if (cmd == "monitor") {
        cmd_get_monitor_data(cmd_id);
    } else if (cmd == "statistics") {
        cmd_get_statistics(cmd_id);
    } else if (cmd == "fgstatistics") {
        cmd_get_fg_statistics(cmd_id);
    } else if (cmd == "logfiles") {
        cmd_get_log_files(cmd_id);
    } else if (cmd == "readlog") {
        uint32_t file_id, offset, size;
        iss >> file_id >> offset >> size;
        cmd_read_log_file(cmd_id, file_id, offset, size);
    } else if (cmd == "stream") {
        int interval_ms = 2000;
        int count = 0;
        iss >> interval_ms >> count;
        cmd_stream_monitor(cmd_id, interval_ms, count);
    } else if (cmd == "quit" || cmd == "exit") {
        should_exit = true;
        output_result(cmd_id, true, 0);
    } else {
        output_error(cmd_id, "Unknown command");
    }
}

int main(int argc, char** argv) {
    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);
    signal(SIGPIPE, SIG_IGN);
    
    powermon = Powermon::createInstance();
    if (powermon == nullptr) {
        output_fatal("Failed to create Powermon instance");
        return EXIT_FAILURE;
    }
    
    powermon->setOnConnectCallback([]() {
        connected = true;
        connecting = false;
        output_event("connected");
    });
    
    powermon->setOnDisconnectCallback([](Powermon::DisconnectReason reason) {
        connected = false;
        connecting = false;
        std::ostringstream ss;
        ss << "\"reason\":" << (int)reason;
        output_event("disconnected", ss.str().c_str());
    });
    
    output_event("ready");
    
    std::string line;
    while (!should_exit && read_line(line)) {
        if (!line.empty()) {
            parse_command(line);
        }
    }
    
    if (connected) {
        powermon->disconnect();
        while (connected && !should_exit) usleep(50 * 1000);
    }
    
    delete powermon;
    return EXIT_SUCCESS;
}
