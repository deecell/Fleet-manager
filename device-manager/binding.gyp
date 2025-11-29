{
  "targets": [
    {
      "target_name": "powermon_addon",
      "sources": [
        "src/addon.cpp",
        "src/powermon_wrapper.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "../libpowermon_bin/inc"
      ],
      "libraries": [
        "<(module_root_dir)/../libpowermon_bin/powermon_lib_pic.a",
        "-lstdc++",
        "-lbluetooth",
        "-ldbus-1",
        "-lpthread"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17", "-fexceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS=0"],
      "conditions": [
        ["OS=='linux'", {
          "cflags_cc": ["-Wno-unused-parameter"]
        }]
      ]
    }
  ]
}
