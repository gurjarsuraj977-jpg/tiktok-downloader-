/**
 * diagnostics/shorturlinfo-check.js  (CommonJS)
 *
 * NEW FILE. Does not touch terabox-server.js's existing routes, TikTok,
 * or Instagram. Exports a single function that terabox-server.js hooks
 * up to a temporary GET route.
 *
 * Tests ONLY: https://teraboxshare.com/s/1N1_3C7UX3ZxIMjNi_D62Ag
 * against https://www.terabox.app/api/shorturlinfo, using the existing
 * TERABOX_NDUS session cookie. Does not use or require a jsToken --
 * we've already established jsToken extraction fails on this account's
 * redirect target, so this tests whether shorturlinfo works independent
 * of that.
 *
 * SECURITY: never returns/logs ndus, jsToken, bdstoken, dlink, cookies,
 * or signed URLs. Output matches exactly the shape requested.
 */

'use strict';

const TEST_URL = 'https://teraboxshare.com/s/1N1_3C7UX3ZxIMjNi_D62Ag';

const SUPPORTED_DOMAINS = [
  'teraboxshare.com', 'terabox.com', '1024terabox.com', 'terabox.app',
  'teraboxlink.com', 'terasharefile.com', 'terafileshare.com',
  'terasharelink.com',
];

const SURL_PATTERN = /\/s\/([a-zA-Z0-9_-]+)/;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Candidate hosts + param sets to try for shorturlinfo, since the exact
// current parameter requirements aren't independently verified. Internal
// only -- none of this appears in the response shape.
const SHORTURLINFO_HOSTS = ['www.terabox.app', 'www.terabox.com', '1024terabox.com'];

function extractSurl(url) {
  const m = SURL_PATTERN.exec(url);
  if (!m) return null;
  const raw = m[1];
  return (raw.startsWith('1') && raw.length > 1) ? raw.slice(1) : raw;
}

async function fetchFinalShareUrl(ndus) {
  const resp = await fetch(TEST_URL, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cookie': `ndus=${ndus}`,
    },
  });
  return resp.url || TEST_URL;
}

async function tryShortUrlInfo(host, surlVariant, referer, ndus) {
  const params = new URLSearchParams({
    shorturl: surlVariant,
    root: '1',
  });
  const url = `https://${host}/api/shorturlinfo?${params.toString()}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': `https://${host}`,
        'Referer': referer,
        'Cookie': `ndus=${ndus}`,
      },
    });
  } catch (err) {
    return { status: null, data: null };
  }
  let data = null;
  try {
    data = await resp.json();
  } catch (_e) {
    return { status: resp.status, data: null };
  }
  return { status: resp.status, data };
}

async function runShortUrlInfoDiagnostic() {
  const result = {
    url_accepted: false,
    extracted_surl: null,
    final_share_page_url: null,
    shorturlinfo_http_status: null,
    shorturlinfo_errno: null,
    file_count: null,
    filename: null,
    size: null,
    fs_id: null,
    diagnostic_stage: 'shorturlinfo',
    sanitized_error: null,
  };

  const ndus = (process.env.TERABOX_NDUS || '').trim();
  if (!ndus) {
    result.sanitized_error = 'TERABOX_NDUS is not set in this environment.';
    return result;
  }

  result.url_accepted = SUPPORTED_DOMAINS.some((d) => TEST_URL.includes(d));
  if (!result.url_accepted) {
    result.sanitized_error = 'Test URL domain not in supported list.';
    return result;
  }

  const surl = extractSurl(TEST_URL);
  result.extracted_surl = surl;
  if (!surl) {
    result.sanitized_error = 'Could not extract surl from test URL.';
    return result;
  }

  let finalUrl;
  try {
    finalUrl = await fetchFinalShareUrl(ndus);
  } catch (err) {
    result.sanitized_error = `page_fetch_failed:${err.name || 'FetchError'}`;
    return result;
  }
  result.final_share_page_url = finalUrl;

  for (const host of SHORTURLINFO_HOSTS) {
    for (const surlVariant of [surl, '1' + surl]) {
      const { status, data } = await tryShortUrlInfo(host, surlVariant, finalUrl, ndus);
      if (status === null) continue;

      result.shorturlinfo_http_status = status;
      if (!data) continue;

      result.shorturlinfo_errno = data.errno;
      if (data.errno === 0) {
        const list = data.list || [];
        result.file_count = list.length;
        if (list.length > 0) {
          const first = list[0];
          result.filename = first.server_filename || null;
          result.size = first.size != null ? Number(first.size) : null;
          result.fs_id = first.fs_id != null ? String(first.fs_id) : null;
        }
        result.sanitized_error = null;
        return result;
      }
    }
  }

  if (result.shorturlinfo_http_status === null) {
    result.sanitized_error = 'No host returned a usable HTTP response for /api/shorturlinfo.';
  } else {
    result.sanitized_error = `shorturlinfo did not return errno 0 (last errno: ${result.shorturlinfo_errno}).`;
  }
  return result;
}

module.exports = { runShortUrlInfoDiagnostic };
