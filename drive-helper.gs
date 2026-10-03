// Lens Loop · Drive helper — one file for Google Apps Script (script.google.com), run in your own account.
//
// Google's Drive sign-in from a web page lasts an hour and a page cannot extend it on its own. Google does
// issue refresh tokens that last for ever, but redeeming and renewing them needs the OAuth client secret,
// which must never be in a public page. This helper keeps that secret and does only those two things for
// the page: redeem the one-time sign-in code for an access token plus a refresh token, and renew the access
// token from the refresh token whenever the page asks — every hour, for ever, hands-free, in any browser.
//
// Setup, once (about five minutes):
//  1. console.cloud.google.com → APIs & Services → Credentials → the Lens Loop OAuth client (Web application)
//     → copy the Client secret. The page's address must be among the Authorized redirect URIs (it already is
//     if Connect Google Drive has ever worked): https://ahmetkartal-99.github.io/lens-loop/
//  2. script.google.com → New project → replace the editor's contents with this file → Project Settings (the
//     gear) → Script Properties → Add script property: CLIENT_SECRET = the secret → Save.
//  3. Deploy → New deployment → type: Web app → Execute as: Me · Who has access: Anyone → Deploy → copy the
//     Web app URL (ends in /exec) → in Lens Loop: Settings → Drive helper → paste → Save → then tap
//     Connect Google Drive once more and approve (Google now asks for "offline" access, which is the refresh token).
//  Also, in Google Cloud → Google Auth Platform → Audience, press "Publish app" if the app is still in Testing:
//  while an app is in Testing, Google expires its refresh tokens after seven days.
//
// What the helper will and will not do: it redeems codes only for the Lens Loop page address, it never sees
// your storylines or your Drive, and the refresh token it hands back lives only in the phone's storage.

const CLIENT_ID = '315454575795-hkrhb3ggevkjjufb4p5bh0ikv7smf5f8.apps.googleusercontent.com';
const PAGE_URL = 'https://ahmetkartal-99.github.io/lens-loop/';

function doPost(e) {
  let p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  const secret = PropertiesService.getScriptProperties().getProperty('CLIENT_SECRET');
  if (!secret) return out({ error: 'no_secret', error_description: 'CLIENT_SECRET is not set in the script properties' });
  let body;
  if (p.code) {
    const uri = String(p.redirect_uri || '').replace(/index\.html$/, '');
    if (uri !== PAGE_URL) return out({ error: 'bad_redirect', error_description: 'the code was not issued for the Lens Loop page' });
    body = { grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirect_uri };
  } else if (p.refresh_token) {
    body = { grant_type: 'refresh_token', refresh_token: p.refresh_token };
  } else {
    return out({ error: 'bad_request', error_description: 'send a code or a refresh_token' });
  }
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', payload: Object.assign({ client_id: CLIENT_ID, client_secret: secret }, body), muteHttpExceptions: true,
  });
  let j;
  try { j = JSON.parse(res.getContentText()); } catch (err) { j = { error: 'bad_answer', error_description: String(res.getContentText()).slice(0, 200) }; }
  return out(j);
}

function doGet() { return out({ ok: true, helper: 'lens-loop', note: 'POST a code or a refresh_token' }); }

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
