add_library(waniar_native STATIC
  src/stub.c
)
target_include_directories(waniar_native PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

add_executable(waniar_native_check
  src/main.c
)
target_link_libraries(waniar_native_check PRIVATE waniar_native)
