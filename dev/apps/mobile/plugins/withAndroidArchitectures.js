const { withGradleProperties } = require("expo/config-plugins");

/**
 * The architectures `scripts/build-android-ffi.sh` builds `libupriv_ffi.so` for.
 * The app cannot run on any other, so an APK carries no libraries for one.
 */
const ARCHITECTURES = "armeabi-v7a,arm64-v8a,x86_64";
const PROPERTY = "reactNativeArchitectures";

module.exports = function withAndroidArchitectures(config) {
  return withGradleProperties(config, (next) => {
    next.modResults = next.modResults.filter(
      (item) => item.type !== "property" || item.key !== PROPERTY,
    );
    next.modResults.push({ type: "property", key: PROPERTY, value: ARCHITECTURES });
    return next;
  });
};
