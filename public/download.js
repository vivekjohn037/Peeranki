const downloadButton = document.querySelector('#download');
const downloadStatus = document.querySelector('#download-status');

const apkParts = [
  {
    "url": "/downloads/peeranki-20261021-release-cc19f40b.apk.part1",
    "bytes": 20971520,
    "sha256": "f2baf64e8622beacf4bc2d8c23d1603588a1cc0c5ab088a21d07f679641d4544"
  },
  {
    "url": "/downloads/peeranki-20261021-release-cc19f40b.apk.part2",
    "bytes": 20971520,
    "sha256": "181d08ce1f3eeca823fc78d64b79d0149819cf068c99be9c8f6a68523694d9d8"
  },
  {
    "url": "/downloads/peeranki-20261021-release-cc19f40b.apk.part3",
    "bytes": 20971520,
    "sha256": "44e8231e020a43b2c4fa9a372e0dc3c26c7a893fc507aa03fb4174302aab99ab"
  },
  {
    "url": "/downloads/peeranki-20261021-release-cc19f40b.apk.part4",
    "bytes": 16974803,
    "sha256": "2e79fb7bd7d633365c965f6ea12771a9947f8559a8700d2fd422a0ef46b7e8b2"
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
