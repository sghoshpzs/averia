// ============================================================================
// GOOGLE CONTACTS — ONE-TIME REFRESH TOKEN SETUP
// Run this once, locally, to mint the refresh token the syncGoogleContact
// Cloud Function needs (functions/googleContacts.js). See README "Google
// Contacts sync — one-time setup" for the full walkthrough — in short:
//
// 1. In Google Cloud Console (the same project as this Firebase app):
//    - APIs & Services -> Library -> enable "Google People API".
//    - APIs & Services -> Credentials -> Create Credentials -> OAuth client ID
//      -> Application type "Desktop app". Note the Client ID and Client Secret.
// 2. npm install googleapis   (run inside this scripts/ folder)
// 3. node get-google-contacts-token.js
//    - Paste the Client ID/Secret when prompted.
//    - Open the printed URL in a browser, and sign in as whichever Google
//      account should OWN these contacts (e.g. the shop's Google account —
//      NOT necessarily your own personal one).
//    - Approve access. The browser will redirect to a localhost URL that
//      this script is already listening on — it captures the code itself,
//      you don't need to copy anything from the browser.
// 4. The script prints a refresh token. Set it as a secret:
//      firebase functions:secrets:set GOOGLE_CONTACTS_CLIENT_ID
//      firebase functions:secrets:set GOOGLE_CONTACTS_CLIENT_SECRET
//      firebase functions:secrets:set GOOGLE_CONTACTS_REFRESH_TOKEN
//    then redeploy functions: firebase deploy --only functions
// ============================================================================

const http = require('http');
const readline = require('readline');
const { google } = require('googleapis');

const PORT = 53682; // arbitrary local port; only needs to match the redirect URI below
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = ['https://www.googleapis.com/auth/contacts'];

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

async function main() {
  const clientId = await ask('OAuth Client ID: ');
  const clientSecret = await ask('OAuth Client Secret: ');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token back at all
    prompt: 'consent', // forces a refresh_token even if this account already granted access before
    scope: SCOPES
  });

  console.log('\nOpen this URL, sign in as the Google account that should own these contacts, and approve access:\n');
  console.log(authUrl);
  console.log('\nWaiting for the redirect back to', REDIRECT_URI, '...\n');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      // The browser can hit this port with other requests before the real
      // OAuth redirect arrives (e.g. an automatic /favicon.ico probe) —
      // ignore anything that isn't actually the redirect instead of treating
      // the first request as gospel, or a stray request steals the resolve
      // with no code and getToken(null) below fails with a confusing error.
      if (!authCode && !error) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.end(error ? `Error: ${error}. You can close this tab.` : 'Success — you can close this tab and return to the terminal.');
      server.close();
      if (error) reject(new Error(error));
      else resolve(authCode);
    });
    server.listen(PORT);
  });

  if (!code) {
    throw new Error('No authorization code received from the redirect.');
  }

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      '\nNo refresh_token came back. This usually means this Google account already granted this exact ' +
      'app access before. Revoke it at https://myaccount.google.com/permissions and run this script again.'
    );
    process.exit(1);
  }

  console.log('\nRefresh token (set this as GOOGLE_CONTACTS_REFRESH_TOKEN):\n');
  console.log(tokens.refresh_token);
  console.log('\nAlso set GOOGLE_CONTACTS_CLIENT_ID and GOOGLE_CONTACTS_CLIENT_SECRET to the values you entered above.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
