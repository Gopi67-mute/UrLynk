import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "./with-short-cmake-object-paths.js";

const { addCmakeArgument, OBJECT_PATH_MAX } = plugin;

/** The shape expo prebuild generates, reduced to what the plugin looks for. */
const GENERATED = `
android {
    namespace 'com.jdaloo.UrLynk'
    defaultConfig {
        applicationId 'com.jdaloo.UrLynk'
        versionCode 1
    }
    buildTypes {
        debug {}
    }
}
`;

test("the CMake argument is added inside defaultConfig", () => {
  const patched = addCmakeArgument(GENERATED);

  assert.match(patched, new RegExp(`CMAKE_OBJECT_PATH_MAX=${OBJECT_PATH_MAX}`));
  // Inside defaultConfig, not merely somewhere in the file: the argument has no
  // effect if Gradle reads it outside that block.
  const inDefaultConfig = patched.slice(
    patched.indexOf("defaultConfig"),
    patched.indexOf("buildTypes"),
  );
  assert.match(inDefaultConfig, /CMAKE_OBJECT_PATH_MAX/);
});

test("the limit stays under the Windows path limit it exists to respect", () => {
  assert.ok(OBJECT_PATH_MAX < 260, `${OBJECT_PATH_MAX} would not avoid the limit`);
});

test("applying it twice changes nothing the second time", () => {
  // prebuild can run the mod against an already-patched file; it must not stack.
  const once = addCmakeArgument(GENERATED);

  assert.equal(addCmakeArgument(once), once);
});

test("a build.gradle without defaultConfig fails loudly rather than silently", () => {
  // If the generated Gradle file ever changes shape, a silent no-op would bring the
  // 260-character build failure back with no clue as to why.
  assert.throws(() => addCmakeArgument("android {\n}\n"), /defaultConfig/);
});
