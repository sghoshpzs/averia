// ============================================================================
// GOOGLE CONTACTS SYNC (People API)
// Pushes a customer's name/phone/email into the shop's real Google Contacts,
// authenticated as whichever Google account you ran the one-time OAuth setup
// for (see README "Google Contacts sync — one-time setup"). Free to use —
// the People API has no billing tier, just a generous per-minute quota.
//
// Uses google-auth-library directly (just for the OAuth2 token handling) and
// plain REST calls to the People API, rather than the full `googleapis`
// package — that package takes ~4.5s just to require() (it eagerly loads
// generated clients for every Google API, not only People), which blew past
// Firebase's 10-second "discover your functions" timeout on deploy
// (https://firebase.google.com/docs/functions/tips#avoid_deployment_timeouts_during_initialization).
// google-auth-library alone loads in well under a second.
// ============================================================================

const { OAuth2Client } = require('google-auth-library');

// Set these with:
//   firebase functions:secrets:set GOOGLE_CONTACTS_CLIENT_ID
//   firebase functions:secrets:set GOOGLE_CONTACTS_CLIENT_SECRET
//   firebase functions:secrets:set GOOGLE_CONTACTS_REFRESH_TOKEN
// See scripts/get-google-contacts-token.js to mint the refresh token.
const GOOGLE_CONTACTS_SECRETS = ['GOOGLE_CONTACTS_CLIENT_ID', 'GOOGLE_CONTACTS_CLIENT_SECRET', 'GOOGLE_CONTACTS_REFRESH_TOKEN'];

const PEOPLE_API = 'https://people.googleapis.com/v1';
const PERSON_FIELDS = 'names,phoneNumbers,emailAddresses';

function oauthClient() {
  const client = new OAuth2Client(process.env.GOOGLE_CONTACTS_CLIENT_ID, process.env.GOOGLE_CONTACTS_CLIENT_SECRET);
  // client.request() below attaches/refreshes the access token from this
  // automatically — no manual token-refresh handling needed here.
  client.setCredentials({ refresh_token: process.env.GOOGLE_CONTACTS_REFRESH_TOKEN });
  return client;
}

function personFields(name, phone, email) {
  return {
    names: [{ givenName: name }],
    phoneNumbers: phone ? [{ value: phone }] : [],
    emailAddresses: email ? [{ value: email }] : []
  };
}

function isNotFound(err) {
  return err.response?.status === 404 || err.code === 404;
}

// Creates the contact the first time this customer is synced, or updates the
// same contact in place on repeat purchases — `existingResourceName` (the
// customer's previously-saved contact id, if any) is what tells these apart,
// so a returning customer never ends up with duplicate contacts.
async function upsertGoogleContact({ name, phone, email, existingResourceName }) {
  const client = oauthClient();
  const fields = personFields(name, phone, email);

  if (existingResourceName) {
    try {
      // updateContact requires the contact's current etag (optimistic
      // concurrency control) — it has to be fetched fresh right before the
      // update, it's not something that can be cached from creation time.
      const current = await client.request({
        url: `${PEOPLE_API}/${existingResourceName}`,
        params: { personFields: PERSON_FIELDS }
      });
      const res = await client.request({
        url: `${PEOPLE_API}/${existingResourceName}:updateContact`,
        method: 'PATCH',
        params: { updatePersonFields: PERSON_FIELDS },
        data: { etag: current.data.etag, ...fields }
      });
      return res.data.resourceName;
    } catch (err) {
      // The previously-synced contact was deleted/moved on the Google side
      // — fall through and create a fresh one instead of failing the sync
      // outright over a stale reference this app can't do anything about.
      if (!isNotFound(err)) throw err;
    }
  }

  const res = await client.request({
    url: `${PEOPLE_API}/people:createContact`,
    method: 'POST',
    data: fields
  });
  return res.data.resourceName;
}

module.exports = { GOOGLE_CONTACTS_SECRETS, upsertGoogleContact };
