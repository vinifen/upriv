# Mobile native bridge (future)

`upriv-core` will be linked here via React Native FFI (see product architecture).

| Platform | Bridge |
|----------|--------|
| Android | JNI + `libupriv_core.so` (ARM64), `7zz` in `jniLibs` |
| iOS | Static lib + Swift/Obj-C shim |
