// Persistent background image management with IndexedDB fallback and dev server sync

const DB_NAME = 'peeranki_audio_db';
const BG_STORE = 'backgrounds';
const BG_KEY = 'menu_background_blob';

function openBackgroundDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('tracks')) {
        db.createObjectStore('tracks');
      }
      if (!db.objectStoreNames.contains(BG_STORE)) {
        db.createObjectStore(BG_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getStoredMenuBackgroundBlob(): Promise<Blob | null> {
  try {
    const db = await openBackgroundDB();
    return new Promise((resolve) => {
      const tx = db.transaction(BG_STORE, 'readonly');
      const store = tx.objectStore(BG_STORE);
      const req = store.get(BG_KEY);
      req.onsuccess = () => {
        resolve(req.result instanceof Blob ? req.result : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setStoredMenuBackgroundBlob(blob: Blob): Promise<void> {
  try {
    const db = await openBackgroundDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BG_STORE, 'readwrite');
      const store = tx.objectStore(BG_STORE);
      const req = store.put(blob, BG_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[BackgroundManager] Failed to store in IndexedDB:', err);
  }

  // Also sync to server public/assets/background/menu_background.png
  try {
    await fetch('/api/upload-bg', {
      method: 'POST',
      body: blob,
    });
  } catch {
    // Offline or serverless mode fallback
  }
}

let activeBlobUrl: string | null = null;

export async function getMenuBackgroundUrl(): Promise<string> {
  const blob = await getStoredMenuBackgroundBlob();
  if (blob) {
    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
    }
    activeBlobUrl = URL.createObjectURL(blob);
    return activeBlobUrl;
  }
  return 'assets/background/menu_background.png';
}

const backgroundChangeListeners = new Set<() => void>();

export function onMenuBackgroundChange(listener: () => void): () => void {
  backgroundChangeListeners.add(listener);
  return () => backgroundChangeListeners.delete(listener);
}

export function notifyMenuBackgroundChange() {
  backgroundChangeListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

export async function applyCustomBackgroundFile(file: File | Blob): Promise<void> {
  await setStoredMenuBackgroundBlob(file);
  notifyMenuBackgroundChange();
}

export function openBackgroundFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/jpg';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) {
      await applyCustomBackgroundFile(file);
    }
    input.remove();
  };
  input.click();
}

export function initBackgroundDragOverlay() {
  if (typeof window === 'undefined') return;

  let dragCounter = 0;
  let overlayEl: HTMLDivElement | null = null;

  const getOrCreateOverlay = () => {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'pk-bg-drop-overlay';
      overlayEl.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.94); border: 3px dashed #38bdf8; border-radius: 16px; padding: 32px 48px; text-align: center; color: #fff; max-width: 480px; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          <div style="font-size: 48px; margin-bottom: 12px;">🖼️</div>
          <div style="font-size: 20px; font-weight: bold; margin-bottom: 8px;">Drop image to set Menu Background</div>
          <div style="font-size: 14px; color: #94a3b8;">PNG, JPG, or WebP will be saved as the new Main Menu backdrop</div>
        </div>
      `;
      overlayEl.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        pointer-events: none;
        backdrop-filter: blur(4px);
      `;
      document.body.appendChild(overlayEl);
    }
    return overlayEl;
  };

  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounter++;
      const el = getOrCreateOverlay();
      el.style.display = 'flex';
    }
  });

  window.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0 && overlayEl) {
      overlayEl.style.display = 'none';
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (overlayEl) {
      overlayEl.style.display = 'none';
    }

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const imgFile = Array.from(files).find(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name),
    );

    if (imgFile) {
      await applyCustomBackgroundFile(imgFile);
    }
  });
}
