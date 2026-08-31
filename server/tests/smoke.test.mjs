import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("map shell vertical slice is present", () => {
  const page = fs.readFileSync(path.join(root, "src/app/page.tsx"), "utf8");
  const shell = fs.readFileSync(path.join(root, "src/components/map-shell.tsx"), "utf8");
  const drawerGesture = fs.readFileSync(
    path.join(root, "src/hooks/use-mobile-drawer-gesture.ts"),
    "utf8",
  );
  const drawerChrome = fs.readFileSync(
    path.join(root, "src/lib/mobile-drawer-chrome.ts"),
    "utf8",
  );

  assert.match(page, /HomeMap/);
  // Three mobile drawer states must be present.
  assert.match(drawerChrome, /export type DrawerState = 'mini' \| 'half' \| 'full'/);
  assert.match(drawerGesture, /export type \{ DrawerState, MobileSheet \}/);
  assert.match(shell, /useMobileDrawerGesture\(/);
  assert.match(shell, /drawerHalf|drawerFull|snapControls/);
  // Map engine graceful-degradation-without-key contract lives in the engine
  // layer now (engine.isConfigured / resolveEngine null fallback): the old
  // lib/map-adapter.ts seam was removed in the map-engine batch (ws-g).
  assert.match(shell, /useState<MapMode>\('work'\)/);
  assert.doesNotMatch(shell, /t\('settings'/);
  assert.match(shell, /notSignedIn/);
  assert.match(shell, /AuthModal/);
});
