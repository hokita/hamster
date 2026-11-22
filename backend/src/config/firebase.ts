import { initializeApp } from 'firebase-admin/app'

export function initFirebase(): void {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
}
