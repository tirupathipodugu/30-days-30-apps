// Share to X, for every app: "Post on X" opens X's composer as a reply under that app's Day post
// (or a new post before the Day post exists), pre-filled with the visitor's result and the link.
// X can't take an image from a web page, so saveImage() hands the picture over separately:
// the share sheet on phones, a download on computers.

const SITE = 'https://tirupathipodugu.github.io/ideas/';

// Load the Day post ids when the module loads, so a click can open X at once (a window opened
// after an await is often blocked as a popup).
let apps = [];
fetch(new URL('../apps.json', import.meta.url), { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : []))
  .then((list) => { if (Array.isArray(list)) apps = list; })
  .catch(() => {});

/** Open X with the result. path is the app folder with a trailing slash, e.g. 'living-heart/'. */
export function postOnX({ path, text }) {
  const tweet = apps.find((a) => a.path === path)?.tweet;
  const q = new URLSearchParams({ text: `${text}\n\n${SITE}${path}` });
  if (tweet) q.set('in_reply_to', String(tweet));
  window.open(`https://x.com/intent/post?${q}`, '_blank', 'noopener');
}

/** Hand an image to the visitor: the share sheet where files can be shared, otherwise a download. */
export async function saveImage(blob, name, title) {
  const file = new File([blob], name, { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

