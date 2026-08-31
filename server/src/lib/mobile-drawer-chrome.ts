// 手机抽屉搜索栏何时可见、mini 吸附时 sheet 如何回落。纯函数,node 可单测。

export type DrawerState = 'mini' | 'half' | 'full';
export type MobileSheet = 'explore' | 'layers' | 'account' | 'recent' | 'agent';

/**
 * mini 档工具栏和列表都被 CSS 藏掉,只剩搜索当 chrome。
 * 非 explore sheet 若也把搜索拿掉,底栏会变成只有一条把手的空壳。
 */
export function shouldShowMobileSearch(mobileSheet: MobileSheet, drawer: DrawerState): boolean {
  return mobileSheet === 'explore' || drawer === 'mini';
}

/** 收到 mini 时回到探索,否则搜索栏虽在、列表仍是空的图层/助手 sheet。 */
export function sheetAfterDrawerSnap(mobileSheet: MobileSheet, nextDrawer: DrawerState): MobileSheet {
  return nextDrawer === 'mini' ? 'explore' : mobileSheet;
}
