/**
 * Keeps React Native's C++ object paths under Windows' 260-character limit.
 *
 * The problem this solves is specific and easy to misdiagnose. React Native's codegen
 * writes each object file into a path that *embeds the full source path* inside the
 * build directory, so a file like
 *
 *   node_modules/react-native-gesture-handler/shared/shadowNodes/react/renderer/
 *     components/rngesturehandler_codegen/RNGestureHandlerDetectorShadowNode.cpp
 *
 * ends up around 336 characters once it is placed under `android/app/.cxx/...`. The
 * `ninja.exe` shipped with the Android SDK's CMake is not long-path aware, so it fails
 * with "Filename longer than 260 characters" even on a machine where Windows'
 * `LongPathsEnabled` registry setting is turned on — as it is on this one. The build
 * error names a dependency rather than the real cause, which makes it look like a
 * broken package.
 *
 * `CMAKE_OBJECT_PATH_MAX` is CMake's own answer: told what the native build tool can
 * cope with, it shortens object directories itself rather than producing paths that
 * cannot be written.
 *
 * This is set for every platform because the argument is harmless where paths are not
 * limited: CMake only shortens a path that would otherwise exceed the maximum.
 *
 * Without this plugin the same one-line change has to be made by hand in
 * `android/app/build.gradle` after every `expo prebuild`, since that directory is
 * generated and is not in version control.
 */

const { withAppBuildGradle } = require("expo/config-plugins");

// Comfortably below 260, leaving room for the build-type and ABI segments that CMake
// does not count when it measures a path.
const OBJECT_PATH_MAX = 240;

const MARKER = "CMAKE_OBJECT_PATH_MAX";

const BLOCK = `
        // Added by plugins/with-short-cmake-object-paths.js — see that file for why.
        externalNativeBuild {
            cmake {
                arguments "-D${MARKER}=${OBJECT_PATH_MAX}"
            }
        }
`;

/** Insert the block inside `android { defaultConfig { ... } }`. */
function addCmakeArgument(contents) {
  if (contents.includes(MARKER)) return contents;

  const anchor = /(\n\s*defaultConfig\s*\{)/;
  if (!anchor.test(contents)) {
    throw new Error(
      "with-short-cmake-object-paths: no `defaultConfig {` block found in " +
        "android/app/build.gradle, so the CMake argument could not be added. The " +
        "generated Gradle file has changed shape; update this plugin.",
    );
  }

  return contents.replace(anchor, `$1${BLOCK}`);
}

module.exports = function withShortCmakeObjectPaths(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== "groovy") {
      throw new Error(
        "with-short-cmake-object-paths: expected a Groovy build.gradle; " +
          `got ${modConfig.modResults.language}.`,
      );
    }

    modConfig.modResults.contents = addCmakeArgument(modConfig.modResults.contents);
    return modConfig;
  });
};

// Exported for the unit test, which checks the edit without running a prebuild.
module.exports.addCmakeArgument = addCmakeArgument;
module.exports.OBJECT_PATH_MAX = OBJECT_PATH_MAX;
