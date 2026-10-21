const downloadButton = document.querySelector('#download');
const downloadStatus = document.querySelector('#download-status');

const apkParts = [
  {
    url: '/downloads/peeranki-20261021.apk.part1',
    bytes: 20_971_520,
    sha256: '8a9dc9a4f9cf6f61bb3a8aa7f389ceb92e9eff5e5df73a98eb0883014fdce09a',
  },
  {
    url: '/downloads/peeranki-20261021.apk.part2',
    bytes: 20_971_520,
    sha256: '0b7bfaca0cd2efbc4b3e387efacb3cd7d92fdbe480a59134f25fb3e098cf8b1c',
  },
  {
    url: '/downloads/peeranki-20261021.apk.part3',
    bytes: 18_096_501,
    sha256: 'c69c25ff56d3e2977bb61f815a232929e374f899c48233e4f81d0a59074e9d2a',
  },
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
