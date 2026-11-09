const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const nativewindConfig = withNativewind(config);
const nativewindResolveRequest = nativewindConfig.resolver.resolveRequest;

const expoAssetPathSegment = `${path.sep}node_modules${path.sep}expo-asset${path.sep}`;

// NativeWind redirects "react-native" to react-native-css/components, whose
// export list omits AssetRegistry. expo-asset reads AssetRegistry from
// "react-native", so font loading fails unless it gets the real package.
nativewindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  const isExpoAssetReactNativeImport =
    platform !== "web" &&
    moduleName === "react-native" &&
    context.originModulePath.includes(expoAssetPathSegment);

  if (isExpoAssetReactNativeImport) {
    const parentResolveRequest =
      config.resolver?.resolveRequest ?? context.resolveRequest;
    return parentResolveRequest(context, moduleName, platform);
  }

  return nativewindResolveRequest(context, moduleName, platform);
};

module.exports = nativewindConfig;
