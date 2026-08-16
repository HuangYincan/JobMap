import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("map shell vertical slice is present", () => {
  const page = fs.readFileSync(path.join(root, "src/app/page.tsx"), "utf8");
  const shell = fs.readFileSync(path.join(root, "src/components/map-shell.tsx"), "utf8");
  const adapter = fs.readFileSync(path.join(root, "src/lib/map-adapter.ts"), "utf8");

  assert.match(page, /HomeMap/);
  // Three mobile drawer states must be present.
  assert.match(shell, /DrawerState = "mini" \| "half" \| "full"/);
  assert.match(shell, /drawerHalf|drawerFull|snapControls/);
  // Map engine must degrade gracefully without an API key.
  assert.match(adapter, /fallback/);
  assert.match(adapter, /NEXT_PUBLIC_AMAP_KEY/);
  assert.match(shell, /useState<MapMode>\('work'\)/);
  assert.doesNotMatch(shell, /t\('settings'/);
  assert.match(shell, /notSignedIn/);
  assert.match(shell, /AuthModal/);
});
