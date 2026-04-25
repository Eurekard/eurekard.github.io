/**
 * grant-ga4-access.mjs
 * One-time script: grants the firebase-adminsdk service account
 * "VIEWER" access to the GA4 property using your local Firebase CLI login.
 *
 * Usage: node grant-ga4-access.mjs
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { google } from 'googleapis';

// ── Config ───────────────────────────────────────────────────
const GA4_PROPERTY_ID = '534431559';
const SERVICE_ACCOUNT_EMAIL = 'firebase-adminsdk-fbsvc@gen-lang-client-0158304921.iam.gserviceaccount.com';

// Firebase CLI stores credentials here on Windows
const FIREBASE_CREDS_PATH = join(homedir(), '.config', 'configstore', 'firebase-tools.json');

// Firebase CLI's public OAuth client (same credentials the CLI uses)
const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8xyqM_LXV9dHaKP-C';
// ─────────────────────────────────────────────────────────────

async function main() {
  // 1. Load stored Firebase CLI refresh token
  let refreshToken;
  try {
    const creds = JSON.parse(readFileSync(FIREBASE_CREDS_PATH, 'utf8'));
    refreshToken = creds?.tokens?.refresh_token;
    if (!refreshToken) throw new Error('No refresh_token found in credentials file');
  } catch (err) {
    console.error('❌ Could not read Firebase CLI credentials:', err.message);
    process.exit(1);
  }

  // 2. Set up OAuth2 client with the stored refresh token
  const auth = new google.auth.OAuth2(
    FIREBASE_CLI_CLIENT_ID,
    FIREBASE_CLI_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: refreshToken });

  // 3. Verify we can get an access token
  try {
    const { token } = await auth.getAccessToken();
    console.log('✅ OAuth2 access token obtained:', token?.slice(0, 20) + '...');
  } catch (err) {
    console.error('❌ Failed to get access token:', err.message);
    process.exit(1);
  }

  // 4. Call the Analytics Admin API to create a user link
  const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth });

  try {
    const res = await analyticsAdmin.properties.userLinks.create({
      parent: `properties/${GA4_PROPERTY_ID}`,
      requestBody: {
        emailAddress: SERVICE_ACCOUNT_EMAIL,
        directRoles: ['predefinedRoles/viewer'],
      },
    });
    console.log('✅ SUCCESS! Service account granted GA4 Viewer access:');
    console.log('   Property:', GA4_PROPERTY_ID);
    console.log('   Email:', SERVICE_ACCOUNT_EMAIL);
    console.log('   User link name:', res.data.name);
  } catch (err) {
    console.error('❌ Failed to add user link:');
    console.error('   Code:', err?.code);
    console.error('   Message:', err?.message);
    if (err?.errors) {
      err.errors.forEach(e => console.error('   Detail:', e.message));
    }
  }
}

main();
