const downloadButton = document.querySelector('#download');
const downloadStatus = document.querySelector('#download-status');

const apkParts = [
  {
    "url": "/downloads/peeranki-20261021-release-8c857a6d.apk.part1",
    "bytes": 20971520,
    "sha256": "604903bcfe05960e638c0abe46c50898e07d38358cca04b2745154ca8c703ab2"
  },
  {
    "url": "/downloads/peeranki-20261021-release-8c857a6d.apk.part2",
    "bytes": 20971520,
    "sha256": "1e15c677e46feb40327d470da827a6a84e3b811c427da952545e7933b790180e"
  },
  {
    "url": "/downloads/peeranki-20261021-release-8c857a6d.apk.part3",
    "bytes": 20971520,
    "sha256": "443325aef692c323987b28a16c74ea401cc1fd4d9e2a9fbb3b44b91bc9c1ce1b"
  },
  {
    "url": "/downloads/peeranki-20261021-release-8c857a6d.apk.part4",
    "bytes": 20971520,
    "sha256": "fe1f2ded564d5d641e27ec7c3038329b0c5ba870b0847078649528ddf08abb0b"
  },
  {
    "url": "/downloads/peeranki-20261021-release-8c857a6d.apk.part5",
    "bytes": 20971520,
    "sha256": "21bc0412d6c7ee9d130c1dd105b52d8d0fbcb8cc8d428fcb1af35312809cb1c8"
  },
  {
    "url": "/downloads/peeranki-20261021-release-8c857a6d.apk.part6",
    "bytes": 20971520,
    "sha256": "c9f64dade6650947cd368730aea781929c04fa5caa98f2d6af67a7dc1ff57f38"
  },
  {
    "url": "/downloads/peeranki-20261021-release-8c857a6d.apk.part7",
    "bytes": 20971520,
    "sha256": "b9ca7be189bab961f07009853aa3f11e83094f117644b075f123639b612ebb22"
  },
  {
    "url": "/downloads/peeranki-20261021-release-8c857a6d.apk.part8",
    "bytes": 12475363,
    "sha256": "196e23244e583ee1d504683f61253d35167a74a1f07af06c460a11338cf55843"
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
