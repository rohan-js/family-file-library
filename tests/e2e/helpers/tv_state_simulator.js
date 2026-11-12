/**
 * tv_state_simulator.js - Simulates TV hardware and UI runtime behavioral invariants.
 */

const crypto = require('node:crypto');

const KEYCODES = {
  KEYCODE_DPAD_LEFT: 21,
  KEYCODE_DPAD_RIGHT: 22,
  KEYCODE_DPAD_UP: 19,
  KEYCODE_DPAD_DOWN: 20,
  KEYCODE_DPAD_CENTER: 23,
  KEYCODE_ENTER: 66,
  KEYCODE_BACK: 4,
  KEYCODE_MEDIA_PLAY_PAUSE: 85,
};

const ACTIONS = {
  PREV_PAGE: 'PREV_PAGE',
  NEXT_PAGE: 'NEXT_PAGE',
  SCROLL_UP: 'SCROLL_UP',
  SCROLL_DOWN: 'SCROLL_DOWN',
  TOGGLE_TOOLBAR: 'TOGGLE_TOOLBAR',
  EXIT_VIEWER: 'EXIT_VIEWER',
  TOGGLE_TTS: 'TOGGLE_TTS',
  UNKNOWN: 'UNKNOWN',
};

class TvDpadRouter {
  routeKey(keyCode) {
    switch (keyCode) {
      case KEYCODES.KEYCODE_DPAD_LEFT:
        return ACTIONS.PREV_PAGE;
      case KEYCODES.KEYCODE_DPAD_RIGHT:
        return ACTIONS.NEXT_PAGE;
      case KEYCODES.KEYCODE_DPAD_UP:
        return ACTIONS.SCROLL_UP;
      case KEYCODES.KEYCODE_DPAD_DOWN:
        return ACTIONS.SCROLL_DOWN;
      case KEYCODES.KEYCODE_DPAD_CENTER:
      case KEYCODES.KEYCODE_ENTER:
        return ACTIONS.TOGGLE_TOOLBAR;
      case KEYCODES.KEYCODE_BACK:
        return ACTIONS.EXIT_VIEWER;
      case KEYCODES.KEYCODE_MEDIA_PLAY_PAUSE:
        return ACTIONS.TOGGLE_TTS;
      default:
        return ACTIONS.UNKNOWN;
    }
  }
}

class TvOverscanCalculator {
  calculateSafeArea(width = 1920, height = 1080, marginPct = 0.05) {
    const horizontalMargin = Math.round(width * marginPct);
    const verticalMargin = Math.round(height * marginPct);
    return {
      width,
      height,
      horizontalMargin,
      verticalMargin,
      safeWidth: width - (2 * horizontalMargin),
      safeHeight: height - (2 * verticalMargin),
    };
  }
}

class SafeTvPdfRendererSim {
  constructor(maxPagesInWindow = 3) {
    this.maxPagesInWindow = maxPagesInWindow;
    this.activePages = new Set();
    this.isRendering = false;
  }

  async renderPage(pageNumber) {
    if (this.isRendering) {
      throw new Error('Concurrent render detected! SafeTvPdfRenderer Mutex violation.');
    }
    this.isRendering = true;

    // Yield to microtask queue to simulate asynchronous Mutex acquisition
    await new Promise((resolve) => setImmediate(resolve));

    try {
      this.activePages.add(pageNumber);
      if (this.activePages.size > this.maxPagesInWindow) {
        // Evict oldest page
        const oldest = this.activePages.values().next().value;
        this.activePages.delete(oldest);
      }
      return {
        pageNumber,
        config: 'RGB_565',
        activeWindowSize: this.activePages.size,
      };
    } finally {
      this.isRendering = false;
    }
  }

  getActivePages() {
    return Array.from(this.activePages);
  }
}

class TvDiskCacheSim {
  constructor(capacityBytes = 524288000) { // 500MB
    this.capacityBytes = capacityBytes;
    this.files = new Map(); // fileId -> { sizeBytes, isPinned, accessIndex }
    this.accessCounter = 0;
  }

  getTotalBytes() {
    let sum = 0;
    for (const item of this.files.values()) {
      sum += item.sizeBytes;
    }
    return sum;
  }

  put(fileId, sizeBytes, isPinned) {
    const existing = this.files.get(fileId);
    const resolvedPinned = isPinned !== undefined
      ? Boolean(isPinned)
      : (existing ? existing.isPinned : false);

    this.files.set(fileId, {
      sizeBytes,
      isPinned: resolvedPinned,
      accessIndex: ++this.accessCounter,
    });
    this.evictIfNeeded();
  }

  touch(fileId) {
    const item = this.files.get(fileId);
    if (item) {
      item.accessIndex = ++this.accessCounter;
    }
  }

  pin(fileId, isPinned = true) {
    const item = this.files.get(fileId);
    if (item) {
      item.isPinned = Boolean(isPinned);
    }
  }

  evictIfNeeded() {
    while (this.getTotalBytes() > this.capacityBytes) {
      // Find least recently accessed unpinned file
      let oldestUnpinned = null;
      let minAccess = Infinity;

      for (const [id, item] of this.files.entries()) {
        if (!item.isPinned && item.accessIndex < minAccess) {
          minAccess = item.accessIndex;
          oldestUnpinned = id;
        }
      }

      if (!oldestUnpinned) {
        // Only pinned files remain; cannot evict further
        break;
      }

      this.files.delete(oldestUnpinned);
    }
  }

  has(fileId) {
    return this.files.has(fileId);
  }

  isPinned(fileId) {
    return Boolean(this.files.get(fileId)?.isPinned);
  }
}

class TtsDiagnosticSim {
  constructor(engines = []) {
    this.engines = engines;
    this.hasDucking = false;
  }

  canSpeak() {
    return this.engines.length > 0;
  }

  requestAudioFocusWithDucking() {
    if (!this.canSpeak()) return false;
    this.hasDucking = true;
    return true;
  }

  releaseAudioFocus() {
    this.hasDucking = false;
  }
}

class TvDesignSystemSim {
  constructor(width = 1920, height = 1080) {
    this.width = width;
    this.height = height;
    this.themeBackground = '#0F172A';
    this.bodyTypographySp = 24;
    this.headerTypographySp = 32;
    this.marginPercent = 0.05;
  }

  getSafeMargins() {
    return {
      horizontalMarginPx: Math.round(this.width * this.marginPercent), // 96px on 1080p
      verticalMarginPx: Math.round(this.height * this.marginPercent),   // 54px on 1080p
      horizontalMarginDp: 48,
      verticalMarginDp: 27,
    };
  }

  getSafeBounds() {
    const margins = this.getSafeMargins();
    return {
      safeWidth: this.width - 2 * margins.horizontalMarginPx,
      safeHeight: this.height - 2 * margins.verticalMarginPx,
    };
  }
}

class TvFocusIndicatorSim {
  constructor() {
    this.isFocused = false;
    this.focusedScale = 1.06;
    this.unfocusedScale = 1.0;
    this.focusedBorderWidthDp = 3;
    this.unfocusedBorderWidthDp = 0;
    this.focusedBorderColor = '#00E5FF';
    this.focusedGlowElevationDp = 16;
    this.focusedGlowColor = '#6600E5FF';
  }

  setFocus(focused) {
    this.isFocused = Boolean(focused);
  }

  getCurrentScale() {
    return this.isFocused ? this.focusedScale : this.unfocusedScale;
  }

  getCurrentBorder() {
    return this.isFocused
      ? { widthDp: this.focusedBorderWidthDp, color: this.focusedBorderColor }
      : { widthDp: this.unfocusedBorderWidthDp, color: 'transparent' };
  }

  getCurrentGlow() {
    return this.isFocused
      ? { elevationDp: this.focusedGlowElevationDp, color: this.focusedGlowColor }
      : { elevationDp: 0, color: 'transparent' };
  }
}

class TvMultiShelfLayoutSim {
  constructor() {
    this.shelves = new Map([
      ['continue_reading', []],
      ['favorites', []],
      ['inbox', []],
      ['folders', []],
    ]);
    this.orientation = 'horizontal';
    this.topActions = new Set(['search', 'settings']);
    this.topNav = ['search', 'settings'];
    this.focusArea = 'shelves'; // 'shelves' | 'top_nav'
    this.activeShelfKey = 'inbox';
    this.focusedIndices = new Map([
      ['continue_reading', 0],
      ['favorites', 0],
      ['inbox', 0],
      ['folders', 0],
    ]);
    this.activeTopNavIndex = 0;
  }

  addItem(shelfKey, item) {
    if (!this.shelves.has(shelfKey)) throw new Error(`Unknown shelf: ${shelfKey}`);
    this.shelves.get(shelfKey).push(item);
    if (shelfKey === 'continue_reading' && this.shelves.get('continue_reading').length === 1) {
      if (this.activeShelfKey === 'inbox') {
        this.activeShelfKey = 'continue_reading';
      }
    }
  }

  getShelfKeys() {
    return Array.from(this.shelves.keys());
  }

  getInitialFocusShelf() {
    return this.shelves.get('continue_reading').length > 0 ? 'continue_reading' : 'inbox';
  }

  setActiveShelf(shelfKey) {
    if (!this.shelves.has(shelfKey)) throw new Error(`Unknown shelf: ${shelfKey}`);
    this.activeShelfKey = shelfKey;
    this.focusArea = 'shelves';
  }

  getFocusedItemIndex(shelfKey = this.activeShelfKey) {
    return this.focusedIndices.get(shelfKey) ?? 0;
  }

  setFocusedItemIndex(shelfKey, index) {
    const items = this.shelves.get(shelfKey) || [];
    if (items.length === 0) {
      this.focusedIndices.set(shelfKey, 0);
      return;
    }
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    this.focusedIndices.set(shelfKey, clamped);
  }

  getFocusedItem(shelfKey = this.activeShelfKey) {
    const items = this.shelves.get(shelfKey) || [];
    const idx = this.getFocusedItemIndex(shelfKey);
    return items[idx] || null;
  }

  navigateLeft(shelfKey = this.activeShelfKey) {
    const items = this.shelves.get(shelfKey) || [];
    const currentIndex = this.getFocusedItemIndex(shelfKey);
    if (items.length === 0 || currentIndex <= 0) {
      // 10-foot TV Invariant: Boundary clamped at index 0. Strictly NO circular wrapping to N-1.
      this.focusedIndices.set(shelfKey, 0);
      return {
        action: 'BOUNDARY_CLAMPED',
        clamped: true,
        wrapped: false,
        shelfKey,
        itemIndex: 0,
        item: items[0] || null,
      };
    }
    const newIndex = currentIndex - 1;
    this.focusedIndices.set(shelfKey, newIndex);
    return {
      action: 'NAVIGATE_LEFT',
      clamped: false,
      wrapped: false,
      shelfKey,
      itemIndex: newIndex,
      item: items[newIndex],
    };
  }

  navigateRight(shelfKey = this.activeShelfKey) {
    const items = this.shelves.get(shelfKey) || [];
    const currentIndex = this.getFocusedItemIndex(shelfKey);
    const maxIndex = Math.max(0, items.length - 1);
    if (items.length === 0 || currentIndex >= maxIndex) {
      // 10-foot TV Invariant: Boundary clamped at index N-1. Strictly NO circular wrapping to 0.
      this.focusedIndices.set(shelfKey, maxIndex);
      return {
        action: 'BOUNDARY_CLAMPED',
        clamped: true,
        wrapped: false,
        shelfKey,
        itemIndex: maxIndex,
        item: items[maxIndex] || null,
      };
    }
    const newIndex = currentIndex + 1;
    this.focusedIndices.set(shelfKey, newIndex);
    return {
      action: 'NAVIGATE_RIGHT',
      clamped: false,
      wrapped: false,
      shelfKey,
      itemIndex: newIndex,
      item: items[newIndex],
    };
  }

  navigateUp() {
    if (this.focusArea === 'top_nav') {
      return { action: 'BOUNDARY_CLAMPED', clamped: true, focusArea: 'top_nav', index: this.activeTopNavIndex };
    }
    const shelfKeys = this.getShelfKeys();
    const currentShelfIndex = shelfKeys.indexOf(this.activeShelfKey);
    if (currentShelfIndex > 0) {
      this.activeShelfKey = shelfKeys[currentShelfIndex - 1];
      const newItems = this.shelves.get(this.activeShelfKey) || [];
      const currItemIndex = this.getFocusedItemIndex(this.activeShelfKey);
      const clampedItemIndex = newItems.length > 0 ? Math.min(currItemIndex, newItems.length - 1) : 0;
      this.focusedIndices.set(this.activeShelfKey, clampedItemIndex);
      return { action: 'NAVIGATE_UP', clamped: false, shelfKey: this.activeShelfKey, itemIndex: clampedItemIndex };
    } else {
      this.focusArea = 'top_nav';
      return { action: 'FOCUS_TOP_NAV', clamped: false, focusArea: 'top_nav', index: this.activeTopNavIndex };
    }
  }

  navigateDown() {
    if (this.focusArea === 'top_nav') {
      this.focusArea = 'shelves';
      return {
        action: 'FOCUS_SHELVES',
        clamped: false,
        focusArea: 'shelves',
        shelfKey: this.activeShelfKey,
        itemIndex: this.getFocusedItemIndex(),
      };
    }
    const shelfKeys = this.getShelfKeys();
    const currentShelfIndex = shelfKeys.indexOf(this.activeShelfKey);
    if (currentShelfIndex < shelfKeys.length - 1) {
      this.activeShelfKey = shelfKeys[currentShelfIndex + 1];
      const newItems = this.shelves.get(this.activeShelfKey) || [];
      const currItemIndex = this.getFocusedItemIndex(this.activeShelfKey);
      const clampedItemIndex = newItems.length > 0 ? Math.min(currItemIndex, newItems.length - 1) : 0;
      this.focusedIndices.set(this.activeShelfKey, clampedItemIndex);
      return { action: 'NAVIGATE_DOWN', clamped: false, shelfKey: this.activeShelfKey, itemIndex: clampedItemIndex };
    } else {
      return { action: 'BOUNDARY_CLAMPED', clamped: true, shelfKey: this.activeShelfKey, itemIndex: this.getFocusedItemIndex() };
    }
  }

  handleDpad(keyCode) {
    if (keyCode === KEYCODES.KEYCODE_DPAD_LEFT || keyCode === 'LEFT' || keyCode === 'DPAD_LEFT') {
      if (this.focusArea === 'top_nav') {
        if (this.activeTopNavIndex > 0) {
          this.activeTopNavIndex--;
          return { action: 'FOCUS_CHANGED', clamped: false, focusArea: 'top_nav', index: this.activeTopNavIndex };
        }
        return { action: 'BOUNDARY_CLAMPED', clamped: true, focusArea: 'top_nav', index: this.activeTopNavIndex };
      }
      return this.navigateLeft(this.activeShelfKey);
    }
    if (keyCode === KEYCODES.KEYCODE_DPAD_RIGHT || keyCode === 'RIGHT' || keyCode === 'DPAD_RIGHT') {
      if (this.focusArea === 'top_nav') {
        if (this.activeTopNavIndex < this.topNav.length - 1) {
          this.activeTopNavIndex++;
          return { action: 'FOCUS_CHANGED', clamped: false, focusArea: 'top_nav', index: this.activeTopNavIndex };
        }
        return { action: 'BOUNDARY_CLAMPED', clamped: true, focusArea: 'top_nav', index: this.activeTopNavIndex };
      }
      return this.navigateRight(this.activeShelfKey);
    }
    if (keyCode === KEYCODES.KEYCODE_DPAD_UP || keyCode === 'UP' || keyCode === 'DPAD_UP') {
      return this.navigateUp();
    }
    if (keyCode === KEYCODES.KEYCODE_DPAD_DOWN || keyCode === 'DOWN' || keyCode === 'DPAD_DOWN') {
      return this.navigateDown();
    }
    return { action: 'UNKNOWN', clamped: false };
  }
}

class TvCoilImageViewerSim {
  constructor(deviceRamHeapMb = 512) {
    this.deviceRamHeapMb = deviceRamHeapMb;
    this.maxHeapPercent = 0.15; // 15% heap cap
    this.bitmapConfig = 'RGB_565';
    this.zoomLevel = 1.0;
    this.rotationDegrees = 0;
    this.isSlideshowRunning = false;
    this.slideshowIntervalMs = 5000;
    this.currentImageIndex = 0;
  }

  getMemoryLimitMb() {
    return this.deviceRamHeapMb * this.maxHeapPercent; // 76.8 MB on 512MB device
  }

  zoomIn() {
    this.zoomLevel = Math.min(3.0, this.zoomLevel + 0.5);
  }

  zoomOut() {
    this.zoomLevel = Math.max(1.0, this.zoomLevel - 0.5);
  }

  rotateClockwise() {
    this.rotationDegrees = (this.rotationDegrees + 90) % 360;
  }

  toggleSlideshow() {
    this.isSlideshowRunning = !this.isSlideshowRunning;
  }

  advanceSlideshow(totalImages) {
    if (this.isSlideshowRunning && totalImages > 0) {
      this.currentImageIndex = (this.currentImageIndex + 1) % totalImages;
    }
  }
}

class TvTextMarkdownViewerSim {
  constructor() {
    this.baseFontSizeSp = 28;
    this.scrollOffset = 0;
    this.savedOffsets = new Map();
  }

  parseMarkdown(content) {
    const lines = content.split('\n');
    const elements = [];
    for (const line of lines) {
      if (line.startsWith('# ')) {
        elements.push({ type: 'header', level: 1, text: line.slice(2) });
      } else if (line.startsWith('## ')) {
        elements.push({ type: 'header', level: 2, text: line.slice(3) });
      } else if (line.startsWith('- ')) {
        elements.push({ type: 'list_item', text: line.slice(2) });
      } else if (line.startsWith('> ')) {
        elements.push({ type: 'quote', text: line.slice(2) });
      } else if (line.trim().length > 0) {
        elements.push({ type: 'paragraph', text: line });
      }
    }
    return elements;
  }

  scrollBy(delta) {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
  }

  saveOffset(docId) {
    this.savedOffsets.set(docId, this.scrollOffset);
  }

  restoreOffset(docId) {
    return this.savedOffsets.get(docId) || 0;
  }
}

class TvZxingQrPairingSim {
  constructor(code = '482-910') {
    this.code = code;
    this.qrWidth = 320;
    this.qrHeight = 320;
    this.expiresInSeconds = 600;
    this.pollingIntervalMs = 3000;
    this.state = 'INITIALIZING';
  }

  start() {
    this.state = 'DISPLAYING_CODE';
  }

  tick(seconds = 1) {
    this.expiresInSeconds = Math.max(0, this.expiresInSeconds - seconds);
    if (this.expiresInSeconds === 0) {
      this.state = 'EXPIRED';
    }
  }

  approve() {
    this.state = 'SUCCESS';
  }
}

class TvPinKeypadSim {
  constructor(salt = 'family_space_salt') {
    this.salt = salt;
    this.enteredDigits = '';
    this.focusedKey = '0';
    this.isUnlocked = false;
  }

  pressKey(digit) {
    if (digit === 'BACKSPACE') {
      this.enteredDigits = this.enteredDigits.slice(0, -1);
    } else if (digit === 'CLEAR') {
      this.enteredDigits = '';
    } else if (this.enteredDigits.length < 4 && /^\d$/.test(digit)) {
      this.enteredDigits += digit;
    }
  }

  computeHash(pin) {
    return crypto.createHash('sha256').update(pin + this.salt).digest('hex');
  }

  submit(expectedHash) {
    const hash = this.computeHash(this.enteredDigits);
    this.enteredDigits = '';
    if (hash === expectedHash) {
      this.isUnlocked = true;
      return true;
    } else {
      this.isUnlocked = false;
      return false;
    }
  }
}

class TvHudToastSim {
  constructor() {
    this.subscribed = false;
    this.visible = false;
    this.currentToast = null;
    this.dismissTimeoutMs = 5000;
    this.remainingMs = 0;
  }

  subscribe() {
    this.subscribed = true;
  }

  onInsert(fileRecord) {
    if (!this.subscribed) return;
    this.visible = true;
    this.currentToast = {
      message: `New file: ${fileRecord.name} from ${fileRecord.sender_name || 'Family Member'}`,
      fileId: fileRecord.id,
    };
    this.remainingMs = this.dismissTimeoutMs;
  }

  tick(elapsedMs) {
    if (!this.visible) return;
    this.remainingMs -= elapsedMs;
    if (this.remainingMs <= 0) {
      this.dismiss();
    }
  }

  dismiss() {
    this.visible = false;
    this.currentToast = null;
    this.remainingMs = 0;
  }
}

module.exports = {
  KEYCODES,
  ACTIONS,
  TvDpadRouter,
  TvOverscanCalculator,
  SafeTvPdfRendererSim,
  TvDiskCacheSim,
  TtsDiagnosticSim,
  TvDesignSystemSim,
  TvFocusIndicatorSim,
  TvMultiShelfLayoutSim,
  TvCoilImageViewerSim,
  TvTextMarkdownViewerSim,
  TvZxingQrPairingSim,
  TvPinKeypadSim,
  TvHudToastSim,
};
