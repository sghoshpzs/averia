// ============================================================================
// GOOGLE CONTACTS SYNC (People API)
// Pushes a customer's name/phone/email into the shop's real Google Contacts,
// authenticated as whichever Google account you ran the one-time OAuth setup
// for (see README "Google Contacts sync — one-time setup"). Free to use —
// the People API has no billing tier, just a generous per-minute quota.
// ============================================================================

const { google } = require('googleapis');

// Set these with:
//   firebase functions:secrets:set GOOGLE_CONTACTS_CLIENT_ID
//   firebase functions:secrets:set GOOGLE_CONTACTS_CLIENT_SECRET
//   firebase functions:secrets:set GOOGLE_CONTACTS_REFRESH_TOKEN
// See scripts/get-google-contacts-token.js to mint the refresh token.
const GOOGLE_CONTACTS_SECRETS = ['GOOGLE_CONTACTS_CLIENT_ID', 'GOOGLE_CONTACTS_CLIENT_SECRET', 'GOOGLE_CONTACTS_REFRESH_TOKEN'];

function peopleClient() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CONTACTS_CLIENT_ID, process.env.GOOGLE_CONTACTS_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_CONTACTS_REFRESH_TOKEN });
  return google.people({ version: 'v1', auth });
}

function personFields(name, phone, email) {
  return {
    names: [{ givenName: name }],
    phoneNumbers: phone ? [{ value: phone }] : [],
    emailAddresses: email ? [{ value: email }] : []
  };
}

// Creates the contact the first time this customer is synced, or updates the
// same contact in place on repeat purchases — `existingResourceName` (the
// customer's previously-saved contact id, if any) is what tells these apart,
// so a returning customer never ends up with duplicate contacts.
async function upsertGoogleContact({ name, phone, email, existingResourceName }) {
  const people = peopleClient();
  const fields = personFields(name, phone, email);

  if (existingResourceName) {
    try {
      // updateContact requires the contact's current etag (optimistic
      // concurrency control) — it has to be fetched fresh right before the
      // update, it's not something that can be cached from creation time.
      const current = await people.people.get({
        resourceName: existingResourceName,
        personFields: 'names,phoneNumbers,emailAddresses'
      });
      const res = await people.people.updateContact({
        resourceName: existingResourceName,
        updatePersonFields: 'names,phoneNumbers,emailAddresses',
        requestBody: { etag: current.data.etag, ...fields }
      });
      return res.data.resourceName;
    } catch (err) {
      // The previously-synced contact was deleted/moved on the Google side
      // — fall through and create a fresh one instead of failing the sync
      // outright over a stale reference this app can't do anything about.
      if (err.code !== 404) throw err;
    }
  }

  const res = await people.people.createContact({ requestBody: fields });
  return res.data.resourceName;
}

module.exports = { GOOGLE_CONTACTS_SECRETS, upsertGoogleContact };
