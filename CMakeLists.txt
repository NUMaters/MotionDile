cmake_minimum_required(VERSION 3.20)

project(WaniAR
  VERSION 0.0.1
  DESCRIPTION "WaniAR — ゲームは主に Vite / Go。CMake は将来のネイティブ処理用の土台"
  LANGUAGES C
)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_subdirectory(native)
