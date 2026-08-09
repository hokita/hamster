import { initializeApp } from 'firebase-admin/app'

// Cloud Run supplies a project ID via its metadata server; local dev has no
// such source, so verifyIdToken() fails with auth/invalid-credential unless
// it's passed explicitly here.
export function initFirebase(): void {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
}
