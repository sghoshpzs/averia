import { auth } from '../firebase';

const superUserEmail = String(import.meta.env.VITE_SUPER_USER || '').trim().toLowerCase();

// Gates the bulk-delete buttons on Inventory Summary and Ad-Hoc Expenses.
// UI-level only — firestore.rules currently allows any authenticated user
// to write/delete, so this does not stop a non-super-user from deleting via
// the API directly. Tighten the rules if that guarantee matters.
export function isSuperUser() {
  const email = auth.currentUser?.email;
  return Boolean(superUserEmail && email && email.trim().toLowerCase() === superUserEmail);
}
