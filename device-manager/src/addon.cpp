#include <napi.h>
#include "powermon_wrapper.h"

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return PowermonWrapper::Init(env, exports);
}

NODE_API_MODULE(powermon_addon, InitAll)
