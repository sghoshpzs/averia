import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { getAuth } from 'firebase/auth';

// All values are read from Vite env vars — see .env.example.
// Never hardcode these; Vite inlines them at build time.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);
// Must match the region in functions/index.js's setGlobalOptions() — a
// mismatch here makes the client call a Cloud Run URL where nothing is
// deployed, which the browser reports as a blocked CORS preflight rather
// than a clear "not found" error.
export const functions = getFunctions(app, 'asia-south1');
export const auth = getAuth(app);
export default app;
