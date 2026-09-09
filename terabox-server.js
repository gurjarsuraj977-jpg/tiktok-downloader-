#!/usr/bin/env node
/**
 * diagnostics/verify-terabox.js
 *
 * Standalone, read-only diagnostic for the TeraBox public-share resolve flow.
 * Uses Node's built-in fetch (Node 18+) -- no new dependencies, no
 * requirements.txt, nothing added to package.json.
 *
 * Does NOT modify terabox-server.js or wire into any live route. Run it
 * manually from the Render Shell tab.
 *
 * WHY MULTIPLE CANDIDATE HOSTS FOR share/list:
 * No verified current source confirms one single fixed host for the
 * share/list metadata call. Documented example responses (from other
 * open-source resolvers) consistently show "dm." and "dm-d." style
 * subdomains as the CDN host for the resolved dlink (file bytes), not
 * as the metadata
 * endpoint. Rather than hard-code a guess, this script tries the referer
 * domain first, then a couple of known candidates, and reports which one
 * (if any) actually returned errno 0 -- so the choice is based on this
 * run's evidence, not on an assumption.
 *
 * SECURITY:
 * - Reads the session cookie ONLY from process.env.TERABOX_NDUS.
 * - Never prints/logs/returns: cookie value, jsToken, bdstoken, dlink
 *   value, authorization headers, or any signed URL.
 * - Output is a flat JSON object with only the fields requested.
 */

'use strict';

const TEST_URL_DEFAULT = 'https://teraboxshare.com/s/1N1_3C7UX3ZxIMjNi_D62Ag';

const SUPPORTED_DOMAINS = [
  'teraboxshare.com', 'terabox.com', '1024terabox.com', 'terabox.app',
  'teraboxlink.com', 'terasharefile.com', 'terafileshare.com',
  'terasharelink.com',
];

const SURL_PATTERN = /\/s\/([a-zA-Z0-9_-]+)/;

const JSTOKEN_PATTERNS = [
  /fn%28%22(.*?)%22%29/,
  /jsToken\s*=\s*"function\(\)\s*\{\s*return\s*"(.*?)"/,
  /"jsToken"\s*:\s*"(.*?)"/,
  /%22(.*?)%22/,
];
const BDSTOKEN_PATTERN = /"bdstoken"\s*:\s*"(.*?)"/;

// Order = try order. '__referer_domain__' = whatever host the share page
// actually redirected to.
const CANDIDATE_HOSTS = ['__referer_domain__', 'www.terabox.com', 'dm.terabox.app'];

const ERRNO_VERIFICATION_REQUIRED = new Set([400141]);
const ERRNO_LIKELY_SESSION_ISSUE = new Set([-6, -7, 110, 105]);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function baseResult() {
  return {
    url_accepted: false,
    extracted_surl: null,
    final_share_page_url: null,
    share_page_http_status: null,
    jstoken_found: false,
    bdstoken_found: false,
    share_api_host_used: null,
    share_api_http_status: null,
    share_api_errno: null,
    file_count: null,
    filename: null,
    size: null,
    fs_id: null,
    dlink_present: false,
    cookie_configured: false,
    cookie_usable: null,
    failure_stage: null,
    sanitized_error: null,
  };
}

function getNdus() {
  return (process.env.TERABOX_NDUS || '').trim();
}

function extractSurl(url) {
  const m = SURL_PATTERN.exec(url);
  if (!m) return null;
  const raw = m[1];
  const stripped = (raw.startsWith('1') && raw.length > 1) ? raw.slice(1) : raw;
  return { raw, stripped };
}

function extractTokens(pageHtml) {
  let jsToken = null;
  for (const pattern of JSTOKEN_PATTERNS) {
    const m = pattern.exec(pageHtml);
    if (m) {
      try {
        jsToken = decodeURIComponent(m[1]);
      } catch (_e) {
        jsToken = m[1];
      }
      break;
    }
  }
  const bdsMatch = BDSTOKEN_PATTERN.exec(pageHtml);
  return { jsToken, bdsToken: bdsMatch ? bdsMatch[1] : null };
}

function browserHeaders({ referer, origin, ndus, accept }) {
  return {
    'User-Agent': UA,
    'Accept': accept || 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': origin,
    'Referer': referer,
    'Cookie': `ndus=${ndus}`,
  };
}

async function tryShareList(host, surlVariant, jsToken, referer, origin, ndus) {
  const params = new URLSearchParams({
    app_id: '250528',
    web: '1',
    channel: 'chunlei',
    clienttype: '0',
    jsToken: jsToken || '',
    shorturl: surlVariant,
    root: '1',
  });
  const apiUrl = `https://${host}/share/list?${params.toString()}`;
  let resp;
  try {
    resp = await fetch(apiUrl, {
      method: 'GET',
      headers: browserHeaders({ referer, origin, ndus }),
    });
  } catch (err) {
    return { netErr: `network_error:${err.name || 'FetchError'}` };
  }
  let data = null;
  try {
    data = await resp.json();
  } catch (_e) {
    return { status: resp.status, data: null, netErr: 'non_json_response' };
  }
  return { status: resp.status, data, netErr: null };
}

async function run(testUrl) {
  const r = baseResult();
  const ndus = getNdus();
  r.cookie_configured = Boolean(ndus);
  if (!ndus) {
    r.failure_stage = 'cookie_missing';
    r.sanitized_error = 'TERABOX_NDUS is not set in this environment.';
    return r;
  }

  const domainOk = SUPPORTED_DOMAINS.some((d) => testUrl.includes(d));
  r.url_accepted = domainOk;
  if (!domainOk) {
    r.failure_stage = 'url_rejected';
    r.sanitized_error = 'URL domain not in supported TeraBox domain list.';
    return r;
  }

  const surlPair = extractSurl(testUrl);
  if (!surlPair) {
    r.failure_stage = 'surl_extraction_failed';
    r.sanitized_error = 'Could not find /s/<id> segment in URL.';
    return r;
  }
  r.extracted_surl = surlPair.stripped;

  let pageResp;
  try {
    pageResp = await fetch(testUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': `ndus=${ndus}`,
      },
    });
  } catch (err) {
    r.failure_stage = 'page_fetch_failed';
    r.sanitized_error = `Network error fetching share page: ${err.name || 'FetchError'}`;
    return r;
  }

  r.final_share_page_url = pageResp.url || testUrl;
  r.share_page_http_status = pageResp.status;

  if (pageResp.status !== 200) {
    r.failure_stage = 'page_fetch_failed';
    r.sanitized_error = `Share page returned HTTP ${pageResp.status}.`;
    return r;
  }

  const pageHtml = await pageResp.text();
  const { jsToken, bdsToken } = extractTokens(pageHtml);
  r.jstoken_found = Boolean(jsToken);
  r.bdstoken_found = Boolean(bdsToken);

  if (!jsToken) {
    r.failure_stage = 'token_extraction_failed';
    r.cookie_usable = null; // can't tell -- markup may have changed independent of cookie validity
    r.sanitized_error = 'jsToken not found in share page HTML. Could mean TeraBox ' +
      'changed page markup, or the page rendered a login/verification wall instead ' +
      'of the normal share view.';
    return r;
  }

  let finalDomain;
  try {
    finalDomain = new URL(r.final_share_page_url).hostname;
  } catch (_e) {
    finalDomain = 'www.terabox.com';
  }
  const origin = `https://${finalDomain}`;
  const referer = r.final_share_page_url;

  const hostsTried = new Set();
  for (const placeholder of CANDIDATE_HOSTS) {
    const host = placeholder === '__referer_domain__' ? finalDomain : placeholder;
    if (hostsTried.has(host)) continue;
    hostsTried.add(host);

    for (const candidateSurl of [surlPair.stripped, surlPair.raw]) {
      const { status, data, netErr } = await tryShareList(
        host, candidateSurl, jsToken, referer, origin, ndus,
      );
      if (netErr) continue;

      r.share_api_host_used = host;
      r.share_api_http_status = status;
      if (!data) continue;

      const errno = data.errno;
      r.share_api_errno = errno;

      if (errno === 0) {
        const fileList = data.list || [];
        r.file_count = fileList.length;
        if (fileList.length > 0) {
          const first = fileList[0];
          r.filename = first.server_filename || null;
          r.size = first.size != null ? Number(first.size) : null;
          r.fs_id = first.fs_id != null ? String(first.fs_id) : null;
          r.dlink_present = Boolean(first.dlink);
        }
        r.cookie_usable = true;
        r.failure_stage = null;
        r.sanitized_error = null;
        return r;
      }

      if (ERRNO_VERIFICATION_REQUIRED.has(errno)) {
        r.failure_stage = 'verification_required';
        r.sanitized_error = `errno ${errno}: share requires additional verification ` +
          '(e.g. password), independent of cookie validity.';
        return r;
      }

      if (ERRNO_LIKELY_SESSION_ISSUE.has(errno)) {
        r.failure_stage = 'expired_session';
        r.cookie_usable = false;
        r.sanitized_error = `errno ${errno}: response pattern is consistent with an ` +
          'expired or invalid session cookie (heuristic, not certain).';
        return r;
      }
    }
  }

  if (r.share_api_http_status === null) {
    r.failure_stage = 'share_api_failed';
    r.sanitized_error = 'No candidate host returned a usable HTTP response.';
  } else {
    r.failure_stage = 'incorrect_endpoint_or_headers';
    r.sanitized_error = 'Got HTTP/JSON responses but none matched errno 0 or a ' +
      'recognized known errno. Endpoint host, params, or headers may not match ' +
      'the current live API -- see share_api_host_used and share_api_errno.';
  }
  return r;
}

function scrub(result) {
  const banned = ['ndus', 'jstoken', 'bdstoken', 'authorization', 'signed'];
  const safe = {};
  for (const [k, v] of Object.entries(result)) {
    const lk = k.toLowerCase();
    if (k === 'dlink_present') {
      safe[k] = v;
      continue;
    }
    if (banned.some((b) => lk.includes(b))) continue;
    safe[k] = v;
  }
  return safe;
}

async function main() {
  const testUrl = process.argv[2] || TEST_URL_DEFAULT;
  const result = await run(testUrl);
  process.stdout.write(JSON.stringify(scrub(result), null, 2) + '\n');
}

main().catch((err) => {
  // Even the crash path must never leak secrets.
  process.stdout.write(JSON.stringify({
    failure_stage: 'unexpected_error',
    sanitized_error: `Unhandled error: ${err.name || 'Error'}`,
  }, null, 2) + '\n');
  process.exitCode = 1;
});
