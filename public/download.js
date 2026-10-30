const downloadButton = document.querySelector('#download');
const downloadStatus = document.querySelector('#download-status');

const apkParts = [
  {
    "url": "/downloads/peeranki-20261030-release-60490e11.apk.part1",
    "bytes": 20381428,
    "sha256": "60490e11ba1badc61a91aa6d97eb343c08f872e29834b60e5855740c316d1768"
  }
];

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadVerifiedPart(part) {
  const response = await fetch(part.url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('A download part could not be loaded.');

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) throw new Error('A download part was replaced by a web page.');

  const data = await response.arrayBuffer();
  if (data.byteLength !== part.bytes) throw new Error('A download part has the wrong size.');

  const digest = await crypto.subtle.digest('SHA-256', data);
  if (toHex(new Uint8Array(digest)) !== part.sha256) throw new Error('A download part failed its integrity check.');
  return data;
}

downloadButton?.addEventListener('click', async (event) => {
  event.preventDefault();
  if (downloadButton.getAttribute('aria-disabled') === 'true') return;

  downloadButton.setAttribute('aria-disabled', 'true');
  downloadStatus.textContent = 'Downloading and verifying Peeranki…';
  try {
    const parts = [];
    for (const part of apkParts) parts.push(await loadVerifiedPart(part));

    const apk = new Blob(parts, { type: 'application/vnd.android.package-archive' });
    const objectUrl = URL.createObjectURL(apk);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'Peeranki.apk';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    downloadStatus.textContent = 'All parts verified. Open Peeranki.apk to install it.';
  } catch {
    downloadStatus.textContent = 'Download verification failed. No APK was saved. Please reload and try again.';
  } finally {
    downloadButton.removeAttribute('aria-disabled');
  }
});
