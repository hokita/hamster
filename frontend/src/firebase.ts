import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

if (import.meta.env.VITE_E2E === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
}
