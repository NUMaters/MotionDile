#include <stdio.h>

#include "waniar/native_stub.h"

int main(void) {
  printf("waniar_native_stub_version=%d\n", waniar_native_stub_version());
  return 0;
}
