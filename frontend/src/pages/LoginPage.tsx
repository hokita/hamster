import { useState } from 'react'
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  async function handleSignIn() {
    try {
      if (import.meta.env.VITE_E2E === 'true') {
        await signInWithEmailAndPassword(
          auth,
          import.meta.env.VITE_E2E_TEST_EMAIL,
          import.meta.env.VITE_E2E_TEST_PASSWORD
        )
      } else {
        const provider = new GoogleAuthProvider()
        await signInWithPopup(auth, provider)
      }
      setError(null)
    } catch {
      setError('Sign-in failed.')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh gap-6">
      <h1 className="text-3xl font-bold m-0">hamster</h1>
      <button
        onClick={handleSignIn}
        className="px-6 py-3 text-base cursor-pointer rounded-lg border border-gray-300 hover:bg-gray-50 active:bg-gray-100"
      >
        Sign in with Google
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}
